import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { createRouter, authedProcedure } from "../middleware";
import { getDb } from "../queries/connection";
import { documents, users } from "@db/schema";

export const documentsRouter = createRouter({
  list: authedProcedure
    .input(z.object({ workspaceId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select({
          id: documents.id,
          title: documents.title,
          topic: documents.topic,
          fileName: documents.fileName,
          fileUrl: documents.fileUrl,
          mimeType: documents.mimeType,
          sizeBytes: documents.sizeBytes,
          taskId: documents.taskId,
          discussionId: documents.discussionId,
          createdAt: documents.createdAt,
          uploadedByName: users.username,
        })
        .from(documents)
        .innerJoin(users, eq(documents.uploadedBy, users.id))
        .where(eq(documents.workspaceId, input.workspaceId))
        .orderBy(desc(documents.createdAt));
    }),

  topics: authedProcedure
    .input(z.object({ workspaceId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({ topic: documents.topic })
        .from(documents)
        .where(eq(documents.workspaceId, input.workspaceId));
      const set = new Set<string>();
      for (const r of rows) if (r.topic) set.add(r.topic);
      return [...set];
    }),

  remove: authedProcedure
    .input(z.object({ documentId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const doc = await db.query.documents.findFirst({
        where: eq(documents.id, input.documentId),
      });
      if (!doc) return { ok: false };
      if (doc.uploadedBy !== ctx.session.userId && ctx.session.role !== "admin") {
        return { ok: false };
      }
      await db.delete(documents).where(eq(documents.id, input.documentId));
      return { ok: true };
    }),
});
