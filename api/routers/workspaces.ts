import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedProcedure } from "../middleware";
import { getDb } from "../queries/connection";
import {
  users,
  workspaceJoinRequests,
  workspaceMembers,
  workspaces,
} from "@db/schema";

export const workspacesRouter = createRouter({
  /* -------------------- CREAR SOLICITUD DE MESA -------------------- */

  create: authedProcedure
    .input(
      z.object({
        name: z.string().min(3).max(255),
        area: z.string().max(255).optional(),
        description: z.string().max(2000).optional(),
        objective: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [result] = await db.insert(workspaces).values({
        name: input.name,
        area: input.area ?? null,
        description: input.description ?? null,
        objective: input.objective ?? null,
        createdBy: ctx.session.userId,
      });
      return { workspaceId: Number(result.insertId) };
    }),

  /* -------------------- LISTAR (solo aprobadas) -------------------- */

  list: authedProcedure.query(async () => {
    const db = getDb();
    return db.query.workspaces.findMany({
      where: and(eq(workspaces.status, "approved"), eq(workspaces.archived, false)),
      orderBy: [desc(workspaces.approvedAt)],
    });
  }),

  /* -------------------- MIS MESAS (miembro o admin) -------------------- */

  myWorkspaces: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const memberships = await db.query.workspaceMembers.findMany({
      where: eq(workspaceMembers.userId, ctx.session.userId),
    });
    if (memberships.length === 0) return [];
    const result = [];
    for (const m of memberships) {
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, m.workspaceId),
      });
      if (ws && ws.status === "approved" && !ws.archived) {
        result.push({ ...ws, memberRole: m.role });
      }
    }
    return result;
  }),

  /* -------------------- OBTENER UNA MESA -------------------- */

  get: authedProcedure
    .input(z.object({ workspaceId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, input.workspaceId),
      });
      if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Mesa no encontrada." });
      const member = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, ctx.session.userId),
        ),
      });
      return { ...ws, memberRole: member?.role ?? null };
    }),

  /* -------------------- SOLICITAR UNIRSE -------------------- */

  requestJoin: authedProcedure
    .input(z.object({ workspaceId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, input.workspaceId),
      });
      if (!ws || ws.status !== "approved") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mesa no disponible." });
      }
      const existingMember = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, ctx.session.userId),
        ),
      });
      if (existingMember) {
        return { ok: true, alreadyMember: true };
      }
      const existingRequest = await db.query.workspaceJoinRequests.findFirst({
        where: and(
          eq(workspaceJoinRequests.workspaceId, input.workspaceId),
          eq(workspaceJoinRequests.userId, ctx.session.userId),
          eq(workspaceJoinRequests.status, "pending"),
        ),
      });
      if (existingRequest) {
        return { ok: true, pending: true };
      }
      await db.insert(workspaceJoinRequests).values({
        workspaceId: input.workspaceId,
        userId: ctx.session.userId,
      });
      return { ok: true, pending: true };
    }),

  /* -------------------- LISTAR SOLICITUDES PENDIENTES (admin de mesa) -------------------- */

  listJoinRequests: authedProcedure
    .input(z.object({ workspaceId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, input.workspaceId),
      });
      if (!ws) throw new TRPCError({ code: "NOT_FOUND" });
      // Solo admin de la mesa o admin general
      const member = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, ctx.session.userId),
        ),
      });
      if (member?.role !== "admin" && ctx.session.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const requests = await db
        .select({
          id: workspaceJoinRequests.id,
          status: workspaceJoinRequests.status,
          createdAt: workspaceJoinRequests.createdAt,
          userId: workspaceJoinRequests.userId,
          username: users.username,
          email: users.email,
        })
        .from(workspaceJoinRequests)
        .innerJoin(users, eq(workspaceJoinRequests.userId, users.id))
        .where(
          and(
            eq(workspaceJoinRequests.workspaceId, input.workspaceId),
            eq(workspaceJoinRequests.status, "pending"),
          ),
        )
        .orderBy(desc(workspaceJoinRequests.createdAt));
      return requests;
    }),

  /* -------------------- APROBAR/RECHAZAR INGRESO (admin de mesa) -------------------- */

  respondJoinRequest: authedProcedure
    .input(
      z.object({
        requestId: z.number(),
        action: z.enum(["approve", "reject"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const req = await db.query.workspaceJoinRequests.findFirst({
        where: eq(workspaceJoinRequests.id, input.requestId),
      });
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, req.workspaceId),
      });
      if (!ws) throw new TRPCError({ code: "NOT_FOUND" });
      // Verificar que quien responde es admin de la mesa o admin general
      const member = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, req.workspaceId),
          eq(workspaceMembers.userId, ctx.session.userId),
        ),
      });
      if (member?.role !== "admin" && ctx.session.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo el administrador de la mesa puede responder." });
      }
      await db
        .update(workspaceJoinRequests)
        .set({ status: input.action === "approve" ? "approved" : "rejected", reviewedBy: ctx.session.userId })
        .where(eq(workspaceJoinRequests.id, input.requestId));
      if (input.action === "approve") {
        await db.insert(workspaceMembers).values({
          workspaceId: req.workspaceId,
          userId: req.userId,
          role: "member",
        });
      }
      return { ok: true };
    }),

  /* -------------------- MIEMBROS DE UNA MESA -------------------- */

  members: authedProcedure
    .input(z.object({ workspaceId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          role: workspaceMembers.role,
          joinedAt: workspaceMembers.joinedAt,
        })
        .from(workspaceMembers)
        .innerJoin(users, eq(workspaceMembers.userId, users.id))
        .where(eq(workspaceMembers.workspaceId, input.workspaceId));
    }),

  /* -------------------- CAMBIAR ROL DE MIEMBRO (admin de mesa) -------------------- */

  setMemberRole: authedProcedure
    .input(
      z.object({
        workspaceId: z.number(),
        userId: z.number(),
        role: z.enum(["admin", "member"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, input.workspaceId),
      });
      if (!ws) throw new TRPCError({ code: "NOT_FOUND" });
      const myMembership = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, ctx.session.userId),
        ),
      });
      if (myMembership?.role !== "admin" && ctx.session.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await db
        .update(workspaceMembers)
        .set({ role: input.role })
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.userId),
          ),
        );
      return { ok: true };
    }),

  /* -------------------- ARCHIVAR MESA -------------------- */

  archive: authedProcedure
    .input(z.object({ workspaceId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, input.workspaceId),
      });
      if (!ws) throw new TRPCError({ code: "NOT_FOUND" });
      const myMembership = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, ctx.session.userId),
        ),
      });
      if (myMembership?.role !== "admin" && ctx.session.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await db
        .update(workspaces)
        .set({ archived: true })
        .where(eq(workspaces.id, input.workspaceId));
      return { ok: true };
    }),
});
