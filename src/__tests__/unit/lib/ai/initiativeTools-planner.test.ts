/**
 * Unit tests for `buildInitiativeTools` — `send_to_feature_planner` tool.
 *
 * Covers:
 *  - chatAgentModel forwarding (existing)
 *  - Bounded re-check loop before IN_PROGRESS reject (new)
 *
 * Every test-case that enters the re-check loop uses vi.useFakeTimers()
 * and drives it with interleaved `await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS)`
 * so the awaited setTimeout and the subsequent findUnique promise both
 * resolve per iteration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    feature: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    stakworkRun: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    initiative: { findFirst: vi.fn() },
    milestone: { findFirst: vi.fn() },
    workspace: { findFirst: vi.fn() },
  },
}));

vi.mock("@/services/roadmap/feature-chat", () => ({
  sendFeatureChatMessage: vi.fn(),
}));

vi.mock("@/services/stakwork-run", () => ({
  stopStakworkRun: vi.fn(),
}));

vi.mock("@/lib/canvas", () => ({
  notifyFeatureReassignmentRefresh: vi.fn(),
  notifyCanvasUpdated: vi.fn(),
}));

vi.mock("@/services/orgs/nodeDetail", () => ({
  loadNodeDetail: vi.fn(),
}));

import { db } from "@/lib/db";
import { sendFeatureChatMessage } from "@/services/roadmap/feature-chat";
import { stopStakworkRun } from "@/services/stakwork-run";
import { buildInitiativeTools } from "@/lib/ai/initiativeTools";

const SEND_TO_FEATURE_PLANNER = "send_to_feature_planner";
const CANCEL_FEATURE_PLANNER = "cancel_feature_planner";

// Must match the consts in initiativeTools.ts.
const RECHECK_INTERVAL_MS = 2_500;
const RECHECK_MAX_ATTEMPTS = 8;

type ExecuteOptions = { abortSignal?: AbortSignal };

function getFeaturePlannerTool(chatAgentModel?: string) {
  const tools = buildInitiativeTools(
    "org_1",
    "user_1",
    undefined,
    chatAgentModel,
  );
  const t = tools[SEND_TO_FEATURE_PLANNER];
  if (!t || typeof t !== "object" || !("execute" in t)) {
    throw new Error("send_to_feature_planner tool not registered");
  }
  return t as unknown as {
    execute: (
      input: { featureId: string; message: string },
      opts?: ExecuteOptions,
    ) => Promise<unknown>;
  };
}

/** Build the standard resolved feature object. */
function featureRow(workflowStatus: string) {
  return {
    id: "feat_1",
    title: "Test Feature",
    workspaceId: "ws_1",
    workflowStatus,
    parentCanvasConversationId: null,
    workspace: {
      slug: "test-ws",
      name: "Test Workspace",
      sourceControlOrgId: "org_1",
    },
  };
}

/** Shorthand: set a single resolved value for findUnique. */
function mockFeatureOnce(workflowStatus: string) {
  (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    featureRow(workflowStatus),
  );
}

/** Expected structured IN_PROGRESS reject payload. */
const IN_PROGRESS_PAYLOAD = {
  error: expect.stringMatching(/planner is currently running/i),
  workflowStatus: "IN_PROGRESS",
  featureId: "feat_1",
  featureTitle: "Test Feature",
  workspaceSlug: "test-ws",
  workspaceName: "Test Workspace",
};

beforeEach(() => {
  vi.clearAllMocks();
  (db.feature.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (sendFeatureChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
    chatMessage: { id: "msg_1" },
    stakworkData: null,
  });
});

afterEach(() => {
  // Restore real timers in case a test used fake ones.
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Existing behaviour — chatAgentModel forwarding
// ---------------------------------------------------------------------------
describe("send_to_feature_planner — chatAgentModel forwarding", () => {
  it("forwards chatAgentModel as model to sendFeatureChatMessage when supplied", async () => {
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      featureRow("COMPLETED"),
    );
    const tool = getFeaturePlannerTool("anthropic/claude-opus-4-6");

    const result = await tool.execute({
      featureId: "feat_1",
      message: "Hello planner",
    });

    expect(result).toMatchObject({ status: "sent" });
    expect(sendFeatureChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        featureId: "feat_1",
        model: "anthropic/claude-opus-4-6",
      }),
    );
  });

  it("does not pass model to sendFeatureChatMessage when chatAgentModel is absent", async () => {
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      featureRow("COMPLETED"),
    );
    const tool = getFeaturePlannerTool(); // no chatAgentModel

    const result = await tool.execute({
      featureId: "feat_1",
      message: "Hello planner",
    });

    expect(result).toMatchObject({ status: "sent" });
    const call = (sendFeatureChatMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call).not.toHaveProperty("model");
  });

  it("forwards a non-Anthropic model unchanged", async () => {
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      featureRow("COMPLETED"),
    );
    const tool = getFeaturePlannerTool("openai/gpt-4o");

    await tool.execute({ featureId: "feat_1", message: "Hello planner" });

    expect(sendFeatureChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai/gpt-4o" }),
    );
  });
});

// ---------------------------------------------------------------------------
// (a) Idle on first read — no re-check, no extra reads
// ---------------------------------------------------------------------------
describe("send_to_feature_planner — (a) idle on first read", () => {
  it("sends immediately with a single findUnique call when status is not IN_PROGRESS", async () => {
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      featureRow("COMPLETED"),
    );
    const tool = getFeaturePlannerTool();

    const result = await tool.execute({
      featureId: "feat_1",
      message: "Hello planner",
    });

    expect(result).toMatchObject({ status: "sent" });
    // Only the initial read — no re-check reads.
    expect(db.feature.findUnique).toHaveBeenCalledTimes(1);
    expect(sendFeatureChatMessage).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// (c) IN_PROGRESS throughout — rework of the original "does not call
//     sendFeatureChatMessage when IN_PROGRESS" test with fake timers.
// ---------------------------------------------------------------------------
describe("send_to_feature_planner — (c) IN_PROGRESS throughout the window", () => {
  it("returns the structured rejection unchanged and never calls sendFeatureChatMessage", async () => {
    vi.useFakeTimers();

    // Initial read returns IN_PROGRESS; all re-check reads also return IN_PROGRESS.
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      featureRow("IN_PROGRESS"),
    );
    // Re-check queries select only { workflowStatus }.
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      workflowStatus: "IN_PROGRESS",
    });

    // Reset to a consistent persistent mock.
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockReset();
    // First call: full feature object (initial read).
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      featureRow("IN_PROGRESS"),
    );
    // All subsequent calls (re-checks): still IN_PROGRESS.
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      workflowStatus: "IN_PROGRESS",
    });

    const tool = getFeaturePlannerTool();
    const executePromise = tool.execute({
      featureId: "feat_1",
      message: "Hello planner",
    });

    // Advance through all RECHECK_MAX_ATTEMPTS iterations.
    for (let i = 0; i < RECHECK_MAX_ATTEMPTS; i++) {
      await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS);
    }

    const result = await executePromise;

    expect(result).toMatchObject(IN_PROGRESS_PAYLOAD);
    expect(sendFeatureChatMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (b) IN_PROGRESS then clears mid-window
// ---------------------------------------------------------------------------
describe("send_to_feature_planner — (b) IN_PROGRESS clears mid-window", () => {
  it("proceeds with the send once status clears", async () => {
    vi.useFakeTimers();

    // Initial read: IN_PROGRESS.
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      featureRow("IN_PROGRESS"),
    );
    // First re-check: still IN_PROGRESS.
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      workflowStatus: "IN_PROGRESS",
    });
    // Second re-check: cleared.
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      workflowStatus: "COMPLETED",
    });

    const tool = getFeaturePlannerTool();
    const executePromise = tool.execute({
      featureId: "feat_1",
      message: "Hello planner",
    });

    // Advance past the first re-check interval (status still IN_PROGRESS).
    await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS);
    // Advance past the second re-check interval (status clears).
    await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS);

    const result = await executePromise;

    expect(result).toMatchObject({ status: "sent" });
    expect(sendFeatureChatMessage).toHaveBeenCalledTimes(1);
    // 1 initial + 2 re-checks = 3 total findUnique calls.
    expect(db.feature.findUnique).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// (d) Feature deleted mid-window
// ---------------------------------------------------------------------------
describe("send_to_feature_planner — (d) feature deleted mid-window", () => {
  it("returns { error: 'Feature not found' } without calling sendFeatureChatMessage", async () => {
    vi.useFakeTimers();

    // Initial read: IN_PROGRESS.
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      featureRow("IN_PROGRESS"),
    );
    // First re-check: feature deleted (null).
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      null,
    );

    const tool = getFeaturePlannerTool();
    const executePromise = tool.execute({
      featureId: "feat_1",
      message: "Hello planner",
    });

    await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS);

    const result = await executePromise;

    expect(result).toEqual({ error: "Feature not found" });
    expect(sendFeatureChatMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (e) Abort signal mid-wait
// ---------------------------------------------------------------------------
describe("send_to_feature_planner — (e) abort signal", () => {
  it("stops the loop early when abortSignal is already aborted", async () => {
    vi.useFakeTimers();

    // Initial read: IN_PROGRESS.
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      featureRow("IN_PROGRESS"),
    );
    // Any re-check that might slip through also returns IN_PROGRESS.
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      workflowStatus: "IN_PROGRESS",
    });

    const controller = new AbortController();
    controller.abort(); // already aborted before execute() is called

    const tool = getFeaturePlannerTool();
    const executePromise = tool.execute(
      { featureId: "feat_1", message: "Hello planner" },
      { abortSignal: controller.signal },
    );

    // No timer advancement needed — the loop should detect the pre-aborted
    // signal before waiting.
    await vi.advanceTimersByTimeAsync(0);

    const result = await executePromise;

    // Should return the IN_PROGRESS rejection (loop exited before clearing).
    expect(result).toMatchObject(IN_PROGRESS_PAYLOAD);
    expect(sendFeatureChatMessage).not.toHaveBeenCalled();
    // Re-check queries should be at most 1 (none or the abort-after-wait branch).
    // The key assertion is that the loop did NOT run all 8 iterations.
    expect(db.feature.findUnique).toHaveBeenCalledTimes(1); // only initial read
  });

  it("stops the loop mid-way when signal is aborted between iterations", async () => {
    vi.useFakeTimers();

    const controller = new AbortController();

    // Initial read: IN_PROGRESS.
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      featureRow("IN_PROGRESS"),
    );
    // First re-check: still IN_PROGRESS; abort after this.
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => {
        controller.abort();
        return { workflowStatus: "IN_PROGRESS" };
      },
    );

    const tool = getFeaturePlannerTool();
    const executePromise = tool.execute(
      { featureId: "feat_1", message: "Hello planner" },
      { abortSignal: controller.signal },
    );

    // Advance through the first interval so the re-check fires and aborts.
    await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS);

    const result = await executePromise;

    expect(result).toMatchObject(IN_PROGRESS_PAYLOAD);
    expect(sendFeatureChatMessage).not.toHaveBeenCalled();
    // 1 initial + 1 re-check = 2 total; loop stops after the first re-check.
    expect(db.feature.findUnique).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// (f) Race: status clears, tool proceeds, sendFeatureChatMessage throws
//     "already running" → catch returns structured IN_PROGRESS payload.
// ---------------------------------------------------------------------------
describe("send_to_feature_planner — (f) race after clear", () => {
  it("returns structured IN_PROGRESS payload when sendFeatureChatMessage throws 'already running'", async () => {
    vi.useFakeTimers();

    // Initial read: IN_PROGRESS.
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      featureRow("IN_PROGRESS"),
    );
    // First re-check: cleared.
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      workflowStatus: "COMPLETED",
    });

    // A concurrent send raced ahead and the downstream guard throws.
    (sendFeatureChatMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("A planning workflow is already running for this feature"),
    );

    const tool = getFeaturePlannerTool();
    const executePromise = tool.execute({
      featureId: "feat_1",
      message: "Hello planner",
    });

    // Advance past the first re-check interval so the status clears.
    await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS);

    const result = await executePromise;

    // Must return all five structured fields, not an opaque { error }.
    expect(result).toMatchObject(IN_PROGRESS_PAYLOAD);
    // sendFeatureChatMessage was called (the tool did proceed after clear).
    expect(sendFeatureChatMessage).toHaveBeenCalledTimes(1);
  });

  it("returns opaque { error } for any other thrown error (not the race error)", async () => {
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      featureRow("COMPLETED"),
    );

    (sendFeatureChatMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Some unexpected DB error"),
    );

    const tool = getFeaturePlannerTool();

    const result = (await tool.execute({
      featureId: "feat_1",
      message: "Hello planner",
    })) as { error?: string };

    expect(result).toEqual({ error: "Some unexpected DB error" });
    // Must NOT include structured fields.
    expect(result).not.toHaveProperty("workflowStatus");
    expect(result).not.toHaveProperty("featureId");
  });
});

// ---------------------------------------------------------------------------
// cancel_feature_planner
// ---------------------------------------------------------------------------
function getCancelTool() {
  const tools = buildInitiativeTools("org_1", "user_1", undefined, undefined);
  const t = tools[CANCEL_FEATURE_PLANNER];
  if (!t || typeof t !== "object" || !("execute" in t)) {
    throw new Error("cancel_feature_planner tool not registered");
  }
  return t as unknown as {
    execute: (input: { featureId: string }) => Promise<Record<string, unknown>>;
  };
}

function mockCancelFeatureOnce() {
  (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    title: "Test Feature",
    workspace: {
      slug: "test-ws",
      name: "Test Workspace",
      sourceControlOrgId: "org_1",
    },
  });
}

describe("cancel_feature_planner", () => {
  it("resolves the active run and halts it via stopStakworkRun", async () => {
    mockCancelFeatureOnce();
    (db.stakworkRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "run_1",
      projectId: 42,
    });

    const result = await getCancelTool().execute({ featureId: "feat_1" });

    expect(stopStakworkRun).toHaveBeenCalledWith("run_1", "user_1");
    expect(result).toMatchObject({
      status: "halted",
      featureId: "feat_1",
      featureTitle: "Test Feature",
    });
  });

  it("returns no_active_run when nothing is running", async () => {
    mockCancelFeatureOnce();
    (db.stakworkRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      null,
    );

    const result = await getCancelTool().execute({ featureId: "feat_1" });

    expect(stopStakworkRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "no_active_run" });
  });

  it("returns starting when the run has no projectId yet", async () => {
    mockCancelFeatureOnce();
    (db.stakworkRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "run_1",
      projectId: null,
    });

    const result = await getCancelTool().execute({ featureId: "feat_1" });

    expect(stopStakworkRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "starting" });
  });

  it("rejects a feature that belongs to another org", async () => {
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      title: "Test Feature",
      workspace: {
        slug: "test-ws",
        name: "Test Workspace",
        sourceControlOrgId: "other_org",
      },
    });

    const result = await getCancelTool().execute({ featureId: "feat_1" });

    expect(db.stakworkRun.findFirst).not.toHaveBeenCalled();
    expect(stopStakworkRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      error: "Feature does not belong to this organization",
    });
  });

  it("returns { error } when stopStakworkRun throws", async () => {
    mockCancelFeatureOnce();
    (db.stakworkRun.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "run_1",
      projectId: 42,
    });
    (stopStakworkRun as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Access denied: user is not a member of this workspace"),
    );

    const result = await getCancelTool().execute({ featureId: "feat_1" });

    expect(result).toEqual({
      error: "Access denied: user is not a member of this workspace",
    });
  });
});
