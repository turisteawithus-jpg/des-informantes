import { z } from "zod";
import { count, desc, eq } from "drizzle-orm";
import { createRouter, adminProcedure } from "../middleware";
import { getDb } from "../queries/connection";
import {
  discussions,
  documents,
  globalChatMessages,
  tasks,
  users,
  workspaceMembers,
  workspaces,
} from "@db/schema";

export const adminRouter = createRouter({
  stats: adminProcedure.query(async () => {
    const db = getDb();
    const [u] = await db.select({ n: count() }).from(users);
    const [w] = await db.select({ n: count() }).from(workspaces);
    const [d] = await db.select({ n: count() }).from(discussions);
    const [t] = await db.select({ n: count() }).from(tasks);
    const [doc] = await db.select({ n: count() }).from(documents);
    const [g] = await db.select({ n: count() }).from(globalChatMessages);
    const [pending] = await db
      .select({ n: count() })
      .from(workspaces)
      .where(eq(workspaces.status, "pending"));
    return {
      users: u.n,
      workspaces: w.n,
      discussions: d.n,
      tasks: t.n,
      documents: doc.n,
      globalMessages: g.n,
      pendingWorkspaces: pending.n,
    };
  }),

  users: adminProcedure.query(async () => {
    const db = getDb();
    return db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        role: users.role,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));
  }),

  setRole: adminProcedure
    .input(z.object({ userId: z.number(), role: z.enum(["admin", "member"]) }))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.session.userId && input.role !== "admin") {
        throw new Error("No puedes quitarte el rol de administrador a ti mismo.");
      }
      const db = getDb();
      await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
      return { ok: true };
    }),

  workspaceAdmins: adminProcedure.query(async () => {
    const db = getDb();
    const approved = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        area: workspaces.area,
        adminId: workspaces.adminId,
        createdAt: workspaces.createdAt,
      })
      .from(workspaces)
      .where(eq(workspaces.status, "approved"))
      .orderBy(desc(workspaces.approvedAt));

    const result = [];
    for (const ws of approved) {
      const members = await db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          role: workspaceMembers.role,
        })
        .from(workspaceMembers)
        .innerJoin(users, eq(workspaceMembers.userId, users.id))
        .where(eq(workspaceMembers.workspaceId, ws.id));
      const admin = members.find((m) => m.role === "admin");
      result.push({ ...ws, members, adminName: admin?.username ?? "Sin admin" });
    }
    return result;
  }),
});
