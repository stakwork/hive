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
    task: { count: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/ai/runCanvasAgent", () => ({
  runCanvasAgent: vi.fn(),
}));

import { db } from "@/lib/db";
import { runCanvasAgent } from "@/lib/ai/runCanvasAgent";
import {
  invokeCanvasAgentOnPlannerMessage,
  countTrailingPlannerAsks,
  MAX_CONSECUTIVE_PLANNER_ASKS,
} from "@/services/canvas-agent-autoturn";
import { actionableWakeReason } from "@/services/canvas-planner-fanout";
import { SEND_TO_FEATURE_PLANNER_TOOL } from "@/lib/proposals/types";
import type { StoredMessage } from "@/services/canvas-turn-persistence";

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
    // The per-message claim + release run inside `db.$transaction` with a
    // FOR UPDATE row read. Default: grant the claim (conversation present,
    // no prior output rows, no live claim) and let release succeed.
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: unknown) => unknown) =>
        fn({
          $queryRaw: vi.fn().mockResolvedValue([{ messages: [], settings: {} }]),
          sharedConversation: { update: vi.fn().mockResolvedValue({}) },
        }),
    );
    // Default: no tasks exist yet for the feature.
    (db.task.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  test('master kill: env "false" does nothing (no DB, no agent)', async () => {
    process.env[ENV_KEY] = "false";

    await invokeCanvasAgentOnPlannerMessage(args);

    expect(runCanvasAgent).not.toHaveBeenCalled();
    // No claim transaction and no conversation load when hard-disabled.
    expect(db.$transaction).not.toHaveBeenCalled();
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

  test("already-claimed message: a live claim short-circuits before loading the conversation", async () => {
    delete process.env[ENV_KEY];
    // The claim transaction finds a fresh (non-stale) claim already
    // recorded for this planner message → this caller LOSES the claim and
    // must not load the conversation or run the agent. Crucially this is a
    // dedup, not a silent drop of a needed turn: another run owns it.
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: unknown) => unknown) =>
        fn({
          $queryRaw: vi.fn().mockResolvedValue([
            {
              messages: [],
              settings: {
                autoTurnClaims: { "msg-1": { claimedAt: Date.now() } },
              },
            },
          ]),
          sharedConversation: { update: vi.fn() },
        }),
    );

    await invokeCanvasAgentOnPlannerMessage(args);

    expect(db.sharedConversation.findUnique).not.toHaveBeenCalled();
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

  test("wake message rides as a USER turn, never a second system message", async () => {
    // Regression: a `system`-role wake message lands AFTER
    // `runCanvasAgent`'s own leading system prompt + concept-seeding
    // assistant/tool messages, so Anthropic rejects the turn with
    // `AI_UnsupportedFunctionalityError: 'Multiple system messages that
    // are separated by user/assistant messages'` — aborting every
    // auto-turn. The wake context must ride as a `user` message.
    delete process.env[ENV_KEY];
    (
      db.sharedConversation.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      ...conversationWith(true),
      messages: [
        { id: "u1", role: "user", content: "Manage this feature for me." },
        {
          id: "p1",
          role: "assistant",
          content: "Plan ready?",
          source: { kind: "planner" },
        },
      ],
    });
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Auth Refactor",
      workspace: { slug: "ws" },
    });
    // Empty steps → no rows appended → no $transaction needed.
    // `cacheableConcepts: {}` + `cacheHit: false` mirrors a real miss
    // with no concepts (swarm returned nothing) → `hasConcepts` false →
    // no cache-persist write, so no `$executeRaw` mock needed.
    (runCanvasAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
      result: { text: Promise.resolve(""), steps: Promise.resolve([]) },
      cacheableConcepts: {},
      cacheHit: false,
    });

    await invokeCanvasAgentOnPlannerMessage(args);

    expect(runCanvasAgent).toHaveBeenCalledOnce();
    const passedMessages = (runCanvasAgent as ReturnType<typeof vi.fn>).mock
      .calls[0][0].messages as Array<{ role: string }>;
    // runCanvasAgent owns the single system prompt; the auto-turn must
    // not inject another one into the message stream.
    expect(passedMessages.some((m) => m.role === "system")).toBe(false);
    // The wake context is the leading user turn.
    expect(passedMessages[0].role).toBe("user");
  });
});

describe("invokeCanvasAgentOnPlannerMessage — generate-tasks loop prevention", () => {
  const args = {
    conversationId: "conv-1",
    featureId: "feat-1",
    plannerMessageId: "msg-1",
    wakeReason: "completed" as const,
  };

  const conversation = (messages: StoredMessage[] = []) => ({
    id: "conv-1",
    userId: "user-1",
    sourceControlOrgId: "org-1",
    workspaceId: "ws-1",
    messages,
    settings: {},
    workspace: { slug: "ws" },
    user: { canvasAutonomousTurns: true },
  });

  const fullPlanFeature = {
    title: "ScrollArea fix",
    brief: "the brief",
    requirements: "the requirements",
    architecture: "the architecture",
    workflowStatus: WorkflowStatus.COMPLETED,
    workspace: { slug: "ws" },
  };

  /** An auto-turn output row that asked `featureId`'s planner something. */
  const askRow = (n: number, featureId = "feat-1"): StoredMessage => ({
    id: `autoturn-prev${n}-0`,
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: `call-${n}`,
        toolName: SEND_TO_FEATURE_PLANNER_TOOL,
        input: { featureId, message: "Please generate the tasks now." },
      },
    ],
  });

  const mockAgentRun = () =>
    (runCanvasAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
      result: { text: Promise.resolve(""), steps: Promise.resolve([]) },
      cacheableConcepts: {},
      cacheHit: false,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env[ENV_KEY];
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: unknown) => unknown) =>
        fn({
          $queryRaw: vi.fn().mockResolvedValue([{ messages: [], settings: {} }]),
          sharedConversation: { update: vi.fn().mockResolvedValue({}) },
        }),
    );
    (
      db.sharedConversation.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(conversation());
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      fullPlanFeature,
    );
    (db.task.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  });

  test("short-circuit: plan complete + tasks already generated → no LLM turn at all", async () => {
    // THE loop: workflowStatus is terminal so every planner reply wakes
    // with 'completed', and the prompt used to re-ask for tasks forever.
    (db.task.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    mockAgentRun();

    await invokeCanvasAgentOnPlannerMessage(args);

    expect(runCanvasAgent).not.toHaveBeenCalled();
  });

  test("tasks not yet generated → turn runs and the wake message pushes for tasks", async () => {
    mockAgentRun();

    await invokeCanvasAgentOnPlannerMessage(args);

    expect(runCanvasAgent).toHaveBeenCalledOnce();
    const messages = (runCanvasAgent as ReturnType<typeof vi.fn>).mock
      .calls[0][0].messages as Array<{ role: string; content: string }>;
    const wake = messages[messages.length - 1];
    expect(wake.role).toBe("user");
    expect(wake.content).toContain("generate the tasks now");
    expect(wake.content).toContain("_(not yet generated)_");
  });

  test("tasks generated but a stage missing → turn runs, wake message forbids re-asking for tasks", async () => {
    // Odd-but-possible state: short-circuit doesn't apply (stage missing),
    // so the LLM runs — the prompt must still carry the never-re-ask rule.
    (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...fullPlanFeature,
      architecture: null,
    });
    (db.task.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    mockAgentRun();

    await invokeCanvasAgentOnPlannerMessage(args);

    expect(runCanvasAgent).toHaveBeenCalledOnce();
    const messages = (runCanvasAgent as ReturnType<typeof vi.fn>).mock
      .calls[0][0].messages as Array<{ role: string; content: string }>;
    const wake = messages[messages.length - 1];
    expect(wake.content).toContain("NEVER ask the planner to generate tasks again");
    expect(wake.content).not.toContain("telling it to generate the tasks now");
  });

  test("loop breaker: too many consecutive asks with no human message → wake skipped", async () => {
    // Use a non-'completed' wake so the short-circuit doesn't mask the
    // breaker — this is the path a future semantic loop (e.g. trailing-'?'
    // ping-pong) would take.
    const transcript = Array.from(
      { length: MAX_CONSECUTIVE_PLANNER_ASKS },
      (_, n) => askRow(n),
    );
    (
      db.sharedConversation.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(conversation(transcript));
    mockAgentRun();

    await invokeCanvasAgentOnPlannerMessage({ ...args, wakeReason: "question" });

    expect(runCanvasAgent).not.toHaveBeenCalled();
  });

  test("loop breaker resets on a human message — steered conversations are never throttled", async () => {
    const transcript: StoredMessage[] = [
      ...Array.from({ length: MAX_CONSECUTIVE_PLANNER_ASKS }, (_, n) =>
        askRow(n),
      ),
      { id: "u-1", role: "user", content: "keep going, I'm watching" },
      askRow(99),
    ];
    (
      db.sharedConversation.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(conversation(transcript));
    mockAgentRun();

    await invokeCanvasAgentOnPlannerMessage({ ...args, wakeReason: "question" });

    expect(runCanvasAgent).toHaveBeenCalledOnce();
  });
});

describe("countTrailingPlannerAsks", () => {
  const ask = (id: string, featureId: string): StoredMessage => ({
    id,
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: `call-${id}`,
        toolName: SEND_TO_FEATURE_PLANNER_TOOL,
        input: { featureId, message: "next stage please" },
      },
    ],
  });

  test("counts only asks targeting the given feature", () => {
    const messages: StoredMessage[] = [
      ask("a", "feat-1"),
      ask("b", "feat-OTHER"),
      ask("c", "feat-1"),
      // A non-planner tool call never counts.
      {
        id: "d",
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-d", toolName: "read_feature", input: {} }],
      },
      // Plain narration rows are skipped, not counted and not a reset.
      { id: "e", role: "assistant", content: "Looking good." },
    ];
    expect(countTrailingPlannerAsks(messages, "feat-1")).toBe(2);
    expect(countTrailingPlannerAsks(messages, "feat-OTHER")).toBe(1);
  });

  test("stops at the most recent human message", () => {
    const messages: StoredMessage[] = [
      ask("a", "feat-1"),
      ask("b", "feat-1"),
      { id: "u", role: "user", content: "thanks, continue" },
      ask("c", "feat-1"),
    ];
    expect(countTrailingPlannerAsks(messages, "feat-1")).toBe(1);
  });

  test("empty transcript → zero", () => {
    expect(countTrailingPlannerAsks([], "feat-1")).toBe(0);
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

  test("real PLAN artifact (plan ready for review) → 'completed' even when not terminal and no trailing '?'", () => {
    expect(
      actionableWakeReason(
        baseFeature, // workflowStatus IN_PROGRESS — the webhook race
        makeMessage({
          message:
            "Requirements are scoped tight. Confirm and I'll go deep into the architecture.",
          artifacts: [{ type: "PLAN", content: { summary: "the plan" } }],
        }),
      ),
    ).toBe("completed");
  });

  test("clarifying-questions PLAN does NOT count as a plan-ready signal (stays 'form')", () => {
    // Same artifact type (PLAN) but the clarifying variant → 'form', not
    // 'completed'. Guards the `plannerMessageHasPlan` exclusion.
    expect(
      actionableWakeReason(
        baseFeature,
        makeMessage({
          message: "Which provider?",
          artifacts: [clarifyingArtifact],
        }),
      ),
    ).toBe("form");
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
