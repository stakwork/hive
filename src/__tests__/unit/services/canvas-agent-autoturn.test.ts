/**
 * Unit tests for the canvas-agent auto-turn (Phase 3 of
 * `docs/plans/canvas-agent-manages-planners.md`).
 *
 * Coverage:
 *   - Gating (two layers, both default off):
 *       1. Master kill switch — with `CANVAS_AUTONOMOUS_TURNS_ENABLED`
 *          set to `"false"`, `invokeCanvasAgentOnPlannerMessage` must NOT
 *          touch the DB or call `runCanvasAgent`.
 *       2. Per-user opt-in — with the env NOT hard-disabled, the owner's
 *          `canvasAutonomousTurns` flag decides: a false flag loads the
 *          conversation but stops before `runCanvasAgent`; a true flag
 *          passes the gate (proceeds to the feature lookup).
 *     Gating regressions are silent in prod, so these cheap tests are
 *     the insurance.
 *   - `actionableWakeReason`: the deterministic FORM / workflow-status
 *     classification + the trailing-`?` heuristic that decide whether a
 *     planner message wakes the agent at all.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkflowStatus } from "@prisma/client";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    sharedConversation: { findUnique: vi.fn(), update: vi.fn() },
    feature: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/ai/runCanvasAgent", () => ({
  runCanvasAgent: vi.fn(),
}));

import { db } from "@/lib/db";
import { runCanvasAgent } from "@/lib/ai/runCanvasAgent";
import { invokeCanvasAgentOnPlannerMessage } from "@/services/canvas-agent-autoturn";
import { actionableWakeReason } from "@/services/canvas-planner-fanout";

const ENV_KEY = "CANVAS_AUTONOMOUS_TURNS_ENABLED";

describe("invokeCanvasAgentOnPlannerMessage — gating", () => {
  const original = process.env[ENV_KEY];

  const args = {
    conversationId: "conv-1",
    featureId: "feat-1",
    plannerMessageId: "msg-1",
    wakeReason: "completed" as const,
  };

  /** A conversation owned by a real user/org, with the opt-in flag set. */
  const conversationWith = (canvasAutonomousTurns: boolean) => ({
    id: "conv-1",
    userId: "user-1",
    sourceControlOrgId: "org-1",
    workspaceId: "ws-1",
    messages: [],
    settings: {},
    workspace: { slug: "ws" },
    user: { canvasAutonomousTurns },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Lock acquire/release: always grant the advisory lock.
    (db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([
      { locked: true },
    ]);
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  test('master kill: env "false" does nothing (no DB, no agent)', async () => {
    process.env[ENV_KEY] = "false";

    await invokeCanvasAgentOnPlannerMessage(args);

    expect(runCanvasAgent).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.sharedConversation.findUnique).not.toHaveBeenCalled();
  });

  test("per-user opt-out: env unset → loads conversation but no agent", async () => {
    delete process.env[ENV_KEY];
    (
      db.sharedConversation.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(conversationWith(false));

    await invokeCanvasAgentOnPlannerMessage(args);

    // It gets past the master switch (lock taken, conversation loaded)…
    expect(db.sharedConversation.findUnique).toHaveBeenCalledOnce();
    // …but the owner opt-out stops it before the feature lookup / agent.
    expect(db.feature.findUnique).not.toHaveBeenCalled();
    expect(runCanvasAgent).not.toHaveBeenCalled();
  });

  test("per-user opt-in: env unset + owner flag true → passes the gate", async () => {
    delete process.env[ENV_KEY];
    (
      db.sharedConversation.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(conversationWith(true));
    // Feature gone → clean early return AFTER the opt-in gate, proving the
    // gate was passed without having to mock the full agent run.
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await invokeCanvasAgentOnPlannerMessage(args);

    expect(db.feature.findUnique).toHaveBeenCalledOnce();
    expect(runCanvasAgent).not.toHaveBeenCalled();
  });
});

describe("actionableWakeReason", () => {
  const baseFeature = {
    id: "feat-1",
    parentCanvasConversationId: "conv-1",
    workspaceId: "ws-1",
    workflowStatus: WorkflowStatus.IN_PROGRESS as WorkflowStatus | null,
  };

  const makeMessage = (
    overrides: Partial<{
      message: string;
      artifacts: Array<{ type: string; content?: unknown }>;
    }>,
  ) =>
    ({
      id: "msg-1",
      message: "",
      artifacts: [],
      timestamp: new Date(),
      ...overrides,
    }) as never;

  /** A planner clarifying-questions artifact: PLAN + ask_clarifying_questions. */
  const clarifyingArtifact = {
    type: "PLAN",
    content: {
      tool_use: "ask_clarifying_questions",
      content: [{ question: "Stripe or Adyen?", type: "single_choice" }],
    },
  };

  test("clarifying-questions PLAN artifact → 'form' (takes precedence over everything)", () => {
    const reason = actionableWakeReason(
      { ...baseFeature, workflowStatus: WorkflowStatus.COMPLETED },
      makeMessage({
        message: "Pick one?",
        artifacts: [clarifyingArtifact],
      }),
    );
    expect(reason).toBe("form");
  });

  test("ArtifactType.FORM (task-style form) does NOT trigger 'form' for planners", () => {
    const reason = actionableWakeReason(
      baseFeature,
      makeMessage({
        message: "status update.",
        artifacts: [{ type: "FORM", content: { webhook: "x" } }],
      }),
    );
    expect(reason).toBeNull();
  });

  test("terminal workflow status maps to its reason", () => {
    expect(
      actionableWakeReason(
        { ...baseFeature, workflowStatus: WorkflowStatus.COMPLETED },
        makeMessage({ message: "Plan ready." }),
      ),
    ).toBe("completed");
    expect(
      actionableWakeReason(
        { ...baseFeature, workflowStatus: WorkflowStatus.HALTED },
        makeMessage({ message: "Paused." }),
      ),
    ).toBe("halted");
    expect(
      actionableWakeReason(
        { ...baseFeature, workflowStatus: WorkflowStatus.FAILED },
        makeMessage({ message: "Broke." }),
      ),
    ).toBe("failed");
    expect(
      actionableWakeReason(
        { ...baseFeature, workflowStatus: WorkflowStatus.ERROR },
        makeMessage({ message: "Errored." }),
      ),
    ).toBe("failed");
  });

  test("trailing '?' → 'question' when not terminal and no FORM", () => {
    expect(
      actionableWakeReason(
        baseFeature,
        makeMessage({ message: "Should we use Stripe or Adyen?" }),
      ),
    ).toBe("question");
  });

  test("pure prose status update → null (fans out but no turn)", () => {
    expect(
      actionableWakeReason(
        baseFeature,
        makeMessage({ message: "Still working on the architecture pass." }),
      ),
    ).toBeNull();
  });
});
