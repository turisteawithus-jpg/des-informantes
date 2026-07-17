import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery, authedProcedure } from "../middleware";
import { getDb } from "../queries/connection";
import { emailVerificationCodes, users } from "@db/schema";
import {
  clearSessionCookieHeader,
  createSessionToken,
  generateVerificationCode,
  hashPassword,
  sessionCookieHeader,
  verifyPassword,
} from "../lib/auth";
import { sendEmail, verificationEmailHtml } from "../lib/email";
import { env } from "../lib/env";

const CODE_TTL_MINUTES = 30;

async function issueVerificationCode(userId: number): Promise<string> {
  const db = getDb();
  const code = generateVerificationCode();
  await db.insert(emailVerificationCodes).values({
    userId,
    code,
    expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
  });
  return code;
}

function setCookie(res: any, cookie: string) {
  const existing = res.getHeader("Set-Cookie");
  if (existing) {
    res.setHeader("Set-Cookie", Array.isArray(existing) ? [...existing, cookie] : [existing, cookie]);
  } else {
    res.setHeader("Set-Cookie", cookie);
  }
}

export const authRouter = createRouter({
  me: publicQuery.query(async ({ ctx }) => {
    const { getSessionFromRequest } = await import("../lib/auth");
    return getSessionFromRequest(ctx.req);
  }),

  register: publicQuery
    .input(
      z.object({
        email: z.string().email("Correo inválido"),
        username: z.string().min(2, "El nombre de usuario es muy corto").max(80),
        password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const email = input.email.toLowerCase().trim();

      const existing = await db.query.users.findFirst({
        where: eq(users.email, email),
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Ya existe una cuenta con ese correo.",
        });
      }

      const role =
        env.adminEmail && email === env.adminEmail ? "admin" : "member";

      const [result] = await db.insert(users).values({
        email,
        username: input.username.trim(),
        passwordHash: await hashPassword(input.password),
        role,
      });

      const userId = Number(result.insertId);
      const code = await issueVerificationCode(userId);
      const sendResult = await sendEmail({
        to: email,
        subject: "DES Informantes - Verifica tu correo",
        html: verificationEmailHtml(code, input.username.trim()),
      });

      return {
        ok: true,
        userId,
        emailSent: sendResult.ok,
        devMode: sendResult.devMode,
      };
    }),

  resendCode: publicQuery
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const email = input.email.toLowerCase().trim();
      const user = await db.query.users.findFirst({
        where: eq(users.email, email),
      });
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No existe esa cuenta." });
      }
      if (user.emailVerified) {
        return { ok: true, alreadyVerified: true, devMode: false };
      }
      const code = await issueVerificationCode(user.id);
      const sendResult = await sendEmail({
        to: email,
        subject: "DES Informantes - Tu nuevo código de verificación",
        html: verificationEmailHtml(code, user.username),
      });
      return { ok: true, alreadyVerified: false, devMode: sendResult.devMode };
    }),

  verifyEmail: publicQuery
    .input(
      z.object({
        email: z.string().email(),
        code: z.string().length(6, "El código tiene 6 dígitos"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const email = input.email.toLowerCase().trim();
      const user = await db.query.users.findFirst({
        where: eq(users.email, email),
      });
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No existe esa cuenta." });
      }

      const record = await db.query.emailVerificationCodes.findFirst({
        where: and(
          eq(emailVerificationCodes.userId, user.id),
          eq(emailVerificationCodes.code, input.code),
          eq(emailVerificationCodes.used, false),
        ),
        orderBy: [desc(emailVerificationCodes.createdAt)],
      });

      if (!record || record.expiresAt.getTime() < Date.now()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Código incorrecto o expirado. Solicita uno nuevo.",
        });
      }

      await db
        .update(emailVerificationCodes)
        .set({ used: true })
        .where(eq(emailVerificationCodes.id, record.id));
      await db
        .update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, user.id));

      const token = createSessionToken({
        userId: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      });
      setCookie(ctx.res, sessionCookieHeader(token));

      return { ok: true, role: user.role };
    }),

  login: publicQuery
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const email = input.email.toLowerCase().trim();
      const user = await db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Correo o contraseña incorrectos.",
        });
      }
      if (!user.emailVerified) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Debes verificar tu correo antes de entrar.",
        });
      }

      const token = createSessionToken({
        userId: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      });
      setCookie(ctx.res, sessionCookieHeader(token));

      return { ok: true, role: user.role, username: user.username };
    }),

  logout: authedProcedure.mutation(({ ctx }) => {
    setCookie(ctx.res, clearSessionCookieHeader());
    return { ok: true };
  }),
});
