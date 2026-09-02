/**
 * Unit tests for abnormal-finish detection in runCanvasAgent's onFinish.
 *
 * A turn can end without onError firing while the user sees nothing
 * (finishReason "stop" with zero visible text) or sees a truncated
 * answer (finishReason "length"). These tests pin down:
 *  1. A warn is emitted for "length" finishes.
 *  2. A warn is emitted for empty "stop" finishes (the dead-turn case).
 *  3. No warn for a normal finish with visible text.
 *  4. No warn for silent "tool-calls" ends (stay_silent / hasToolCall
 *     stop conditions / cancellation all finish this way).
 *  5. No warn when the stream reports no finishReason (mock/legacy shape).
 *  6. hooks.onFinish receives finishReason + visibleChars, with
 *     visibleChars summed across ALL steps, not just the final one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must come before any import that transitively loads them.
// Mirrors runCanvasAgent-timing.test.ts.
// ---------------------------------------------------------------------------
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn() },
  getWorkspaceChannelName: vi.fn(() => "ch"),
  PUSHER_EVENTS: { HIGHLIGHT_NODES: "highlight" },
}));
vi.mock("@/lib/ai/askTools", () => ({
  askTools: vi.fn(() => ({})),
  listConcepts: vi.fn(async () => ({ concepts: [] })),
  createHasEndMarkerCondition: vi.fn(() => () => false),
}));
vi.mock("@/lib/ai/askToolsMulti", () => ({ askToolsMulti: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/workspaceConfig", () => ({
  buildWorkspaceConfigs: vi.fn(async (_slugs: string[], _uid: string) => [
    {
      workspaceId: "ws-1",
      userId: "user-1",
      slug: "ws-slug",
      swarmUrl: "https://swarm",
      swarmApiKey: "key",
      repoUrls: [],
      pat: "pat",
      description: "",
      members: [],
      currentUserGithubUsername: null,
    },
  ]),
  buildPublicWorkspaceConfig: vi.fn(),
  fetchConceptsForWorkspaces: vi.fn(async () => ({})),
}));
vi.mock("@/lib/ai/connectionTools", () => ({ buildConnectionTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/canvasTools", () => ({ buildCanvasTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/initiativeTools", () => ({ buildInitiativeTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/researchTools", () => ({ buildResearchTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/htmlArtifactTools", () => ({ buildHtmlArtifactTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/infraTools", () => ({ buildInfraTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/graphWalkerTools", () => ({ buildGraphWalkerTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/graphWalkDispatchTools", () => ({ buildGraphWalkDispatchTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/workflowExplorerTools", () => ({ buildWorkflowExplorerTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/promptTools", () => ({ buildPromptTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/conceptTools", () => ({ buildConceptTools: vi.fn(() => ({})) }));
vi.mock("@/lib/canvas/linkedWorkspaces", () => ({
  getLinkedWorkspacesForInitiative: vi.fn(() => []),
}));
vi.mock("@/lib/ai/message-sanitizer", () => ({
  sanitizeAndCompleteToolCalls: vi.fn(async (msgs: unknown) => msgs),
}));
vi.mock("@/lib/ai/provider", () => ({
  getModel: vi.fn(() => ({ modelId: "mock-model" })),
  getApiKeyForProvider: vi.fn(() => "api-key"),
}));
vi.mock("aieo", () => ({ getProviderOptions: vi.fn(() => ({})) }));
vi.mock("@/services/bifrost/orchestrator", () => ({
  getBifrostForLLM: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/canvas-system-prompt", () => ({
  getCanvasSystemPrompt: vi.fn(async () => ({ value: "system", promptId: null })),
}));
vi.mock("@/lib/ai/capabilityGates", () => ({
  isPromptsCapabilityEnabledForOrg: vi.fn(async () => false),
  isGraphWriteCapabilityEnabledForOrg: vi.fn(async () => false),
  isCodeChangeCapabilityEnabledForOrg: vi.fn(async () => false),
}));
vi.mock("@/lib/constants/prompt", () => ({
  getMultiWorkspacePrefixMessages: vi.fn(() => []),
  getQuickAskPrefixMessages: vi.fn(() => []),
  buildCanvasScopeMessage: vi.fn(() => null),
  getRoadmapCapabilitySnippet: vi.fn(() => ""),
  getWhiteboardCapabilitySnippet: vi.fn(() => ""),
  getPlannerCapabilitySnippet: vi.fn(() => ""),
  getResearchCapabilitySnippet: vi.fn(() => ""),
  getConnectionsCapabilitySnippet: vi.fn(() => ""),
  getHtmlPagesCapabilitySnippet: vi.fn(() => ""),
  getGraphWalkerCapabilitySnippet: vi.fn(() => ""),
  getInfraCapabilitySnippet: vi.fn(() => ""),
  getWorkflowsCapabilitySnippet: vi.fn(() => ""),
  getPromptsCapabilitySnippet: vi.fn(() => ""),
  getConceptsCapabilitySnippet: vi.fn(() => ""),
  getCanvasPromptSuffix: vi.fn(() => ""),
}));

const mockStreamText = vi.fn();
vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  tool: vi.fn((t: unknown) => t),
}));

import { runCanvasAgent } from "@/lib/ai/runCanvasAgent";
import type { ModelMessage } from "ai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseOpts(overrides: Partial<Parameters<typeof runCanvasAgent>[0]> = {}) {
  return {
    userId: "user-1",
    workspaceSlugs: ["ws-slug"],
    messages: [{ role: "user", content: "hello" }] as ModelMessage[],
    ...overrides,
  } satisfies Parameters<typeof runCanvasAgent>[0];
}

/**
 * streamText mock that fires onFinish with a caller-supplied finish
 * event, so each test can shape finishReason / text / steps.
 */
function makeFinishingStream(finishEvent: Record<string, unknown>) {
  return (opts: Record<string, unknown>) => {
    const { onFinish } = opts as {
      onFinish?: (arg: Record<string, unknown>) => Promise<void>;
    };
    const finishP = onFinish
      ? onFinish({ usage: { inputTokens: 10, outputTokens: 5 }, ...finishEvent })
      : Promise.resolve();
    return {
      toUIMessageStreamResponse: vi.fn(() => new Response("ok")),
      consumeStream: vi.fn(async () => {}),
      _finishP: finishP,
    };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runCanvasAgent — abnormal-finish detection", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  function abnormalWarns() {
    return warnSpy.mock.calls
      .filter((args) => args[0] === "[runCanvasAgent] abnormal finish")
      .map((args) => args[1] as Record<string, unknown>);
  }

  it("warns on a length finish even when text was produced", async () => {
    mockStreamText.mockImplementation(
      makeFinishingStream({
        finishReason: "length",
        text: "truncated ans",
        steps: [{ text: "truncated ans" }],
      }),
    );

    await runCanvasAgent(baseOpts());

    const warns = abnormalWarns();
    expect(warns).toHaveLength(1);
    expect(warns[0]!.finishReason).toBe("length");
    expect(warns[0]!.visibleChars).toBe(13);
  });

  it("warns on a clean stop with zero visible text across all steps (dead turn)", async () => {
    mockStreamText.mockImplementation(
      makeFinishingStream({
        finishReason: "stop",
        text: "",
        steps: [{ text: "" }, { text: "" }],
      }),
    );

    await runCanvasAgent(baseOpts());

    const warns = abnormalWarns();
    expect(warns).toHaveLength(1);
    expect(warns[0]!.finishReason).toBe("stop");
    expect(warns[0]!.visibleChars).toBe(0);
    expect(warns[0]!.steps).toBe(2);
  });

  it("does NOT warn on a normal stop finish with visible text", async () => {
    mockStreamText.mockImplementation(
      makeFinishingStream({
        finishReason: "stop",
        text: "final answer",
        steps: [{ text: "" }, { text: "final answer" }],
      }),
    );

    await runCanvasAgent(baseOpts());

    expect(abnormalWarns()).toHaveLength(0);
  });

  it("does NOT warn on an empty tool-calls finish (legit silent end)", async () => {
    // stay_silent, hasToolCall(...) stop conditions, and cancellation all
    // end the loop right after a tool call — finishReason "tool-calls",
    // no visible text, and nothing is wrong.
    mockStreamText.mockImplementation(
      makeFinishingStream({
        finishReason: "tool-calls",
        text: "",
        steps: [{ text: "" }],
      }),
    );

    await runCanvasAgent(baseOpts());

    expect(abnormalWarns()).toHaveLength(0);
  });

  it("does NOT warn when the finish event carries no finishReason", async () => {
    mockStreamText.mockImplementation(makeFinishingStream({}));

    await runCanvasAgent(baseOpts());

    expect(abnormalWarns()).toHaveLength(0);
  });

  it("passes finishReason and cross-step visibleChars to hooks.onFinish", async () => {
    mockStreamText.mockImplementation(
      makeFinishingStream({
        finishReason: "stop",
        text: "bc",
        // Sum must span all steps (1 + 0 + 2), not just the final one.
        steps: [{ text: "a" }, { text: "" }, { text: "bc" }],
      }),
    );

    const onFinish = vi.fn();
    const { result } = await runCanvasAgent(baseOpts({ hooks: { onFinish } }));
    await (result as unknown as { _finishP: Promise<void> })._finishP;

    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith({
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: "stop",
      visibleChars: 3,
      // No Stop press in this run — threaded through so the quick-ask
      // route can tell a cancellation "tool-calls" finish (legit) from
      // a tool call that ended the turn without an output (flagged).
      cancellationRequested: false,
    });
  });
});
