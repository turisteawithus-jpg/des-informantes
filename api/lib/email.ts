import { env } from "./env";

type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
};

/**
 * Envío de correos con Resend (API REST, sin dependencias extra).
 * Si no hay API key configurada (entorno de desarrollo), el correo
 * se escribe en consola y se considera "enviado" para poder probar.
 */
export async function sendEmail({
  to,
  subject,
  html,
}: SendEmailParams): Promise<{ ok: boolean; devMode: boolean }> {
  if (!env.resendApiKey) {
    console.log("──────── CORREO (modo desarrollo) ────────");
    console.log(`Para: ${to}`);
    console.log(`Asunto: ${subject}`);
    console.log(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    console.log("──────────────────────────────────────────");
    return { ok: true, devMode: true };
  }

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
    console.error(`[email] Error enviando correo (${resp.status}): ${text}`);
    return { ok: false, devMode: false };
  }
  return { ok: true, devMode: false };
}

export function verificationEmailHtml(code: string, username: string): string {
  return `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; background:#FBF7EF; padding:32px;">
    <div style="max-width:520px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,.08);">
      <div style="background:linear-gradient(135deg,#7C1D2E,#B91C1C); padding:28px 32px; text-align:center;">
        <h1 style="color:#FBE8C4; margin:0; font-size:26px; letter-spacing:.5px;">🎭 TítereHub</h1>
        <p style="color:#FBE8C4; margin:6px 0 0; opacity:.85; font-size:14px;">El espacio de discusión del noticiero</p>
      </div>
      <div style="padding:32px;">
        <p style="color:#3E2723; font-size:16px;">¡Hola, <strong>${username}</strong>!</p>
        <p style="color:#5D4037; font-size:15px; line-height:1.6;">
          Gracias por unirte a TítereHub. Para activar tu cuenta, ingresa este código
          de verificación en la plataforma:
        </p>
        <div style="text-align:center; margin:28px 0;">
          <span style="display:inline-block; background:#FBF7EF; border:2px dashed #B91C1C; border-radius:12px; padding:14px 32px; font-size:32px; font-weight:bold; letter-spacing:8px; color:#7C1D2E;">
            ${code}
          </span>
        </div>
        <p style="color:#8D6E63; font-size:13px; line-height:1.5;">
          El código expira en 30 minutos. Si no creaste esta cuenta, ignora este mensaje.
        </p>
      </div>
    </div>
  </div>`;
}
