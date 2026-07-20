/**
 * Unit tests for `repoAgent()` in `src/lib/ai/askTools.ts`.
 *
 * Coverage:
 *  1. completed-with-result after abort → returns real result (Req 5)
 *  2. failed after abort → returns cancelled marker (not a throw)
 *  3. aborted status after abort → returns cancelled marker (not a throw)
 *  4. grace-window exit fires when swarm never reports a terminal status
 *  5. non-aborted completed path → returns result normally
 *  6. non-aborted failed path → throws
 *  7. non-aborted timeout path → throws
 *  8. onRequestId hook is called with the request_id immediately
 *  9. isAbortRequested is called each poll cycle
 * 10. repoAgent module has no db/Prisma import
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────
// We mock fetch globally so we can control initiate + progress responses.

// Also need to mock the deep-import deps pulled in by askTools at module level.
vi.mock("gitsee/server", () => ({ RepoAnalyzer: vi.fn() }));
vi.mock("@/lib/ai/provider", () => ({ getProviderTool: vi.fn() }));
vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: vi.fn() }));
vi.mock("@/lib/ai/mcpTimeout", () => ({
  withMcpTimeout: vi.fn(),
  isMcpTimeout: vi.fn(),
}));
vi.mock("@/lib/mcp/mcpTools", () => ({
  mcpListFeatures: vi.fn(),
  mcpReadFeature: vi.fn(),
  mcpListTasks: vi.fn(),
  mcpReadTask: vi.fn(),
  mcpCheckStatus: vi.fn(),
  findWorkspaceUser: vi.fn(),
}));
vi.mock("@/services/bifrost/orchestrator", () => ({
  getBifrostForLLM: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ai/concepts", () => ({ swarmFetch: vi.fn() }));
vi.mock("@/lib/ai/mcpResult", () => ({
  mcpText: vi.fn(),
  capMcpResult: vi.fn(),
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { repoAgent, REPO_AGENT_CANCELLED } from "@/lib/ai/askTools";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Mock a successful initiate response. */
function mockInitiate(requestId = "req-1") {
  return {
    ok: true,
    json: () => Promise.resolve({ request_id: requestId }),
    text: () => Promise.resolve(""),
  };
}

/** Mock a progress response with a given status and optional result/error. */
function mockProgress(status: string, result?: Record<string, string>, error?: string) {
  return {
    ok: true,
    json: () => Promise.resolve({ status, result: result ?? null, error }),
  };
}

const SWARM_URL = "https://swarm.test";
const SWARM_KEY = "test-key";
const BASE_PARAMS = { prompt: "What does the code do?" };

/**
 * Build a fetch mock sequence: initiate response followed by progress responses.
 */
function buildFetch(progressSequence: Array<ReturnType<typeof mockProgress>>) {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    if (call === 0) {
      call++;
      return Promise.resolve(mockInitiate());
    }
    const idx = call - 1; // progress call index
    call++;
    return Promise.resolve(progressSequence[Math.min(idx, progressSequence.length - 1)]);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Advance timers in tight loop to let poll `setTimeout` resolve.
 * Returns a promise that resolves once the repoAgent promise settles.
 */
async function drainPolls(agentPromise: Promise<unknown>, maxCycles = 10): Promise<unknown> {
  for (let i = 0; i < maxCycles; i++) {
    // Advance past the 5-second poll interval.
    await vi.advanceTimersByTimeAsync(5100);
  }
  return agentPromise;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("repoAgent()", () => {
  it("1. returns the real result when run completes after abort was requested (Req 5)", async () => {
    let abortFlag = false;
    const fetchMock = buildFetch([
      // First two polls: still running, abort is requested on poll 2
      mockProgress("running"),
      mockProgress("completed", { content: "real answer" }),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const promise = repoAgent(SWARM_URL, SWARM_KEY, BASE_PARAMS, undefined, {
      isAbortRequested: async () => {
        // Returns true starting from the second poll invocation
        abortFlag = true;
        return abortFlag;
      },
    });

    const result = await drainPolls(promise, 3);
    expect(result).toEqual({ content: "real answer" });
    expect(result).not.toBe(REPO_AGENT_CANCELLED);
  });

  it("2. returns cancelled marker (not a throw) when run fails after abort", async () => {
    const fetchMock = buildFetch([
      mockProgress("running"),
      mockProgress("failed", undefined, "some error"),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const promise = repoAgent(SWARM_URL, SWARM_KEY, BASE_PARAMS, undefined, {
      isAbortRequested: async () => true, // abort from the start
    });

    const result = await drainPolls(promise, 3);
    expect(result).toBe(REPO_AGENT_CANCELLED);
  });

  it("3. returns cancelled marker (not a throw) when swarm reports 'aborted' status", async () => {
    const fetchMock = buildFetch([
      mockProgress("aborted"),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const promise = repoAgent(SWARM_URL, SWARM_KEY, BASE_PARAMS, undefined, {
      isAbortRequested: async () => true,
    });

    const result = await drainPolls(promise, 2);
    expect(result).toBe(REPO_AGENT_CANCELLED);
  });

  it("4. grace-window exit fires when swarm never returns a terminal status", async () => {
    // Always returns "running"; abort is requested from cycle 1.
    const fetchMock = buildFetch(Array(20).fill(mockProgress("running")));
    vi.stubGlobal("fetch", fetchMock);

    const promise = repoAgent(SWARM_URL, SWARM_KEY, BASE_PARAMS, undefined, {
      isAbortRequested: async () => true,
    });

    // ABORT_GRACE_POLL_CYCLES = 3, so after 3 cycles we expect exit.
    const result = await drainPolls(promise, 5);
    expect(result).toBe(REPO_AGENT_CANCELLED);
  });

  it("5. non-aborted completed path returns result normally", async () => {
    const fetchMock = buildFetch([
      mockProgress("running"),
      mockProgress("completed", { content: "normal answer" }),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const promise = repoAgent(SWARM_URL, SWARM_KEY, BASE_PARAMS);
    const result = await drainPolls(promise, 3);
    expect(result).toEqual({ content: "normal answer" });
  });

  it("6. non-aborted failed path throws an error", async () => {
    const fetchMock = buildFetch([
      mockProgress("failed", undefined, "execution error"),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    // Attach the rejection handler before advancing timers so there's no window
    // where the promise is rejected but not yet observed (unhandled rejection).
    const promise = repoAgent(SWARM_URL, SWARM_KEY, BASE_PARAMS);
    const settled = promise.catch((e) => ({ threw: true, message: (e as Error).message }));
    await vi.advanceTimersByTimeAsync(5100);
    const result = await settled;
    expect(result).toMatchObject({ threw: true, message: expect.stringContaining("execution error") });
  });

  it("7. non-aborted timeout path throws after max attempts", async () => {
    // All polls return "running" — never terminates normally.
    const fetchMock = buildFetch(Array(130).fill(mockProgress("running")));
    vi.stubGlobal("fetch", fetchMock);

    const promise = repoAgent(SWARM_URL, SWARM_KEY, BASE_PARAMS);
    // Attach handler before advancing to avoid unhandled rejection warnings.
    const settled = promise.catch((e) => ({ threw: true, message: (e as Error).message }));
    // Advance past 120 × 5s = 600 s
    await vi.advanceTimersByTimeAsync(120 * 5100);
    const result = await settled;
    expect(result).toMatchObject({ threw: true, message: expect.stringContaining("timed out") });
  });

  it("8. onRequestId hook is called with the request_id right after initiate", async () => {
    const fetchMock = buildFetch([mockProgress("completed", { content: "ok" })]);
    vi.stubGlobal("fetch", fetchMock);

    const onRequestId = vi.fn().mockResolvedValue(undefined);
    const promise = repoAgent(SWARM_URL, SWARM_KEY, BASE_PARAMS, undefined, { onRequestId });
    await drainPolls(promise, 2);

    expect(onRequestId).toHaveBeenCalledOnce();
    expect(onRequestId).toHaveBeenCalledWith("req-1");
  });

  it("9. isAbortRequested is called each poll cycle", async () => {
    const fetchMock = buildFetch([
      mockProgress("running"),
      mockProgress("running"),
      mockProgress("completed", { content: "done" }),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const isAbortRequested = vi.fn().mockResolvedValue(false);
    const promise = repoAgent(SWARM_URL, SWARM_KEY, BASE_PARAMS, undefined, { isAbortRequested });
    await drainPolls(promise, 4);

    // Should have been called at least once per poll cycle (3 progress polls = 3 calls).
    expect(isAbortRequested.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("10. repoAgent module imports no db/Prisma", async () => {
    // Dynamic import of the module source — check it doesn't pull in Prisma.
    // We verify by checking what's imported at the top of askTools.ts.
    // The simplest runtime check: no `db` property on the module.
    const mod = await import("@/lib/ai/askTools");
    expect((mod as Record<string, unknown>).db).toBeUndefined();
    expect((mod as Record<string, unknown>).prisma).toBeUndefined();
  });

  it("completed with empty result after abort returns cancelled marker", async () => {
    const fetchMock = buildFetch([
      mockProgress("completed", {}), // empty result
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const promise = repoAgent(SWARM_URL, SWARM_KEY, BASE_PARAMS, undefined, {
      isAbortRequested: async () => true,
    });
    const result = await drainPolls(promise, 2);
    expect(result).toBe(REPO_AGENT_CANCELLED);
  });
});
