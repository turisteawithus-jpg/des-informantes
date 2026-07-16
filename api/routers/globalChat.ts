import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { createRouter, publicQuery, authedProcedure } from "../middleware";
import { getDb } from "../queries/connection";
import { globalChatMessages, users } from "@db/schema";

export const globalChatRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();
    return db
      .select({
        id: globalChatMessages.id,
        content: globalChatMessages.content,
        createdAt: globalChatMessages.createdAt,
        userId: globalChatMessages.userId,
        username: users.username,
      })
      .from(globalChatMessages)
      .innerJoin(users, eq(globalChatMessages.userId, users.id))
      .orderBy(desc(globalChatMessages.createdAt))
      .limit(100);
  }),

  send: authedProcedure
    .input(z.object({ content: z.string().min(1).max(2000) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db.insert(globalChatMessages).values({
        userId: ctx.session.userId,
        content: input.content,
      });
      return { ok: true };
    }),
});
