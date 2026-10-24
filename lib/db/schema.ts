import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

const userId = () =>
  text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

// ─── Enums ──────────────────────────────────────────────────────────────────

export const userStatus = pgEnum("user_status", ["active", "waitlist"]);
export const agentRole = pgEnum("agent_role", ["primary", "specialized"]);
export const chatChannel = pgEnum("chat_channel", ["web", "telegram"]);
export const messageRole = pgEnum("message_role", ["user", "assistant", "system", "tool"]);

// ─── Users + Auth.js adapter tables ─────────────────────────────────────────

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  // Required by the Auth.js Drizzle adapter.
  emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
  status: userStatus("status").notNull().default("active"),
  plan: text("plan").notNull().default("free"),
  timezone: text("timezone").notNull().default("America/New_York"),
  telegramChatId: text("telegram_chat_id").unique(),
  telegramLinkedAt: timestamp("telegram_linked_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: userId(),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("accounts_user_id_idx").on(t.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: userId(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ─── Application tables (all user-owned) ────────────────────────────────────

export const agents = pgTable(
  "agents",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull(),
    role: agentRole("role").notNull(),
    description: text("description"),
    soul: text("soul").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("agents_user_id_idx").on(t.userId),
    // At most one primary agent per user.
    uniqueIndex("agents_one_primary_per_user").on(t.userId).where(sql`${t.role} = 'primary'`),
  ],
);

export const chats = pgTable(
  "chats",
  {
    id: id(),
    userId: userId(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    channel: chatChannel("channel").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("chats_user_id_idx").on(t.userId)],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    userId: userId(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_user_id_idx").on(t.userId),
    index("messages_chat_id_created_at_idx").on(t.chatId, t.createdAt),
  ],
);

export const scheduledJobs = pgTable(
  "scheduled_jobs",
  {
    id: id(),
    userId: userId(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    cronExpression: text("cron_expression").notNull(),
    prompt: text("prompt").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true, mode: "date" }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("scheduled_jobs_user_id_idx").on(t.userId),
    index("scheduled_jobs_enabled_next_run_at_idx").on(t.enabled, t.nextRunAt),
  ],
);

export const usage = pgTable(
  "usage",
  {
    id: id(),
    userId: userId(),
    /** YYYY-MM */
    month: text("month").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),
  },
  (t) => [
    index("usage_user_id_idx").on(t.userId),
    uniqueIndex("usage_user_id_month_unique").on(t.userId, t.month),
  ],
);

/**
 * How much the agent may do with one connected toolkit. `access` is a level id from
 * lib/agents/composio.ts; no row means that toolkit's default level.
 */
export const integrationAccess = pgTable(
  "integration_access",
  {
    id: id(),
    userId: userId(),
    /** Composio toolkit slug, uppercase (e.g. GMAIL). */
    toolkit: text("toolkit").notNull(),
    access: text("access").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("integration_access_user_id_toolkit_unique").on(t.userId, t.toolkit)],
);

// ─── Inferred types ─────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserStatus = (typeof userStatus.enumValues)[number];

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type VerificationToken = typeof verificationTokens.$inferSelect;
export type NewVerificationToken = typeof verificationTokens.$inferInsert;

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type AgentRole = (typeof agentRole.enumValues)[number];

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type ChatChannel = (typeof chatChannel.enumValues)[number];

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageRole = (typeof messageRole.enumValues)[number];

export type ScheduledJob = typeof scheduledJobs.$inferSelect;
export type NewScheduledJob = typeof scheduledJobs.$inferInsert;

export type Usage = typeof usage.$inferSelect;
export type NewUsage = typeof usage.$inferInsert;

export type IntegrationAccess = typeof integrationAccess.$inferSelect;
