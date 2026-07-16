import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { discussions, discussionMessages, summaries } from "@db/schema";
import {
  summarizeDiscussion,
  type DiscussionMessage,
} from "./gemini";

export const SUMMARY_EVERY = 5;

export async function maybeCreatePartialSummary(
  discussionId: number,
): Promise<void> {
  const db = getDb();

  const discussion = await db.query.discussions.findFirst({
    where: eq(discussions.id, discussionId),
  });
  if (!discussion) return;

  const [{ total }] = await db
    .select({ total: count() })
    .from(discussionMessages)
    .where(eq(discussionMessages.discussionId, discussionId));

  if (total === 0 || total % SUMMARY_EVERY !== 0) return;

  const existing = await db.query.summaries.findFirst({
    where: and(
      eq(summaries.discussionId, discussionId),
      eq(summaries.kind, "partial"),
      eq(summaries.messageCount, total),
    ),
  });
  if (existing) return;

  const rows = await db
    .select({
      username: discussionMessages.userId,
      type: discussionMessages.type,
      content: discussionMessages.content,
    })
    .from(discussionMessages)
    .where(eq(discussionMessages.discussionId, discussionId))
    .orderBy(desc(discussionMessages.createdAt))
    .limit(SUMMARY_EVERY * 2);

  const userIds = [...new Set(rows.map((r) => r.username))];
  const usersTable = (await import("@db/schema")).users;
  const nameMap = new Map<number, string>();
  for (const uid of userIds) {
    const u = await db.query.users.findFirst({
      where: eq(usersTable.id, uid),
    });
    if (u) nameMap.set(uid, u.username);
  }

  const messages: DiscussionMessage[] = rows
    .reverse()
    .filter((r) => r.content)
    .map((r) => ({
      username: nameMap.get(r.username) ?? "Participante",
      type: r.type,
      content: r.content ?? "",
    }));

  const ws = await db.query.workspaces.findFirst({
    where: (w, { eq: eqFn }) => eqFn(w.id, discussion.workspaceId),
  });

  const summary = await summarizeDiscussion(
    ws?.name ?? "Proyecto",
    discussion.title,
    messages,
  );

  if (summary) {
    await db.insert(summaries).values({
      discussionId,
      workspaceId: discussion.workspaceId,
      kind: "partial",
      content: summary,
      messageCount: total,
    });
  }
}
