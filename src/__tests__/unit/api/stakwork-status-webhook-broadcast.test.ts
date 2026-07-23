/**
 * Tests for the LEGAL_BENCHMARK_RUNNER broadcast-suppression guard in
 * POST /api/stakwork/webhook (the lightweight status hook).
 *
 * After the top-level webhook_url fix, the status hook now receives Stakwork
 * lifecycle callbacks for LEGAL_BENCHMARK_RUNNER runs. The existing
 * skipBroadcast guard (originally for DIAGRAM_GENERATION only) was extended to
 * also suppress the COMPLETED broadcast for LEGAL_BENCHMARK_RUNNER, so the UI
 * is only notified after the result is merged by the response-path webhook.
 *
 * These tests verify:
 *  - COMPLETED status for LEGAL_BENCHMARK_RUNNER does NOT trigger pusher STAKWORK_RUN_UPDATE
 *  - IN_PROGRESS status for LEGAL_BENCHMARK_RUNNER DOES trigger pusher STAKWORK_RUN_UPDATE
 *  - COMPLETED status for an unrelated run type (TASK_GENERATION) DOES trigger broadcast
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Stable mock references (hoisted) ────────────────────────────────────────

const mockDbStakworkRunFindFirst = vi.hoisted(() => vi.fn());
const mockDbStakworkRunUpdate = vi.hoisted(() => vi.fn());
const mockPusherTrigger = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    stakworkRun: {
      findFirst: mockDbStakworkRunFindFirst,
      update: mockDbStakworkRunUpdate,
    },
    task: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    feature: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: mockPusherTrigger },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getTaskChannelName: (id: string) => `task-${id}`,
  getFeatureChannelName: (id: string) => `feature-${id}`,
  PUSHER_EVENTS: {
    STAKWORK_RUN_UPDATE: "stakwork-run-update",
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
  },
}));

// These are used by the status webhook route internally
vi.mock("@/services/roadmap/feature-status-sync", () => ({
  updateFeatureStatusFromTasks: vi.fn(),
}));
vi.mock("@/lib/canvas", () => ({
  notifyFeatureCanvasRefresh: vi.fn(),
}));
vi.mock("@/services/canvas-planner-fanout", () => ({
  syncPlannerWorkflowStatusToCanvas: vi.fn(),
}));
vi.mock("@/services/notifications", () => ({
  createAndSendNotification: vi.fn(),
}));
vi.mock("@/services/workflow-editor-retry", () => ({
  retryWorkflowEditorTask: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/pods/utils", () => ({
  releaseTaskPod: vi.fn(),
}));

// ─── Import subject under test ────────────────────────────────────────────────

import { POST as postStatusWebhook } from "@/app/api/stakwork/webhook/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStatusRequest(runId: string, projectStatus: string) {
  return new NextRequest(
    `http://localhost/api/stakwork/webhook?run_id=${runId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_status: projectStatus }),
    },
  );
}

function makeRunRow(type: string, resultStatus = "IN_PROGRESS") {
  return {
    id: "run-1",
    type,
    status: resultStatus,
    featureId: null,
    workspaceId: "ws-1",
    workspace: { slug: "openlaw" },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/stakwork/webhook — LEGAL_BENCHMARK_RUNNER broadcast suppression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPusherTrigger.mockResolvedValue({});
  });

  test("COMPLETED status for LEGAL_BENCHMARK_RUNNER does NOT trigger STAKWORK_RUN_UPDATE broadcast", async () => {
    mockDbStakworkRunFindFirst.mockResolvedValue(
      makeRunRow("LEGAL_BENCHMARK_RUNNER", "IN_PROGRESS"),
    );
    mockDbStakworkRunUpdate.mockResolvedValue(
      makeRunRow("LEGAL_BENCHMARK_RUNNER", "COMPLETED"),
    );

    const res = await postStatusWebhook(makeStatusRequest("run-1", "completed"));
    expect(res.status).toBe(200);

    // Pusher must NOT have been called with STAKWORK_RUN_UPDATE
    const runUpdateCalls = mockPusherTrigger.mock.calls.filter(
      (call: unknown[]) => call[1] === "stakwork-run-update",
    );
    expect(runUpdateCalls).toHaveLength(0);
  });

  test("IN_PROGRESS status for LEGAL_BENCHMARK_RUNNER STILL triggers STAKWORK_RUN_UPDATE broadcast", async () => {
    mockDbStakworkRunFindFirst.mockResolvedValue(
      makeRunRow("LEGAL_BENCHMARK_RUNNER", "PENDING"),
    );
    mockDbStakworkRunUpdate.mockResolvedValue(
      makeRunRow("LEGAL_BENCHMARK_RUNNER", "IN_PROGRESS"),
    );

    const res = await postStatusWebhook(makeStatusRequest("run-1", "in_progress"));
    expect(res.status).toBe(200);

    // Pusher MUST have been called with STAKWORK_RUN_UPDATE for non-terminal status
    const runUpdateCalls = mockPusherTrigger.mock.calls.filter(
      (call: unknown[]) => call[1] === "stakwork-run-update",
    );
    expect(runUpdateCalls).toHaveLength(1);
    expect(runUpdateCalls[0][2]).toMatchObject({
      runId: "run-1",
      type: "LEGAL_BENCHMARK_RUNNER",
      status: "IN_PROGRESS",
    });
  });

  test("COMPLETED status for TASK_GENERATION (unrelated type) DOES trigger STAKWORK_RUN_UPDATE broadcast", async () => {
    // Confirm the guard only fires for DIAGRAM_GENERATION and LEGAL_BENCHMARK_RUNNER
    mockDbStakworkRunFindFirst.mockResolvedValue(
      makeRunRow("TASK_GENERATION", "IN_PROGRESS"),
    );
    mockDbStakworkRunUpdate.mockResolvedValue(
      makeRunRow("TASK_GENERATION", "COMPLETED"),
    );

    const res = await postStatusWebhook(makeStatusRequest("run-1", "completed"));
    expect(res.status).toBe(200);

    const runUpdateCalls = mockPusherTrigger.mock.calls.filter(
      (call: unknown[]) => call[1] === "stakwork-run-update",
    );
    expect(runUpdateCalls).toHaveLength(1);
    expect(runUpdateCalls[0][2]).toMatchObject({
      runId: "run-1",
      type: "TASK_GENERATION",
      status: "COMPLETED",
    });
  });
});
