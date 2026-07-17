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

export default restAuth;
