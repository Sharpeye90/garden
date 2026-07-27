import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const gardenStates = sqliteTable("garden_states", {
  userKey: text("user_key").primaryKey(),
  gardenId: text("garden_id").notNull().default("primary"),
  payload: text("payload").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  key: text("key").primaryKey(),
  userKey: text("user_key").notNull(),
  resultRevision: integer("result_revision").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const recommendationFeedback = sqliteTable("recommendation_feedback", {
  id: text("id").primaryKey(),
  userKey: text("user_key").notNull(),
  gardenId: text("garden_id").notNull(),
  taskId: text("task_id").notNull(),
  ruleId: text("rule_id").notNull(),
  category: text("category").notNull(),
  comment: text("comment"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const assistantQuestions = sqliteTable("assistant_questions", {
  id: text("id").primaryKey(),
  userKey: text("user_key").notNull(),
  gardenId: text("garden_id").notNull(),
  question: text("question").notNull(),
  status: text("status").notNull().default("queued"),
  response: text("response"),
  inputHash: text("input_hash"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: text("completed_at"),
});

export const contentImports = sqliteTable("content_imports", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  sourceHash: text("source_hash").notNull(),
  rowCount: integer("row_count").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
