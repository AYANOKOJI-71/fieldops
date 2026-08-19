import { index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["user", "admin"]);
export const workOrderStatus = pgEnum("work_order_status", ["scheduled", "in_progress", "completed", "needs_review"]);
export const workOrderPriority = pgEnum("work_order_priority", ["low", "standard", "urgent"]);
export const syncEntityType = pgEnum("sync_entity_type", ["work_order", "visit"]);
export const syncOperation = pgEnum("sync_operation", ["create", "update", "resolve_conflict"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("open_id", { length: 128 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("login_method", { length: 64 }),
  role: userRole("role").default("user").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  lastSignedIn: timestamp("last_signed_in", { withTimezone: true }).defaultNow().notNull(),
});

export const fieldWorkOrders = pgTable("field_work_orders", {
  id: varchar("id", { length: 96 }).primaryKey(),
  ownerOpenId: varchar("owner_open_id", { length: 128 }).notNull(),
  customerName: text("customer_name").notNull(),
  serviceSite: text("service_site").notNull(),
  address: text("address").notNull(),
  scheduledStart: timestamp("scheduled_start", { withTimezone: true }).notNull(),
  priority: workOrderPriority("priority").notNull(),
  status: workOrderStatus("status").notNull(),
  description: text("description").notNull(),
  equipment: text("equipment").notNull(),
  version: integer("version").default(1).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: varchar("updated_by", { length: 128 }).notNull(),
}, (table) => [index("field_work_orders_owner_updated_idx").on(table.ownerOpenId, table.updatedAt)]);

export const fieldVisits = pgTable("field_visits", {
  id: varchar("id", { length: 96 }).primaryKey(),
  ownerOpenId: varchar("owner_open_id", { length: 128 }).notNull(),
  workOrderId: varchar("work_order_id", { length: 96 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  notes: text("notes").notNull().default(""),
  checklist: jsonb("checklist").$type<{ siteAccess: boolean; safetyCheck: boolean; serviceComplete: boolean }>().notNull(),
  version: integer("version").default(1).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("field_visits_owner_updated_idx").on(table.ownerOpenId, table.updatedAt), index("field_visits_owner_work_order_idx").on(table.ownerOpenId, table.workOrderId)]);

export const syncMutationLedger = pgTable("sync_mutation_ledger", {
  clientMutationId: varchar("client_mutation_id", { length: 128 }).primaryKey(),
  ownerOpenId: varchar("owner_open_id", { length: 128 }).notNull(),
  entityType: syncEntityType("entity_type").notNull(),
  entityId: varchar("entity_id", { length: 96 }).notNull(),
  operation: syncOperation("operation").notNull(),
  appliedVersion: integer("applied_version").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("sync_mutation_ledger_owner_idx").on(table.ownerOpenId)]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type FieldWorkOrder = typeof fieldWorkOrders.$inferSelect;
export type FieldVisit = typeof fieldVisits.$inferSelect;
