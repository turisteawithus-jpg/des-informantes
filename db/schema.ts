import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  boolean,
  int,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

/* ----------------------------- USUARIOS ----------------------------- */

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  username: varchar("username", { length: 80 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["admin", "member"]).notNull().default("member"),
  emailVerified: boolean("email_verified").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const emailVerificationCodes = mysqlTable("email_verification_codes", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  code: varchar("code", { length: 6 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ------------------------- CHAT GLOBAL PÚBLICO ------------------------- */

export const globalChatMessages = mysqlTable("global_chat_messages", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  content: text("content").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ------------------------ MESAS DE TRABAJO ------------------------ */

export const workspaces = mysqlTable("workspaces", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  area: varchar("area", { length: 255 }),
  description: text("description"),
  objective: text("objective"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }).notNull(),
  adminId: bigint("admin_id", { mode: "number", unsigned: true }),
  status: mysqlEnum("status", ["pending", "approved", "rejected"])
    .notNull()
    .default("pending"),
  approvedBy: bigint("approved_by", { mode: "number", unsigned: true }),
  approvedAt: timestamp("approved_at"),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const workspaceMembers = mysqlTable(
  "workspace_members",
  {
    id: serial("id").primaryKey(),
    workspaceId: bigint("workspace_id", { mode: "number", unsigned: true }).notNull(),
    userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
    role: mysqlEnum("role", ["admin", "member"]).notNull().default("member"),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workspace_members_unique").on(t.workspaceId, t.userId)],
);

export const workspaceJoinRequests = mysqlTable("workspace_join_requests", {
  id: serial("id").primaryKey(),
  workspaceId: bigint("workspace_id", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected"])
    .notNull()
    .default("pending"),
    reviewedBy: bigint("reviewed_by", { mode: "number", unsigned: true }),
  message: text("message"),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
/* ------------------------ LÍNEA DE TRABAJO ------------------------ */

export const workspaceTimelineItems = mysqlTable("workspace_timeline_items", {
  id: serial("id").primaryKey(),
  workspaceId: bigint("workspace_id", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  itemDate: timestamp("item_date"),
  linkType: mysqlEnum("link_type", ["document", "task", "discussion", "none"])
    .notNull()
    .default("none"),
  linkId: bigint("link_id", { mode: "number", unsigned: true }),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* --------------------- DISCUSIONES (chats internos) --------------------- */

export const discussions = mysqlTable("discussions", {
  id: serial("id").primaryKey(),
  workspaceId: bigint("workspace_id", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: mysqlEnum("status", ["open", "closed"]).notNull().default("open"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
});

/* --------------------------- MENSAJES --------------------------- */

export const discussionMessages = mysqlTable("discussion_messages", {
  id: serial("id").primaryKey(),
  discussionId: bigint("discussion_id", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  type: mysqlEnum("type", ["text", "audio", "system"]).notNull().default("text"),
  content: text("content"),
  audioUrl: varchar("audio_url", { length: 500 }),
  transcriptionStatus: mysqlEnum("transcription_status", [
    "none",
    "pending",
    "done",
    "error",
  ])
    .notNull()
    .default("none"),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ----------------------- RESÚMENES / RELATORÍAS IA ----------------------- */

export const summaries = mysqlTable("summaries", {
  id: serial("id").primaryKey(),
  discussionId: bigint("discussion_id", { mode: "number", unsigned: true }).notNull(),
  workspaceId: bigint("workspace_id", { mode: "number", unsigned: true }).notNull(),
  kind: mysqlEnum("kind", ["partial", "relatoria", "systematization"])
    .notNull()
    .default("partial"),
  content: text("content").notNull(),
  messageCount: int("message_count").notNull().default(0),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
/* ----------------------- CHATS PRIVADOS ----------------------- */

/* ----------------------- MODERACION ----------------------- */

export const discussionModerationStates = mysqlTable("discussion_moderation_states", {
  id: serial("id").primaryKey(),
  discussionId: bigint("discussion_id", { mode: "number", unsigned: true }).notNull().unique(),
  currentPhase: mysqlEnum("current_phase", [
    "apertura", "contextualizacion", "comprension", "sintesis_parcial",
    "profundizacion", "coincidencias_diferencias", "alternativas",
    "evaluacion", "acuerdo", "conclusion", "compromisos"
  ]).notNull().default("apertura"),
  topics: text("topics"),
  currentTopicIndex: int("current_topic_index").notNull().default(0),
  bridgeText: text("bridge_text"),
  handsRaised: text("hands_raised"),
  wordRound: int("word_round").notNull().default(1),
  interventionsRequired: int("interventions_required").notNull().default(5),
  interventionsCompleted: int("interventions_completed").notNull().default(0),
  active: boolean("active").notNull().default(false),
  activatedBy: bigint("activated_by", { mode: "number", unsigned: true }),
  activatedAt: timestamp("activated_at"),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const moderationConclusions = mysqlTable("moderation_conclusions", {
  id: serial("id").primaryKey(),
  discussionId: bigint("discussion_id", { mode: "number", unsigned: true }).notNull(),
  phase: mysqlEnum("phase", [
    "apertura", "contextualizacion", "comprension", "sintesis_parcial",
    "profundizacion", "coincidencias_diferencias", "alternativas",
    "evaluacion", "acuerdo", "conclusion", "compromisos"
  ]).notNull(),
  topicIndex: int("topic_index").notNull().default(0),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const privateConversations = mysqlTable(
  "private_conversations",
  {
    id: serial("id").primaryKey(),
    user1Id: bigint("user1_id", { mode: "number", unsigned: true }).notNull(),
    user2Id: bigint("user2_id", { mode: "number", unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [uniqueIndex("private_conv_unique").on(t.user1Id, t.user2Id)],
);

export const privateMessages = mysqlTable("private_messages", {
  id: serial("id").primaryKey(),
  conversationId: bigint("conversation_id", { mode: "number", unsigned: true }).notNull(),
  senderId: bigint("sender_id", { mode: "number", unsigned: true }).notNull(),
  content: text("content").notNull(),
  read: boolean("read").notNull().default(false),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
/* ------------------------------- TAREAS ------------------------------- */

export const tasks = mysqlTable("tasks", {
  id: serial("id").primaryKey(),
  workspaceId: bigint("workspace_id", { mode: "number", unsigned: true }).notNull(),
  discussionId: bigint("discussion_id", { mode: "number", unsigned: true }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: mysqlEnum("status", ["pending", "in_progress", "done"])
    .notNull()
    .default("pending"),
  assigneeId: bigint("assignee_id", { mode: "number", unsigned: true }),
  dueDate: timestamp("due_date"),
  resultDocumentId: bigint("result_document_id", {
    mode: "number",
    unsigned: true,
  }),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

/* ----------------------------- DOCUMENTOS ----------------------------- */

export const documents = mysqlTable("documents", {
  id: serial("id").primaryKey(),
  workspaceId: bigint("workspace_id", { mode: "number", unsigned: true }).notNull(),
  discussionId: bigint("discussion_id", { mode: "number", unsigned: true }),
  taskId: bigint("task_id", { mode: "number", unsigned: true }),
  conclusionId: bigint("conclusion_id", { mode: "number", unsigned: true }),
  uploadedBy: bigint("uploaded_by", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  topic: varchar("topic", { length: 120 }),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileUrl: varchar("file_url", { length: 500 }).notNull(),
  mimeType: varchar("mime_type", { length: 120 }),
  sizeBytes: int("size_bytes").notNull().default(0),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
