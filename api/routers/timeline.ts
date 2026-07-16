import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { createRouter, authedProcedure } from "../middleware";
import { getDb } from "../queries/connection";
import { workspaceTimelineItems } from "@db/schema";

export const timelineRouter = createRouter({
  list: authedProcedure
    .input(z.object({ workspaceId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db.query.workspaceTimelineItems.findMany({
        where: eq(workspaceTimelineItems.workspaceId, input.workspaceId),
        orderBy: [asc(workspaceTimelineItems.itemDate)],
      });
    }),

  create: authedProcedure
    .input(
      z.object({
        workspaceId: z.number(),
        title: z.string().min(1).max(255),
        description: z.string().max(1000).optional(),
        itemDate: z.string().datetime().optional(),
        linkType: z.enum(["document", "task", "discussion", "none"]).optional(),
        linkId: z.number().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const [result] = await db.insert(workspaceTimelineItems).values({
        workspaceId: input.workspaceId,
        title: input.title,
        description: input.description ?? null,
        itemDate: input.itemDate ? new Date(input.itemDate) : null,
        linkType: input.linkType ?? "none",
        linkId: input.linkId ?? null,
      });
      return { itemId: Number(result.insertId) };
    }),

  remove: authedProcedure
    .input(z.object({ itemId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .delete(workspaceTimelineItems)
        .where(eq(workspaceTimelineItems.id, input.itemId));
      return { ok: true };
    }),
});
