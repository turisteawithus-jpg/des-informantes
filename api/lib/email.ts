import { env } from "./env";
import nodemailer from "nodemailer";

type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
};

// Crear transporte de Gmail SMTP (se crea una sola vez)
const gmailTransporter = env.gmailUser && env.gmailAppPassword
  ? nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: env.gmailUser,
        pass: env.gmailAppPassword,
      },
    })
  : null;

export async function sendEmail({
  to,
  subject,
  html,
}: SendEmailParams): Promise<{ ok: boolean; devMode: boolean }> {
  console.log(
    `[email] Canal de envio: ${
      gmailTransporter
        ? `Gmail SMTP (${env.gmailUser})`
        : env.resendApiKey
          ? `Resend (from: ${env.resendFrom})`
          : "MODO DESARROLLO (no sale ningun correo real)"
    } -> ${to}`,
  );
  // Si no hay Gmail configurado, usar Resend como fallback, o modo desarrollo
  if (!gmailTransporter) {
    // Intentar Resend como fallback
    if (env.resendApiKey) {
      try {
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ from: env.resendFrom, to, subject, html }),
        });
        if (!resp.ok) {
          const text = await resp.text();
          console.error(`[email] Resend error (${resp.status}): ${text}`);
          return { ok: false, devMode: false };
        }
        return { ok: true, devMode: false };
      } catch (e: any) {
        console.error("[email] Resend fallback error:", e.message);
      }
    }
    // Modo desarrollo: solo log en consola
    console.log("-------- CORREO (modo desarrollo) --------");
    console.log(`Para: ${to}`);
    console.log(`Asunto: ${subject}`);
    console.log(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    console.log("------------------------------------------");
    return { ok: true, devMode: true };
  }

  // Enviar via Gmail SMTP
  try {
    await gmailTransporter.sendMail({
      from: `"DES Informantes" <${env.gmailUser}>`,
      to,
      subject,
      html,
    });
    console.log(`[email] Enviado a ${to} via Gmail: ${subject}`);
    return { ok: true, devMode: false };
  } catch (e: any) {
    console.error("[email] Gmail error:", e.message);
    return { ok: false, devMode: false };
  }
}

export function verificationEmailHtml(code: string, username: string): string {
  return `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; background:#f8fafc; padding:32px;">
    <div style="max-width:520px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,.08);">
      <div style="background:linear-gradient(135deg,#0a2540,#1a5276); padding:28px 32px; text-align:center;">
        <h1 style="color:#ffffff; margin:0; font-size:26px; letter-spacing:.5px;">DES Informantes</h1>
        <p style="color:#e2e8f0; margin:6px 0 0; opacity:.85; font-size:14px;">Mas alla del relato, estan los hechos.</p>
      </div>
      <div style="padding:32px;">
        <p style="color:#1e293b; font-size:16px;">Hola, <strong>${username}</strong>!</p>
        <p style="color:#475569; font-size:15px; line-height:1.6;">
          Gracias por registrarte en DES Informantes. Para activar tu cuenta, ingresa este codigo
          de verificacion en la plataforma:
        </p>
        <div style="text-align:center; margin:28px 0;">
          <span style="display:inline-block; background:#f1f5f9; border:2px dashed #0a2540; border-radius:12px; padding:14px 32px; font-size:32px; font-weight:bold; letter-spacing:8px; color:#0a2540;">
            ${code}
          </span>
        </div>
        <p style="color:#64748b; font-size:13px; line-height:1.5;">
          El codigo expira en 30 minutos. Si no creaste esta cuenta, ignora este mensaje.
        </p>
      </div>
      <div style="background:#f8fafc; padding:16px 32px; text-align:center;">
        <p style="color:#94a3b8; font-size:12px; margin:0;">
          DES Informantes - Comunidad de periodismo investigativo
        </p>
      </div>
    </div>
  </div>`;
}
