import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./routers/auth";
import { globalChatRouter } from "./routers/globalChat";
import { workspacesRouter } from "./routers/workspaces";
import { workspaceApprovalsRouter } from "./routers/workspaceApprovals";
import { discussionsRouter } from "./routers/discussions";
import { tasksRouter } from "./routers/tasks";
import { documentsRouter } from "./routers/documents";
import { timelineRouter } from "./routers/timeline";
import { adminRouter } from "./routers/admin";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  globalChat: globalChatRouter,
  workspaces: workspacesRouter,
  workspaceApprovals: workspaceApprovalsRouter,
  discussions: discussionsRouter,
  tasks: tasksRouter,
  documents: documentsRouter,
  timeline: timelineRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
