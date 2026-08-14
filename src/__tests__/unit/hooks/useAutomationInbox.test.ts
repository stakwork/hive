/**
 * Unit tests for useAutomationInbox hook
 *
 * Covers:
 * 1. Returns count/runs from inbox fetch on mount
 * 2. openRun: chatReady=false → no-op (no fetch calls)
 * 3. openRun: success path — both openServerConversation + seen POST succeed → run removed
 * 4. openRun: openServerConversation fails → run stays, seen POST never called
 * 5. openRun: seen POST fails → run stays (console.warn emitted)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAutomationInbox, type InboxRun } from "@/app/org/[githubLogin]/_state/useAutomationInbox";

// ── Mock canvasChatStore ──────────────────────────────────────────────────────
// vi.mock factories are hoisted before variable declarations, so we use
// vi.hoisted() to create the mocks before the factory runs.

const { mockStartConversation, mockSetServerConversationId } = vi.hoisted(() => ({
  mockStartConversation: vi.fn(() => "local-conv-id"),
  mockSetServerConversationId: vi.fn(),
}));

vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => {
  // openServerConversation calls useCanvasChatStore.getState() as a static
  // method on the Zustand store — the hook selector pattern alone is not enough.
  const storeState = {
    activeConversationId: null,
    conversations: {},
    startConversation: mockStartConversation,
    setServerConversationId: mockSetServerConversationId,
  };
  const useCanvasChatStore = Object.assign(
    (selector: (s: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState },
  );
  return { useCanvasChatStore };
});

// ── Mock fetch ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_GITHUB_LOGIN = "test-org";

function makeRun(overrides: Partial<InboxRun> = {}): InboxRun {
  return {
    automationId: "auto-1",
    automationName: "Daily Standup",
    conversationId: "conv-abc",
    lastRunAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeInboxResponse(runs: InboxRun[]) {
  return {
    ok: true,
    json: async () => ({ count: runs.length, runs }),
  } as Response;
}

function makeConvResponse() {
  return {
    ok: true,
    json: async () => ({
      messages: [
        { role: "user", content: "Hello", id: "m1", timestamp: new Date().toISOString() },
      ],
      settings: { extraWorkspaceSlugs: [] },
    }),
  } as Response;
}

function makeSeenResponse(ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => (ok ? { ok: true } : { error: "Not found" }),
  } as Response;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useAutomationInbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches inbox on mount and populates count/runs", async () => {
    const run = makeRun();
    mockFetch.mockResolvedValueOnce(makeInboxResponse([run]));

    const { result } = renderHook(() =>
      useAutomationInbox(TEST_GITHUB_LOGIN, { chatReady: true }),
    );

    await waitFor(() => expect(result.current.count).toBe(1));
    expect(result.current.runs).toHaveLength(1);
    expect(result.current.runs[0].automationId).toBe("auto-1");
  });

  it("returns count=0 and empty runs initially and after empty inbox response", async () => {
    mockFetch.mockResolvedValueOnce(makeInboxResponse([]));

    const { result } = renderHook(() =>
      useAutomationInbox(TEST_GITHUB_LOGIN, { chatReady: true }),
    );

    // Initial synchronous state
    expect(result.current.count).toBe(0);
    expect(result.current.runs).toEqual([]);

    await waitFor(() => {
      // After fetch resolves, still 0
      expect(result.current.count).toBe(0);
    });
  });

  describe("openRun", () => {
    it("is a no-op when chatReady=false — no fetch calls beyond inbox", async () => {
      const run = makeRun();
      // inbox fetch
      mockFetch.mockResolvedValueOnce(makeInboxResponse([run]));

      const { result } = renderHook(() =>
        useAutomationInbox(TEST_GITHUB_LOGIN, { chatReady: false }),
      );

      await waitFor(() => expect(result.current.count).toBe(1));

      // Clear call count — only inbox GET should have been called
      const callsBefore = mockFetch.mock.calls.length;

      await act(async () => {
        await result.current.openRun(run);
      });

      // No additional fetch calls
      expect(mockFetch.mock.calls.length).toBe(callsBefore);
      // Run still in list
      expect(result.current.count).toBe(1);
    });

    it("success path: decrements count only after BOTH calls succeed", async () => {
      const run = makeRun();
      mockFetch
        .mockResolvedValueOnce(makeInboxResponse([run])) // inbox GET
        .mockResolvedValueOnce(makeConvResponse())        // conv GET
        .mockResolvedValueOnce(makeSeenResponse(true));   // seen POST

      const { result } = renderHook(() =>
        useAutomationInbox(TEST_GITHUB_LOGIN, { chatReady: true }),
      );

      await waitFor(() => expect(result.current.count).toBe(1));

      await act(async () => {
        await result.current.openRun(run);
      });

      expect(result.current.count).toBe(0);
      expect(result.current.runs).toHaveLength(0);
    });

    it("failure path A: openServerConversation fails → run stays, seen never called", async () => {
      const run = makeRun();
      mockFetch
        .mockResolvedValueOnce(makeInboxResponse([run])) // inbox GET
        .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as Response); // conv GET fails

      const { result } = renderHook(() =>
        useAutomationInbox(TEST_GITHUB_LOGIN, { chatReady: true }),
      );

      await waitFor(() => expect(result.current.count).toBe(1));

      const callsBefore = mockFetch.mock.calls.length;

      await act(async () => {
        await result.current.openRun(run);
      });

      // Run stays
      expect(result.current.count).toBe(1);
      // seen POST should NOT have been called
      const seenCalls = mockFetch.mock.calls
        .slice(callsBefore)
        .filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");
      expect(seenCalls).toHaveLength(0);
    });

    it("failure path B: seen POST fails → run stays and console.warn is emitted", async () => {
      const run = makeRun();
      mockFetch
        .mockResolvedValueOnce(makeInboxResponse([run])) // inbox GET
        .mockResolvedValueOnce(makeConvResponse())        // conv GET succeeds
        .mockResolvedValueOnce(makeSeenResponse(false, 404)); // seen POST fails

      const { result } = renderHook(() =>
        useAutomationInbox(TEST_GITHUB_LOGIN, { chatReady: true }),
      );

      await waitFor(() => expect(result.current.count).toBe(1));

      await act(async () => {
        await result.current.openRun(run);
      });

      // Run stays — don't optimistically remove it
      expect(result.current.count).toBe(1);
      // A console.warn should have been emitted for the state-integrity gap
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("openRun"),
        expect.anything(),
      );
    });

    it("failure path C: seen POST throws → run stays and console.warn is emitted", async () => {
      const run = makeRun();
      mockFetch
        .mockResolvedValueOnce(makeInboxResponse([run])) // inbox GET
        .mockResolvedValueOnce(makeConvResponse())        // conv GET succeeds
        .mockRejectedValueOnce(new Error("Network error")); // seen POST throws

      const { result } = renderHook(() =>
        useAutomationInbox(TEST_GITHUB_LOGIN, { chatReady: true }),
      );

      await waitFor(() => expect(result.current.count).toBe(1));

      await act(async () => {
        await result.current.openRun(run);
      });

      expect(result.current.count).toBe(1);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("openRun"),
        expect.anything(),
      );
    });

    it("only removes the opened run — others remain in the list", async () => {
      const run1 = makeRun({ automationId: "auto-1", conversationId: "conv-1" });
      const run2 = makeRun({ automationId: "auto-2", conversationId: "conv-2" });
      mockFetch
        .mockResolvedValueOnce(makeInboxResponse([run1, run2])) // inbox GET
        .mockResolvedValueOnce(makeConvResponse())               // conv GET for run1
        .mockResolvedValueOnce(makeSeenResponse(true));          // seen POST for run1

      const { result } = renderHook(() =>
        useAutomationInbox(TEST_GITHUB_LOGIN, { chatReady: true }),
      );

      await waitFor(() => expect(result.current.count).toBe(2));

      await act(async () => {
        await result.current.openRun(run1);
      });

      expect(result.current.count).toBe(1);
      expect(result.current.runs[0].automationId).toBe("auto-2");
    });
  });
});
