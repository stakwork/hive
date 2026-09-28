/**
 * Unit tests for the OPENHEALTH_BENCHMARK_RUNNER branch of
 * processStakworkRunWebhook — the thin webhook leg (NOT the poll/settle
 * path, which lives in pollOpenHealthBenchmarkRuns and is tested
 * separately).
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { processStakworkRunWebhook } from "@/services/stakwork-run";
import { db } from "@/lib/db";
import { WorkflowStatus, StakworkRunType } from "@prisma/client";

vi.mock("@/lib/db");
vi.mock("@/lib/service-factory");
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue({}) },
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  getFeatureChannelName: vi.fn((id: string) => `feature-${id}`),
  getWhiteboardChannelName: vi.fn((id: string) => `whiteboard-${id}`),
  PUSHER_EVENTS: {
    STAKWORK_RUN_UPDATE: "stakwork-run-update",
    STAKWORK_RUN_DECISION: "stakwork-run-decision",
    WHITEBOARD_CHAT_MESSAGE: "whiteboard-chat-message",
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
  },
}));
vi.mock("@/services/excalidraw-layout", () => ({
  relayoutDiagram: vi.fn(),
  sanitiseDiagram: vi.fn((d: unknown) => d),
  computeUserElementsBoundingBox: vi.fn(),
  computePlacementOffset: vi.fn(),
  offsetExcalidrawElements: vi.fn((e: unknown[]) => e),
}));
vi.mock("@/lib/ai/utils", () => ({ buildFeatureContext: vi.fn() }));
vi.mock("@/lib/encryption", () => ({
  EncryptionService: { getInstance: vi.fn(() => ({ decryptField: vi.fn() })) },
}));
vi.mock("@/lib/sphinx/daily-pr-summary", () => ({ sendToSphinx: vi.fn() }));
vi.mock("@/lib/runtime", () => ({ isDevelopmentMode: vi.fn().mockReturnValue(false) }));
vi.mock("@/services/workflow-editor", () => ({
  saveWorkflowArtifact: vi.fn(),
  triggerWorkflowEditorRun: vi.fn(),
}));
vi.mock("@/services/canvas-planner-fanout", () => ({
  syncPlannerWorkflowStatusToCanvas: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_AI_GENERATION_WORKFLOW_ID: "123",
    STAKWORK_DIAGRAM_WORKFLOW_ID: "777",
    STAKWORK_API_KEY: "test-key",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    POOL_MANAGER_API_KEY: "test-pool-key",
    POOL_MANAGER_BASE_URL: "https://workspaces.sphinx.chat/api",
  },
  optionalEnvVars: {
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    POOL_MANAGER_BASE_URL: "https://workspaces.sphinx.chat/api",
    API_TIMEOUT: 10000,
  },
  isBifrostEnabledForWorkspace: vi.fn().mockReturnValue(false),
  isBifrostEnabledForAgent: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/openhealth-benchmarks/poll", () => ({
  pollOpenHealthBenchmarkRuns: vi.fn().mockResolvedValue(undefined),
}));

const mockedDb = vi.mocked(db);

const SECRET = "a".repeat(32);
const RUN_ID = "run-oh-1";
const WORKSPACE_ID = "ws-openhealth";

function tokenFor(runId: string): string {
  return createHmac("sha256", SECRET).update(runId).digest("hex");
}

describe("processStakworkRunWebhook — OPENHEALTH_BENCHMARK_RUNNER thin webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_SECRET = SECRET;
  });

  test("rejects a missing/invalid run_token before any write", async () => {
    mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue({
      id: RUN_ID,
      type: StakworkRunType.OPENHEALTH_BENCHMARK_RUNNER,
      workspaceId: WORKSPACE_ID,
      status: WorkflowStatus.IN_PROGRESS,
      result: JSON.stringify({ runner: "strut", task: "patient_diagnosis", gtId: "gt-1" }),
      workspace: { slug: "hive" },
    });
    mockedDb.stakworkRun.updateMany = vi.fn();

    await expect(
      processStakworkRunWebhook(
        { result: { task: "patient_diagnosis", gtId: "gt-1", weighted_problem_list_f1_neutral: 0.9 } },
        {
          type: "OPENHEALTH_BENCHMARK_RUNNER",
          workspace_id: WORKSPACE_ID,
          run_id: RUN_ID,
          run_token: "bad-token",
        },
      ),
    ).rejects.toThrow("Unauthorized: invalid run token");

    expect(db.stakworkRun.updateMany).not.toHaveBeenCalled();
  });

  test("merges ONLY the thin allowlist and never writes status from project_status", async () => {
    mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue({
      id: RUN_ID,
      type: StakworkRunType.OPENHEALTH_BENCHMARK_RUNNER,
      workspaceId: WORKSPACE_ID,
      status: WorkflowStatus.IN_PROGRESS,
      result: JSON.stringify({ runner: "strut", task: "patient_diagnosis", gtId: "gt-1", split: "public" }),
      workspace: { slug: "hive" },
    });
    mockedDb.stakworkRun.updateMany = vi.fn().mockResolvedValue({ count: 1 });

    const result = await processStakworkRunWebhook(
      {
        // No project_status at all — the generic branch would default this
        // to COMPLETED. The openhealth branch must never do that.
        result: {
          task: "patient_diagnosis",
          gtId: "gt-1",
          weighted_problem_list_f1_neutral: 0.87,
          gradeError: null,
          problemList: ["leak"],
          ground_truth: { secret: true },
          groundTruth: { secret: true },
          gold: "leak",
          matched: ["leak-pair"],
          report_url: "https://s3.example/leak",
        },
      },
      {
        type: "OPENHEALTH_BENCHMARK_RUNNER",
        workspace_id: WORKSPACE_ID,
        run_id: RUN_ID,
        run_token: tokenFor(RUN_ID),
      },
    );

    expect(db.stakworkRun.updateMany).toHaveBeenCalledTimes(1);
    const call = (mockedDb.stakworkRun.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Must scope to still-pending/in-progress rows and NEVER write `status`.
    expect(call.where).toEqual({
      id: RUN_ID,
      status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
    });
    expect(call.data).not.toHaveProperty("status");

    const written = JSON.parse(call.data.result as string);
    expect(written.task).toBe("patient_diagnosis");
    expect(written.gtId).toBe("gt-1");
    expect(written.weighted_problem_list_f1_neutral).toBe(0.87);
    expect(written).not.toHaveProperty("problemList");
    expect(written).not.toHaveProperty("ground_truth");
    expect(written).not.toHaveProperty("groundTruth");
    expect(written).not.toHaveProperty("gold");
    expect(written).not.toHaveProperty("matched");
    expect(written).not.toHaveProperty("report_url");
    // Correlation data preserved from the existing row.
    expect(written.runner).toBe("strut");
    expect(written.split).toBe("public");

    expect(result.runId).toBe(RUN_ID);
  });

  test("rejects when NEXTAUTH_SECRET is missing or too short", async () => {
    process.env.NEXTAUTH_SECRET = "short";
    mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue({
      id: RUN_ID,
      type: StakworkRunType.OPENHEALTH_BENCHMARK_RUNNER,
      workspaceId: WORKSPACE_ID,
      status: WorkflowStatus.IN_PROGRESS,
      result: "{}",
      workspace: { slug: "hive" },
    });

    await expect(
      processStakworkRunWebhook(
        { result: { task: "patient_diagnosis", gtId: "gt-1" } },
        {
          type: "OPENHEALTH_BENCHMARK_RUNNER",
          workspace_id: WORKSPACE_ID,
          run_id: RUN_ID,
          run_token: "whatever",
        },
      ),
    ).rejects.toThrow("Unauthorized: invalid run token");
  });

  test("rejects a workspace mismatch", async () => {
    mockedDb.stakworkRun.findFirst = vi.fn().mockResolvedValue({
      id: RUN_ID,
      type: StakworkRunType.OPENHEALTH_BENCHMARK_RUNNER,
      workspaceId: "some-other-workspace",
      status: WorkflowStatus.IN_PROGRESS,
      result: "{}",
      workspace: { slug: "hive" },
    });

    await expect(
      processStakworkRunWebhook(
        { result: { task: "patient_diagnosis", gtId: "gt-1" } },
        {
          type: "OPENHEALTH_BENCHMARK_RUNNER",
          workspace_id: WORKSPACE_ID,
          run_id: RUN_ID,
          run_token: tokenFor(RUN_ID),
        },
      ),
    ).rejects.toThrow("Unauthorized: workspace mismatch");
  });
});
