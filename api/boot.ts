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
  moderationConclusions,
  discussionMessages,
  discussions,
  users,
  workspaces,
} from "@db/schema";
import { eq, asc } from "drizzle-orm";
import {
  generateModeratorConclusion,
  generateTopicList,
  nextPhaseKeyServer,
  PHASE_ORDER_SERVER,
  PHASE_INFO_SERVER,
} from "./lib/groqModerator";

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
   MOTOR DEL MODERADOR IA (automatico)
   Cada 12 segundos revisa las discusiones con moderador activo.
   Cuando una ronda de palabras se completa:
     1. La IA genera la conclusion objetiva de la fase.
     2. La guarda en el historial (alimenta la relatoria en proceso).
     3. Avanza automaticamente a la siguiente fase.
   El frontend detecta el cambio y muestra el anuncio grande.
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

        let topics: string[] = [];
        try { topics = st.topics ? JSON.parse(st.topics) : []; } catch { topics = []; }

        // RONDA DE SELECCION DE TEMAS: la IA extrae y organiza los temas propuestos
        if (topics.length === 0) {
          const aiTopics = await generateTopicList(ws?.name || "Proyecto", disc.title, msgs);
          const finalTopics = (aiTopics && aiTopics.length > 0 ? aiTopics : ["Tema general"]).slice(0, 8);
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
          console.log(`[moderador] Discusion ${st.discussionId}: ${finalTopics.length} temas definidos por la IA`);
          continue;
        }

        // RONDA DE FASE dentro del tema actual: la IA genera la conclusion
        const topicTitle = topics[st.currentTopicIndex] || "Tema general";
        const conclusion = await generateModeratorConclusion(
          ws?.name || "Proyecto",
          disc.title,
          st.currentPhase,
          topicTitle,
          msgs,
        );

        await db.insert(moderationConclusions).values({
          discussionId: st.discussionId,
          phase: st.currentPhase,
          topicIndex: st.currentTopicIndex,
          title:
            conclusion?.title ||
            `Conclusion de la fase ${PHASE_INFO_SERVER[st.currentPhase]?.name ?? st.currentPhase}`,
          content:
            conclusion?.content ||
            "La IA no pudo generar la conclusion en este momento. El moderador reintentara en la proxima ronda.",
        });

        const isLastPhase =
          PHASE_ORDER_SERVER.indexOf(st.currentPhase as any) ===
          PHASE_ORDER_SERVER.length - 1;
        const hasMoreTopics = st.currentTopicIndex + 1 < topics.length;

        if (isLastPhase && hasMoreTopics) {
          // Tema concluido: pasa al siguiente tema, la relatoria en proceso se reinicia
          await db
            .update(discussionModerationStates)
            .set({
              currentTopicIndex: st.currentTopicIndex + 1,
              currentPhase: "apertura",
              interventionsCompleted: 0,
              wordRound: st.wordRound + 1,
              updatedAt: new Date(),
            })
            .where(eq(discussionModerationStates.discussionId, st.discussionId));
          console.log(`[moderador] Discusion ${st.discussionId}: tema ${st.currentTopicIndex + 1} concluido, avanza al tema ${st.currentTopicIndex + 2}`);
        } else if (isLastPhase && !hasMoreTopics) {
          // Ultimo tema concluido: el moderador termina su labor
          await db
            .update(discussionModerationStates)
            .set({ active: false, updatedAt: new Date() })
            .where(eq(discussionModerationStates.discussionId, st.discussionId));
          console.log(`[moderador] Discusion ${st.discussionId}: moderacion finalizada`);
        } else {
          await db
            .update(discussionModerationStates)
            .set({
              currentPhase: nextPhaseKeyServer(st.currentPhase) as any,
              interventionsCompleted: 0,
              wordRound: st.wordRound + 1,
              updatedAt: new Date(),
            })
            .where(eq(discussionModerationStates.discussionId, st.discussionId));
          console.log(
            `[moderador] Discusion ${st.discussionId}: fase ${st.currentPhase} concluida, avanza automaticamente`,
          );
        }
      } finally {
        processingModeration.delete(st.discussionId);
      }
    }
  } catch (e: any) {
    console.error("[moderador] Error en ciclo:", e.message);
  }
}

setInterval(processCompletedRounds, 12000);

serve({
  fetch: app.fetch,
  port: parseInt(process.env.PORT || "3000"),
}, (info) => {
  console.log(`Server running on http://localhost:${info.port}/`);
});

export default app;
