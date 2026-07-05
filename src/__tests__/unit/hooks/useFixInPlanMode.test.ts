/**
 * Unit/interaction tests for useFixInPlanMode hook
 *
 * Covers:
 * - Happy path: fetches blob, creates feature, seeds chat with selectedRepositoryIds, opens tab
 * - Blob-fetch failure → still creates plan (graceful fallback, no frames)
 * - null repositoryId → omits selectedRepositoryIds entirely
 * - /api/features failure → toast.error, no tab opened
 * - /api/features/[id]/chat failure → toast.error, no tab opened
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFixInPlanMode } from "@/app/w/[slug]/errors/[issueId]/useFixInPlanMode";
import type { ErrorIssueDetailResponse } from "@/types/error-issues";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockToastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => mockToastError(...args) } }));

const mockWindowOpen = vi.fn();
Object.defineProperty(window, "open", { value: mockWindowOpen, writable: true });

// ── Fixtures ───────────────────────────────────────────────────────────────────

const baseDetail: ErrorIssueDetailResponse = {
  issue: {
    id: "issue-1",
    workspaceId: "ws-1",
    repositoryId: "repo-1",
    repoKey: "acme/api",
    fingerprint: "abc123",
    exceptionType: "NoMethodError",
    title: "undefined method 'foo'",
    status: "UNRESOLVED",
    occurrenceCount: 3,
    firstSeenAt: "2024-01-01T00:00:00Z",
    lastSeenAt: "2024-01-02T00:00:00Z",
    environment: "production",
    release: "v1.0.0",
    metadata: null,
    kgRefId: null,
      correlatedPrNumber: null,
      correlatedPrUrl: null,
      correlatedCommitSha: null,
      correlationConfidence: null,
      correlationComputedAt: null,
      correlationCandidates: null,
  },
  events: [
    {
      id: "event-1",
      issueId: "issue-1",
      workspaceId: "ws-1",
      repositoryId: "repo-1",
      repoKey: "acme/api",
      exceptionType: "NoMethodError",
      message: "undefined method 'foo' for nil",
      environment: "production",
      release: "v1.0.0",
      fingerprint: "abc123",
      commitSha: "deadbeef",
      repositoryUrl: "https://github.com/acme/api",
      defaultBranch: "main",
      createdAt: "2024-01-02T00:00:00Z",
    },
  ],
  eventsTotal: 1,
  eventsHasMore: false,
};

const blobPayload = JSON.stringify({
  stackTrace: "NoMethodError\n  app/models/user.rb:42:in 'save'",
  frames: [{ filename: "app/models/user.rb", function: "save", lineno: 42, inApp: true }],
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFetch(overrides: Record<string, { ok: boolean; body?: unknown; text?: string }> = {}) {
  return vi.fn((url: string) => {
    for (const [pattern, response] of Object.entries(overrides)) {
      if (url.includes(pattern)) {
        return Promise.resolve({
          ok: response.ok,
          json: () => Promise.resolve(response.body ?? {}),
          text: () => Promise.resolve(response.text ?? ""),
          status: response.ok ? 200 : 500,
        });
      }
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve(""), status: 200 });
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("useFixInPlanMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: fetches blob, creates feature, seeds chat, opens new tab", async () => {
    const fetchMock = makeFetch({
      "/blob": { ok: true, text: blobPayload },
      "/api/features\"": { ok: true, body: { data: { id: "feat-1" } } },
      "/api/features/feat-1/chat": { ok: true, body: {} },
    });

    // More precise: order-based fetch mock
    let callCount = 0;
    const orderedFetch = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        // blob fetch
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve(blobPayload), status: 200 });
      }
      if (callCount === 2) {
        // POST /api/features
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { id: "feat-1" } }), text: () => Promise.resolve(""), status: 200 });
      }
      if (callCount === 3) {
        // POST /api/features/feat-1/chat
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve(""), status: 200 });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve(""), status: 200 });
    });
    vi.stubGlobal("fetch", orderedFetch);

    const { result } = renderHook(() => useFixInPlanMode(baseDetail, "my-workspace"));

    await act(async () => {
      await result.current.launch();
    });

    // Should have made 3 calls: blob, create feature, seed chat
    expect(orderedFetch).toHaveBeenCalledTimes(3);

    const allCalls = orderedFetch.mock.calls as unknown as Array<[string, RequestInit]>;

    // First call: blob
    expect(allCalls[0][0]).toContain("/blob");

    // Second call: POST /api/features
    expect(allCalls[1][0]).toBe("/api/features");
    const featureBody = JSON.parse(allCalls[1][1].body as string);
    expect(featureBody.title).toMatch(/^Fix:/);
    expect(featureBody.title.length).toBeLessThanOrEqual(100);
    expect(featureBody.workspaceId).toBe("ws-1");

    // Third call: POST /api/features/feat-1/chat with selectedRepositoryIds
    expect(allCalls[2][0]).toBe("/api/features/feat-1/chat");
    const chatBody = JSON.parse(allCalls[2][1].body as string);
    expect(chatBody.selectedRepositoryIds).toEqual(["repo-1"]);
    expect(chatBody.message).toContain("NoMethodError");

    // Should open new tab
    expect(mockWindowOpen).toHaveBeenCalledWith("/w/my-workspace/plan/feat-1", "_blank", "noopener,noreferrer");
    // No toast error
    expect(mockToastError).not.toHaveBeenCalled();
    // isLaunching should be false after completion
    expect(result.current.isLaunching).toBe(false);
  });

  it("blob-fetch failure → still creates plan without frames, no throw", async () => {
    let callCount = 0;
    const fetchMock = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        // blob fetch fails
        return Promise.reject(new Error("network error"));
      }
      if (callCount === 2) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { id: "feat-2" } }), text: () => Promise.resolve(""), status: 200 });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve(""), status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFixInPlanMode(baseDetail, "my-workspace"));

    await act(async () => {
      await result.current.launch();
    });

    // Feature was still created
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // No toast error
    expect(mockToastError).not.toHaveBeenCalled();
    // Tab opened
    expect(mockWindowOpen).toHaveBeenCalledWith("/w/my-workspace/plan/feat-2", "_blank", "noopener,noreferrer");
  });

  it("null repositoryId → omits selectedRepositoryIds from chat body", async () => {
    const detailNoRepo: ErrorIssueDetailResponse = {
      ...baseDetail,
      issue: { ...baseDetail.issue, repositoryId: null },
    };

    let callCount = 0;
    let chatBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ ok: true, text: () => Promise.resolve(""), json: () => Promise.resolve({}), status: 200 });
      if (callCount === 2) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { id: "feat-3" } }), text: () => Promise.resolve(""), status: 200 });
      if (callCount === 3) {
        // capture chat body
        return {
          then: () => {},
          ok: true,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve(""),
          status: 200,
        };
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve(""), status: 200 });
    });

    // Use a cleaner approach
    const calls: Array<[string, RequestInit]> = [];
    const cleanFetch = vi.fn((url: string, init?: RequestInit) => {
      calls.push([url, init ?? {}]);
      const n = calls.length;
      if (n === 1) return Promise.resolve({ ok: true, text: () => Promise.resolve(""), json: () => Promise.resolve({}), status: 200 });
      if (n === 2) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { id: "feat-3" } }), text: () => Promise.resolve(""), status: 200 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve(""), status: 200 });
    });
    vi.stubGlobal("fetch", cleanFetch);

    const { result } = renderHook(() => useFixInPlanMode(detailNoRepo, "my-workspace"));

    await act(async () => {
      await result.current.launch();
    });

    // Third call is the chat
    chatBody = JSON.parse(calls[2][1].body as string);
    expect(chatBody).not.toHaveProperty("selectedRepositoryIds");
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("/api/features failure → toast.error and no tab opened", async () => {
    let callCount = 0;
    const fetchMock = vi.fn(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ ok: true, text: () => Promise.resolve(""), json: () => Promise.resolve({}), status: 200 });
      if (callCount === 2) return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "server error" }), text: () => Promise.resolve(""), status: 500 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve(""), status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFixInPlanMode(baseDetail, "my-workspace"));

    await act(async () => {
      await result.current.launch();
    });

    expect(mockToastError).toHaveBeenCalled();
    expect(mockWindowOpen).not.toHaveBeenCalled();
    expect(result.current.isLaunching).toBe(false);
  });

  it("/api/features/chat failure → toast.error and no tab opened", async () => {
    let callCount = 0;
    const fetchMock = vi.fn(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ ok: true, text: () => Promise.resolve(""), json: () => Promise.resolve({}), status: 200 });
      if (callCount === 2) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { id: "feat-5" } }), text: () => Promise.resolve(""), status: 200 });
      if (callCount === 3) return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "bad request" }), text: () => Promise.resolve(""), status: 400 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve(""), status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFixInPlanMode(baseDetail, "my-workspace"));

    await act(async () => {
      await result.current.launch();
    });

    expect(mockToastError).toHaveBeenCalled();
    expect(mockWindowOpen).not.toHaveBeenCalled();
    expect(result.current.isLaunching).toBe(false);
  });
});
