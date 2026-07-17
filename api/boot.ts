import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import { appRouter } from "./router";
import { env } from "./lib/env";
import { uploadRouter } from "./uploads";

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
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

if (env.isProduction) {
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);
}

serve({
  fetch: app.fetch,
  port: parseInt(process.env.PORT || "3000"),
}, (info) => {
  console.log(`Server running on http://localhost:${info.port}/`);
});

export default app;
