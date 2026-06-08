/**
 * Unit tests for the canvas-agent auto-turn (Phase 3 of
 * `docs/plans/canvas-agent-manages-planners.md`).
 *
 * Coverage:
 *   - Kill switch: with `CANVAS_AUTONOMOUS_TURNS_ENABLED` unset/false,
 *     `invokeCanvasAgentOnPlannerMessage` must NOT touch the DB or call
 *     `runCanvasAgent`. Kill-switch regressions are silent in prod, so
 *     this cheap test is the insurance.
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

describe("invokeCanvasAgentOnPlannerMessage — kill switch", () => {
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  test("does nothing when env is unset", async () => {
    delete process.env[ENV_KEY];

    await invokeCanvasAgentOnPlannerMessage({
      conversationId: "conv-1",
      featureId: "feat-1",
      plannerMessageId: "msg-1",
      wakeReason: "form",
    });

    expect(runCanvasAgent).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.sharedConversation.findUnique).not.toHaveBeenCalled();
  });

  test('does nothing when env is "false"', async () => {
    process.env[ENV_KEY] = "false";

    await invokeCanvasAgentOnPlannerMessage({
      conversationId: "conv-1",
      featureId: "feat-1",
      plannerMessageId: "msg-1",
      wakeReason: "completed",
    });

    expect(runCanvasAgent).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
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
