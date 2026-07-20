import { eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  moderationConclusions,
  discussions,
  workspaces,
  users,
  commitmentReminderLogs,
} from "@db/schema";
import { sendEmail } from "./email";

/* ================================================================
   TAREAS PROGRAMADAS DE DES INFORMANTES

   1. RECORDATORIOS DE COMPROMISOS (Entrega D)
      Todos los dias a la 1:50 PM revisa las conclusiones guardadas,
      encuentra los compromisos cuya fecha sea HOY y envia un correo
      a la persona responsable. La tabla commitment_reminder_logs
      evita enviar el mismo recordatorio dos veces.

   2. LIMPIEZA DE CHATS PERSONALES
      Una vez al dia borra los mensajes privados con mas de 31 dias:
      la plataforma solo conserva el ultimo mes de conversaciones.
   ================================================================ */

type ParsedCommitment = {
  conclusionId: number;
  text: string;
  responsible: string;
  date: Date;
  key: string;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Acepta: 2026-07-25 | 25/07/2026 | 25-07-2026 | 25/7/26
function parseCommitmentDate(raw: string): Date | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return new Date(year, Number(m[2]) - 1, Number(m[1]));
  }
  return null;
}

// Extrae los compromisos de una conclusion (seccion "## Compromisos asumidos")
function parseCommitments(conclusionId: number, content: string): ParsedCommitment[] {
  const out: ParsedCommitment[] = [];
  const section = content.split(/^##\s*Compromisos asumidos\s*$/im)[1];
  if (!section) return out;
  // La seccion termina donde empiece otro titulo Markdown
  const body = section.split(/^##\s/m)[0];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;
    const match = trimmed.match(/^-\s*(.+?)\s*\|\s*Responsable:\s*(.+?)\s*\|\s*Fecha:\s*(.+?)\s*$/i);
    if (!match) continue;
    const date = parseCommitmentDate(match[3]);
    if (!date) continue; // "Sin fecha" u otro texto no interpretable
    out.push({
      conclusionId,
      text: match[1].trim(),
      responsible: match[2].trim(),
      date,
      key: trimmed.slice(0, 250),
    });
  }
  return out;
}

function reminderEmailHtml(username: string, text: string, dateStr: string, discTitle: string, wsName: string): string {
  return `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; background:#f8fafc; padding:32px;">
    <div style="max-width:520px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,.08);">
      <div style="background:linear-gradient(135deg,#0a2540,#1a5276); padding:28px 32px; text-align:center;">
        <h1 style="color:#ffffff; margin:0; font-size:26px; letter-spacing:.5px;">DES Informantes</h1>
        <p style="color:#e2e8f0; margin:6px 0 0; opacity:.85; font-size:14px;">Recordatorio de compromiso</p>
      </div>
      <div style="padding:32px;">
        <p style="color:#1e293b; font-size:16px;">Hola, <strong>${username}</strong>!</p>
        <p style="color:#475569; font-size:15px; line-height:1.6;">
          Te escribimos para recordarte que <strong>hoy</strong> vence un compromiso
          que asumiste en la mesa <strong>${wsName}</strong>, en la discusion
          <strong>${discTitle}</strong>:
        </p>
        <div style="margin:24px 0; background:#f1f5f9; border-left:4px solid #0a2540; border-radius:8px; padding:16px 20px;">
          <p style="color:#0a2540; font-size:15px; margin:0; line-height:1.5;">${text}</p>
          <p style="color:#64748b; font-size:12px; margin:8px 0 0;">Fecha acordada: ${dateStr}</p>
        </div>
        <p style="color:#64748b; font-size:13px; line-height:1.5;">
          Entra a la plataforma para contarle al grupo como va tu compromiso.
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

let sendingReminders = false;

async function sendCommitmentReminders(): Promise<void> {
  if (sendingReminders) return;
  sendingReminders = true;
  try {
    const db = getDb();
    const today = todayKey();
    const conclusions = await db.select().from(moderationConclusions);
    let sent = 0;

    for (const concl of conclusions) {
      const commitments = parseCommitments(concl.id, concl.content || "");
      for (const com of commitments) {
        if (todayKey(com.date) !== today) continue;

        // Registrar primero para no duplicar (la llave unica lo garantiza)
        try {
          await db.insert(commitmentReminderLogs).values({
            conclusionId: com.conclusionId,
            commitmentKey: com.key,
            sentOn: today,
          });
        } catch {
          continue; // ya fue enviado hoy
        }

        if (/^por definir$/i.test(com.responsible)) continue;

        const responsible = await db.query.users.findFirst({
          where: sql`LOWER(${users.username}) = LOWER(${com.responsible})`,
        });
        if (!responsible) continue;

        const disc = await db.query.discussions.findFirst({
          where: eq(discussions.id, concl.discussionId),
        });
        const ws = disc
          ? await db.query.workspaces.findFirst({ where: eq(workspaces.id, disc.workspaceId) })
          : null;

        await sendEmail({
          to: responsible.email,
          subject: `DES Informantes - Hoy vence tu compromiso: ${com.text.slice(0, 60)}`,
          html: reminderEmailHtml(
            responsible.username,
            com.text,
            `${pad(com.date.getDate())}/${pad(com.date.getMonth() + 1)}/${com.date.getFullYear()}`,
            disc?.title ?? "Discusion",
            ws?.name ?? "tu mesa",
          ),
        });
        sent++;
      }
    }
    if (sent > 0) console.log(`[recordatorios] ${sent} recordatorio(s) de compromiso enviados (${today})`);
  } catch (e: any) {
    console.error("[recordatorios] Error en ciclo:", e.message);
  } finally {
    sendingReminders = false;
  }
}

async function cleanupOldPrivateMessages(): Promise<void> {
  try {
    const db = getDb();
    const result: any = await db.execute(
      sql`DELETE FROM private_messages WHERE created_at < (NOW() - INTERVAL 31 DAY)`,
    );
    const deleted = result?.[0]?.affectedRows ?? 0;
    if (deleted > 0) {
      console.log(`[limpieza-chats] ${deleted} mensajes privados con mas de 31 dias eliminados`);
    }
  } catch (e: any) {
    console.error("[limpieza-chats] Error:", e.message);
  }
}

export function startSchedulers(): void {
  // Limpieza de chats: al arrancar y luego cada 24 horas
  void cleanupOldPrivateMessages();
  setInterval(() => void cleanupOldPrivateMessages(), 24 * 60 * 60 * 1000);

  // Recordatorios: revisa cada 5 minutos; solo actua entre 1:50 y 1:54 PM
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 13 && now.getMinutes() >= 50 && now.getMinutes() < 55) {
      void sendCommitmentReminders();
    }
  }, 5 * 60 * 1000);

  console.log("[schedulers] Recordatorios de compromisos (1:50 PM) y limpieza mensual de chats activos");
}
