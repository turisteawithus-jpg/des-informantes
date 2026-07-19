import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { parse as parseCookies, serialize as serializeCookie } from "cookie";
import { env } from "./env";

export const SESSION_COOKIE = "titerehub_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 días

export type SessionPayload = {
  userId: number;
  email: string;
  username: string;
  role: "admin" | "member";
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createSessionToken(payload: SessionPayload): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: SESSION_TTL_SECONDS,
  });
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, env.jwtSecret) as SessionPayload;
  } catch {
    return null;
  }
}

export function sessionCookieHeader(token: string): string {
  return serializeCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure, // false por defecto: la sesion funciona por HTTP y HTTPS; activa COOKIE_SECURE=1 con HTTPS
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookieHeader(): string {
  return serializeCookie(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: env.cookieSecure, // false por defecto: la sesion funciona por HTTP y HTTPS; activa COOKIE_SECURE=1 con HTTPS
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

// Fix: funciona con Request (Fetch) y IncomingMessage (Node.js)
export function getSessionFromRequest(
  req: Request | { headers: { cookie?: string } }
): SessionPayload | null {
  let header: string | undefined;

  if ("headers" in req) {
    if (typeof (req.headers as any).get === "function") {
      header = (req.headers as any).get("cookie") || undefined;
    } else {
      header = (req.headers as any).cookie;
    }
  }

  if (!header) return null;
  const cookies = parseCookies(header);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  return verifySessionToken(token);
}

export function generateVerificationCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
