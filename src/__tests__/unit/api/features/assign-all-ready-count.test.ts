/**
 * Unit tests for GET /api/features/[featureId]/tasks/assign-all
 * (the "N tasks ready" count powering the canvas-chat StartTasksSlot).
 */
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

// ── Mocks (keep middleware/utils real; it reads request headers) ────

vi.mock("@/lib/db", () => ({
  db: {
    phase: { findFirst: vi.fn() },
    task: { count: vi.fn() },
  },
}));

vi.mock("@/services/roadmap/utils", () => ({
  validateFeatureAccess: vi.fn(),
}));

// Heavy transitive imports the route pulls in for its POST path —
// stub them so importing the module is side-effect free.
vi.mock("@/services/roadmap/feature-status-sync", () => ({
  updateFeatureStatusFromTasks: vi.fn(),
}));
vi.mock("@/lib/canvas", () => ({ notifyFeatureCanvasRefresh: vi.fn() }));
vi.mock("@/lib/pods/status-queries", () => ({ getPoolStatusFromPods: vi.fn() }));
vi.mock("@/services/task-coordinator-cron", () => ({
  processTicketSweep: vi.fn(),
  processWorkflowTaskSweep: vi.fn(),
}));

const { db } = await import("@/lib/db");
const { validateFeatureAccess } = await import("@/services/roadmap/utils");
const { GET } = await import(
  "@/app/api/features/[featureId]/tasks/assign-all/route"
);

const mockPhaseFind = db.phase.findFirst as Mock;
const mockTaskCount = db.task.count as Mock;
const mockValidate = validateFeatureAccess as Mock;

function makeRequest(authed = true): NextRequest {
  return new NextRequest(
    "http://localhost/api/features/feat-1/tasks/assign-all",
    {
      method: "GET",
      headers: authed
        ? {
            [MIDDLEWARE_HEADERS.USER_ID]: "user-1",
            [MIDDLEWARE_HEADERS.USER_EMAIL]: "t@e.com",
            [MIDDLEWARE_HEADERS.USER_NAME]: "T",
            [MIDDLEWARE_HEADERS.AUTH_STATUS]: "authenticated",
          }
        : {},
    },
  );
}

const params = { params: Promise.resolve({ featureId: "feat-1" }) };

describe("GET /api/features/[featureId]/tasks/assign-all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidate.mockResolvedValue(undefined);
    mockPhaseFind.mockResolvedValue({ id: "phase-1" });
    mockTaskCount.mockResolvedValue(3);
  });

  it("401 when unauthenticated", async () => {
    const res = await GET(makeRequest(false), params);
    expect(res.status).toBe(401);
  });

  it("returns the ready-task count for the first phase", async () => {
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ readyCount: 3 });
    // The count must mirror the POST's assignment scope exactly.
    expect(mockTaskCount).toHaveBeenCalledWith({
      where: {
        phaseId: "phase-1",
        assigneeId: null,
        systemAssigneeType: null,
        deleted: false,
        status: "TODO",
      },
    });
  });

  it("returns 0 when the feature has no phases", async () => {
    mockPhaseFind.mockResolvedValue(null);
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ readyCount: 0 });
    expect(mockTaskCount).not.toHaveBeenCalled();
  });

  it("maps 'Access denied' to 403", async () => {
    mockValidate.mockRejectedValue(new Error("Access denied"));
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(403);
  });
});
