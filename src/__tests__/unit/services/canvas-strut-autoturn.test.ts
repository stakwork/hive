/**
 * Unit tests for canvas-strut-autoturn.ts
 *
 * Coverage: the gates that decide whether a settled strut chat — or a job
 * turn's reply — costs an LLM turn: master kill switch, per-message claim,
 * owner opt-in, idempotency, and the launch loop breaker; plus each wake's
 * runCanvasAgent args and what its wake message tells the agent.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const { mockConversationFindUnique, mockRunCanvasAgent, mockClaim, mockRelease, mockAppend, mockMessagesFromSteps } =
  vi.hoisted(() => ({
    mockConversationFindUnique: vi.fn(),
    mockRunCanvasAgent: vi.fn(),
    mockClaim: vi.fn(),
    mockRelease: vi.fn(),
    mockAppend: vi.fn(),
    mockMessagesFromSteps: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({ db: { sharedConversation: { findUnique: mockConversationFindUnique } } }));
vi.mock("@/lib/ai/runCanvasAgent", () => ({ runCanvasAgent: mockRunCanvasAgent }));
vi.mock("@/lib/ai/conversationHelpers", () => ({
  toModelMessages: (rows: Array<{ role: string; content: string }>) =>
    rows.map((r) => ({ role: r.role, content: r.content })),
}));
vi.mock("@/lib/ai/strutTools", () => ({
  DISPATCH_STRUT_TOOL: "dispatch_strut",
  START_JOB_TOOL: "start_job",
  CONTINUE_JOB_TOOL: "continue_job",
}));
vi.mock("@/services/canvas-agent-autoturn", () => ({
  STAY_SILENT_TOOL: "stay_silent",
  claimAutoTurn: mockClaim,
  releaseAutoTurnClaim: mockRelease,
  hasConcepts: () => false,
  persistPromptConcepts: vi.fn(),
}));
vi.mock("@/services/canvas-turn-persistence", () => ({
  messagesFromSteps: mockMessagesFromSteps,
  appendTurnMessages: mockAppend,
}));

import {
  invokeCanvasAgentOnJobTurn,
  invokeCanvasAgentOnStrutSettled,
  countTrailingStrutDispatches,
  MAX_CONSECUTIVE_STRUT_DISPATCHES,
  type JobAutoTurnArgs,
} from "@/services/canvas-strut-autoturn";
import type { StoredMessage } from "@/services/canvas-turn-persistence";

const ARGS = {
  conversationId: "conv-1",
  wakeId: "strut-run-1-0-turn",
  workspaceSlug: "acme",
  chatId: "chat-9",
  title: "Build clipper",
  failed: false,
  publicBaseUrl: "https://hive.example.com",
};

const launchRow = (id: string, toolName: string): StoredMessage =>
  ({
    id,
    role: "assistant",
    content: "",
    toolCalls: [{ id: `tc-${id}`, toolName, input: {} }],
  }) as unknown as StoredMessage;
const dispatchRow = (id: string): StoredMessage => launchRow(id, "dispatch_strut");
const userRow = (id: string): StoredMessage => ({ id, role: "user", content: "go" }) as unknown as StoredMessage;

const JOB_ARGS: JobAutoTurnArgs = {
  conversationId: "conv-1",
  wakeId: "job-row-1",
  workspaceSlug: "acme",
  jobId: "6f1c0d3e-1111-4222-8333-444455556666",
  title: "Dark mode plan",
  outcome: "success",
  artifacts: [{ title: "Plan", kind: "markdown", label: "plan" }],
  publicBaseUrl: "https://hive.example.com",
};

function conversation(over: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    sourceControlOrgId: "org-1",
    messages: [userRow("u1"), dispatchRow("a1")],
    settings: { extraWorkspaceSlugs: ["other"] },
    workspace: { slug: "home" },
    user: { canvasAutonomousTurns: true },
    ...over,
  };
}

describe("countTrailingStrutDispatches", () => {
  test("counts dispatches back to the last human message", () => {
    expect(countTrailingStrutDispatches([dispatchRow("a0"), userRow("u1"), dispatchRow("a1"), dispatchRow("a2")])).toBe(
      2,
    );
    expect(countTrailingStrutDispatches([dispatchRow("a0"), userRow("u1")])).toBe(0);
  });

  test("a job turn is a launch too: start_job and continue_job count, other tools do not", () => {
    expect(
      countTrailingStrutDispatches([
        userRow("u1"),
        launchRow("a1", "start_job"),
        launchRow("a2", "read_feature"),
        launchRow("a3", "continue_job"),
        dispatchRow("a4"),
      ]),
    ).toBe(3);
  });
});

describe("invokeCanvasAgentOnStrutSettled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClaim.mockResolvedValue(true);
    mockRelease.mockResolvedValue(undefined);
    mockConversationFindUnique.mockResolvedValue(conversation());
    mockMessagesFromSteps.mockReturnValue([{ id: "autoturn-strut-run-1-0-turn-0" }]);
    mockRunCanvasAgent.mockResolvedValue({
      result: { text: Promise.resolve(""), steps: Promise.resolve([]) },
      cacheableConcepts: {},
      cacheHit: true,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  test("the master kill switch skips before claiming", async () => {
    vi.stubEnv("CANVAS_AUTONOMOUS_TURNS_ENABLED", "false");
    await invokeCanvasAgentOnStrutSettled(ARGS);
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockRunCanvasAgent).not.toHaveBeenCalled();
  });

  test("a lost claim runs nothing and releases nothing", async () => {
    mockClaim.mockResolvedValue(false);
    await invokeCanvasAgentOnStrutSettled(ARGS);
    expect(mockRunCanvasAgent).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  test("the owner's opt-in is required", async () => {
    mockConversationFindUnique.mockResolvedValue(conversation({ user: { canvasAutonomousTurns: false } }));
    await invokeCanvasAgentOnStrutSettled(ARGS);
    expect(mockRunCanvasAgent).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledWith("conv-1", ARGS.wakeId);
  });

  test("an already-handled wake and the loop breaker both skip the LLM turn", async () => {
    mockConversationFindUnique.mockResolvedValueOnce(
      conversation({
        messages: [userRow("u1"), { id: `autoturn-${ARGS.wakeId}-0`, role: "assistant", content: "done" }],
      }),
    );
    await invokeCanvasAgentOnStrutSettled(ARGS);

    mockConversationFindUnique.mockResolvedValueOnce(
      conversation({
        messages: [
          userRow("u1"),
          ...Array.from({ length: MAX_CONSECUTIVE_STRUT_DISPATCHES }, (_, i) => dispatchRow(`a${i}`)),
        ],
      }),
    );
    await invokeCanvasAgentOnStrutSettled(ARGS);
    expect(mockRunCanvasAgent).not.toHaveBeenCalled();
  });

  test("runs the agent as the owner, ending on the wake message, and appends its rows", async () => {
    await invokeCanvasAgentOnStrutSettled(ARGS);

    const call = mockRunCanvasAgent.mock.calls[0][0];
    expect(call).toMatchObject({
      userId: "user-1",
      orgId: "org-1",
      workspaceSlugs: ["home", "other", "acme"],
      silentPusher: true,
      currentCanvasConversationId: "conv-1",
      publicBaseUrl: "https://hive.example.com",
    });
    const last = call.messages.at(-1);
    expect(last.role).toBe("user");
    expect(last.content).toContain("chat-9");
    expect(Object.keys(call.additionalTools)).toEqual(["stay_silent"]);

    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1", idPrefix: `autoturn-${ARGS.wakeId}-`, reason: "autoturn" }),
    );
    expect(mockRelease).toHaveBeenCalledWith("conv-1", ARGS.wakeId);
  });
});

describe("invokeCanvasAgentOnJobTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClaim.mockResolvedValue(true);
    mockRelease.mockResolvedValue(undefined);
    mockConversationFindUnique.mockResolvedValue(
      conversation({ messages: [userRow("u1"), launchRow("a1", "start_job")] }),
    );
    mockMessagesFromSteps.mockReturnValue([{ id: "autoturn-job-row-1-0" }]);
    mockRunCanvasAgent.mockResolvedValue({
      result: { text: Promise.resolve(""), steps: Promise.resolve([]) },
      cacheableConcepts: {},
      cacheHit: true,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  test("the same gates as a settled chat: kill switch, claim, opt-in", async () => {
    vi.stubEnv("CANVAS_AUTONOMOUS_TURNS_ENABLED", "false");
    await invokeCanvasAgentOnJobTurn(JOB_ARGS);
    expect(mockClaim).not.toHaveBeenCalled();
    vi.unstubAllEnvs();

    mockClaim.mockResolvedValueOnce(false);
    await invokeCanvasAgentOnJobTurn(JOB_ARGS);
    expect(mockRunCanvasAgent).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();

    mockConversationFindUnique.mockResolvedValueOnce(conversation({ user: { canvasAutonomousTurns: false } }));
    await invokeCanvasAgentOnJobTurn(JOB_ARGS);
    expect(mockRunCanvasAgent).not.toHaveBeenCalled();
    expect(mockClaim).toHaveBeenCalledWith("conv-1", "job-row-1");
    expect(mockRelease).toHaveBeenCalledWith("conv-1", "job-row-1");
  });

  test("job turns trip the loop breaker: continue_job rounds with no human message between", async () => {
    mockConversationFindUnique.mockResolvedValueOnce(
      conversation({
        messages: [
          userRow("u1"),
          launchRow("a0", "start_job"),
          ...Array.from({ length: MAX_CONSECUTIVE_STRUT_DISPATCHES - 1 }, (_, i) =>
            launchRow(`a${i + 1}`, "continue_job"),
          ),
        ],
      }),
    );
    await invokeCanvasAgentOnJobTurn(JOB_ARGS);
    expect(mockRunCanvasAgent).not.toHaveBeenCalled();
  });

  test("runs as the owner, ending on a wake message that asks for a summary and names the job, the cards and continue_job", async () => {
    await invokeCanvasAgentOnJobTurn(JOB_ARGS);

    const call = mockRunCanvasAgent.mock.calls[0][0];
    expect(call).toMatchObject({
      userId: "user-1",
      orgId: "org-1",
      workspaceSlugs: ["home", "other", "acme"],
      silentPusher: true,
      currentCanvasConversationId: "conv-1",
      publicBaseUrl: "https://hive.example.com",
    });
    const last = call.messages.at(-1);
    expect(last.role).toBe("user");
    expect(last.content).toContain("job `6f1c0d3e-1111-4222-8333-444455556666`");
    expect(last.content).toContain("finished its turn.");
    expect(last.content).toContain("Plan (plan)");
    expect(last.content).toContain("**Summarize** (the default)");
    expect(last.content).toContain("do not list files, functions or line numbers");
    expect(last.content).toContain('`continue_job` with `jobId: "6f1c0d3e-1111-4222-8333-444455556666"`');
    expect(Object.keys(call.additionalTools)).toEqual(["stay_silent"]);

    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1", idPrefix: "autoturn-job-row-1-", reason: "autoturn" }),
    );
    expect(mockRelease).toHaveBeenCalledWith("conv-1", "job-row-1");
  });

  test("the wake message says how the turn ended: a question, a failure, a stop, a lost run", async () => {
    const wakeText = async (over: Partial<JobAutoTurnArgs>) => {
      mockRunCanvasAgent.mockClear();
      await invokeCanvasAgentOnJobTurn({ ...JOB_ARGS, ...over });
      return mockRunCanvasAgent.mock.calls[0][0].messages.at(-1).content as string;
    };
    expect(await wakeText({ ask: "Which repo?" })).toContain("STOPPED FOR A DECISION");
    expect(await wakeText({ outcome: "error" })).toContain("failed — the entry says why");
    expect(await wakeText({ outcome: "cancelled" })).toContain("been stopped by the user");
    expect(await wakeText({ outcome: "lost" })).toContain("been lost");
    expect(await wakeText({ artifacts: [] })).toContain("Nothing is attached to it.");
  });

  test("an already-handled wake appends nothing", async () => {
    mockConversationFindUnique.mockResolvedValueOnce(
      conversation({ messages: [userRow("u1"), { id: "autoturn-job-row-1-0", role: "assistant", content: "done" }] }),
    );
    await invokeCanvasAgentOnJobTurn(JOB_ARGS);
    expect(mockRunCanvasAgent).not.toHaveBeenCalled();
  });
});
