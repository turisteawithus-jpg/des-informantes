import { Hono } from "hono";
import { getDb } from "./queries/connection";
import {
  users,
  workspaces,
  workspaceMembers,
  workspaceJoinRequests,
  discussions,
  discussionMessages,
  summaries,
  discussionModerationStates,
  moderationConclusions,
  privateConversations,
  privateMessages,
  emailVerificationCodes,
} from "@db/schema";
import { and, desc, eq, or, asc, count } from "drizzle-orm";
import { getSessionFromRequest } from "./lib/auth";

const restWorkspaces = new Hono();
function getUser(c: any) {
  return getSessionFromRequest(c.req.raw);
}

/* ================================================================ */
/*   MESAS DE TRABAJO                                               */
/* ================================================================ */

// GET / — listar mesas aprobadas
restWorkspaces.get("/", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const db = getDb();
  const list = await db.query.workspaces.findMany({
    where: and(eq(workspaces.status, "approved"), eq(workspaces.archived, false)),
    orderBy: [desc(workspaces.approvedAt)],
  });
  return c.json(list);
});

// GET /mine — mesas donde soy miembro
restWorkspaces.get("/mine", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const db = getDb();
  const memberships = await db.query.workspaceMembers.findMany({
    where: eq(workspaceMembers.userId, user.userId),
  });
  if (memberships.length === 0) return c.json([]);
  const result: any[] = [];
  for (const m of memberships) {
    const ws = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, m.workspaceId),
    });
    if (ws && ws.status === "approved" && !ws.archived) {
      result.push({ ...ws, memberRole: m.role });
    }
  }
  return c.json(result);
});

// POST / — crear mesa
restWorkspaces.post("/", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  try {
    const body = await c.req.json();
    const { name, area, description, objective } = body;
    if (!name || name.length < 3) return c.json({ error: "Nombre muy corto" }, 400);
    const db = getDb();
    const [result] = await db.insert(workspaces).values({
      name,
      area: area ?? null,
      description: description ?? null,
      objective: objective ?? null,
      createdBy: user.userId,
    });
    const workspaceId = Number(result.insertId);
    await db.insert(workspaceMembers).values({
      workspaceId,
      userId: user.userId,
      role: "admin",
    });
    return c.json({ ok: true, workspaceId });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /join — solicitar ingreso a una mesa
restWorkspaces.post("/join", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  try {
    const body = await c.req.json();
    const { workspaceId } = body;
    const db = getDb();
    const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    if (!ws || ws.status !== "approved") return c.json({ error: "Mesa no disponible" }, 404);
    const existing = await db.query.workspaceMembers.findFirst({
      where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.userId)),
    });
    if (existing) return c.json({ ok: true, alreadyMember: true });
    const existingReq = await db.query.workspaceJoinRequests.findFirst({
      where: and(
        eq(workspaceJoinRequests.workspaceId, workspaceId),
        eq(workspaceJoinRequests.userId, user.userId),
        eq(workspaceJoinRequests.status, "pending"),
      ),
    });
    if (existingReq) return c.json({ ok: true, pending: true });
    await db.insert(workspaceJoinRequests).values({ workspaceId, userId: user.userId, message: body.message || null });
    return c.json({ ok: true, pending: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

/* ================================================================ */
/*   SOLICITUDES DE INGRESO A MESA                                  */
/* ================================================================ */

// GET /:id/join-requests — listar solicitudes pendientes (admin de mesa o general)
restWorkspaces.get("/:id/join-requests", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const wsId = Number(c.req.param("id"));
  const db = getDb();
  const member = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, wsId), eq(workspaceMembers.userId, user.userId)),
  });
  if (member?.role !== "admin" && user.role !== "admin") {
    return c.json({ error: "No tienes permiso" }, 403);
  }
  const reqs = await db
    .select({
      id: workspaceJoinRequests.id,
      userId: workspaceJoinRequests.userId,
      status: workspaceJoinRequests.status,
      message: workspaceJoinRequests.message,
      createdAt: workspaceJoinRequests.createdAt,
      username: users.username,
      email: users.email,
    })
    .from(workspaceJoinRequests)
    .innerJoin(users, eq(workspaceJoinRequests.userId, users.id))
    .where(
      and(
        eq(workspaceJoinRequests.workspaceId, wsId),
        eq(workspaceJoinRequests.status, "pending"),
      ),
    );
  return c.json(reqs);
});

// POST /join-requests/:id/respond — aprobar o rechazar solicitud
restWorkspaces.post("/join-requests/:id/respond", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const reqId = Number(c.req.param("id"));
  const body = await c.req.json();
  const { action } = body;
  const db = getDb();
  const req = await db.query.workspaceJoinRequests.findFirst({
    where: eq(workspaceJoinRequests.id, reqId),
  });
  if (!req) return c.json({ error: "Solicitud no encontrada" }, 404);
  const member = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, req.workspaceId), eq(workspaceMembers.userId, user.userId)),
  });
  if (member?.role !== "admin" && user.role !== "admin") {
    return c.json({ error: "No tienes permiso" }, 403);
  }
  await db.update(workspaceJoinRequests).set({
    status: action === "approve" ? "approved" : "rejected",
    reviewedBy: user.userId,
  }).where(eq(workspaceJoinRequests.id, reqId));
  if (action === "approve") {
    await db.insert(workspaceMembers).values({
      workspaceId: req.workspaceId,
      userId: req.userId,
      role: "member",
    });
  }
  return c.json({ ok: true });
});

/* ================================================================ */
/*   ADMIN GENERAL                                                  */
/* ================================================================ */

restWorkspaces.get("/admin/users", async (c) => {
  const user = getUser(c);
  if (!user || user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  const db = getDb();
  const list = await db.select().from(users).orderBy(desc(users.createdAt));
  return c.json(list);
});

restWorkspaces.delete("/admin/users/:id", async (c) => {
  const user = getUser(c);
  if (!user || user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  const targetId = Number(c.req.param("id"));
  if (targetId === user.userId) return c.json({ error: "No puedes eliminarte a ti mismo" }, 400);
  const db = getDb();
  await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, targetId));
  await db.delete(workspaceJoinRequests).where(eq(workspaceJoinRequests.userId, targetId));
  await db.delete(emailVerificationCodes).where(eq(emailVerificationCodes.userId, targetId));
  await db.delete(users).where(eq(users.id, targetId));
  return c.json({ ok: true });
});

restWorkspaces.get("/admin/stats", async (c) => {
  const user = getUser(c);
  if (!user || user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  const db = getDb();
  const [u] = await db.select({ n: count() }).from(users);
  const [w] = await db.select({ n: count() }).from(workspaces);
  const [p] = await db.select({ n: count() }).from(workspaces).where(eq(workspaces.status, "pending"));
  return c.json({ users: u.n, workspaces: w.n, pendingWorkspaces: p.n });
});

restWorkspaces.get("/admin/pending", async (c) => {
  const user = getUser(c);
  if (!user || user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  const db = getDb();
  const list = await db.query.workspaces.findMany({
    where: eq(workspaces.status, "pending"),
    orderBy: [desc(workspaces.createdAt)],
  });
  return c.json(list);
});

restWorkspaces.post("/admin/approve/:id", async (c) => {
  const user = getUser(c);
  if (!user || user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  const id = Number(c.req.param("id"));
  const db = getDb();
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, id) });
  if (!ws || ws.status !== "pending") return c.json({ error: "Mesa ya procesada" }, 400);
  await db.update(workspaces).set({ status: "approved", approvedBy: user.userId, approvedAt: new Date() }).where(eq(workspaces.id, id));
  await db.insert(workspaceMembers).values({ workspaceId: id, userId: ws.createdBy, role: "admin" });
  return c.json({ ok: true });
});

restWorkspaces.post("/admin/reject/:id", async (c) => {
  const user = getUser(c);
  if (!user || user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  const id = Number(c.req.param("id"));
  const db = getDb();
  await db.update(workspaces).set({ status: "rejected" }).where(eq(workspaces.id, id));
  return c.json({ ok: true });
});

restWorkspaces.get("/admin/approved", async (c) => {
  const user = getUser(c);
  if (!user || user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  const db = getDb();
  const approved = await db.select({
    id: workspaces.id,
    name: workspaces.name,
    area: workspaces.area,
    description: workspaces.description,
    createdBy: workspaces.createdBy,
    createdAt: workspaces.createdAt,
    approvedAt: workspaces.approvedAt,
  }).from(workspaces).where(eq(workspaces.status, "approved")).orderBy(desc(workspaces.approvedAt));
  const result: any[] = [];
  for (const ws of approved) {
    const members = await db.select({
      id: users.id,
      username: users.username,
      email: users.email,
      role: workspaceMembers.role,
    }).from(workspaceMembers).innerJoin(users, eq(workspaceMembers.userId, users.id)).where(eq(workspaceMembers.workspaceId, ws.id));
    const admin = members.find((m) => m.role === "admin");
    result.push({ ...ws, members, adminName: admin?.username ?? "Sin admin" });
  }
  return c.json(result);
});

restWorkspaces.post("/admin/users/:id/role", async (c) => {
  const user = getUser(c);
  if (!user || user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  const targetId = Number(c.req.param("id"));
  if (targetId === user.userId) return c.json({ error: "No puedes cambiar tu propio rol" }, 400);
  const body = await c.req.json();
  const db = getDb();
  await db.update(users).set({ role: body.role }).where(eq(users.id, targetId));
  return c.json({ ok: true });
});

// Endpoint admin: verificar usuario manualmente (bypass email)
restWorkspaces.post("/admin/verify-user/:id", async (c) => {
  const user = getUser(c);
  if (!user || user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  const targetId = Number(c.req.param("id"));
  const db = getDb();
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, targetId));
  return c.json({ ok: true });
});

// Endpoint admin: eliminar mesa permanentemente
restWorkspaces.delete("/admin/workspaces/:id", async (c) => {
  const user = getUser(c);
  if (!user || user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  const id = Number(c.req.param("id"));
  const db = getDb();
  await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, id));
  await db.delete(workspaceJoinRequests).where(eq(workspaceJoinRequests.workspaceId, id));
  await db.delete(workspaces).where(eq(workspaces.id, id));
  return c.json({ ok: true });
});

/* ================================================================ */
/*   MODERACION DE MENSAJES (fijar / editar / eliminar)             */
/*   Permiso: admin general en cualquier chat, o admin de la mesa   */
/*   a la que pertenece el mensaje.                                 */
/* ================================================================ */

// Fijar mensaje
restWorkspaces.post("/messages/:id/pin", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const msgId = Number(c.req.param("id"));
  const db = getDb();
  const msg = await db.query.discussionMessages.findFirst({ where: eq(discussionMessages.id, msgId) });
  if (!msg) return c.json({ error: "Mensaje no encontrado" }, 404);
  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, msg.discussionId) });
  const member = disc
    ? await db.query.workspaceMembers.findFirst({
        where: and(eq(workspaceMembers.workspaceId, disc.workspaceId), eq(workspaceMembers.userId, user.userId)),
      })
    : null;
  if (member?.role !== "admin" && user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  await db.update(discussionMessages).set({ pinned: true }).where(eq(discussionMessages.id, msgId));
  return c.json({ ok: true });
});

// Quitar fijacion de mensaje
restWorkspaces.post("/messages/:id/unpin", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const msgId = Number(c.req.param("id"));
  const db = getDb();
  const msg = await db.query.discussionMessages.findFirst({ where: eq(discussionMessages.id, msgId) });
  if (!msg) return c.json({ error: "Mensaje no encontrado" }, 404);
  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, msg.discussionId) });
  const member = disc
    ? await db.query.workspaceMembers.findFirst({
        where: and(eq(workspaceMembers.workspaceId, disc.workspaceId), eq(workspaceMembers.userId, user.userId)),
      })
    : null;
  if (member?.role !== "admin" && user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  await db.update(discussionMessages).set({ pinned: false }).where(eq(discussionMessages.id, msgId));
  return c.json({ ok: true });
});

// Eliminar mensaje (admin general o admin de la mesa del mensaje)
restWorkspaces.delete("/messages/:id", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const msgId = Number(c.req.param("id"));
  const db = getDb();
  const msg = await db.query.discussionMessages.findFirst({ where: eq(discussionMessages.id, msgId) });
  if (!msg) return c.json({ error: "Mensaje no encontrado" }, 404);
  if (user.role === "admin") {
    await db.delete(discussionMessages).where(eq(discussionMessages.id, msgId));
    return c.json({ ok: true });
  }
  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, msg.discussionId) });
  const member = disc
    ? await db.query.workspaceMembers.findFirst({
        where: and(eq(workspaceMembers.workspaceId, disc.workspaceId), eq(workspaceMembers.userId, user.userId)),
      })
    : null;
  if (member?.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  await db.delete(discussionMessages).where(eq(discussionMessages.id, msgId));
  return c.json({ ok: true });
});

// Editar mensaje (admin general o admin de la mesa del mensaje)
restWorkspaces.put("/messages/:id", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const msgId = Number(c.req.param("id"));
  const body = await c.req.json();
  const { content } = body;
  if (!content || !content.trim()) return c.json({ error: "Contenido vacio" }, 400);
  const db = getDb();
  const msg = await db.query.discussionMessages.findFirst({ where: eq(discussionMessages.id, msgId) });
  if (!msg) return c.json({ error: "Mensaje no encontrado" }, 404);
  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, msg.discussionId) });
  const member = disc
    ? await db.query.workspaceMembers.findFirst({
        where: and(eq(workspaceMembers.workspaceId, disc.workspaceId), eq(workspaceMembers.userId, user.userId)),
      })
    : null;
  if (member?.role !== "admin" && user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  await db.update(discussionMessages).set({ content: content.trim() }).where(eq(discussionMessages.id, msgId));
  return c.json({ ok: true });
});

/* ================================================================ */
/*   DETALLE / EDICION / ARCHIVADO DE MESAS                         */
/* ================================================================ */

// GET /:id — detalle de una mesa
restWorkspaces.get("/:id", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const id = Number(c.req.param("id"));
  const db = getDb();
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, id) });
  if (!ws) return c.json({ error: "Mesa no encontrada" }, 404);
  const member = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, id), eq(workspaceMembers.userId, user.userId)),
  });
  return c.json({ ...ws, memberRole: member?.role ?? null });
});

// PUT /:id — editar mesa (admin de mesa o admin general)
restWorkspaces.put("/:id", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const id = Number(c.req.param("id"));
  try {
    const body = await c.req.json();
    const db = getDb();
    const member = await db.query.workspaceMembers.findFirst({
      where: and(eq(workspaceMembers.workspaceId, id), eq(workspaceMembers.userId, user.userId)),
    });
    if (member?.role !== "admin" && user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.area !== undefined) updateData.area = body.area;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.objective !== undefined) updateData.objective = body.objective;
    await db.update(workspaces).set(updateData).where(eq(workspaces.id, id));
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// DELETE /:id/archive — archivar mesa
restWorkspaces.delete("/:id/archive", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const id = Number(c.req.param("id"));
  const db = getDb();
  const member = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, id), eq(workspaceMembers.userId, user.userId)),
  });
  if (member?.role !== "admin" && user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  await db.update(workspaces).set({ archived: true }).where(eq(workspaces.id, id));
  return c.json({ ok: true });
});

// GET /:id/members — miembros de una mesa
restWorkspaces.get("/:id/members", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const id = Number(c.req.param("id"));
  const db = getDb();
  const list = await db.select({
    id: users.id,
    username: users.username,
    email: users.email,
    role: workspaceMembers.role,
    joinedAt: workspaceMembers.joinedAt,
  }).from(workspaceMembers).innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, id));
  return c.json(list);
});

/* ================================================================ */
/*   DISCUSIONES Y MENSAJES                                         */
/* ================================================================ */

// GET /:id/discussions — listar discusiones de una mesa
restWorkspaces.get("/:id/discussions", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const wsId = Number(c.req.param("id"));
  const db = getDb();
  const list = await db.query.discussions.findMany({
    where: eq(discussions.workspaceId, wsId),
    orderBy: [desc(discussions.createdAt)],
  });
  return c.json(list);
});

// POST /:id/discussions — crear discusion
restWorkspaces.post("/:id/discussions", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const wsId = Number(c.req.param("id"));
  const body = await c.req.json();
  const { title, description } = body;
  const db = getDb();
  const [result] = await db.insert(discussions).values({
    workspaceId: wsId,
    title,
    description: description || null,
    createdBy: user.userId,
  });
  return c.json({ discussionId: Number(result.insertId) });
});

// GET /discussion/:id — obtener una discusion
restWorkspaces.get("/discussion/:id", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const db = getDb();
  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, discId) });
  if (!disc) return c.json({ error: "Discusion no encontrada" }, 404);
  const member = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, disc.workspaceId), eq(workspaceMembers.userId, user.userId)),
  });
  return c.json({ ...disc, memberRole: member?.role ?? null });
});

// GET /discussion/:id/messages — listar mensajes (incluye pinned)
restWorkspaces.get("/discussion/:id/messages", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const db = getDb();
  const msgs = await db
    .select({
      id: discussionMessages.id,
      type: discussionMessages.type,
      content: discussionMessages.content,
      audioUrl: discussionMessages.audioUrl,
      transcriptionStatus: discussionMessages.transcriptionStatus,
      pinned: discussionMessages.pinned,
      createdAt: discussionMessages.createdAt,
      userId: discussionMessages.userId,
      username: users.username,
    })
    .from(discussionMessages)
    .innerJoin(users, eq(discussionMessages.userId, users.id))
    .where(eq(discussionMessages.discussionId, discId))
    .orderBy(asc(discussionMessages.createdAt));
  return c.json(msgs);
});

// POST /discussion/:id/messages — enviar mensaje de texto
restWorkspaces.post("/discussion/:id/messages", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const body = await c.req.json();
  const content = body.content?.trim();
  if (!content || content.length < 1 || content.length > 4000) return c.json({ error: "Mensaje invalido" }, 400);
  const db = getDb();
  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, discId) });
  if (!disc || disc.status === "closed") return c.json({ error: "Discusion cerrada" }, 400);
  await db.insert(discussionMessages).values({ discussionId: discId, userId: user.userId, type: "text", content });
  return c.json({ ok: true });
});

// POST /discussion/:id/close — cerrar discusion y generar relatoria con IA
restWorkspaces.post("/discussion/:id/close", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const db = getDb();
  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, discId) });
  if (!disc) return c.json({ error: "Discusion no encontrada" }, 404);
  const member = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, disc.workspaceId), eq(workspaceMembers.userId, user.userId)),
  });
  if (member?.role !== "admin" && user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  if (disc.status === "closed") return c.json({ error: "Ya esta cerrada" }, 400);
  const rows = await db.select({
    userId: discussionMessages.userId,
    type: discussionMessages.type,
    content: discussionMessages.content,
  }).from(discussionMessages).where(eq(discussionMessages.discussionId, discId)).orderBy(asc(discussionMessages.createdAt));
  const nameMap = new Map<number, string>();
  for (const uid of [...new Set(rows.map((r) => r.userId))]) {
    const u = await db.query.users.findFirst({ where: eq(users.id, uid) });
    if (u) nameMap.set(uid, u.username);
  }
  const msgs = rows
    .filter((r) => r.content)
    .map((r) => ({ username: nameMap.get(r.userId) || "Participante", type: r.type, content: r.content || "" }));
  const partials = await db.query.summaries.findMany({
    where: and(eq(summaries.discussionId, discId), eq(summaries.kind, "partial")),
    orderBy: [asc(summaries.createdAt)],
  });
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, disc.workspaceId) });
  const { generateRelatoria } = await import("./lib/groq");
  const relatoria = await generateRelatoria(
    ws?.name || "Proyecto",
    disc.title,
    msgs,
    partials.map((p) => p.content),
  );
  await db.update(discussions).set({ status: "closed", closedAt: new Date() }).where(eq(discussions.id, discId));
  if (relatoria) {
    await db.insert(summaries).values({
      discussionId: discId,
      workspaceId: disc.workspaceId,
      kind: "relatoria",
      content: relatoria,
      messageCount: rows.length,
    });
  }
  return c.json({ ok: true, hasRelatoria: !!relatoria });
});

// GET /discussion/:id/summaries — resumenes IA parciales
restWorkspaces.get("/discussion/:id/summaries", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const db = getDb();
  const list = await db.query.summaries.findMany({
    where: and(eq(summaries.discussionId, discId), eq(summaries.kind, "partial")),
    orderBy: [asc(summaries.createdAt)],
  });
  return c.json(list);
});

// GET /discussion/:id/relatoria — relatoria oficial
restWorkspaces.get("/discussion/:id/relatoria", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const db = getDb();
  const rel = await db.query.summaries.findFirst({
    where: and(eq(summaries.discussionId, discId), eq(summaries.kind, "relatoria")),
    orderBy: [desc(summaries.createdAt)],
  });
  return c.json(rel ?? null);
});

// POST /discussion/:id/partial-summary — generar resumen parcial con IA
restWorkspaces.post("/discussion/:id/partial-summary", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const db = getDb();
  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, discId) });
  if (!disc) return c.json({ error: "Discusion no encontrada" }, 404);
  const member = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, disc.workspaceId), eq(workspaceMembers.userId, user.userId)),
  });
  if (member?.role !== "admin" && user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  const rows = await db.select({
    userId: discussionMessages.userId,
    type: discussionMessages.type,
    content: discussionMessages.content,
  }).from(discussionMessages).where(eq(discussionMessages.discussionId, discId)).orderBy(asc(discussionMessages.createdAt));
  const nameMap = new Map<number, string>();
  for (const uid of [...new Set(rows.map((r) => r.userId))]) {
    const u = await db.query.users.findFirst({ where: eq(users.id, uid) });
    if (u) nameMap.set(uid, u.username);
  }
  const msgs = rows
    .filter((r) => r.content)
    .map((r) => ({ username: nameMap.get(r.userId) || "Participante", type: r.type, content: r.content || "" }));
  const partials = await db.query.summaries.findMany({
    where: and(eq(summaries.discussionId, discId), eq(summaries.kind, "partial")),
    orderBy: [asc(summaries.createdAt)],
  });
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, disc.workspaceId) });
  const { generateRelatoria } = await import("./lib/groq");
  const relatoria = await generateRelatoria(
    ws?.name || "Proyecto",
    disc.title,
    msgs,
    partials.map((p) => p.content),
  );
  if (relatoria) {
    await db.insert(summaries).values({
      discussionId: discId,
      workspaceId: disc.workspaceId,
      kind: "partial",
      content: relatoria,
      messageCount: rows.length,
    });
  }
  return c.json({ ok: true, relatoria });
});

/* ================================================================ */
/*   MODERADOR IA POR FASES                                         */
/* ================================================================ */

// GET /discussion/:id/moderation-state — ver estado de moderacion
restWorkspaces.get("/discussion/:id/moderation-state", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const db = getDb();
  const state = await db.query.discussionModerationStates.findFirst({
    where: eq(discussionModerationStates.discussionId, discId),
  });
  if (!state) return c.json({ error: "Moderador no activado" }, 404);
  const conclusions = await db.query.moderationConclusions.findMany({
    where: eq(moderationConclusions.discussionId, discId),
    orderBy: [asc(moderationConclusions.createdAt)],
  });
  return c.json({ state, conclusions });
});

// POST /discussion/:id/activate-moderator — activar el moderador IA
restWorkspaces.post("/discussion/:id/activate-moderator", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const db = getDb();
  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, discId) });
  if (!disc) return c.json({ error: "Discusion no encontrada" }, 404);
  const member = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, disc.workspaceId), eq(workspaceMembers.userId, user.userId)),
  });
  if (member?.role !== "admin" && user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  const existing = await db.query.discussionModerationStates.findFirst({
    where: eq(discussionModerationStates.discussionId, discId),
  });
  if (existing) {
    await db.update(discussionModerationStates)
      .set({ active: true, updatedAt: new Date() })
      .where(eq(discussionModerationStates.discussionId, discId));
    return c.json({ ok: true, message: "Moderador reactivado" });
  }
  const members = await db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, disc.workspaceId));
  const interventionsRequired = Math.ceil(members.length / 2);
  await db.insert(discussionModerationStates).values({
    discussionId: discId,
    interventionsRequired: interventionsRequired > 0 ? interventionsRequired : 5,
    active: true,
    activatedBy: user.userId,
    activatedAt: new Date(),
  });
  return c.json({ ok: true, interventionsRequired });
});

// POST /discussion/:id/next-phase — avanzar a la siguiente fase
restWorkspaces.post("/discussion/:id/next-phase", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const body = await c.req.json();
  const { conclusionTitle, conclusionContent } = body;
  const db = getDb();
  const state = await db.query.discussionModerationStates.findFirst({
    where: eq(discussionModerationStates.discussionId, discId),
  });
  if (!state || !state.active) return c.json({ error: "Moderador no activo" }, 400);
  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, discId) });
  if (!disc) return c.json({ error: "Discusion no encontrada" }, 404);
  const member = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, disc.workspaceId), eq(workspaceMembers.userId, user.userId)),
  });
  if (member?.role !== "admin" && user.role !== "admin") return c.json({ error: "No tienes permiso" }, 403);
  if (conclusionTitle && conclusionContent) {
    await db.insert(moderationConclusions).values({
      discussionId: discId,
      phase: state.currentPhase,
      topicIndex: state.currentTopicIndex,
      title: conclusionTitle,
      content: conclusionContent,
    });
  }
  const phases = [
    "apertura", "contextualizacion", "comprension", "sintesis_parcial",
    "profundizacion", "coincidencias_diferencias", "alternativas",
    "evaluacion", "acuerdo", "conclusion", "compromisos",
  ] as const;
  const currentIdx = phases.indexOf(state.currentPhase);
  const nextIdx = Math.min(currentIdx + 1, phases.length - 1);
  await db.update(discussionModerationStates).set({
    currentPhase: phases[nextIdx],
    interventionsCompleted: 0,
    wordRound: state.wordRound + 1,
    updatedAt: new Date(),
  }).where(eq(discussionModerationStates.discussionId, discId));
  return c.json({ ok: true, nextPhase: phases[nextIdx], isLast: nextIdx === phases.length - 1 });
});

// POST /discussion/:id/intervention — registrar intervencion en ronda de palabras
restWorkspaces.post("/discussion/:id/intervention", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const db = getDb();
  const state = await db.query.discussionModerationStates.findFirst({
    where: eq(discussionModerationStates.discussionId, discId),
  });
  if (!state || !state.active) return c.json({ error: "Moderador no activo" }, 400);
  const newCompleted = state.interventionsCompleted + 1;
  await db.update(discussionModerationStates).set({
    interventionsCompleted: newCompleted,
    updatedAt: new Date(),
  }).where(eq(discussionModerationStates.discussionId, discId));
  return c.json({
    ok: true,
    interventionsCompleted: newCompleted,
    interventionsRequired: state.interventionsRequired,
    isRoundComplete: newCompleted >= state.interventionsRequired,
  });
});

/* ================================================================ */
/*   CHATS PRIVADOS                                                 */
/* ================================================================ */

// GET /conversations — listar conversaciones del usuario
restWorkspaces.get("/conversations", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const db = getDb();
  const convs = await db.select().from(privateConversations)
    .where(or(eq(privateConversations.user1Id, user.userId), eq(privateConversations.user2Id, user.userId)));
  const result: any[] = [];
  for (const conv of convs) {
    const otherId = conv.user1Id === user.userId ? conv.user2Id : conv.user1Id;
    const otherUser = await db.query.users.findFirst({ where: eq(users.id, otherId) });
    result.push({
      ...conv,
      otherUser: otherUser ? { id: otherUser.id, username: otherUser.username, email: otherUser.email } : null,
    });
  }
  return c.json(result);
});

// POST /conversations — obtener o crear conversacion con otro usuario
restWorkspaces.post("/conversations", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const body = await c.req.json();
  const otherUserId = Number(body.userId);
  const db = getDb();
  let conv = await db.query.privateConversations.findFirst({
    where: or(
      and(eq(privateConversations.user1Id, user.userId), eq(privateConversations.user2Id, otherUserId)),
      and(eq(privateConversations.user1Id, otherUserId), eq(privateConversations.user2Id, user.userId)),
    ),
  });
  if (!conv) {
    const [result] = await db.insert(privateConversations).values({
      user1Id: Math.min(user.userId, otherUserId),
      user2Id: Math.max(user.userId, otherUserId),
    });
    conv = { id: Number(result.insertId), user1Id: user.userId, user2Id: otherUserId } as any;
  }
  return c.json({ ok: true, conversationId: conv.id });
});

// POST /conversations/:id/messages — enviar mensaje privado
restWorkspaces.post("/conversations/:id/messages", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const convId = Number(c.req.param("id"));
  const body = await c.req.json();
  const db = getDb();
  const [result] = await db.insert(privateMessages).values({
    conversationId: convId,
    senderId: user.userId,
    content: body.content,
  });
  return c.json({ ok: true, messageId: Number(result.insertId) });
});

// GET /conversations/:id/messages — listar mensajes de una conversacion
restWorkspaces.get("/conversations/:id/messages", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const convId = Number(c.req.param("id"));
  const db = getDb();
  const msgs = await db.select().from(privateMessages)
    .where(eq(privateMessages.conversationId, convId))
    .orderBy(asc(privateMessages.createdAt));
  const result: any[] = [];
  for (const m of msgs) {
    const sender = await db.query.users.findFirst({ where: eq(users.id, m.senderId) });
    result.push({ ...m, senderName: sender?.username ?? "Desconocido" });
  }
  return c.json(result);
});

export default restWorkspaces;
