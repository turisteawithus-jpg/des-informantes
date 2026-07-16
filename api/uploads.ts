import { Hono } from "hono";
import { mkdir, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { getDb } from "./queries/connection";
import {
  discussionMessages,
  discussions,
  documents,
  workspaceMembers,
} from "@db/schema";
import { getSessionFromRequest } from "./lib/auth";
import { transcribeAudio } from "./lib/gemini";
import { maybeCreatePartialSummary } from "./lib/discussion";

export const uploadRouter = new Hono();

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

async function requireWorkspaceMember(workspaceId: number, userId: number): Promise<boolean> {
  const db = getDb();
  const m = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
  });
  return !!m;
}

/* -------------------- SUBIDA DE AUDIO -------------------- */

uploadRouter.post("/audio", async (c) => {
  const session = getSessionFromRequest(c.req.raw);
  if (!session) return c.json({ error: "No autenticado" }, 401);

  const body = await c.req.parseBody();
  const discussionId = Number(body["discussionId"]);
  const file = body["file"];
  if (!discussionId || !(file instanceof File)) {
    return c.json({ error: "Faltan datos (discussionId, file)" }, 400);
  }

  const db = getDb();
  const discussion = await db.query.discussions.findFirst({
    where: eq(discussions.id, discussionId),
  });
  if (!discussion) return c.json({ error: "Discusión no encontrada" }, 404);
  if (discussion.status === "closed") {
    return c.json({ error: "La discusión está cerrada" }, 400);
  }
  if (!(await requireWorkspaceMember(discussion.workspaceId, session.userId))) {
    return c.json({ error: "No eres miembro de esta mesa" }, 403);
  }

  await mkdir(UPLOADS_DIR, { recursive: true });
  const fileName = `${Date.now()}-${session.userId}-${sanitize(file.name || "audio.webm")}`;
  const filePath = path.join(UPLOADS_DIR, fileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  const [result] = await db.insert(discussionMessages).values({
    discussionId,
    userId: session.userId,
    type: "audio",
    audioUrl: `/api/files/${fileName}`,
    transcriptionStatus: "pending",
    content: null,
  });
  const messageId = Number(result.insertId);

  const transcription = await transcribeAudio(
    buffer.toString("base64"),
    file.type || "audio/webm",
  );

  await db
    .update(discussionMessages)
    .set({
      content: transcription ?? "(No se pudo transcribir el audio automáticamente)",
      transcriptionStatus: transcription ? "done" : "error",
    })
    .where(eq(discussionMessages.id, messageId));

  void maybeCreatePartialSummary(discussionId).catch((e) =>
    console.error("[summary] Error:", e),
  );

  return c.json({
    ok: true,
    messageId,
    transcriptionStatus: transcription ? "done" : "error",
  });
});

/* -------------------- SUBIDA DE DOCUMENTOS -------------------- */

uploadRouter.post("/document", async (c) => {
  const session = getSessionFromRequest(c.req.raw);
  if (!session) return c.json({ error: "No autenticado" }, 401);

  const body = await c.req.parseBody();
  const workspaceId = Number(body["workspaceId"]);
  const title = String(body["title"] || "").trim();
  const topic = String(body["topic"] || "").trim() || null;
  const taskId = body["taskId"] ? Number(body["taskId"]) : null;
  const discussionId = body["discussionId"] ? Number(body["discussionId"]) : null;
  const file = body["file"];

  if (!workspaceId || !title || !(file instanceof File)) {
    return c.json({ error: "Faltan datos (workspaceId, title, file)" }, 400);
  }
  if (!(await requireWorkspaceMember(workspaceId, session.userId))) {
    return c.json({ error: "No eres miembro de esta mesa" }, 403);
  }

  await mkdir(UPLOADS_DIR, { recursive: true });
  const fileName = `${Date.now()}-doc-${sanitize(file.name || "documento")}`;
  const filePath = path.join(UPLOADS_DIR, fileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  const db = getDb();
  const [result] = await db.insert(documents).values({
    workspaceId,
    discussionId,
    taskId,
    uploadedBy: session.userId,
    title,
    topic,
    fileName: file.name,
    fileUrl: `/api/files/${fileName}`,
    mimeType: file.type || null,
    sizeBytes: buffer.length,
  });

  return c.json({ ok: true, documentId: Number(result.insertId) });
});

/* -------------------- DESCARGA DE ARCHIVOS -------------------- */

uploadRouter.get("/files/:name", async (c) => {
  const session = getSessionFromRequest(c.req.raw);
  if (!session) return c.json({ error: "No autenticado" }, 401);

  const name = sanitize(c.req.param("name"));
  const filePath = path.join(UPLOADS_DIR, name);
  if (!existsSync(filePath)) return c.json({ error: "No encontrado" }, 404);

  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const mime: Record<string, string> = {
    webm: "audio/webm", mp3: "audio/mpeg", wav: "audio/wav",
    ogg: "audio/ogg", m4a: "audio/mp4", pdf: "application/pdf",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };

  const stream = Readable.toWeb(createReadStream(filePath));
  return new Response(stream as ReadableStream, {
    headers: {
      "Content-Type": mime[ext] ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${name}"`,
    },
  });
});
