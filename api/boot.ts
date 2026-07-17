import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { uploadRouter } from "./uploads";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

// Fix: usar adapter node-http de tRPC (diseñado para Node.js)
app.use("/api/trpc/*", async (c) => {
  const nodeReq = c.env.incoming;
  const nodeRes = c.env.outgoing;

  await nodeHTTPRequestHandler({
    req: nodeReq,
    res: nodeRes,
    path: c.req.path.replace("/api/trpc/", "").replace("/api/trpc", ""),
    router: appRouter,
    createContext: () => createContext({ req: c.req.raw, resHeaders: c.res.headers }),
    batching: { enabled: true },
  });

  return c.body(null);
});

app.route("/api/upload", uploadRouter);
app.route("/api", uploadRouter);
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
