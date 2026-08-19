export type WorkOrderStatus = "scheduled" | "in_progress" | "completed" | "needs_review";
export type WorkOrderPriority = "low" | "standard" | "urgent";
export type SyncState = "synced" | "pending" | "conflict" | "failed";
export type MutationOperation = "create" | "update" | "resolve_conflict";

export type WorkOrder = {
  id: string;
  customerName: string;
  serviceSite: string;
  address: string;
  scheduledStart: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  description: string;
  equipment: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
  syncState: SyncState;
};

export type ChecklistValues = {
  siteAccess: boolean;
  safetyCheck: boolean;
  serviceComplete: boolean;
};

export type Visit = {
  id: string;
  workOrderId: string;
  startedAt: string | null;
  completedAt: string | null;
  notes: string;
  checklist: ChecklistValues;
  version: number;
  updatedAt: string;
  syncState: SyncState;
};

export type SyncMutation = {
  clientMutationId: string;
  entityType: "work_order" | "visit";
  entityId: string;
  operation: MutationOperation;
  payload: Record<string, unknown>;
  baseVersion: number;
  createdAt: string;
  retryCount: number;
  status: "queued" | "processing" | "failed" | "conflict";
  errorMessage: string | null;
};

export type SyncSummary = { pending: number; conflicts: number; failed: number };

export const EMPTY_CHECKLIST: ChecklistValues = { siteAccess: false, safetyCheck: false, serviceComplete: false };
