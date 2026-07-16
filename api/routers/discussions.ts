import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedProcedure } from "../middleware";
import { getDb } from "../queries/connection";
import {
  discussionMessages,
  discussions,
  documents,
  summaries,
  tasks,
  users,
  workspaceMembers,
  workspaces,
} from "@db/schema";
import {
  generateRelatoria,
  generateSystematization,
  type DiscussionMessage,
} from "../lib/gemini";
import { maybeCreatePartialSummary } from "../lib/discussion";

async function requireWorkspaceMember(workspaceId: number, userId: number) {
  const db = getDb();
  const member = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
  });
  if (!member) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No eres miembro de esta mesa de trabajo.",
    });
  }
  return member;
}

export const discussionsRouter = createRouter({
  /* ------------------------------ DISCUSIONES ------------------------------ */

  list: authedProcedure
    .input(z.object({ workspaceId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db.query.discussions.findMany({
        where: eq(discussions.workspaceId, input.workspaceId),
        orderBy: [desc(discussions.createdAt)],
      });
    }),

  create: authedProcedure
    .input(
      z.object({
        workspaceId: z.number(),
        title: z.string().min(2).max(255),
        description: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireWorkspaceMember(input.workspaceId, ctx.session.userId);
      const db = getDb();
      const [result] = await db.insert(discussions).values({
        workspaceId: input.workspaceId,
        title: input.title,
        description: input.description ?? null,
        createdBy: ctx.session.userId,
      });
      return { discussionId: Number(result.insertId) };
    }),

  get: authedProcedure
    .input(z.object({ discussionId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const d = await db.query.discussions.findFirst({
        where: eq(discussions.id, input.discussionId),
      });
      if (!d)
        throw new TRPCError({ code: "NOT_FOUND", message: "Discusión no encontrada." });
      return d;
    }),

  close: authedProcedure
    .input(z.object({ discussionId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const d = await db.query.discussions.findFirst({
        where: eq(discussions.id, input.discussionId),
      });
      if (!d)
        throw new TRPCError({ code: "NOT_FOUND", message: "Discusión no encontrada." });
      const member = await requireWorkspaceMember(d.workspaceId, ctx.session.userId);
      if (member.role !== "admin" && ctx.session.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo el administrador de la mesa puede cerrar la discusión.",
        });
      }
      const rows = await db
        .select({
          userId: discussionMessages.userId,
          type: discussionMessages.type,
          content: discussionMessages.content,
        })
        .from(discussionMessages)
        .where(eq(discussionMessages.discussionId, input.discussionId))
        .orderBy(asc(discussionMessages.createdAt));

      const nameMap = new Map<number, string>();
      for (const uid of [...new Set(rows.map((r) => r.userId))]) {
        const u = await db.query.users.findFirst({ where: eq(users.id, uid) });
        if (u) nameMap.set(uid, u.username);
      }

      const discussion: DiscussionMessage[] = rows
        .filter((r) => r.content)
        .map((r) => ({
          username: nameMap.get(r.userId) ?? "Participante",
          type: r.type,
          content: r.content ?? "",
        }));

      const partials = await db.query.summaries.findMany({
        where: and(
          eq(summaries.discussionId, input.discussionId),
          eq(summaries.kind, "partial"),
        ),
        orderBy: [asc(summaries.createdAt)],
      });

      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, d.workspaceId),
      });

      const relatoria = await generateRelatoria(
        ws?.name ?? "Proyecto",
        d.title,
        discussion,
        partials.map((p) => p.content),
      );

      await db
        .update(discussions)
        .set({ status: "closed", closedAt: new Date() })
        .where(eq(discussions.id, input.discussionId));

      if (relatoria) {
        await db.insert(summaries).values({
          discussionId: input.discussionId,
          workspaceId: d.workspaceId,
          kind: "relatoria",
          content: relatoria,
          messageCount: rows.length,
        });
      }

      return { ok: true, hasRelatoria: !!relatoria };
    }),

  /* ------------------------------ MENSAJES ------------------------------ */

  messages: authedProcedure
    .input(z.object({ discussionId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select({
          id: discussionMessages.id,
          type: discussionMessages.type,
          content: discussionMessages.content,
          audioUrl: discussionMessages.audioUrl,
          transcriptionStatus: discussionMessages.transcriptionStatus,
          createdAt: discussionMessages.createdAt,
          userId: discussionMessages.userId,
          username: users.username,
        })
        .from(discussionMessages)
        .innerJoin(users, eq(discussionMessages.userId, users.id))
        .where(eq(discussionMessages.discussionId, input.discussionId))
        .orderBy(asc(discussionMessages.createdAt));
    }),

  sendText: authedProcedure
    .input(
      z.object({
        discussionId: z.number(),
        content: z.string().min(1).max(4000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const d = await db.query.discussions.findFirst({
        where: eq(discussions.id, input.discussionId),
      });
      if (!d)
        throw new TRPCError({ code: "NOT_FOUND", message: "Discusión no encontrada." });
      if (d.status === "closed")
        throw new TRPCError({ code: "BAD_REQUEST", message: "La discusión está cerrada." });
      await requireWorkspaceMember(d.workspaceId, ctx.session.userId);
      await db.insert(discussionMessages).values({
        discussionId: input.discussionId,
        userId: ctx.session.userId,
        type: "text",
        content: input.content,
      });
      void maybeCreatePartialSummary(input.discussionId).catch((e) =>
        console.error("[summary] Error:", e),
      );
      return { ok: true };
    }),

  /* --------------------------- RESÚMENES / IA --------------------------- */

  summaries: authedProcedure
    .input(z.object({ discussionId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db.query.summaries.findMany({
        where: and(
          eq(summaries.discussionId, input.discussionId),
          eq(summaries.kind, "partial"),
        ),
        orderBy: [asc(summaries.createdAt)],
      });
    }),

  relatoria: authedProcedure
    .input(z.object({ discussionId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db.query.summaries.findFirst({
        where: and(
          eq(summaries.discussionId, input.discussionId),
          eq(summaries.kind, "relatoria"),
        ),
        orderBy: [desc(summaries.createdAt)],
      });
    }),

  /* ------------------------ SISTEMATIZACIÓN ------------------------ */

  generateSystematization: authedProcedure
    .input(z.object({ workspaceId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await requireWorkspaceMember(input.workspaceId, ctx.session.userId);
      const ws = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, input.workspaceId),
      });
      if (!ws) throw new TRPCError({ code: "NOT_FOUND" });

      const wsDiscussions = await db.query.discussions.findMany({
        where: eq(discussions.workspaceId, input.workspaceId),
        orderBy: [asc(discussions.createdAt)],
      });

      const discussionsWithRelatoria = [];
      for (const d of wsDiscussions) {
        const rel = await db.query.summaries.findFirst({
          where: and(
            eq(summaries.discussionId, d.id),
            eq(summaries.kind, "relatoria"),
          ),
          orderBy: [desc(summaries.createdAt)],
        });
        discussionsWithRelatoria.push({ title: d.title, relatoria: rel?.content ?? null });
      }

      const wsTasks = await db.query.tasks.findMany({
        where: eq(tasks.workspaceId, input.workspaceId),
      });
      const assigneeNames = new Map<number, string>();
      for (const t of wsTasks) {
        if (t.assigneeId && !assigneeNames.has(t.assigneeId)) {
          const u = await db.query.users.findFirst({
            where: eq(users.id, t.assigneeId),
          });
          if (u) assigneeNames.set(t.assigneeId, u.username);
        }
      }

      const wsDocs = await db.query.documents.findMany({
        where: eq(documents.workspaceId, input.workspaceId),
      });

      const content = await generateSystematization({
        workspaceTitle: ws.name,
        workspaceDescription: ws.description ?? "",
        discussions: discussionsWithRelatoria,
        tasks: wsTasks.map((t) => ({
          title: t.title,
          status: t.status,
          assignee: t.assigneeId ? (assigneeNames.get(t.assigneeId) ?? null) : null,
        })),
        documents: wsDocs.map((d) => ({ title: d.title, topic: d.topic })),
      });

      if (!content) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No se pudo generar la sistematización. Verifica GEMINI_API_KEY.",
        });
      }

      const firstDiscussion = wsDiscussions[0];
      await db.insert(summaries).values({
        discussionId: firstDiscussion?.id ?? 0,
        workspaceId: input.workspaceId,
        kind: "systematization",
        content,
        messageCount: 0,
      });

      return { content };
    }),

  latestSystematization: authedProcedure
    .input(z.object({ workspaceId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db.query.summaries.findFirst({
        where: and(
          eq(summaries.workspaceId, input.workspaceId),
          eq(summaries.kind, "systematization"),
        ),
        orderBy: [desc(summaries.createdAt)],
      });
    }),
});
