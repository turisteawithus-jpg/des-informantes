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
import { startSchedulers } from "./lib/reminders";

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
   REGLA DE RONDAS (motor ligero)
   Cada 12 segundos mantiene actualizada la cantidad de intervenciones
   requeridas por ronda (minimo 5; 50% de los miembros desde 12).

   NADA AVANZA SOLO: ni los temas ni los momentos. Cuando una ronda se
   completa (incluida la ronda de propuesta de temas), el moderador
   (persona) decide en la app si hay OTRA RONDA o si se AVANZA, y el
   anuncio le llega a TODOS. Las conclusiones de cada momento solo se
   generan cuando el moderador decide pasar al siguiente momento.
   ================================================================ */
async function keepRoundRuleUpdated() {
  try {
    const db = getDb();
    const states = await db
      .select()
      .from(discussionModerationStates)
      .where(eq(discussionModerationStates.active, true));

    for (const st of states) {
      const disc = await db.query.discussions.findFirst({
        where: eq(discussions.id, st.discussionId),
      });
      if (!disc) continue;

      // Regla vigente: minimo 5 intervenciones; 50% de los miembros
      // solo cuando la mesa tiene 12 o mas.
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
      }
    }
  } catch (e: any) {
    console.error("[moderador] Error en ciclo:", e.message);
  }
}

setInterval(keepRoundRuleUpdated, 12000);

// Tareas programadas: recordatorios de compromisos (1:50 PM) y
// limpieza mensual de los chats personales (solo se conserva el ultimo mes)
startSchedulers();

const server = serve({
  fetch: app.fetch,
  port: parseInt(process.env.PORT || "3000"),
}, (info) => {
  console.log(`Server running on http://localhost:${info.port}/`);
});

// Edicion en vivo de documentos (WebSocket en el mismo puerto, ruta /collab/)
attachCollabServer(server);

export default app;
