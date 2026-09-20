/**
 * Unit tests for canvas-strut-autoturn.ts
 *
 * Coverage: the gates that decide whether a settled strut chat costs an LLM
 * turn — master kill switch, per-message claim, owner opt-in, idempotency,
 * and the dispatch loop breaker — plus the happy path's runCanvasAgent args.
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
vi.mock("@/lib/ai/strutTools", () => ({ DISPATCH_STRUT_TOOL: "dispatch_strut" }));
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
  invokeCanvasAgentOnStrutSettled,
  countTrailingStrutDispatches,
  MAX_CONSECUTIVE_STRUT_DISPATCHES,
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

const dispatchRow = (id: string): StoredMessage =>
  ({
    id,
    role: "assistant",
    content: "",
    toolCalls: [{ id: `tc-${id}`, toolName: "dispatch_strut", input: {} }],
  }) as unknown as StoredMessage;
const userRow = (id: string): StoredMessage => ({ id, role: "user", content: "go" }) as unknown as StoredMessage;

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
