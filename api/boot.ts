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
// Endpoint REST directo para registro (bypass tRPC bug)
app.post("/api/register-direct", async (c) => {
  try {
    const body = await c.req.json();
    const { email, username, password } = body;
    
    // Validación básica
    if (!email || !username || !password || password.length < 8) {
      return c.json({ error: "Datos inválidos" }, 400);
    }
    
    const db = (await import("./queries/connection")).getDb();
    const { users, emailVerificationCodes } = await import("@db/schema");
    const { eq } = await import("drizzle-orm");
    const { hashPassword, generateVerificationCode } = await import("./lib/auth");
    const { sendEmail, verificationEmailHtml } = await import("./lib/email");
    const { env } = await import("./lib/env");
    
    const emailLower = email.toLowerCase().trim();
    
    // Verificar si ya existe
    const existing = await db.query.users.findFirst({
      where: eq(users.email, emailLower),
    });
    if (existing) {
      return c.json({ error: "Ya existe una cuenta con ese correo." }, 409);
    }
    
    // Crear usuario
    const role = env.adminEmail && emailLower === env.adminEmail ? "admin" : "member";
    const [result] = await db.insert(users).values({
      email: emailLower,
      username: username.trim(),
      passwordHash: await hashPassword(password),
      role,
    });
    
    const userId = Number(result.insertId);
    
    // Generar código de verificación
    const code = generateVerificationCode();
    await db.insert(emailVerificationCodes).values({
      userId,
      code,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    
    // Enviar email
    await sendEmail({
      to: emailLower,
      subject: "DES Informantes - Verifica tu correo",
      html: verificationEmailHtml(code, username.trim()),
    });
    
    return c.json({ ok: true, userId });
    
  } catch (e: any) {
    console.error("[register-direct] Error:", e);
    return c.json({ error: "Error interno: " + e.message }, 500);
  }
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
