import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createServer } from "node:http";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { uploadRouter } from "./uploads";

const honoApp = new Hono();

honoApp.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
honoApp.route("/api/upload", uploadRouter);
honoApp.route("/api", uploadRouter);
honoApp.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

// Servidor HTTP que routea entre tRPC y Hono
const server = createServer((req, res) => {
  if (req.url?.startsWith("/api/trpc")) {
    const path = req.url.replace("/api/trpc/", "").split("?")[0];
    nodeHTTPRequestHandler({
      req,
      res,
      path,
      router: appRouter,
      createContext: () => createContext({ req, res }),
    });
  } else {
    honoApp.fetch(req, res);
  }
});

if (env.isProduction) {
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(honoApp);

  const port = parseInt(process.env.PORT || "3000");
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

export default honoApp;
