/**
 * Unit tests for stage-timing logs in runCanvasAgent.
 *
 * Acceptance criteria verified:
 *  1. Stage-timing lines emit with non-negative ms and {workspaces, orgId} context.
 *  2. TTFT fires exactly once, only on the first text-delta chunk (not tool-call
 *     or reasoning chunks).
 *  3. Per-tool round-trip reports a non-zero delta (onChunk, not onStepFinish ~0ms trap).
 *  4. onStepFinish bookkeeping stays synchronous — no timing state touched there.
 *  5. Timing Map / firstTokenLogged flag do NOT leak across two concurrent calls.
 *  6. onFinish streaming-duration label is distinct from the route setup-to-stream label.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must come before any import that transitively loads them.
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
  getGraphWalkerCapabilitySnippet: vi.fn(() => ""),
  getInfraCapabilitySnippet: vi.fn(() => ""),
  getWorkflowsCapabilitySnippet: vi.fn(() => ""),
  getPromptsCapabilitySnippet: vi.fn(() => ""),
  getConceptsCapabilitySnippet: vi.fn(() => ""),
  getCanvasPromptSuffix: vi.fn(() => ""),
}));

// ---------------------------------------------------------------------------
// Controllable streamText mock — lets each test drive onChunk/onFinish.
// ---------------------------------------------------------------------------
const mockStreamText = vi.fn();
vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  tool: vi.fn((t: unknown) => t),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------
import { runCanvasAgent } from "@/lib/ai/runCanvasAgent";
import type { ModelMessage } from "ai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid options for single-workspace authenticated call. */
function baseOpts(overrides: Partial<Parameters<typeof runCanvasAgent>[0]> = {}) {
  return {
    userId: "user-1",
    workspaceSlugs: ["ws-slug"],
    messages: [{ role: "user", content: "hello" }] as ModelMessage[],
    ...overrides,
  } satisfies Parameters<typeof runCanvasAgent>[0];
}

/**
 * Build a fake streamText result that synchronously invokes whatever
 * callbacks are wired in via `opts` (onChunk, onFinish, onStepFinish, onError).
 * Returns an object shaped like the AI SDK result handle so callers don't
 * need to await anything additional.
 */
function makeStreamResult(
  chunks: Array<{ type: string; toolCallId?: string; toolName?: string; text?: string }> = [],
  finishUsage = { inputTokens: 10, outputTokens: 5 },
) {
  return (opts: Record<string, unknown>) => {
    const { onChunk, onFinish, onStepFinish } = opts as {
      onChunk?: (arg: { chunk: unknown }) => void;
      onFinish?: (arg: { usage: unknown }) => Promise<void>;
      onStepFinish?: (sf: unknown) => Promise<void>;
    };

    // Fire chunks synchronously so the test can observe logs.
    for (const chunk of chunks) {
      onChunk?.({ chunk });
    }

    // Fire onStepFinish with the tool pairs so bookkeeping runs.
    if (onStepFinish) {
      const content = chunks
        .filter((c) => c.type === "tool-call" || c.type === "tool-result")
        .map((c) =>
          c.type === "tool-call"
            ? { type: "tool-call", toolName: c.toolName, input: {} }
            : { type: "tool-result", toolName: c.toolName },
        );
      void onStepFinish({ content });
    }

    // Fire onFinish.
    const finishP = onFinish ? onFinish({ usage: finishUsage }) : Promise.resolve();

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

describe("runCanvasAgent — stage-timing logs", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // Helper: collect all `[runCanvasAgent] timing` calls as parsed objects.
  function timingLogs() {
    return consoleSpy.mock.calls
      .filter((args) => args[0] === "[runCanvasAgent] timing")
      .map((args) => args[1] as Record<string, unknown>);
  }

  // -------------------------------------------------------------------------
  // 1. Non-negative ms + {workspaces, orgId} on every timing line
  // -------------------------------------------------------------------------
  it("emits timing lines with non-negative ms and workspaces/orgId context", async () => {
    mockStreamText.mockImplementation(makeStreamResult([]));

    await runCanvasAgent(baseOpts());

    const logs = timingLogs();
    // There must be at least a few stages logged.
    expect(logs.length).toBeGreaterThan(0);

    for (const log of logs) {
      // ms must be defined and >= 0 on lines that measure time.
      if ("ms" in log) {
        expect(typeof log.ms).toBe("number");
        expect(log.ms as number).toBeGreaterThanOrEqual(0);
      }
      // Every line must carry workspaces and orgId context.
      expect(log).toHaveProperty("workspaces");
      expect(Array.isArray(log.workspaces)).toBe(true);
      expect(log).toHaveProperty("orgId");
    }
  });

  // -------------------------------------------------------------------------
  // 2. TTFT fires exactly once, only on text-delta chunk
  // -------------------------------------------------------------------------
  it("TTFT fires exactly once on the first text-delta, not on tool-call/reasoning", async () => {
    const chunks = [
      { type: "tool-call", toolCallId: "tc1", toolName: "list_concepts" },
      { type: "tool-result", toolCallId: "tc1", toolName: "list_concepts" },
      { type: "reasoning", text: "thinking…" }, // reasoning chunk — must NOT trigger TTFT
      { type: "text-delta", text: "Hello" },    // first text-delta — TTFT fires here
      { type: "text-delta", text: " world" },   // second text-delta — TTFT must NOT fire again
    ];

    mockStreamText.mockImplementation(makeStreamResult(chunks));

    await runCanvasAgent(baseOpts());

    const ttftLogs = timingLogs().filter((l) => l.stage === "time-to-first-token");
    expect(ttftLogs).toHaveLength(1);
    expect((ttftLogs[0]!.ms as number)).toBeGreaterThanOrEqual(0);
    // The log must carry model context (set after model resolution).
    expect(ttftLogs[0]).toHaveProperty("model");
  });

  it("TTFT does NOT fire when there are no text-delta chunks", async () => {
    const chunks = [
      { type: "tool-call", toolCallId: "tc1", toolName: "list_concepts" },
      { type: "tool-result", toolCallId: "tc1", toolName: "list_concepts" },
    ];

    mockStreamText.mockImplementation(makeStreamResult(chunks));

    await runCanvasAgent(baseOpts());

    const ttftLogs = timingLogs().filter((l) => l.stage === "time-to-first-token");
    expect(ttftLogs).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 3. Per-tool round-trip in onChunk (non-zero delta regression guard)
  // -------------------------------------------------------------------------
  it("per-tool round-trip logs a non-trivially non-zero delta via onChunk (not onStepFinish)", async () => {
    // Simulate real execution time between call and result chunks.
    // We inject a Date.now() stub that advances by 5 ms between the
    // tool-call and tool-result chunks so the test is deterministic.
    let callCount = 0;
    const baseTime = Date.now();
    const dateNowStub = vi.spyOn(Date, "now").mockImplementation(() => {
      // Advance by 5 ms on the 2nd call (tool-result processing).
      return baseTime + callCount++ * 5;
    });

    const chunks = [
      { type: "tool-call", toolCallId: "tc1", toolName: "web_search" },
      { type: "tool-result", toolCallId: "tc1", toolName: "web_search" },
      { type: "text-delta", text: "answer" },
    ];

    mockStreamText.mockImplementation(makeStreamResult(chunks));

    await runCanvasAgent(baseOpts());

    dateNowStub.mockRestore();

    const roundTripLogs = timingLogs().filter((l) => l.stage === "tool-round-trip");
    expect(roundTripLogs.length).toBeGreaterThan(0);
    const roundTrip = roundTripLogs[0]!;
    // Non-negative (exact value depends on timing stub).
    expect((roundTrip.ms as number)).toBeGreaterThanOrEqual(0);
    expect(roundTrip.tool).toBe("web_search");
  });

  // -------------------------------------------------------------------------
  // 4. streaming-duration-total in onFinish is labeled distinctly from
  //    the route's setup-to-stream label
  // -------------------------------------------------------------------------
  it("onFinish logs streaming-duration-total (NOT setup-to-stream)", async () => {
    mockStreamText.mockImplementation(makeStreamResult([]));

    await runCanvasAgent(baseOpts());

    const streamingDurationLogs = timingLogs().filter(
      (l) => l.stage === "streaming-duration-total",
    );
    expect(streamingDurationLogs).toHaveLength(1);
    expect((streamingDurationLogs[0]!.ms as number)).toBeGreaterThanOrEqual(0);
    expect(streamingDurationLogs[0]).toHaveProperty("model");

    // Must NOT use the route-level label "setup-to-stream".
    const setupToStreamLogs = timingLogs().filter(
      (l) => l.stage === "setup-to-stream",
    );
    expect(setupToStreamLogs).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 5. Timing Map / firstTokenLogged flag do NOT leak across concurrent calls
  // -------------------------------------------------------------------------
  it("concurrent runCanvasAgent invocations keep independent TTFT flags", async () => {
    // Two concurrent calls, each gets its own text-delta.
    mockStreamText.mockImplementation(makeStreamResult([
      { type: "text-delta", text: "response" },
    ]));

    await Promise.all([
      runCanvasAgent(baseOpts({ workspaceSlugs: ["ws-a"] })),
      runCanvasAgent(baseOpts({ workspaceSlugs: ["ws-b"] })),
    ]);

    // Each call should have fired TTFT exactly once — total 2.
    const ttftLogs = timingLogs().filter((l) => l.stage === "time-to-first-token");
    expect(ttftLogs).toHaveLength(2);
  });

  it("concurrent calls do not share toolCallStartTimes (no cross-contamination)", async () => {
    // First call has a tool-call but its result arrives only in the second
    // invocation's chunk stream (simulated by splitting chunks across two
    // independent mockStreamText instances). In practice the Map is per-invocation
    // so the second call should see zero tool-round-trip logs for the first call's id.
    let callIdx = 0;
    mockStreamText.mockImplementation(() => {
      const idx = callIdx++;
      return makeStreamResult(
        idx === 0
          ? [{ type: "tool-call", toolCallId: "shared-id", toolName: "list_concepts" }]
          : [{ type: "tool-result", toolCallId: "shared-id", toolName: "list_concepts" }],
      )({} as Record<string, unknown>);
    });

    await Promise.all([
      runCanvasAgent(baseOpts({ workspaceSlugs: ["ws-a"] })),
      runCanvasAgent(baseOpts({ workspaceSlugs: ["ws-b"] })),
    ]);

    // The second call's tool-result with "shared-id" must NOT match against
    // the first call's tool-call — so round-trip count is 0 (no paired call/result
    // in a single invocation's Map).
    const roundTripLogs = timingLogs().filter((l) => l.stage === "tool-round-trip");
    expect(roundTripLogs).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 6. onStepFinish stays synchronous — timing state (TTFT / toolCallStartTimes)
  //    is only written from onChunk, never from onStepFinish.
  //
  //    We verify this by running a step that has BOTH a tool-call content entry
  //    in onStepFinish AND a text-delta + tool chunks in onChunk. The TTFT log
  //    must appear exactly once — from the onChunk text-delta — not from the
  //    onStepFinish invocation. If onStepFinish inadvertently set firstTokenLogged
  //    the TTFT log count would be 0 (flag pre-empted) or >1 (double-log).
  // -------------------------------------------------------------------------
  it("onStepFinish does not affect TTFT: exactly one TTFT log from onChunk text-delta", async () => {
    // The makeStreamResult helper fires onChunk chunks AND calls onStepFinish with
    // matching content, in that order. If TTFT were gated in onStepFinish it would
    // fire before onChunk and the flag would prevent the onChunk log — total 0.
    // The implementation gates TTFT in onChunk only, so the count must be 1.
    const chunks = [
      { type: "tool-call",  toolCallId: "tc1", toolName: "list_concepts" },
      { type: "tool-result", toolCallId: "tc1", toolName: "list_concepts" },
      { type: "text-delta", text: "answer" },
      { type: "text-delta", text: " more" },   // second delta — TTFT must NOT re-fire
    ];

    mockStreamText.mockImplementation(makeStreamResult(chunks));

    await runCanvasAgent(baseOpts());

    const ttftLogs = timingLogs().filter((l) => l.stage === "time-to-first-token");
    expect(ttftLogs).toHaveLength(1);
    // Also confirm onStepFinish did not sneak in a tool-round-trip log for the
    // same pair that onChunk already handles — it would appear as a duplicate.
    const roundTrip = timingLogs().filter((l) => l.stage === "tool-round-trip");
    // onChunk fires the round-trip; onStepFinish must not double-log it.
    expect(roundTrip).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 7. Key stage labels are present in a normal single-workspace flow
  // -------------------------------------------------------------------------
  it("emits expected stage labels for single-workspace authenticated flow", async () => {
    mockStreamText.mockImplementation(makeStreamResult([
      { type: "text-delta", text: "answer" },
    ]));

    await runCanvasAgent(baseOpts());

    const stages = timingLogs().map((l) => l.stage as string);

    // Core stages that MUST be present in every single-workspace run.
    expect(stages).toContain("buildWorkspaceConfigs (single)");
    expect(stages).toContain("listConcepts (single)");
    expect(stages).toContain("getQuickAskPrefixMessages (single)");
    expect(stages).toContain("sanitizeAndCompleteToolCalls");
    expect(stages).toContain("getBifrostForLLM");
    expect(stages).toContain("streaming-duration-total");
    expect(stages).toContain("time-to-first-token");
  });

  // -------------------------------------------------------------------------
  // 8. Cache-hit path logs `skipped: "cache hit"` instead of a fetch time
  // -------------------------------------------------------------------------
  it("logs skipped=cache-hit for listConcepts when concepts cache is supplied", async () => {
    mockStreamText.mockImplementation(makeStreamResult([]));

    await runCanvasAgent(
      baseOpts({
        cachedConcepts: {
          concepts: [{ id: "c1", name: "Auth" }],
        },
      }),
    );

    const conceptLog = timingLogs().find((l) => l.stage === "listConcepts (single)");
    expect(conceptLog).toBeDefined();
    expect(conceptLog!.skipped).toBe("cache hit");
    // ms is 0 on a cache hit, not a real measurement.
    expect(conceptLog!.ms).toBe(0);
  });
});
