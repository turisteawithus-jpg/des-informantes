import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import { appRouter } from "./router";
import { env } from "./lib/env";
import { uploadRouter } from "./uploads";
import restAuth from "./restAuth";
import restWorkspaces from "./restWorkspaces";
import { getDb } from "./queries/connection";
import {
  discussionModerationStates,
  discussionMessages,
  discussions,
  users,
  workspaces,
  workspaceMembers,
} from "@db/schema";
import { eq, asc } from "drizzle-orm";
import { generateTopicList } from "./lib/groqModerator";
import { attachCollabServer } from "./lib/collab";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

// tRPC via nodeHTTPRequestHandler usando Hono bindings
// Fix: tRPC bug #6091 - normalizar req.url para que empiece con "/"
app.use("/api/trpc/*", async (c) => {
  const incoming = c.env.incoming;
  const outgoing = c.env.outgoing;

  // Fix: asegurar que req.url empiece con "/" (tRPC bug #6091)
  if (incoming.url && !incoming.url.startsWith("/")) {
    incoming.url = "/" + incoming.url;
  }

  const path = c.req.path.replace("/api/trpc/", "").replace("/api/trpc", "");

  await nodeHTTPRequestHandler({
    req: incoming,
    res: outgoing,
    path,
    router: appRouter,
    createContext: () => ({ req: incoming, res: outgoing }),
    batching: { enabled: true },
  });

  return c.body(null);
});

app.route("/api/upload", uploadRouter);
app.route("/api", uploadRouter);
app.route("/api/rest", restAuth);
app.route("/api/rest/workspaces", restWorkspaces);
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

if (env.isProduction) {
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);
}

/* ================================================================
   MOTOR DEL MODERADOR IA
   Cada 12 segundos revisa las discusiones con moderador activo:
   - En la ronda de propuesta de temas, extrae SOLO los temas que
     los participantes escribieron (nunca inventa).
   - Aplica la regla vigente de intervenciones por ronda
     (minimo 5; 50% de los miembros desde 12).
   Cuando una ronda de fases se completa, el motor NO avanza solo:
   el moderador (persona) decide en la app si hay otra ronda o si
   se abre el siguiente momento, y el anuncio le llega a TODOS.
   ================================================================ */
const processingModeration = new Set<number>();

async function processCompletedRounds() {
  try {
    const db = getDb();
    const states = await db
      .select()
      .from(discussionModerationStates)
      .where(eq(discussionModerationStates.active, true));

    for (const st of states) {
      if (st.interventionsCompleted < st.interventionsRequired) continue;
      if (processingModeration.has(st.discussionId)) continue;
      processingModeration.add(st.discussionId);
      try {
        const disc = await db.query.discussions.findFirst({
          where: eq(discussions.id, st.discussionId),
        });
        if (!disc) continue;

        // Regla de rondas vigente: minimo 5 intervenciones; 50% de los miembros
        // solo cuando la mesa tiene 12 o mas. Se aplica sola a discusiones ya activas.
        const memberRows = await db
          .select()
          .from(workspaceMembers)
          .where(eq(workspaceMembers.workspaceId, disc.workspaceId));
        const requiredNow = memberRows.length >= 12 ? Math.ceil(memberRows.length / 2) : 5;
        if (requiredNow !== st.interventionsRequired) {
          await db
            .update(discussionModerationStates)
            .set({ interventionsRequired: requiredNow, updatedAt: new Date() })
            .where(eq(discussionModerationStates.discussionId, st.discussionId));
          console.log(`[moderador] Discusion ${st.discussionId}: ronda ajustada a ${requiredNow} intervenciones (${memberRows.length} miembros)`);
          if (st.interventionsCompleted < requiredNow) continue;
        }

        let topics: string[] = [];
        try { topics = st.topics ? JSON.parse(st.topics) : []; } catch { topics = []; }

        // Si ya hay temas definidos y la ronda se completo, el motor NO avanza solo:
        // queda en pausa hasta que el moderador (persona) decida en la app si hay
        // otra ronda de palabras o si se abre el siguiente momento.
        if (topics.length > 0) continue;

        // RONDA DE PROPUESTA DE TEMAS: los temas los definen LOS PARTICIPANTES.
        // La IA SOLO extrae y organiza lo que ellos propusieron; nunca inventa temas.
        const rows = await db
          .select({
            userId: discussionMessages.userId,
            type: discussionMessages.type,
            content: discussionMessages.content,
          })
          .from(discussionMessages)
          .where(eq(discussionMessages.discussionId, st.discussionId))
          .orderBy(asc(discussionMessages.createdAt))
          .limit(120);

        const nameMap = new Map<number, string>();
        for (const uid of [...new Set(rows.map((r) => r.userId))]) {
          const u = await db.query.users.findFirst({ where: eq(users.id, uid) });
          if (u) nameMap.set(uid, u.username);
        }
        const msgs = rows
          .filter((r) => r.content)
          .map((r) => ({
            username: nameMap.get(r.userId) || "Participante",
            type: r.type,
            content: r.content || "",
          }));

        const ws = await db.query.workspaces.findFirst({
          where: eq(workspaces.id, disc.workspaceId),
        });

        const aiTopics = await generateTopicList(ws?.name || "Proyecto", disc.title, msgs);
        if (!aiTopics || aiTopics.length === 0) {
          // Nadie ha propuesto temas todavia (o error tecnico): abre una nueva
          // ronda de palabras y sigue esperando propuestas de los participantes.
          await db
            .update(discussionModerationStates)
            .set({
              interventionsCompleted: 0,
              wordRound: st.wordRound + 1,
              updatedAt: new Date(),
            })
            .where(eq(discussionModerationStates.discussionId, st.discussionId));
          console.log(
            aiTopics === null
              ? `[moderador] Discusion ${st.discussionId}: error tecnico al extraer temas, se reintentara en la proxima ronda`
              : `[moderador] Discusion ${st.discussionId}: aun no hay temas propuestos por los participantes, esperando nueva ronda`,
          );
          continue;
        }
        const finalTopics = aiTopics.slice(0, 8);
        await db
          .update(discussionModerationStates)
          .set({
            topics: JSON.stringify(finalTopics),
            currentTopicIndex: 0,
            currentPhase: "apertura",
            interventionsCompleted: 0,
            wordRound: st.wordRound + 1,
            updatedAt: new Date(),
          })
          .where(eq(discussionModerationStates.discussionId, st.discussionId));
        console.log(`[moderador] Discusion ${st.discussionId}: ${finalTopics.length} temas extraidos de las propuestas de los participantes`);
        continue;
      } finally {
        processingModeration.delete(st.discussionId);
      }
    }
  } catch (e: any) {
    console.error("[moderador] Error en ciclo:", e.message);
  }
}

setInterval(processCompletedRounds, 12000);

const server = serve({
  fetch: app.fetch,
  port: parseInt(process.env.PORT || "3000"),
}, (info) => {
  console.log(`Server running on http://localhost:${info.port}/`);
});

// Edicion en vivo de documentos (WebSocket en el mismo puerto, ruta /collab/)
attachCollabServer(server);

export default app;
