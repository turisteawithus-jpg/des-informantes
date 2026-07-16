import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, adminProcedure } from "../middleware";
import { getDb } from "../queries/connection";
import { users, workspaceMembers, workspaces } from "@db/schema";

export const workspaceApprovalsRouter = createRouter({
  /** Listar todas las mesas pendientes de aprobación (admin general). */
  pending: adminProcedure.query(async () => {
    const db = getDb();
    return db.query.workspaces.findMany({
      where: eq(workspaces.status, "pending"),
      orderBy: [desc(workspaces.createdAt)],
    });
  }),

  /** Listar todas las mesas aprobadas (admin general). */
  approved: adminProcedure.query(async () => {
    const db = getDb();
    return db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        area: workspaces.area,
        description: workspaces.description,
        objective: workspaces.objective,
        status: workspaces.status,
        createdBy: workspaces.createdBy,
        adminId: workspaces.adminId,
        createdAt: workspaces.createdAt,
        approvedAt: workspaces.approvedAt,
        creatorName: users.username,
        creatorEmail: users.email,
      })
      .from(workspaces)
      .innerJoin(users, eq(workspaces.createdBy, users.id))
      .where(and(eq(workspaces.status, "approved"), eq(workspaces.archived, false)))
      .orderBy(desc(workspaces.approvedAt));
  }),

  /** Aprobar una mesa: el creador se convierte en admin de la mesa. */
  approve: adminProcedure
    .input(z.object({ workspaceId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, input.workspaceId),
      });
      if (!ws) throw new TRPCError({ code: "NOT_FOUND" });
      if (ws.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "La mesa ya fue procesada." });
      }
      await db
        .update(workspaces)
        .set({
          status: "approved",
          adminId: ws.createdBy,
          approvedBy: ctx.session.userId,
          approvedAt: new Date(),
        })
        .where(eq(workspaces.id, input.workspaceId));
      // El creador se convierte en admin de la mesa
      await db.insert(workspaceMembers).values({
        workspaceId: input.workspaceId,
        userId: ws.createdBy,
        role: "admin",
      });
      return { ok: true };
    }),

  /** Rechazar una mesa. */
  reject: adminProcedure
    .input(z.object({ workspaceId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(workspaces)
        .set({ status: "rejected" })
        .where(eq(workspaces.id, input.workspaceId));
      return { ok: true };
    }),

  /** Cambiar admin de una mesa (admin general). */
  setWorkspaceAdmin: adminProcedure
    .input(z.object({ workspaceId: z.number(), userId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(workspaces)
        .set({ adminId: input.userId })
        .where(eq(workspaces.id, input.workspaceId));
      // Asegurar que el nuevo admin sea admin en workspace_members
      const existing = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.userId),
        ),
      });
      if (existing) {
        await db
          .update(workspaceMembers)
          .set({ role: "admin" })
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, input.userId),
            ),
          );
      } else {
        await db.insert(workspaceMembers).values({
          workspaceId: input.workspaceId,
          userId: input.userId,
          role: "admin",
        });
      }
      return { ok: true };
    }),

  /** Quitar admin de una mesa (admin general): pasa a ser member. */
  removeWorkspaceAdmin: adminProcedure
    .input(z.object({ workspaceId: z.number(), userId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(workspaceMembers)
        .set({ role: "member" })
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.userId),
          ),
        );
      return { ok: true };
    }),
});
