import { and, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { fieldVisits, fieldWorkOrders, type InsertUser, syncMutationLedger, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
export async function getDb() {
  if (!_db && process.env.FIELD_SERVICE_POSTGRES_URL) {
    try { _db = drizzle(process.env.FIELD_SERVICE_POSTGRES_URL); } catch (error) { console.warn("[Database] Failed to connect:", error); _db = null; }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb(); if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  const values: InsertUser = { openId: user.openId, lastSignedIn: user.lastSignedIn ?? new Date() };
  const updateSet: Record<string, unknown> = { updatedAt: new Date(), lastSignedIn: values.lastSignedIn };
  for (const field of ["name", "email", "loginMethod"] as const) if (user[field] !== undefined) { values[field] = user[field] ?? null; updateSet[field] = user[field] ?? null; }
  values.role = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user"); updateSet.role = values.role;
  await db.insert(users).values(values).onConflictDoUpdate({ target: users.openId, set: updateSet });
}

export async function getUserByOpenId(openId: string) { const db = await getDb(); if (!db) return undefined; const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1); return result[0]; }

const checklistSchema = z.object({ siteAccess: z.boolean(), safetyCheck: z.boolean(), serviceComplete: z.boolean() });
const workOrderPayloadSchema = z.object({ customerName: z.string().min(1), serviceSite: z.string().min(1), address: z.string().min(1), scheduledStart: z.string().datetime(), priority: z.enum(["low", "standard", "urgent"]), status: z.enum(["scheduled", "in_progress", "completed", "needs_review"]), description: z.string().min(1), equipment: z.string().min(1), updatedBy: z.string().min(1).max(128).optional() });
const visitPayloadSchema = z.object({ workOrderId: z.string().min(1).max(96), startedAt: z.string().datetime().nullable(), completedAt: z.string().datetime().nullable(), notes: z.string().max(12000), checklist: checklistSchema });

export type IncomingSyncMutation = { clientMutationId: string; entityType: "work_order" | "visit"; entityId: string; operation: "create" | "update" | "resolve_conflict"; payload: Record<string, unknown>; baseVersion: number; createdAt: string };
export type AppliedMutation = { clientMutationId: string; entityType: IncomingSyncMutation["entityType"]; entityId: string; version: number; idempotent?: boolean };
export type ConflictMutation = { clientMutationId: string; entityType: IncomingSyncMutation["entityType"]; entityId: string; reason: string; serverRecord: unknown };

export async function applyFieldServiceMutations(ownerOpenId: string, mutations: IncomingSyncMutation[]) {
  const db = await getDb(); if (!db) throw new Error("Database is not available for synchronization");
  const applied: AppliedMutation[] = []; const conflicts: ConflictMutation[] = [];
  for (const mutation of mutations) {
    await db.transaction(async (tx) => {
      const previous = await tx.select().from(syncMutationLedger).where(eq(syncMutationLedger.clientMutationId, mutation.clientMutationId)).limit(1);
      if (previous[0]) { applied.push({ clientMutationId: mutation.clientMutationId, entityType: mutation.entityType, entityId: mutation.entityId, version: previous[0].appliedVersion, idempotent: true }); return; }
      if (mutation.entityType === "work_order") {
        const parsed = workOrderPayloadSchema.safeParse(mutation.payload);
        if (!parsed.success) { conflicts.push({ clientMutationId: mutation.clientMutationId, entityType: mutation.entityType, entityId: mutation.entityId, reason: "The work-order payload is invalid.", serverRecord: null }); return; }
        const current = (await tx.select().from(fieldWorkOrders).where(and(eq(fieldWorkOrders.id, mutation.entityId), eq(fieldWorkOrders.ownerOpenId, ownerOpenId))).limit(1))[0];
        if (current && current.version !== mutation.baseVersion) { conflicts.push({ clientMutationId: mutation.clientMutationId, entityType: mutation.entityType, entityId: mutation.entityId, reason: "The server record changed after this field edit started.", serverRecord: current }); return; }
        if (!current && mutation.operation !== "create") { conflicts.push({ clientMutationId: mutation.clientMutationId, entityType: mutation.entityType, entityId: mutation.entityId, reason: "The server does not have this work order yet.", serverRecord: null }); return; }
        const nextVersion = (current?.version ?? 0) + 1;
        const record = { ownerOpenId, customerName: parsed.data.customerName, serviceSite: parsed.data.serviceSite, address: parsed.data.address, scheduledStart: new Date(parsed.data.scheduledStart), priority: parsed.data.priority, status: parsed.data.status, description: parsed.data.description, equipment: parsed.data.equipment, version: nextVersion, updatedAt: new Date(), updatedBy: parsed.data.updatedBy ?? ownerOpenId };
        if (current) await tx.update(fieldWorkOrders).set(record).where(eq(fieldWorkOrders.id, mutation.entityId)); else await tx.insert(fieldWorkOrders).values({ id: mutation.entityId, ...record });
        await tx.insert(syncMutationLedger).values({ clientMutationId: mutation.clientMutationId, ownerOpenId, entityType: mutation.entityType, entityId: mutation.entityId, operation: mutation.operation, appliedVersion: nextVersion }); applied.push({ clientMutationId: mutation.clientMutationId, entityType: mutation.entityType, entityId: mutation.entityId, version: nextVersion }); return;
      }
      const parsed = visitPayloadSchema.safeParse(mutation.payload);
      if (!parsed.success) { conflicts.push({ clientMutationId: mutation.clientMutationId, entityType: mutation.entityType, entityId: mutation.entityId, reason: "The visit payload is invalid.", serverRecord: null }); return; }
      const current = (await tx.select().from(fieldVisits).where(and(eq(fieldVisits.id, mutation.entityId), eq(fieldVisits.ownerOpenId, ownerOpenId))).limit(1))[0];
      if (current && current.version !== mutation.baseVersion) { conflicts.push({ clientMutationId: mutation.clientMutationId, entityType: mutation.entityType, entityId: mutation.entityId, reason: "The server visit was updated while a local change was queued.", serverRecord: current }); return; }
      if (!current && mutation.operation !== "create") { conflicts.push({ clientMutationId: mutation.clientMutationId, entityType: mutation.entityType, entityId: mutation.entityId, reason: "The server does not have this visit yet.", serverRecord: null }); return; }
      const nextVersion = (current?.version ?? 0) + 1;
      const record = { ownerOpenId, workOrderId: parsed.data.workOrderId, startedAt: parsed.data.startedAt ? new Date(parsed.data.startedAt) : null, completedAt: parsed.data.completedAt ? new Date(parsed.data.completedAt) : null, notes: parsed.data.notes, checklist: parsed.data.checklist, version: nextVersion, updatedAt: new Date() };
      if (current) await tx.update(fieldVisits).set(record).where(eq(fieldVisits.id, mutation.entityId)); else await tx.insert(fieldVisits).values({ id: mutation.entityId, ...record });
      await tx.insert(syncMutationLedger).values({ clientMutationId: mutation.clientMutationId, ownerOpenId, entityType: mutation.entityType, entityId: mutation.entityId, operation: mutation.operation, appliedVersion: nextVersion }); applied.push({ clientMutationId: mutation.clientMutationId, entityType: mutation.entityType, entityId: mutation.entityId, version: nextVersion });
    });
  }
  return { applied, conflicts };
}

export async function getFieldServiceSnapshot(ownerOpenId: string, cursor?: Date) {
  const db = await getDb(); if (!db) throw new Error("Database is not available for synchronization");
  const condition = cursor ? and(eq(fieldWorkOrders.ownerOpenId, ownerOpenId), gt(fieldWorkOrders.updatedAt, cursor)) : eq(fieldWorkOrders.ownerOpenId, ownerOpenId);
  const visitCondition = cursor ? and(eq(fieldVisits.ownerOpenId, ownerOpenId), gt(fieldVisits.updatedAt, cursor)) : eq(fieldVisits.ownerOpenId, ownerOpenId);
  const [workOrders, visits] = await Promise.all([db.select().from(fieldWorkOrders).where(condition), db.select().from(fieldVisits).where(visitCondition)]);
  return { workOrders, visits, cursor: new Date() };
}
