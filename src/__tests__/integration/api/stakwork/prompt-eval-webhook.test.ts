/**
 * Integration tests: PROMPT_EVAL branch in processStakworkRunWebhook
 *
 * Verifies that:
 * - The full eval result is stored verbatim in StakworkRun.result
 * - PROMPT_EVAL_RESULT Pusher event is fired with runId, promptVersionId, and result
 * - Auto-accept is skipped for PROMPT_EVAL runs
 * - Fast-track chain is not triggered for PROMPT_EVAL runs
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { processStakworkRunWebhook } from "@/services/stakwork-run";
import { WorkflowStatus } from "@prisma/client";
import { generateUniqueId, generateUniqueSlug } from "@/__tests__/support/helpers";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getWhiteboardChannelName: (id: string) => `whiteboard-${id}`,
  getFeatureChannelName: (id: string) => `feature-${id}`,
  PUSHER_EVENTS: {
    STAKWORK_RUN_UPDATE: "stakwork-run-update",
    STAKWORK_RUN_DECISION: "stakwork-run-decision",
    WHITEBOARD_CHAT_MESSAGE: "whiteboard-chat-message",
    FEATURE_UPDATED: "feature-updated",
    PROMPT_EVAL_RESULT: "prompt-eval-result",
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((_field: string, value: unknown) => String(value)),
    })),
  },
}));

vi.mock("@/lib/vercel/stakwork-token", () => ({
  getStakworkTokenReference: vi.fn(() => "HIVE_STAGING"),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RICH_EVAL_RESULT = {
  pass_rate: 0.8,
  passed: 8,
  failed: 2,
  total: 10,
  trigger_results: [{ score: 1, result: "ok", passed: true }],
};

async function createUser() {
  return db.user.create({
    data: {
      id: generateUniqueId("user"),
      email: `user-${generateUniqueId()}@test.com`,
      name: "Test User",
    },
  });
}

async function createWorkspace(ownerId: string) {
  return db.workspace.create({
    data: {
      name: `Test Workspace ${generateUniqueId()}`,
      slug: generateUniqueSlug("test-ws"),
      ownerId,
    },
  });
}

async function createPromptEvalRun(
  workspaceId: string,
  opts: { promptVersionId?: number; projectId?: number; autoAccept?: boolean } = {}
) {
  const { promptVersionId = 55, projectId = Math.floor(Math.random() * 100000) + 1, autoAccept = false } = opts;
  return db.stakworkRun.create({
    data: {
      type: "PROMPT_EVAL",
      workspaceId,
      promptVersionId,
      evalSetId: "eval-set-test",
      status: WorkflowStatus.IN_PROGRESS,
      projectId,
      autoAccept,
      webhookUrl: `https://example.com/api/webhook/stakwork/response?type=PROMPT_EVAL&workspace_id=${workspaceId}`,
    },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("processStakworkRunWebhook — PROMPT_EVAL branch", () => {
  let user: Awaited<ReturnType<typeof createUser>>;
  let workspace: Awaited<ReturnType<typeof createWorkspace>>;
  let pusherServer: { trigger: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    user = await createUser();
    workspace = await createWorkspace(user.id);
    const pusherModule = await import("@/lib/pusher");
    pusherServer = pusherModule.pusherServer as unknown as { trigger: ReturnType<typeof vi.fn> };
  });

  afterEach(async () => {
    // Clean up in reverse FK order
    await db.stakworkRun.deleteMany({ where: { workspaceId: workspace.id } });
    await db.workspace.deleteMany({ where: { id: workspace.id } });
    await db.user.deleteMany({ where: { id: user.id } });
  });

  it("stores the rich eval result verbatim in StakworkRun.result", async () => {
    const run = await createPromptEvalRun(workspace.id, { promptVersionId: 55 });

    await processStakworkRunWebhook(
      { result: RICH_EVAL_RESULT, project_status: "complete", project_id: run.projectId! },
      { type: "PROMPT_EVAL", workspace_id: workspace.id }
    );

    const updated = await db.stakworkRun.findUnique({ where: { id: run.id } });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe(WorkflowStatus.COMPLETED);
    const stored = JSON.parse(updated!.result as string);
    expect(stored).toEqual(RICH_EVAL_RESULT);
  });

  it("fires PROMPT_EVAL_RESULT Pusher event with runId, promptVersionId, and full result", async () => {
    const run = await createPromptEvalRun(workspace.id, { promptVersionId: 55 });

    await processStakworkRunWebhook(
      { result: RICH_EVAL_RESULT, project_status: "complete", project_id: run.projectId! },
      { type: "PROMPT_EVAL", workspace_id: workspace.id }
    );

    expect(pusherServer.trigger).toHaveBeenCalledWith(
      `workspace-${workspace.slug}`,
      "prompt-eval-result",
      {
        runId: run.id,
        promptVersionId: 55,
        result: RICH_EVAL_RESULT,
      }
    );
  });

  it("skips auto-accept for PROMPT_EVAL runs even when autoAccept is true", async () => {
    const run = await createPromptEvalRun(workspace.id, { promptVersionId: 55, autoAccept: true });

    await processStakworkRunWebhook(
      { result: RICH_EVAL_RESULT, project_status: "complete", project_id: run.projectId! },
      { type: "PROMPT_EVAL", workspace_id: workspace.id }
    );

    // No decision field should be set on the run
    const updated = await db.stakworkRun.findUnique({ where: { id: run.id } });
    expect(updated?.decision).toBeNull();

    // STAKWORK_RUN_DECISION event should NOT have been fired
    const decisionCalls = pusherServer.trigger.mock.calls.filter(
      (call: unknown[]) => call[1] === "stakwork-run-decision"
    );
    expect(decisionCalls).toHaveLength(0);
  });

  it("does not trigger a fast-track chain (no new StakworkRun rows)", async () => {
    const run = await createPromptEvalRun(workspace.id, { promptVersionId: 55 });
    const runsBefore = await db.stakworkRun.count({ where: { workspaceId: workspace.id } });

    await processStakworkRunWebhook(
      { result: RICH_EVAL_RESULT, project_status: "complete", project_id: run.projectId! },
      { type: "PROMPT_EVAL", workspace_id: workspace.id }
    );

    const runsAfter = await db.stakworkRun.count({ where: { workspaceId: workspace.id } });
    expect(runsAfter).toBe(runsBefore);
  });
});
