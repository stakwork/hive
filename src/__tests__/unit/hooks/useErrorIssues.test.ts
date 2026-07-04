/**
 * Unit tests for useErrorIssues hook
 *
 * Covers:
 * - Initial fetch from GET /api/errors
 * - Merge-in-place on Pusher update (existing issue, isNew: false)
 * - Refetch on isNew: true (new issue, payload has no title/exceptionType)
 * - Refetch on unknown id + isNew: false
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// ── Pusher mock ───────────────────────────────────────────────────────────────
const mockBind = vi.fn();
const mockUnbind = vi.fn();
const mockChannel = { bind: mockBind, unbind: mockUnbind };
const mockPusherClient = {
  subscribe: vi.fn(() => mockChannel),
  unsubscribe: vi.fn(),
};

vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(() => mockPusherClient),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    ERROR_ISSUE_UPDATED: "error-issue-updated",
  },
}));

// Enable Pusher so the subscription branch is exercised
beforeEach(() => {
  process.env.NEXT_PUBLIC_PUSHER_KEY = "test-pusher-key";
});

// ── fetch mock ────────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// ── hook under test ───────────────────────────────────────────────────────────
import { useErrorIssues } from "@/hooks/useErrorIssues";
import type { ErrorIssueUpdatedPayload } from "@/types/error-issues";

function makeIssue(id: string, overrides?: object) {
  return {
    id,
    workspaceId: "ws-1",
    repositoryId: "repo-1",
    repoKey: "hive",
    fingerprint: `fp-${id}`,
    exceptionType: "TypeError",
    title: `Error ${id}`,
    status: "UNRESOLVED",
    occurrenceCount: 1,
    firstSeenAt: "2026-05-01T00:00:00Z",
    lastSeenAt: "2026-05-01T00:00:00Z",
    environment: "production",
    release: "1.0.0",
    metadata: null,
    kgRefId: null,
    ...overrides,
  };
}

function makeListResponse(issues: ReturnType<typeof makeIssue>[]) {
  return {
    ok: true,
    json: async () => ({ issues, total: issues.length, hasMore: false }),
  };
}

function getPusherHandler(): ((payload: ErrorIssueUpdatedPayload) => void) | undefined {
  const calls = mockBind.mock.calls as Array<[string, (p: ErrorIssueUpdatedPayload) => void]>;
  return calls.find(([event]) => event === "error-issue-updated")?.[1];
}

const DEFAULT_PARAMS = { workspaceId: "ws-1", slug: "my-workspace" };

describe("useErrorIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches issues on mount and exposes them", async () => {
    mockFetch.mockResolvedValueOnce(makeListResponse([makeIssue("a"), makeIssue("b")]));

    const { result } = renderHook(() => useErrorIssues(DEFAULT_PARAMS));

    // Loading initially
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.issues).toHaveLength(2);
    expect(result.current.issues[0].id).toBe("a");
    expect(result.current.issues[1].id).toBe("b");
    expect(result.current.total).toBe(2);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("builds the correct query string with filters", async () => {
    mockFetch.mockResolvedValueOnce(makeListResponse([]));

    renderHook(() =>
      useErrorIssues({ ...DEFAULT_PARAMS, status: "RESOLVED", repoKey: "hive", skip: 20, limit: 10 }),
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("workspace_id=ws-1");
    expect(url).toContain("status=RESOLVED");
    expect(url).toContain("repoKey=hive");
    expect(url).toContain("skip=20");
    expect(url).toContain("limit=10");
  });

  it("sets error state on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });

    const { result } = renderHook(() => useErrorIssues(DEFAULT_PARAMS));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch error issues");
    expect(result.current.issues).toHaveLength(0);
  });

  it("merges occurrenceCount/status/lastSeenAt in-place for an existing issue (isNew: false)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeListResponse([makeIssue("a", { occurrenceCount: 1, status: "UNRESOLVED" })]),
    );

    const { result } = renderHook(() => useErrorIssues(DEFAULT_PARAMS));
    await waitFor(() => expect(result.current.issues).toHaveLength(1));

    const handler = getPusherHandler();
    expect(handler).toBeDefined();

    act(() => {
      handler!({
        id: "a",
        repositoryId: "repo-1",
        fingerprint: "fp-a",
        isNew: false,
        occurrenceCount: 5,
        status: "RESOLVED",
        lastSeenAt: "2026-06-01T00:00:00Z",
      });
    });

    expect(result.current.issues[0].occurrenceCount).toBe(5);
    expect(result.current.issues[0].status).toBe("RESOLVED");
    expect(result.current.issues[0].lastSeenAt).toBe("2026-06-01T00:00:00Z");
    // Title / exceptionType unchanged
    expect(result.current.issues[0].title).toBe("Error a");
  });

  it("refetches when isNew: true (new issue payload has no full data)", async () => {
    const firstIssues = [makeIssue("a")];
    const secondIssues = [makeIssue("a"), makeIssue("b")];

    mockFetch
      .mockResolvedValueOnce(makeListResponse(firstIssues))
      .mockResolvedValueOnce(makeListResponse(secondIssues));

    const { result } = renderHook(() => useErrorIssues(DEFAULT_PARAMS));
    await waitFor(() => expect(result.current.issues).toHaveLength(1));

    const handler = getPusherHandler();

    act(() => {
      handler!({
        id: "b",
        repositoryId: null,
        fingerprint: "fp-b",
        isNew: true,
        occurrenceCount: 1,
        status: "UNRESOLVED",
        lastSeenAt: "2026-06-01T00:00:00Z",
      });
    });

    await waitFor(() => expect(result.current.issues).toHaveLength(2));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("refetches when isNew: false but id is not in local state", async () => {
    mockFetch
      .mockResolvedValueOnce(makeListResponse([makeIssue("a")]))
      .mockResolvedValueOnce(makeListResponse([makeIssue("a"), makeIssue("unknown-id")]));

    const { result } = renderHook(() => useErrorIssues(DEFAULT_PARAMS));
    await waitFor(() => expect(result.current.issues).toHaveLength(1));

    const handler = getPusherHandler();

    act(() => {
      handler!({
        id: "unknown-id",
        repositoryId: null,
        fingerprint: "fp-unknown",
        isNew: false,
        occurrenceCount: 3,
        status: "UNRESOLVED",
        lastSeenAt: "2026-06-01T00:00:00Z",
      });
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  it("exposes a refetch function that re-requests the API", async () => {
    mockFetch
      .mockResolvedValueOnce(makeListResponse([makeIssue("a")]))
      .mockResolvedValueOnce(makeListResponse([makeIssue("a"), makeIssue("b")]));

    const { result } = renderHook(() => useErrorIssues(DEFAULT_PARAMS));
    await waitFor(() => expect(result.current.issues).toHaveLength(1));

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.issues).toHaveLength(2));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("omits status param when no status is provided (relies on backend active-only default)", async () => {
    mockFetch.mockResolvedValueOnce(makeListResponse([]));

    renderHook(() => useErrorIssues(DEFAULT_PARAMS));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).not.toContain("status=");
  });

  it("sends status=all when status is 'all'", async () => {
    mockFetch.mockResolvedValueOnce(makeListResponse([]));

    renderHook(() => useErrorIssues({ ...DEFAULT_PARAMS, status: "all" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("status=all");
  });

  it("sends sort=impact when sort param is 'impact'", async () => {
    mockFetch.mockResolvedValueOnce(makeListResponse([]));

    renderHook(() => useErrorIssues({ ...DEFAULT_PARAMS, sort: "impact" }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("sort=impact");
  });

  it("Pusher merge does not clobber impactScore/impactMeta on existing issue", async () => {
    mockFetch.mockResolvedValueOnce(
      makeListResponse([
        makeIssue("a", {
          occurrenceCount: 1,
          status: "UNRESOLVED",
          // Simulate a scored issue
          impactScore: 0.75,
          impactScoredAt: "2026-06-01T00:00:00Z",
          impactMeta: { topNodeName: "src/core/auth.ts" },
        }),
      ]),
    );

    const { result } = renderHook(() => useErrorIssues(DEFAULT_PARAMS));
    await waitFor(() => expect(result.current.issues).toHaveLength(1));

    const handler = getPusherHandler();
    expect(handler).toBeDefined();

    act(() => {
      handler!({
        id: "a",
        repositoryId: "repo-1",
        fingerprint: "fp-a",
        isNew: false,
        occurrenceCount: 10,
        status: "RESOLVED",
        lastSeenAt: "2026-07-01T00:00:00Z",
      });
    });

    // Pusher-updated fields are merged
    expect(result.current.issues[0].occurrenceCount).toBe(10);
    expect(result.current.issues[0].status).toBe("RESOLVED");
    expect(result.current.issues[0].lastSeenAt).toBe("2026-07-01T00:00:00Z");

    // Impact fields must NOT be clobbered (payload doesn't carry them)
    expect((result.current.issues[0] as any).impactScore).toBe(0.75);
    expect((result.current.issues[0] as any).impactMeta).toEqual({ topNodeName: "src/core/auth.ts" });
  });
});
