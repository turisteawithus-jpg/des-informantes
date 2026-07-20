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
  documents,
  privateConversations,
  privateMessages,
  userFriendships,
  emailVerificationCodes,
} from "@db/schema";
import { and, desc, eq, or, asc, count, like, ne } from "drizzle-orm";
import { getSessionFromRequest } from "./lib/auth";
import {
  PHASE_ORDER_SERVER,
  PHASE_INFO_SERVER,
  generateModeratorConclusion,
  generatePhaseBridge,
  generateWelcomeBack,
  generateTopicInfo,
  generateTopicList,
  nextPhaseKeyServer,
} from "./lib/groqModerator";

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

// GET /:id/discussions-progress — progreso del moderador IA por discusion
// (alimenta las barras de carga de las tarjetas de discusion en la mesa)
restWorkspaces.get("/:id/discussions-progress", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const wsId = Number(c.req.param("id"));
  const db = getDb();
  const discs = await db.query.discussions.findMany({
    where: eq(discussions.workspaceId, wsId),
  });
  const result: any[] = [];
  for (const d of discs) {
    const st = await db.query.discussionModerationStates.findFirst({
      where: eq(discussionModerationStates.discussionId, d.id),
    });
    if (!st) {
      result.push({
        discussionId: d.id, started: false, active: false, finished: false,
        topicsCount: 0, currentTopicIndex: 0, currentPhase: null,
        phaseName: null, currentTopic: null, progress: 0,
      });
      continue;
    }
    let topics: string[] = [];
    try { topics = st.topics ? JSON.parse(st.topics) : []; } catch { topics = []; }
    const totalPhases = PHASE_ORDER_SERVER.length;
    const phaseIdx = Math.max(0, PHASE_ORDER_SERVER.indexOf(st.currentPhase as any));
    // El motor solo desactiva el moderador cuando concluye el ultimo tema
    const finished = !st.active && topics.length > 0;
    const progress = topics.length === 0
      ? 0
      : finished
        ? 1
        : Math.min(1, (st.currentTopicIndex + phaseIdx / totalPhases) / topics.length);
    result.push({
      discussionId: d.id,
      started: true,
      active: !!st.active,
      finished,
      topicsCount: topics.length,
      currentTopicIndex: st.currentTopicIndex,
      currentPhase: st.currentPhase,
      phaseName: PHASE_INFO_SERVER[st.currentPhase]?.name ?? st.currentPhase,
      currentTopic: topics[st.currentTopicIndex] ?? null,
      progress,
    });
  }
  return c.json(result);
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
  const discussionId = Number(result.insertId);
  // El Moderador IA se activa SOLO al abrir la discusion:
  // da la bienvenida y desde el primer momento cuenta la ronda de palabras
  // para recoger los temas que los participantes propondran.
  const members = await db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, wsId));
  const interventionsRequired = members.length >= 12 ? Math.ceil(members.length / 2) : 5;
  await db.insert(discussionModerationStates).values({
    discussionId,
    interventionsRequired,
    active: true,
    activatedBy: user.userId,
    activatedAt: new Date(),
  });
  console.log(`[moderador] Discusion ${discussionId}: moderador activado automaticamente al abrir la discusion`);
  return c.json({ discussionId, moderatorActive: true });
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
  // Si el moderador IA esta activo, este mensaje cuenta como intervencion de la ronda
  const modState = await db.query.discussionModerationStates.findFirst({
    where: eq(discussionModerationStates.discussionId, discId),
  });
  if (modState?.active) {
    const newCompleted = modState.interventionsCompleted + 1;
    await db.update(discussionModerationStates).set({
      interventionsCompleted: newCompleted,
      updatedAt: new Date(),
    }).where(eq(discussionModerationStates.discussionId, discId));
    return c.json({
      ok: true,
      moderation: {
        active: true,
        interventionsCompleted: newCompleted,
        interventionsRequired: modState.interventionsRequired,
        isRoundComplete: newCompleted >= modState.interventionsRequired,
      },
    });
  }
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
  // Cualquier participante puede pedir un resumen parcial
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
  let topics: string[] = [];
  try { topics = state.topics ? JSON.parse(state.topics) : []; } catch { topics = []; }
  let hands: number[] = [];
  try { hands = state.handsRaised ? JSON.parse(state.handsRaised) : []; } catch { hands = []; }
  return c.json({ state: { ...state, topics, handsRaised: hands, handsCount: hands.length }, conclusions });
});

// POST /discussion/:id/raise-hand — levantar o bajar la mano (pedir la palabra)
restWorkspaces.post("/discussion/:id/raise-hand", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const db = getDb();
  const state = await db.query.discussionModerationStates.findFirst({
    where: eq(discussionModerationStates.discussionId, discId),
  });
  if (!state || !state.active) return c.json({ error: "Moderador no activo" }, 400);
  let hands: number[] = [];
  try { hands = state.handsRaised ? JSON.parse(state.handsRaised) : []; } catch { hands = []; }
  let raised: boolean;
  if (hands.includes(user.userId)) {
    hands = hands.filter((id) => id !== user.userId);
    raised = false;
  } else {
    hands.push(user.userId);
    raised = true;
  }
  await db.update(discussionModerationStates)
    .set({ handsRaised: JSON.stringify(hands), updatedAt: new Date() })
    .where(eq(discussionModerationStates.discussionId, discId));
  return c.json({ ok: true, raised, handsCount: hands.length });
});

/* ================================================================ */
/*   BIENVENIDA DE REINGRESO + INFO DE TEMAS + DOCUMENTOS (IA)      */
/*   Cache en memoria: se regenera solo cuando cambia el momento    */
/* ================================================================ */
const welcomeBackCache = new Map<string, string>();
const topicInfoCache = new Map<string, string>();

// GET /discussion/:id/welcome-back — la IA recibe al usuario POR SU NOMBRE
// y lo ubica en el momento actual cuando reingresa a la discusion
restWorkspaces.get("/discussion/:id/welcome-back", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const db = getDb();
  const state = await db.query.discussionModerationStates.findFirst({
    where: eq(discussionModerationStates.discussionId, discId),
  });
  if (!state) return c.json({ error: "Moderador no activado" }, 404);
  let topics: string[] = [];
  try { topics = state.topics ? JSON.parse(state.topics) : []; } catch { topics = []; }
  if (topics.length === 0) return c.json({ error: "Aun no hay temas definidos" }, 404);

  const cacheKey = `${discId}:${user.userId}:${state.currentTopicIndex}:${state.currentPhase}:${state.wordRound}`;
  const cached = welcomeBackCache.get(cacheKey);
  if (cached) return c.json({ text: cached });

  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, discId) });
  if (!disc) return c.json({ error: "Discusion no encontrada" }, 404);
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, disc.workspaceId) });
  const conclusions = await db.query.moderationConclusions.findMany({
    where: eq(moderationConclusions.discussionId, discId),
    orderBy: [asc(moderationConclusions.createdAt)],
  });
  const topicConcl = conclusions
    .filter((cn) => (cn.topicIndex ?? 0) === state.currentTopicIndex)
    .map((cn) => ({ phaseName: PHASE_INFO_SERVER[cn.phase]?.name ?? cn.phase, title: cn.title }));
  const phase = PHASE_INFO_SERVER[state.currentPhase] ?? { name: state.currentPhase, objective: "" };
  const text = await generateWelcomeBack(
    user.username,
    ws?.name || "Proyecto",
    disc.title,
    topics[state.currentTopicIndex] || "Tema general",
    phase.name,
    phase.objective,
    topicConcl,
  );
  if (!text) return c.json({ error: "No se pudo generar la bienvenida" }, 500);
  welcomeBackCache.set(cacheKey, text);
  return c.json({ text });
});

// GET /discussion/:id/topic-info?index=N — block de notas del recuadro principal del tema
restWorkspaces.get("/discussion/:id/topic-info", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const index = Number(c.req.query("index") ?? 0);
  const db = getDb();
  const state = await db.query.discussionModerationStates.findFirst({
    where: eq(discussionModerationStates.discussionId, discId),
  });
  if (!state) return c.json({ error: "Moderador no activado" }, 404);
  let topics: string[] = [];
  try { topics = state.topics ? JSON.parse(state.topics) : []; } catch { topics = []; }
  const title = topics[index];
  if (!title) return c.json({ error: "Tema no encontrado" }, 404);

  // El recuadro principal solo muestra el NOMBRE mientras el tema esta en curso
  // o pendiente; la nota descriptiva aparece cuando el tema ya concluyo.
  const finishedAll = !state.active && topics.length > 0;
  const isTopicDone = index < state.currentTopicIndex || finishedAll;
  if (!isTopicDone) {
    return c.json({ desc: null, status: index === state.currentTopicIndex ? "en-curso" : "pendiente" });
  }

  const cacheKey = `${discId}:${index}:${title}`;
  const cached = topicInfoCache.get(cacheKey);
  if (cached) return c.json({ desc: cached });
  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, discId) });
  const ws = disc ? await db.query.workspaces.findFirst({ where: eq(workspaces.id, disc.workspaceId) }) : null;
  const conclusions = await db.query.moderationConclusions.findMany({
    where: eq(moderationConclusions.discussionId, discId),
    orderBy: [asc(moderationConclusions.createdAt)],
  });
  const titles = conclusions.filter((cn) => (cn.topicIndex ?? 0) === index).map((cn) => cn.title);
  const desc = await generateTopicInfo(ws?.name || "Proyecto", disc?.title || "Discusion", title, titles);
  if (!desc) return c.json({ error: "No se pudo generar la nota" }, 500);
  topicInfoCache.set(cacheKey, desc);
  return c.json({ desc });
});

// GET /discussion/:id/docs — documentos anclados a la linea de tiempo de la discusion
restWorkspaces.get("/discussion/:id/docs", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const db = getDb();
  const list = await db.query.documents.findMany({
    where: eq(documents.discussionId, discId),
    orderBy: [asc(documents.createdAt)],
  });
  return c.json(list);
});

// POST /discussion/:id/link-doc — anexar un documento por URL (Drive, etc.) a un recuadro
restWorkspaces.post("/discussion/:id/link-doc", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const body = await c.req.json();
  const title = body.title?.trim();
  const url = body.url?.trim();
  if (!title || !url || !/^https?:\/\//i.test(url)) {
    return c.json({ error: "Faltan datos o el enlace no es valido (debe iniciar con http)" }, 400);
  }
  const db = getDb();
  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, discId) });
  if (!disc) return c.json({ error: "Discusion no encontrada" }, 404);
  const [result] = await db.insert(documents).values({
    workspaceId: disc.workspaceId,
    discussionId: discId,
    conclusionId: body.conclusionId ? Number(body.conclusionId) : null,
    uploadedBy: user.userId,
    title: title.slice(0, 255),
    topic: body.topicTitle?.slice(0, 120) || null,
    fileName: "enlace-externo",
    fileUrl: url.slice(0, 500),
    mimeType: "link/externo",
    sizeBytes: 0,
  });
  console.log(`[docs] Discusion ${discId}: documento enlazado "${title}"`);
  return c.json({ ok: true, documentId: Number(result.insertId) });
});

// POST /discussion/:id/editor-doc — crear un documento en linea (editable dentro de la plataforma)
restWorkspaces.post("/discussion/:id/editor-doc", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const body = await c.req.json();
  const title = body.title?.trim();
  if (!title) return c.json({ error: "El tema general del documento es obligatorio" }, 400);
  const db = getDb();
  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, discId) });
  if (!disc) return c.json({ error: "Discusion no encontrada" }, 404);
  const [result] = await db.insert(documents).values({
    workspaceId: disc.workspaceId,
    discussionId: discId,
    conclusionId: body.conclusionId ? Number(body.conclusionId) : null,
    uploadedBy: user.userId,
    title: title.slice(0, 255),
    topic: body.topicTitle?.slice(0, 120) || null,
    fileName: "editor-en-linea",
    fileUrl: "",
    mimeType: "editor/html",
    sizeBytes: 0,
    content: "<p></p>",
  });
  console.log(`[docs] Discusion ${discId}: documento en linea creado "${title}"`);
  return c.json({ ok: true, documentId: Number(result.insertId) });
});

// GET /documents/:docId/content — leer el contenido del documento en linea
restWorkspaces.get("/documents/:docId/content", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const docId = Number(c.req.param("docId"));
  const db = getDb();
  const doc = await db.query.documents.findFirst({ where: eq(documents.id, docId) });
  if (!doc) return c.json({ error: "Documento no encontrado" }, 404);
  return c.json({ id: doc.id, title: doc.title, topic: doc.topic, content: doc.content ?? "" });
});

// PUT /documents/:docId/content — guardar el contenido (autoguardado del editor)
restWorkspaces.put("/documents/:docId/content", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const docId = Number(c.req.param("docId"));
  const body = await c.req.json();
  const db = getDb();
  await db.update(documents)
    .set({ content: String(body.content ?? "").slice(0, 200000) })
    .where(eq(documents.id, docId));
  return c.json({ ok: true });
});

// POST /documents/:docId/attach — anclar un documento ya subido al recuadro (momento) correspondiente
restWorkspaces.post("/documents/:docId/attach", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const docId = Number(c.req.param("docId"));
  const body = await c.req.json();
  const db = getDb();
  await db.update(documents)
    .set({ conclusionId: body.conclusionId ? Number(body.conclusionId) : null })
    .where(eq(documents.id, docId));
  return c.json({ ok: true });
});

// POST /discussion/:id/topics — cualquier participante puede agregar un tema
restWorkspaces.post("/discussion/:id/topics", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const body = await c.req.json();
  const title = body.title?.trim();
  if (!title || title.length < 3) return c.json({ error: "Titulo muy corto" }, 400);
  const db = getDb();
  const state = await db.query.discussionModerationStates.findFirst({
    where: eq(discussionModerationStates.discussionId, discId),
  });
  if (!state) return c.json({ error: "Moderador no activado" }, 400);
  let topics: string[] = [];
  try { topics = state.topics ? JSON.parse(state.topics) : []; } catch { topics = []; }
  topics.push(title.slice(0, 150));
  await db.update(discussionModerationStates)
    .set({ topics: JSON.stringify(topics), updatedAt: new Date() })
    .where(eq(discussionModerationStates.discussionId, discId));
  return c.json({ ok: true, topics });
});

// POST /discussion/:id/activate-moderator — activar el moderador IA
restWorkspaces.post("/discussion/:id/activate-moderator", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const db = getDb();
  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, discId) });
  if (!disc) return c.json({ error: "Discusion no encontrada" }, 404);
  // Cualquier participante autenticado puede activar el moderador.
  // Regla de rondas de palabras: MINIMO 5 intervenciones por ronda;
  // la regla del 50% de los miembros aplica solo cuando la mesa tiene 12 o mas.
  const members = await db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, disc.workspaceId));
  const interventionsRequired = members.length >= 12 ? Math.ceil(members.length / 2) : 5;
  const existing = await db.query.discussionModerationStates.findFirst({
    where: eq(discussionModerationStates.discussionId, discId),
  });
  if (existing) {
    await db.update(discussionModerationStates)
      .set({ active: true, interventionsRequired, handsRaised: "[]", updatedAt: new Date() })
      .where(eq(discussionModerationStates.discussionId, discId));
    return c.json({ ok: true, message: "Moderador reactivado", interventionsRequired });
  }
  await db.insert(discussionModerationStates).values({
    discussionId: discId,
    interventionsRequired,
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
  // Cualquier participante puede avanzar de fase, pero SIEMPRE dejando la conclusion de la fase
  if (!conclusionTitle?.trim() || !conclusionContent?.trim()) {
    return c.json({ error: "Registra la conclusion de la fase para poder avanzar" }, 400);
  }
  await db.insert(moderationConclusions).values({
    discussionId: discId,
    phase: state.currentPhase,
    topicIndex: state.currentTopicIndex,
    title: conclusionTitle.trim(),
    content: conclusionContent.trim(),
  });
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

// Quien puede decidir el rumbo de la moderacion: quien activo el moderador,
// un admin de la mesa o el admin general
async function canDecideModeration(db: any, user: any, state: any, workspaceId: number): Promise<boolean> {
  if (user.role === "admin") return true;
  if (state.activatedBy && state.activatedBy === user.userId) return true;
  const member = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.userId)),
  });
  return member?.role === "admin";
}

// POST /discussion/:id/next-round — el moderador (persona) decide OTRA ronda de palabras
restWorkspaces.post("/discussion/:id/next-round", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const db = getDb();
  const state = await db.query.discussionModerationStates.findFirst({
    where: eq(discussionModerationStates.discussionId, discId),
  });
  if (!state || !state.active) return c.json({ error: "Moderador no activo" }, 400);
  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, discId) });
  if (!disc) return c.json({ error: "Discusion no encontrada" }, 404);
  if (!(await canDecideModeration(db, user, state, disc.workspaceId))) {
    return c.json({ error: "Solo el moderador puede decidir el siguiente paso" }, 403);
  }
  await db.update(discussionModerationStates).set({
    interventionsCompleted: 0,
    wordRound: state.wordRound + 1,
    handsRaised: "[]",
    updatedAt: new Date(),
  }).where(eq(discussionModerationStates.discussionId, discId));
  console.log(`[moderador] Discusion ${discId}: el moderador pidio OTRA ronda de palabras`);
  return c.json({ ok: true });
});

// POST /discussion/:id/advance-phase — el moderador (persona) decide AVANZAR:
// la IA cierra el momento actual con su conclusion y redacta el contexto del siguiente
restWorkspaces.post("/discussion/:id/advance-phase", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const discId = Number(c.req.param("id"));
  const db = getDb();
  const state = await db.query.discussionModerationStates.findFirst({
    where: eq(discussionModerationStates.discussionId, discId),
  });
  if (!state || !state.active) return c.json({ error: "Moderador no activo" }, 400);
  const disc = await db.query.discussions.findFirst({ where: eq(discussions.id, discId) });
  if (!disc) return c.json({ error: "Discusion no encontrada" }, 404);
  if (!(await canDecideModeration(db, user, state, disc.workspaceId))) {
    return c.json({ error: "Solo el moderador puede decidir el siguiente paso" }, 403);
  }

  let topics: string[] = [];
  try { topics = state.topics ? JSON.parse(state.topics) : []; } catch { topics = []; }

  // RONDA DE PROPUESTAS: si aun no hay temas, AVANZAR significa definir la
  // lista de temas con lo que propuso el grupo y arrancar el Tema 1.
  // La IA solo organiza lo que los participantes escribieron; nunca inventa.
  if (topics.length === 0) {
    const proposalRows = await db
      .select({
        userId: discussionMessages.userId,
        type: discussionMessages.type,
        content: discussionMessages.content,
      })
      .from(discussionMessages)
      .where(eq(discussionMessages.discussionId, discId))
      .orderBy(asc(discussionMessages.createdAt))
      .limit(120);
    const nameMap = new Map<number, string>();
    for (const uid of [...new Set(proposalRows.map((r) => r.userId))]) {
      const u = await db.query.users.findFirst({ where: eq(users.id, uid) });
      if (u) nameMap.set(uid, u.username);
    }
    const proposalMsgs = proposalRows
      .filter((r) => r.content)
      .map((r) => ({
        username: nameMap.get(r.userId) || "Participante",
        type: r.type,
        content: r.content || "",
      }));
    const wsForTopics = await db.query.workspaces.findFirst({ where: eq(workspaces.id, disc.workspaceId) });
    const aiTopics = await generateTopicList(wsForTopics?.name || "Proyecto", disc.title, proposalMsgs);
    if (aiTopics === null) {
      return c.json({ error: "Hubo un error tecnico al organizar los temas. Intenta de nuevo." }, 500);
    }
    if (aiTopics.length === 0) {
      return c.json({ error: "Aun no hay temas propuestos por los participantes. Dale otra ronda al grupo para que propongan." }, 400);
    }
    const finalTopics = aiTopics.slice(0, 8);
    await db
      .update(discussionModerationStates)
      .set({
        topics: JSON.stringify(finalTopics),
        currentTopicIndex: 0,
        currentPhase: "apertura",
        interventionsCompleted: 0,
        wordRound: state.wordRound + 1,
        handsRaised: "[]",
        updatedAt: new Date(),
      })
      .where(eq(discussionModerationStates.discussionId, discId));
    console.log(`[moderador] Discusion ${discId}: ${finalTopics.length} temas definidos por decision del moderador (ronda ${state.wordRound})`);
    return c.json({ ok: true, topicsDefined: true });
  }

  // Transcripcion reciente para el analisis de la IA
  const rows = await db
    .select({
      userId: discussionMessages.userId,
      type: discussionMessages.type,
      content: discussionMessages.content,
    })
    .from(discussionMessages)
    .where(eq(discussionMessages.discussionId, discId))
    .orderBy(asc(discussionMessages.createdAt))
    .limit(120);
  const nameMap = new Map<number, string>();
  for (const uid of [...new Set(rows.map((r) => r.userId))]) {
    const u = await db.query.users.findFirst({ where: eq(users.id, uid) });
    if (u) nameMap.set(uid, u.username);
  }
  const msgs = rows
    .filter((r) => r.content)
    .map((r) => ({
      username: nameMap.get(r.userId) || "Participante",
      type: r.type,
      content: r.content || "",
    }));
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, disc.workspaceId) });

  const topicTitle = topics[state.currentTopicIndex] || "Tema general";
  const prevPhaseKey = state.currentPhase;
  const prevPhaseName = PHASE_INFO_SERVER[prevPhaseKey]?.name ?? prevPhaseKey;

  // 1. La IA cierra el momento que termina (analisis practico: ideas, acuerdos,
  //    diferencias y compromisos SOLO si realmente existen)
  const conclusion = await generateModeratorConclusion(
    ws?.name || "Proyecto",
    disc.title,
    prevPhaseKey,
    topicTitle,
    msgs,
  );
  await db.insert(moderationConclusions).values({
    discussionId: discId,
    phase: prevPhaseKey,
    topicIndex: state.currentTopicIndex,
    title: conclusion?.title || `Conclusion de la fase ${prevPhaseName}`,
    content: conclusion?.content || "La IA no pudo generar la conclusion en este momento.",
  });

  // 2. Calcular el siguiente momento (otra fase, otro tema o el cierre)
  const isLastPhase =
    PHASE_ORDER_SERVER.indexOf(prevPhaseKey as any) === PHASE_ORDER_SERVER.length - 1;
  const hasMoreTopics = state.currentTopicIndex + 1 < topics.length;
  const updates: any = {
    interventionsCompleted: 0,
    wordRound: state.wordRound + 1,
    handsRaised: "[]",
    updatedAt: new Date(),
  };
  let nextPhaseName: string | null = null;
  let nextObjective = "";
  let nextTopicTitle = topicTitle;
  if (isLastPhase && hasMoreTopics) {
    updates.currentTopicIndex = state.currentTopicIndex + 1;
    updates.currentPhase = "apertura";
    nextPhaseName = PHASE_INFO_SERVER.apertura.name;
    nextObjective = PHASE_INFO_SERVER.apertura.objective;
    nextTopicTitle = topics[state.currentTopicIndex + 1];
  } else if (isLastPhase && !hasMoreTopics) {
    updates.active = false;
    updates.bridgeText = null;
  } else {
    const nk = nextPhaseKeyServer(prevPhaseKey);
    updates.currentPhase = nk;
    nextPhaseName = PHASE_INFO_SERVER[nk]?.name ?? nk;
    nextObjective = PHASE_INFO_SERVER[nk]?.objective ?? "";
  }

  // 3. La IA redacta el contexto de apertura del nuevo momento (lenguaje de moderacion)
  if (nextPhaseName) {
    const bridge = await generatePhaseBridge(
      ws?.name || "Proyecto",
      disc.title,
      nextTopicTitle,
      prevPhaseName,
      nextPhaseName,
      nextObjective,
      conclusion?.content ?? null,
    );
    updates.bridgeText = bridge ?? null;
  }

  await db.update(discussionModerationStates).set(updates)
    .where(eq(discussionModerationStates.discussionId, discId));
  console.log(
    updates.active === false
      ? `[moderador] Discusion ${discId}: el moderador cerro el ultimo momento, moderacion finalizada`
      : `[moderador] Discusion ${discId}: el moderador abrio un nuevo momento`,
  );
  return c.json({ ok: true, finished: updates.active === false });
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
/*   BUSQUEDA DE USUARIOS (cualquier usuario autenticado)           */
/*   Solo devuelve id y nombre de usuario (nunca el correo).        */
/* ================================================================ */
restWorkspaces.get("/users/search", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const q = (c.req.query("q") || "").trim();
  if (q.length < 2) return c.json([]);
  const db = getDb();
  const found = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(and(like(users.username, `%${q}%`), ne(users.id, user.userId)))
    .limit(10);
  // Incluir el estado de amistad con cada resultado
  const result: any[] = [];
  for (const u of found) {
    const f = await friendshipBetween(db, user.userId, u.id);
    let status = "none";
    if (f) {
      status = f.status === "accepted"
        ? "friends"
        : f.userId === user.userId ? "pending_out" : "pending_in";
    }
    result.push({ ...u, status, friendshipId: f?.id ?? null });
  }
  return c.json(result);
});

/* ================================================================ */
/*   AMISTADES ENTRE USUARIOS                                       */
/* ================================================================ */

async function friendshipBetween(db: any, a: number, b: number) {
  return db.query.userFriendships.findFirst({
    where: or(
      and(eq(userFriendships.userId, a), eq(userFriendships.friendId, b)),
      and(eq(userFriendships.userId, b), eq(userFriendships.friendId, a)),
    ),
  });
}

async function areFriends(db: any, a: number, b: number): Promise<boolean> {
  const f = await friendshipBetween(db, a, b);
  return !!f && f.status === "accepted";
}

// GET /friends — amigos aceptados del usuario
restWorkspaces.get("/friends", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const db = getDb();
  const rows = await db.select().from(userFriendships)
    .where(and(
      or(eq(userFriendships.userId, user.userId), eq(userFriendships.friendId, user.userId)),
      eq(userFriendships.status, "accepted"),
    ));
  const result: any[] = [];
  for (const f of rows) {
    const otherId = f.userId === user.userId ? f.friendId : f.userId;
    const other = await db.query.users.findFirst({ where: eq(users.id, otherId) });
    if (other) result.push({ id: other.id, username: other.username, since: f.createdAt });
  }
  return c.json(result);
});

// GET /friends/requests — solicitudes pendientes (recibidas y enviadas)
restWorkspaces.get("/friends/requests", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const db = getDb();
  const rows = await db.select().from(userFriendships)
    .where(and(
      or(eq(userFriendships.userId, user.userId), eq(userFriendships.friendId, user.userId)),
      eq(userFriendships.status, "pending"),
    ));
  const incoming: any[] = [];
  const outgoing: any[] = [];
  for (const f of rows) {
    const otherId = f.userId === user.userId ? f.friendId : f.userId;
    const other = await db.query.users.findFirst({ where: eq(users.id, otherId) });
    if (!other) continue;
    const item = { id: f.id, user: { id: other.id, username: other.username }, createdAt: f.createdAt };
    if (f.friendId === user.userId) incoming.push(item); else outgoing.push(item);
  }
  return c.json({ incoming, outgoing });
});

// POST /friends/request — enviar solicitud de amistad
restWorkspaces.post("/friends/request", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const body = await c.req.json();
  const otherId = Number(body.userId);
  if (!Number.isFinite(otherId) || otherId === user.userId) {
    return c.json({ error: "Usuario invalido" }, 400);
  }
  const db = getDb();
  const other = await db.query.users.findFirst({ where: eq(users.id, otherId) });
  if (!other) return c.json({ error: "Usuario no encontrado" }, 404);

  const existing = await friendshipBetween(db, user.userId, otherId);
  if (existing) {
    if (existing.status === "accepted") return c.json({ ok: true, status: "friends" });
    // Si el otro ya me habia enviado solicitud, se acepta automaticamente
    if (existing.friendId === user.userId) {
      await db.update(userFriendships).set({ status: "accepted" })
        .where(eq(userFriendships.id, existing.id));
      return c.json({ ok: true, status: "friends" });
    }
    return c.json({ ok: true, status: "pending" });
  }
  await db.insert(userFriendships).values({
    userId: user.userId,
    friendId: otherId,
    status: "pending",
  });
  return c.json({ ok: true, status: "pending" });
});

// POST /friends/:id/accept — aceptar solicitud (solo quien la recibio)
restWorkspaces.post("/friends/:id/accept", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const fid = Number(c.req.param("id"));
  const db = getDb();
  const f = await db.query.userFriendships.findFirst({ where: eq(userFriendships.id, fid) });
  if (!f || f.friendId !== user.userId) return c.json({ error: "Solicitud no encontrada" }, 404);
  await db.update(userFriendships).set({ status: "accepted" }).where(eq(userFriendships.id, fid));
  return c.json({ ok: true });
});

// POST /friends/:id/decline — rechazar/cancelar solicitud (cualquiera de los dos)
restWorkspaces.post("/friends/:id/decline", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const fid = Number(c.req.param("id"));
  const db = getDb();
  const f = await db.query.userFriendships.findFirst({ where: eq(userFriendships.id, fid) });
  if (!f || (f.userId !== user.userId && f.friendId !== user.userId)) {
    return c.json({ error: "Solicitud no encontrada" }, 404);
  }
  await db.delete(userFriendships).where(eq(userFriendships.id, fid));
  return c.json({ ok: true });
});

// GET /friends/status/:userId — relacion con otro usuario
restWorkspaces.get("/friends/status/:userId", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const otherId = Number(c.req.param("userId"));
  if (!Number.isFinite(otherId)) return c.json({ error: "Id invalido" }, 400);
  if (otherId === user.userId) return c.json({ status: "self" });
  const db = getDb();
  const f = await friendshipBetween(db, user.userId, otherId);
  if (!f) return c.json({ status: "none" });
  if (f.status === "accepted") return c.json({ status: "friends", friendshipId: f.id });
  return c.json({
    status: f.userId === user.userId ? "pending_out" : "pending_in",
    friendshipId: f.id,
  });
});

/* ================================================================ */
/*   CHATS PRIVADOS                                                 */
/* ================================================================ */

// GET /conversations — conversaciones del usuario, con ultimo mensaje
// y cantidad de no leidos (para la lista estilo WhatsApp)
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
    const msgs = await db.select().from(privateMessages)
      .where(eq(privateMessages.conversationId, conv.id))
      .orderBy(desc(privateMessages.createdAt))
      .limit(50);
    const last = msgs[0] ?? null;
    const unread = msgs.filter((m) => m.senderId !== user.userId && !m.read).length;
    result.push({
      id: conv.id,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      otherUser: otherUser ? { id: otherUser.id, username: otherUser.username } : null,
      lastMessage: last ? { content: last.content, senderId: last.senderId, createdAt: last.createdAt } : null,
      unreadCount: unread,
    });
  }
  // La mas reciente primero
  result.sort((a, b) => {
    const ta = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const tb = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return tb - ta;
  });
  return c.json(result);
});

// POST /conversations — obtener o crear conversacion con otro usuario.
// Para conversaciones NUEVAS se requiere amistad (o ser administrador general).
restWorkspaces.post("/conversations", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const body = await c.req.json();
  const otherUserId = Number(body.userId);
  if (!Number.isFinite(otherUserId) || otherUserId === user.userId) {
    return c.json({ error: "Usuario invalido" }, 400);
  }
  const db = getDb();
  let conv = await db.query.privateConversations.findFirst({
    where: or(
      and(eq(privateConversations.user1Id, user.userId), eq(privateConversations.user2Id, otherUserId)),
      and(eq(privateConversations.user1Id, otherUserId), eq(privateConversations.user2Id, user.userId)),
    ),
  });
  if (!conv) {
    if (user.role !== "admin" && !(await areFriends(db, user.userId, otherUserId))) {
      return c.json({ error: "Primero deben ser amigos: enviale una solicitud de amistad" }, 403);
    }
    const [result] = await db.insert(privateConversations).values({
      user1Id: Math.min(user.userId, otherUserId),
      user2Id: Math.max(user.userId, otherUserId),
    });
    conv = { id: Number(result.insertId), user1Id: user.userId, user2Id: otherUserId } as any;
  }
  return c.json({ ok: true, conversationId: conv.id });
});

// POST /conversations/:id/messages — enviar mensaje privado (solo participantes)
restWorkspaces.post("/conversations/:id/messages", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const convId = Number(c.req.param("id"));
  const body = await c.req.json();
  const content = String(body.content ?? "").trim();
  if (!content || content.length > 2000) return c.json({ error: "Mensaje invalido" }, 400);
  const db = getDb();
  const conv = await db.query.privateConversations.findFirst({
    where: eq(privateConversations.id, convId),
  });
  if (!conv || (conv.user1Id !== user.userId && conv.user2Id !== user.userId)) {
    return c.json({ error: "Conversacion no encontrada" }, 404);
  }
  const [result] = await db.insert(privateMessages).values({
    conversationId: convId,
    senderId: user.userId,
    content,
  });
  return c.json({ ok: true, messageId: Number(result.insertId) });
});

// GET /conversations/:id/messages — mensajes de una conversacion (solo
// participantes). Marca como leidos los mensajes que me enviaron.
restWorkspaces.get("/conversations/:id/messages", async (c) => {
  const user = getUser(c);
  if (!user) return c.json({ error: "No autorizado" }, 401);
  const convId = Number(c.req.param("id"));
  const db = getDb();
  const conv = await db.query.privateConversations.findFirst({
    where: eq(privateConversations.id, convId),
  });
  if (!conv || (conv.user1Id !== user.userId && conv.user2Id !== user.userId)) {
    return c.json({ error: "Conversacion no encontrada" }, 404);
  }
  const otherId = conv.user1Id === user.userId ? conv.user2Id : conv.user1Id;
  const otherUser = await db.query.users.findFirst({ where: eq(users.id, otherId) });

  // Marcar como leidos los que me enviaron
  await db.update(privateMessages).set({ read: true })
    .where(and(
      eq(privateMessages.conversationId, convId),
      ne(privateMessages.senderId, user.userId),
      eq(privateMessages.read, false),
    ));

  const msgs = await db.select().from(privateMessages)
    .where(eq(privateMessages.conversationId, convId))
    .orderBy(asc(privateMessages.createdAt));
  const result: any[] = [];
  for (const m of msgs) {
    const sender = await db.query.users.findFirst({ where: eq(users.id, m.senderId) });
    result.push({ ...m, senderName: sender?.username ?? "Desconocido" });
  }
  return c.json({
    otherUser: otherUser ? { id: otherUser.id, username: otherUser.username } : null,
    messages: result,
  });
});

export default restWorkspaces;
