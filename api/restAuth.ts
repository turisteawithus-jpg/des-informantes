import { Hono } from "hono";
import { getDb } from "./queries/connection";
import { users, emailVerificationCodes } from "@db/schema";
import { eq } from "drizzle-orm";
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  sessionCookieHeader,
  clearSessionCookieHeader,
  getSessionFromRequest,
  generateVerificationCode,
} from "./lib/auth";
import { sendEmail, verificationEmailHtml } from "./lib/email";
import { env } from "./lib/env";

const restAuth = new Hono();
// Endpoints de diagnóstico
restAuth.get("/ping", (c) => {
  console.log("[DIAG] GET ping received");
  return c.json({ ok: true, time: Date.now() });
});

restAuth.post("/ping", async (c) => {
  console.log("[DIAG] POST ping received");
  try {
    const body = await c.req.json();
    console.log("[DIAG] body:", JSON.stringify(body));
    return c.json({ ok: true, received: body });
  } catch (e: any) {
    console.log("[DIAG] body parse error:", e.message);
    return c.json({ error: "parse: " + e.message }, 400);
  }
});

// Registro directo (sin tRPC)
restAuth.post("/register", async (c) => {
  try {
    console.log("[register] Step 1: Parsing body");
    const body = await c.req.json();
    const { email, username, password } = body;
    console.log("[register] Step 2: Body parsed", { email, username });

    if (!email || !username || !password || password.length < 8) {
      return c.json({ error: "Datos inválidos. La contraseña debe tener al menos 8 caracteres." }, 400);
    }

    console.log("[register] Step 3: Getting DB");
    const db = getDb();
    const emailLower = email.toLowerCase().trim();
    console.log("[register] Step 4: Checking existing user");

    const existing = await db.query.users.findFirst({
      where: eq(users.email, emailLower),
    });
    if (existing) {
      return c.json({ error: "Ya existe una cuenta con ese correo." }, 409);
    }

    console.log("[register] Step 5: Creating user");
    const role = env.adminEmail && emailLower === env.adminEmail ? "admin" : "member";

    const [result] = await db.insert(users).values({
      email: emailLower,
      username: username.trim(),
      passwordHash: await hashPassword(password),
      role,
    });

    console.log("[register] Step 6: User created, ID:", result.insertId);
    const userId = Number(result.insertId);
    
    console.log("[register] Step 7: Generating code");
    const code = generateVerificationCode();
    
    console.log("[register] Step 8: Inserting code");
    await db.insert(emailVerificationCodes).values({
      userId,
      code,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    console.log("[register] Step 9: Sending email to:", emailLower);
    console.log("[register] Step 9a: resendFrom:", env.resendFrom);
    console.log("[register] Step 9b: resendApiKey exists:", !!env.resendApiKey);
    
    const sendResult = await sendEmail({
      to: emailLower,
      subject: "DES Informantes - Verifica tu correo",
      html: verificationEmailHtml(code, username.trim()),
    });

    console.log("[register] Step 10: Email result:", sendResult);

    return c.json({ ok: true, userId });

  } catch (e: any) {
    console.error("[register] CRASH at step unknown:", e.message);
    console.error("[register] Stack:", e.stack);
    return c.json({ error: "Error interno: " + e.message }, 500);
  }
});

// Login directo (sin tRPC)
restAuth.post("/login", async (c) => {
  try {
    const body = await c.req.json();
    const { email, password } = body;

    const db = getDb();
    const emailLower = email.toLowerCase().trim();

    const user = await db.query.users.findFirst({
      where: eq(users.email, emailLower),
    });

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return c.json({ error: "Correo o contraseña incorrectos." }, 401);
    }

    if (!user.emailVerified) {
      return c.json({ error: "Debes verificar tu correo antes de entrar." }, 403);
    }

    const token = createSessionToken({
      userId: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    });

    c.header("Set-Cookie", sessionCookieHeader(token));
    return c.json({ ok: true, role: user.role, username: user.username });

  } catch (e: any) {
    console.error("[login] Error:", e);
    return c.json({ error: "Error interno: " + e.message }, 500);
  }
});

// Verificar email
restAuth.post("/verify-email", async (c) => {
  try {
    const body = await c.req.json();
    const { email, code } = body;

    const db = getDb();
    const emailLower = email.toLowerCase().trim();

    const user = await db.query.users.findFirst({
      where: eq(users.email, emailLower),
    });
    if (!user) {
      return c.json({ error: "No existe esa cuenta." }, 404);
    }

    const { and } = await import("drizzle-orm");
    const record = await db.query.emailVerificationCodes.findFirst({
      where: and(
        eq(emailVerificationCodes.userId, user.id),
        eq(emailVerificationCodes.code, code),
        eq(emailVerificationCodes.used, false),
      ),
    });

    if (!record || record.expiresAt.getTime() < Date.now()) {
      return c.json({ error: "Código incorrecto o expirado." }, 400);
    }

    await db.update(emailVerificationCodes).set({ used: true }).where(eq(emailVerificationCodes.id, record.id));
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, user.id));

    const token = createSessionToken({
      userId: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    });

    c.header("Set-Cookie", sessionCookieHeader(token));
    return c.json({ ok: true, role: user.role });

  } catch (e: any) {
    console.error("[verify] Error:", e);
    return c.json({ error: "Error interno: " + e.message }, 500);
  }
});

// Sesión actual
restAuth.get("/me", async (c) => {
  const session = getSessionFromRequest(c.req.raw);
  return c.json({ session });
});

// Cerrar sesión
restAuth.post("/logout", async (c) => {
  c.header("Set-Cookie", clearSessionCookieHeader());
  return c.json({ ok: true });
});

/* ================================================================
   CHAT GLOBAL PÚBLICO
   ================================================================ */

// GET /api/rest/global-chat — listar mensajes (público)
restAuth.get("/global-chat", async (c) => {
  const db = getDb();
  const { globalChatMessages, users } = await import("@db/schema");
  const { desc, eq } = await import("drizzle-orm");
  const msgs = await db
    .select({
      id: globalChatMessages.id,
      content: globalChatMessages.content,
      createdAt: globalChatMessages.createdAt,
      userId: globalChatMessages.userId,
      username: users.username,
    })
    .from(globalChatMessages)
    .innerJoin(users, eq(globalChatMessages.userId, users.id))
    .orderBy(desc(globalChatMessages.createdAt))
    .limit(100);
  return c.json(msgs);
});

// POST /api/rest/global-chat — enviar mensaje (requiere auth)
restAuth.post("/global-chat", async (c) => {
  const user = getSessionFromRequest(c.req.raw);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const body = await c.req.json();
  const content = body.content?.trim();
  if (!content || content.length < 1 || content.length > 2000) {
    return c.json({ error: "Mensaje invalido" }, 400);
  }
  const db = getDb();
  const { globalChatMessages } = await import("@db/schema");
  await db.insert(globalChatMessages).values({
    userId: user.userId,
    content,
  });
  return c.json({ ok: true });
});

/* ================================================================
   REENVIAR CODIGO DE VERIFICACION
   ================================================================ */
restAuth.post("/resend-code", async (c) => {
  try {
    const body = await c.req.json();
    const email = body.email?.toLowerCase()?.trim();
    if (!email) return c.json({ error: "Email requerido" }, 400);

    const db = getDb();
    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (!user) return c.json({ error: "Usuario no encontrado" }, 404);
    if (user.emailVerified) return c.json({ ok: true, alreadyVerified: true });

    // Generar nuevo codigo
    const code = generateVerificationCode();

    // Insertar nuevo codigo
    await db.insert(emailVerificationCodes).values({
      userId: user.id,
      code,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    // Enviar email
    const result = await sendEmail({
      to: email,
      subject: "DES Informantes - Nuevo codigo de verificacion",
      html: verificationEmailHtml(code, user.username),
    });

    return c.json({ ok: true, devMode: result.devMode });
  } catch (e: any) {
    console.error("[resend-code] Error:", e);
    return c.json({ error: "Error interno" }, 500);
  }
});

export default restAuth;
