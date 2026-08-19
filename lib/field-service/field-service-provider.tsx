import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuth } from "@/hooks/use-auth";
import { createTRPCClient } from "@/lib/trpc";
import { createLocalId, currentTimestamp, enqueueMutation, getMutations, getSyncSummary, getVisits, getWorkOrders, initializeFieldServiceDatabase, removeMutation, writeVisit, writeWorkOrder } from "./database";
import { EMPTY_CHECKLIST, type ChecklistValues, type SyncMutation, type SyncSummary, type Visit, type WorkOrder } from "./types";

type VisitDraft = { notes: string; checklist: ChecklistValues };
type FieldServiceContextValue = {
  ready: boolean; workOrders: WorkOrder[]; visits: Visit[]; mutations: SyncMutation[]; syncSummary: SyncSummary; lastRefreshAt: string | null; syncing: boolean; syncError: string | null;
  refresh: () => Promise<void>; getVisitForOrder: (workOrderId: string) => Visit | undefined; startVisit: (workOrderId: string) => Promise<void>;
  saveVisit: (workOrderId: string, draft: VisitDraft) => Promise<void>; completeVisit: (workOrderId: string, draft: VisitDraft) => Promise<void>;
  setWorkOrderConflict: (workOrderId: string) => Promise<void>; resolveConflict: (workOrderId: string, keepLocal: boolean) => Promise<void>; syncNow: () => Promise<void>;
};
const FieldServiceContext = createContext<FieldServiceContextValue | undefined>(undefined);

function makeMutation(entityType: SyncMutation["entityType"], entityId: string, operation: SyncMutation["operation"], payload: Record<string, unknown>, baseVersion: number): SyncMutation {
  return { clientMutationId: createLocalId("mutation"), entityType, entityId, operation, payload, baseVersion, createdAt: currentTimestamp(), retryCount: 0, status: "queued", errorMessage: null };
}

export function FieldServiceProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth(); const api = useMemo(() => createTRPCClient(), []);
  const [ready, setReady] = useState(false); const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]); const [visits, setVisits] = useState<Visit[]>([]); const [mutations, setMutations] = useState<SyncMutation[]>([]); const [syncSummary, setSyncSummary] = useState<SyncSummary>({ pending: 0, conflicts: 0, failed: 0 }); const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null); const [syncing, setSyncing] = useState(false); const [syncError, setSyncError] = useState<string | null>(null);
  const refresh = useCallback(async () => { const [nextOrders, nextVisits, nextMutations, nextSummary] = await Promise.all([getWorkOrders(), getVisits(), getMutations(), getSyncSummary()]); setWorkOrders(nextOrders); setVisits(nextVisits); setMutations(nextMutations); setSyncSummary(nextSummary); setLastRefreshAt(currentTimestamp()); }, []);
  useEffect(() => { let mounted = true; initializeFieldServiceDatabase().then(async () => { if (!mounted) return; await refresh(); if (mounted) setReady(true); }).catch((error) => { console.warn("[FieldService] Local database failed to initialize", error); if (mounted) setReady(true); }); return () => { mounted = false; }; }, [refresh]);
  const getVisitForOrder = useCallback((workOrderId: string) => visits.find((visit) => visit.workOrderId === workOrderId), [visits]);
  const updateOrder = useCallback(async (current: WorkOrder, patch: Partial<WorkOrder>, operation: SyncMutation["operation"] = "update") => { const updated: WorkOrder = { ...current, ...patch, version: current.version + 1, updatedAt: currentTimestamp(), updatedBy: "current-technician", syncState: "pending" }; await writeWorkOrder(updated); await enqueueMutation(makeMutation("work_order", updated.id, operation, updated, current.version)); return updated; }, []);
  const startVisit = useCallback(async (workOrderId: string) => { const workOrder = workOrders.find((item) => item.id === workOrderId); if (!workOrder) return; const existingVisit = visits.find((item) => item.workOrderId === workOrderId); if (!existingVisit) { const visit: Visit = { id: createLocalId("visit"), workOrderId, startedAt: currentTimestamp(), completedAt: null, notes: "", checklist: EMPTY_CHECKLIST, version: 1, updatedAt: currentTimestamp(), syncState: "pending" }; await writeVisit(visit); await enqueueMutation(makeMutation("visit", visit.id, "create", visit, 0)); } if (workOrder.status !== "in_progress") await updateOrder(workOrder, { status: "in_progress" }); await refresh(); }, [refresh, updateOrder, visits, workOrders]);
  const saveVisit = useCallback(async (workOrderId: string, draft: VisitDraft) => { const current = visits.find((item) => item.workOrderId === workOrderId); const visit: Visit = { id: current?.id ?? createLocalId("visit"), workOrderId, startedAt: current?.startedAt ?? currentTimestamp(), completedAt: current?.completedAt ?? null, notes: draft.notes.trim(), checklist: draft.checklist, version: (current?.version ?? 0) + 1, updatedAt: currentTimestamp(), syncState: "pending" }; await writeVisit(visit); await enqueueMutation(makeMutation("visit", visit.id, current ? "update" : "create", visit, current?.version ?? 0)); await refresh(); }, [refresh, visits]);
  const completeVisit = useCallback(async (workOrderId: string, draft: VisitDraft) => { const current = visits.find((item) => item.workOrderId === workOrderId); const visit: Visit = { id: current?.id ?? createLocalId("visit"), workOrderId, startedAt: current?.startedAt ?? currentTimestamp(), completedAt: currentTimestamp(), notes: draft.notes.trim(), checklist: { ...draft.checklist, serviceComplete: true }, version: (current?.version ?? 0) + 1, updatedAt: currentTimestamp(), syncState: "pending" }; await writeVisit(visit); await enqueueMutation(makeMutation("visit", visit.id, current ? "update" : "create", visit, current?.version ?? 0)); const workOrder = workOrders.find((item) => item.id === workOrderId); if (workOrder) await updateOrder(workOrder, { status: "completed" }); await refresh(); }, [refresh, updateOrder, visits, workOrders]);
  const setWorkOrderConflict = useCallback(async (workOrderId: string) => { const workOrder = workOrders.find((item) => item.id === workOrderId); if (!workOrder) return; const conflicted: WorkOrder = { ...workOrder, status: "needs_review", syncState: "conflict", updatedAt: currentTimestamp() }; await writeWorkOrder(conflicted); await enqueueMutation({ ...makeMutation("work_order", workOrder.id, "update", conflicted, workOrder.version), status: "conflict", errorMessage: "A dispatcher update was received while a local update was pending." }); await refresh(); }, [refresh, workOrders]);
  const resolveConflict = useCallback(async (workOrderId: string, keepLocal: boolean) => { const workOrder = workOrders.find((item) => item.id === workOrderId); if (!workOrder) return; const updated: WorkOrder = { ...workOrder, status: keepLocal ? "in_progress" : "scheduled", description: keepLocal ? workOrder.description : `${workOrder.description} (dispatcher update accepted)`, syncState: "pending", version: workOrder.version + 1, updatedAt: currentTimestamp(), updatedBy: "current-technician" }; await writeWorkOrder(updated); await enqueueMutation(makeMutation("work_order", updated.id, "resolve_conflict", { ...updated, resolution: keepLocal ? "keep_local" : "accept_server" }, workOrder.version)); await refresh(); }, [refresh, workOrders]);
  const syncNow = useCallback(async () => {
    if (!isAuthenticated) { const message = "Sign in to synchronize this device with your workspace."; setSyncError(message); throw new Error(message); }
    setSyncing(true); setSyncError(null);
    try {
      const queued = mutations.filter((item) => item.status === "queued" || item.status === "failed");
      if (queued.length > 0) {
        const result = await api.fieldService.push.mutate({ mutations: queued.map(({ clientMutationId, entityType, entityId, operation, payload, baseVersion, createdAt }) => ({ clientMutationId, entityType, entityId, operation, payload, baseVersion, createdAt })) });
        for (const item of result.applied) await removeMutation(item.clientMutationId);
        for (const conflict of result.conflicts) {
          const workOrder = workOrders.find((item) => item.id === conflict.entityId);
          if (conflict.entityType === "work_order" && workOrder) await writeWorkOrder({ ...workOrder, status: "needs_review", syncState: "conflict", updatedAt: currentTimestamp() });
          const visit = visits.find((item) => item.id === conflict.entityId);
          if (conflict.entityType === "visit" && visit) await writeVisit({ ...visit, syncState: "conflict", updatedAt: currentTimestamp() });
        }
      }
      const snapshot = await api.fieldService.pull.query();
      for (const remote of snapshot.workOrders) {
        const local = workOrders.find((item) => item.id === remote.id);
        if (!local || local.syncState === "synced" || remote.version >= local.version) await writeWorkOrder({ ...remote, scheduledStart: remote.scheduledStart.toISOString(), updatedAt: remote.updatedAt.toISOString(), syncState: "synced" });
      }
      for (const remote of snapshot.visits) {
        const local = visits.find((item) => item.id === remote.id);
        if (!local || local.syncState === "synced" || remote.version >= local.version) await writeVisit({ ...remote, startedAt: remote.startedAt?.toISOString() ?? null, completedAt: remote.completedAt?.toISOString() ?? null, updatedAt: remote.updatedAt.toISOString(), syncState: "synced" });
      }
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Synchronization could not finish. Your local changes remain safe on this device.";
      setSyncError(message); throw error;
    } finally { setSyncing(false); }
  }, [api, isAuthenticated, mutations, refresh, visits, workOrders]);
  const value = useMemo<FieldServiceContextValue>(() => ({ ready, workOrders, visits, mutations, syncSummary, lastRefreshAt, syncing, syncError, refresh, getVisitForOrder, startVisit, saveVisit, completeVisit, setWorkOrderConflict, resolveConflict, syncNow }), [completeVisit, getVisitForOrder, lastRefreshAt, mutations, ready, refresh, resolveConflict, saveVisit, setWorkOrderConflict, startVisit, syncError, syncNow, syncSummary, syncing, visits, workOrders]);
  return <FieldServiceContext.Provider value={value}>{children}</FieldServiceContext.Provider>;
}

export function useFieldService() { const context = useContext(FieldServiceContext); if (!context) throw new Error("useFieldService must be used within FieldServiceProvider"); return context; }
