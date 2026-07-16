import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedProcedure } from "../middleware";
import { getDb } from "../queries/connection";
import { documents, tasks, users, workspaceMembers } from "@db/schema";

async function requireWorkspaceMember(workspaceId: number, userId: number) {
  const db = getDb();
  const member = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
  });
  if (!member) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No eres miembro de esta mesa." });
  }
  return member;
}

export const tasksRouter = createRouter({
  list: authedProcedure
    .input(z.object({ workspaceId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          discussionId: tasks.discussionId,
          dueDate: tasks.dueDate,
          resultDocumentId: tasks.resultDocumentId,
          createdAt: tasks.createdAt,
          assigneeId: tasks.assigneeId,
          assigneeName: users.username,
        })
        .from(tasks)
        .leftJoin(users, eq(tasks.assigneeId, users.id))
        .where(eq(tasks.workspaceId, input.workspaceId))
        .orderBy(desc(tasks.createdAt));
    }),

  create: authedProcedure
    .input(
      z.object({
        workspaceId: z.number(),
        title: z.string().min(2).max(255),
        description: z.string().max(2000).optional(),
        discussionId: z.number().optional(),
        assigneeId: z.number().optional(),
        dueDate: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireWorkspaceMember(input.workspaceId, ctx.session.userId);
      const db = getDb();
      const [result] = await db.insert(tasks).values({
        workspaceId: input.workspaceId,
        title: input.title,
        description: input.description ?? null,
        discussionId: input.discussionId ?? null,
        assigneeId: input.assigneeId ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
      });
      return { taskId: Number(result.insertId) };
    }),

  updateStatus: authedProcedure
    .input(
      z.object({
        taskId: z.number(),
        status: z.enum(["pending", "in_progress", "done"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const task = await db.query.tasks.findFirst({
        where: eq(tasks.id, input.taskId),
      });
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceMember(task.workspaceId, ctx.session.userId);
      await db.update(tasks).set({ status: input.status }).where(eq(tasks.id, input.taskId));
      return { ok: true };
    }),

  attachResult: authedProcedure
    .input(z.object({ taskId: z.number(), documentId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const task = await db.query.tasks.findFirst({
        where: eq(tasks.id, input.taskId),
      });
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkspaceMember(task.workspaceId, ctx.session.userId);
      const doc = await db.query.documents.findFirst({
        where: eq(documents.id, input.documentId),
      });
      if (!doc || doc.workspaceId !== task.workspaceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Documento no pertenece a esta mesa." });
      }
      await db
        .update(tasks)
        .set({ resultDocumentId: input.documentId, status: "done" })
        .where(eq(tasks.id, input.taskId));
      return { ok: true };
    }),
});
