import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyFieldServiceMutations: vi.fn(),
  getFieldServiceSnapshot: vi.fn(),
}));

vi.mock("../server/db", () => ({
  applyFieldServiceMutations: mocks.applyFieldServiceMutations,
  getFieldServiceSnapshot: mocks.getFieldServiceSnapshot,
}));

import { appRouter } from "../server/routers";

const technicianContext = {
  user: {
    id: 42,
    openId: "tech-42",
    name: "Avery Patel",
    email: "avery@example.test",
    loginMethod: "oauth",
    role: "user" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
  req: {} as never,
  res: { clearCookie: vi.fn() } as never,
};

const workOrderMutation = {
  clientMutationId: "mutation-field-0001",
  entityType: "work_order" as const,
  entityId: "wo-field-001",
  operation: "update" as const,
  baseVersion: 3,
  createdAt: "2026-08-19T05:00:00.000Z",
  payload: {
    customerName: "Harbor View Medical",
    serviceSite: "Outpatient Center",
    address: "1420 Bayline Ave",
    scheduledStart: "2026-08-19T09:30:00.000Z",
    priority: "urgent",
    status: "in_progress",
    description: "Inspect HVAC condensate drain.",
    equipment: "RTU-2",
  },
};

describe("field-service synchronization router", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scopes queued field mutations to the authenticated technician", async () => {
    mocks.applyFieldServiceMutations.mockResolvedValue({
      applied: [{ clientMutationId: workOrderMutation.clientMutationId, entityType: "work_order", entityId: "wo-field-001", version: 4 }],
      conflicts: [],
    });
    const caller = appRouter.createCaller(technicianContext);

    const result = await caller.fieldService.push({ mutations: [workOrderMutation] });

    expect(mocks.applyFieldServiceMutations).toHaveBeenCalledWith("tech-42", [workOrderMutation]);
    expect(result.applied).toHaveLength(1);
    expect(result.conflicts).toEqual([]);
  });

  it("returns a conflict response instead of silently discarding a version mismatch", async () => {
    mocks.applyFieldServiceMutations.mockResolvedValue({
      applied: [],
      conflicts: [{
        clientMutationId: workOrderMutation.clientMutationId,
        entityType: "work_order",
        entityId: "wo-field-001",
        reason: "The server record changed after this field edit started.",
        serverRecord: { id: "wo-field-001", version: 5, status: "scheduled" },
      }],
    });
    const caller = appRouter.createCaller(technicianContext);

    const result = await caller.fieldService.push({ mutations: [workOrderMutation] });

    expect(result.applied).toEqual([]);
    expect(result.conflicts[0]?.serverRecord).toMatchObject({ version: 5, status: "scheduled" });
  });

  it("rejects malformed mutation requests before they reach the data layer", async () => {
    const caller = appRouter.createCaller(technicianContext);

    await expect(caller.fieldService.push({ mutations: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.applyFieldServiceMutations).not.toHaveBeenCalled();
  });
});
