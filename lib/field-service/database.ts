import * as SQLite from "expo-sqlite";

import type { SyncMutation, SyncSummary, Visit, WorkOrder } from "./types";
import { EMPTY_CHECKLIST } from "./types";

let databasePromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;

function getDatabase() {
  if (!databasePromise) databasePromise = SQLite.openDatabaseAsync("offline-field-service.db");
  return databasePromise;
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function now() { return new Date().toISOString(); }

function timeToday(hour: number, minute: number) {
  const value = new Date();
  value.setHours(hour, minute, 0, 0);
  return value.toISOString();
}

type WorkOrderRow = Omit<WorkOrder, "version"> & { version: number | string };
type VisitRow = Omit<Visit, "version" | "checklist"> & { version: number | string; checklistJson: string };
type MutationRow = Omit<SyncMutation, "payload" | "baseVersion" | "retryCount"> & { payloadJson: string; baseVersion: number | string; retryCount: number | string };

function toWorkOrder(row: WorkOrderRow): WorkOrder { return { ...row, version: Number(row.version) }; }

function toVisit(row: VisitRow): Visit {
  let checklist = EMPTY_CHECKLIST;
  try { checklist = { ...EMPTY_CHECKLIST, ...(JSON.parse(row.checklistJson) as Partial<typeof EMPTY_CHECKLIST>) }; } catch { checklist = EMPTY_CHECKLIST; }
  return { id: row.id, workOrderId: row.workOrderId, startedAt: row.startedAt, completedAt: row.completedAt, notes: row.notes, checklist, version: Number(row.version), updatedAt: row.updatedAt, syncState: row.syncState };
}

function toMutation(row: MutationRow): SyncMutation {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(row.payloadJson) as Record<string, unknown>; } catch { payload = {}; }
  return { clientMutationId: row.clientMutationId, entityType: row.entityType, entityId: row.entityId, operation: row.operation, payload, baseVersion: Number(row.baseVersion), createdAt: row.createdAt, retryCount: Number(row.retryCount), status: row.status, errorMessage: row.errorMessage };
}

export async function initializeFieldServiceDatabase() {
  const db = await getDatabase();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY NOT NULL, customerName TEXT NOT NULL, serviceSite TEXT NOT NULL, address TEXT NOT NULL,
      scheduledStart TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL, description TEXT NOT NULL,
      equipment TEXT NOT NULL, version INTEGER NOT NULL, updatedAt TEXT NOT NULL, updatedBy TEXT NOT NULL, syncState TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visits (
      id TEXT PRIMARY KEY NOT NULL, workOrderId TEXT NOT NULL UNIQUE, startedAt TEXT, completedAt TEXT,
      notes TEXT NOT NULL, checklistJson TEXT NOT NULL, version INTEGER NOT NULL, updatedAt TEXT NOT NULL, syncState TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_mutations (
      clientMutationId TEXT PRIMARY KEY NOT NULL, entityType TEXT NOT NULL, entityId TEXT NOT NULL, operation TEXT NOT NULL,
      payloadJson TEXT NOT NULL, baseVersion INTEGER NOT NULL, createdAt TEXT NOT NULL, retryCount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL, errorMessage TEXT
    );
  `);
  const count = await db.getFirstAsync<{ total: number }>("SELECT COUNT(*) AS total FROM work_orders");
  if ((count?.total ?? 0) > 0) return;
  const createdAt = now();
  const seedOrders: WorkOrder[] = [
    { id: "wo-harbor-001", customerName: "Harbor View Medical", serviceSite: "Outpatient Center", address: "1420 Bayline Ave, Suite 200", scheduledStart: timeToday(9, 30), priority: "urgent", status: "scheduled", description: "Inspect HVAC condensate drain and confirm treatment room airflow.", equipment: "RTU-2 · MERV 13 filtration", version: 3, updatedAt: createdAt, updatedBy: "dispatcher@northstar.example", syncState: "synced" },
    { id: "wo-civic-002", customerName: "Civic Square Offices", serviceSite: "Tower B", address: "88 Market Street, Floor 12", scheduledStart: timeToday(11, 15), priority: "standard", status: "scheduled", description: "Quarterly fire-door inspection with electronic closer adjustment.", equipment: "Door set B-12 · Floor 12", version: 1, updatedAt: createdAt, updatedBy: "dispatcher@northstar.example", syncState: "synced" },
    { id: "wo-cedar-003", customerName: "Cedar & Stone Bakery", serviceSite: "Production Kitchen", address: "317 Cedar Lane", scheduledStart: timeToday(14, 0), priority: "standard", status: "in_progress", description: "Diagnose intermittent dishwasher drainage alarm and verify sanitation cycle.", equipment: "WashPro DW-450", version: 4, updatedAt: createdAt, updatedBy: "technician@northstar.example", syncState: "pending" },
  ];
  await db.withTransactionAsync(async () => {
    for (const item of seedOrders) await writeWorkOrder(item);
    const activeVisit: Visit = { id: "visit-cedar-003", workOrderId: "wo-cedar-003", startedAt: timeToday(13, 38), completedAt: null, notes: "Customer reported an alarm after the afternoon cleaning cycle.", checklist: { siteAccess: true, safetyCheck: true, serviceComplete: false }, version: 1, updatedAt: createdAt, syncState: "pending" };
    await writeVisit(activeVisit);
    await enqueueMutation({ clientMutationId: "mutation-cedar-003", entityType: "visit", entityId: activeVisit.id, operation: "update", payload: activeVisit, baseVersion: 0, createdAt, retryCount: 0, status: "queued", errorMessage: null });
  });
}

export async function getWorkOrders() { const db = await getDatabase(); const rows = await db.getAllAsync<WorkOrderRow>("SELECT * FROM work_orders ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'needs_review' THEN 2 ELSE 3 END, scheduledStart ASC"); return rows.map(toWorkOrder); }
export async function getVisits() { const db = await getDatabase(); const rows = await db.getAllAsync<VisitRow>("SELECT * FROM visits ORDER BY updatedAt DESC"); return rows.map(toVisit); }
export async function getMutations() { const db = await getDatabase(); const rows = await db.getAllAsync<MutationRow>("SELECT * FROM sync_mutations ORDER BY createdAt ASC"); return rows.map(toMutation); }

export async function getSyncSummary(): Promise<SyncSummary> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ status: string; total: number }>("SELECT status, COUNT(*) AS total FROM sync_mutations GROUP BY status");
  return rows.reduce<SyncSummary>((summary, row) => { if (row.status === "queued" || row.status === "processing") summary.pending += Number(row.total); if (row.status === "conflict") summary.conflicts += Number(row.total); if (row.status === "failed") summary.failed += Number(row.total); return summary; }, { pending: 0, conflicts: 0, failed: 0 });
}

export async function writeWorkOrder(item: WorkOrder) { const db = await getDatabase(); await db.runAsync("INSERT OR REPLACE INTO work_orders (id, customerName, serviceSite, address, scheduledStart, priority, status, description, equipment, version, updatedAt, updatedBy, syncState) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", item.id, item.customerName, item.serviceSite, item.address, item.scheduledStart, item.priority, item.status, item.description, item.equipment, item.version, item.updatedAt, item.updatedBy, item.syncState); }
export async function writeVisit(item: Visit) { const db = await getDatabase(); await db.runAsync("INSERT OR REPLACE INTO visits (id, workOrderId, startedAt, completedAt, notes, checklistJson, version, updatedAt, syncState) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", item.id, item.workOrderId, item.startedAt, item.completedAt, item.notes, JSON.stringify(item.checklist), item.version, item.updatedAt, item.syncState); }
export async function enqueueMutation(mutation: SyncMutation) { const db = await getDatabase(); await db.runAsync("INSERT OR REPLACE INTO sync_mutations (clientMutationId, entityType, entityId, operation, payloadJson, baseVersion, createdAt, retryCount, status, errorMessage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", mutation.clientMutationId, mutation.entityType, mutation.entityId, mutation.operation, JSON.stringify(mutation.payload), mutation.baseVersion, mutation.createdAt, mutation.retryCount, mutation.status, mutation.errorMessage); }
export async function removeMutation(clientMutationId: string) { const db = await getDatabase(); await db.runAsync("DELETE FROM sync_mutations WHERE clientMutationId = ?", clientMutationId); }
export async function markMutationStatus(clientMutationId: string, status: SyncMutation["status"], errorMessage: string | null = null) { const db = await getDatabase(); await db.runAsync("UPDATE sync_mutations SET status = ?, errorMessage = ?, retryCount = retryCount + 1 WHERE clientMutationId = ?", status, errorMessage, clientMutationId); }
export function createLocalId(prefix: string) { return createId(prefix); }
export function currentTimestamp() { return now(); }
