/**
 * @vitest-environment jsdom
 *
 * Tests for the live-PR-status polling in useArtifactContent.ts.
 *
 * Covers:
 *   - first paint: inline content shown immediately (no loading state)
 *   - poll started for any inline pull_request ref with a repo and number
 *   - live result overlaid on inline content (state, checks, branches, author)
 *   - polling stops (refetchInterval returns false) once state is merged/closed
 *   - on fetch error the inline content is kept (no "failed" status exposed)
 *   - a ref stamped with a job's ids (stored while the route needed them) polls the same, with nothing of the job on the URL
 *   - no change for non-pull_request inline refs
 *   - card + panel share the query key (single fetch)
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";

// ─── Mocks ──────────────────────────────────────────────────────────────────

// useChatOrgLogin always returns "acme-org" in tests.
vi.mock(
  "@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel",
  () => ({ useChatOrgLogin: () => "acme-org" }),
);

const mockFetch = vi.fn();

// ─── Helpers ────────────────────────────────────────────────────────────────

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { Wrapper, qc };
}

function prRef(overContent: Record<string, unknown> = {}): ArtifactRef {
  return {
    id: "pr-1",
    kind: "pull_request",
    title: "My PR",
    source: {
      type: "inline",
      content: {
        url: "https://github.com/acme/app/pull/7",
        repo: "acme/app",
        number: 7,
        state: "open",
        ...overContent,
      },
    },
  };
}

function markdownRef(): ArtifactRef {
  return {
    id: "md-1",
    kind: "markdown",
    title: "Plan",
    source: { type: "inline", content: { text: "# Plan" } },
  };
}

const LIVE = {
  state: "merged",
  title: "My PR",
  headSha: "sha",
  headBranch: "feat",
  baseBranch: "main",
  author: "alice",
  checks: [{ name: "CI", status: "success" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useArtifactContent — pull_request live polling", () => {
  it("shows inline content immediately (no loading state)", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify(LIVE), { status: 200 }));
    const { Wrapper } = wrapper();
    const { useArtifactContent } = await import(
      "@/app/org/[githubLogin]/_components/artifacts/useArtifactContent"
    );
    const { result } = renderHook(() => useArtifactContent(prRef()), { wrapper: Wrapper });
    // Immediately ready with the inline state.
    expect(result.current.status).toBe("ready");
    if (result.current.status === "ready") {
      // Pull_request-specific shape.
      const content = result.current.content as { state: string };
      expect(content.state).toBe("open"); // inline first-paint value
    }
  });

  it("overlays live result once fetch resolves", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(LIVE), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const { Wrapper } = wrapper();
    const { useArtifactContent } = await import(
      "@/app/org/[githubLogin]/_components/artifacts/useArtifactContent"
    );
    const { result } = renderHook(() => useArtifactContent(prRef()), { wrapper: Wrapper });

    await waitFor(() => {
      if (result.current.status !== "ready") return;
      const c = result.current.content as { state: string };
      expect(c.state).toBe("merged");
    });

    // Verify the fetch URL includes the correct query params.
    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).toContain("/api/orgs/acme-org/strut/pull-request");
    expect(url).toContain("repo=acme%2Fapp");
    expect(url).toContain("number=7");
  });

  it("live overlay includes checks, branches, author from live result", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(LIVE), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const { Wrapper } = wrapper();
    const { useArtifactContent } = await import(
      "@/app/org/[githubLogin]/_components/artifacts/useArtifactContent"
    );
    const { result } = renderHook(() => useArtifactContent(prRef()), { wrapper: Wrapper });

    await waitFor(() => {
      if (result.current.status !== "ready") return;
      const c = result.current.content as {
        state: string;
        author?: string;
        headBranch?: string;
        checks?: Array<{ name: string; status: string }>;
      };
      expect(c.author).toBe("alice");
      expect(c.headBranch).toBe("feat");
      expect(c.checks).toHaveLength(1);
      expect(c.checks![0]).toEqual({ name: "CI", status: "success" });
    });
  });

  it("on fetch error keeps inline content silently (no failed/unavailable status)", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));
    const { Wrapper } = wrapper();
    const { useArtifactContent } = await import(
      "@/app/org/[githubLogin]/_components/artifacts/useArtifactContent"
    );
    const { result } = renderHook(() => useArtifactContent(prRef()), { wrapper: Wrapper });

    // Wait a tick for the query to fail.
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    // Should stay "ready" with the inline state, not "failed".
    expect(result.current.status).toBe("ready");
    if (result.current.status === "ready") {
      const c = result.current.content as { state: string };
      expect(c.state).toBe("open");
    }
  });

  it("polls every 30 s while open, and stops once merged/closed or once a read has failed", async () => {
    const { prLivePollInterval } = await import(
      "@/app/org/[githubLogin]/_components/artifacts/useArtifactContent"
    );
    expect(prLivePollInterval({ status: "pending" })).toBe(30_000);
    expect(prLivePollInterval({ status: "success", data: { state: "open" } })).toBe(30_000);
    expect(prLivePollInterval({ status: "success", data: { state: "draft" } })).toBe(30_000);
    expect(prLivePollInterval({ status: "success", data: { state: "merged" } })).toBe(false);
    expect(prLivePollInterval({ status: "success", data: { state: "closed" } })).toBe(false);
    // A 403 (no GitHub token for the owner), a 404 (GitHub will not show the viewer the PR), a network error.
    expect(prLivePollInterval({ status: "error" })).toBe(false);
    expect(prLivePollInterval({ status: "error", data: { state: "open" } })).toBe(false);
  });

  it("a read that failed is not asked again on the interval", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: "Not found" }), { status: 404 }));
    const { Wrapper, qc } = wrapper();
    const { useArtifactContent } = await import(
      "@/app/org/[githubLogin]/_components/artifacts/useArtifactContent"
    );
    renderHook(() => useArtifactContent(prRef()), { wrapper: Wrapper });
    await waitFor(() => expect(qc.getQueryCache().getAll()[0]?.state.status).toBe("error"));
    const query = qc.getQueryCache().getAll()[0];
    const observer = query.observers[0] as unknown as { options: { refetchInterval: (q: unknown) => number | false } };
    expect(observer.options.refetchInterval(query)).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("a ref stamped with a job's ids polls like any other, and nothing of the job goes on the URL", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(LIVE), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const { Wrapper } = wrapper();
    const { useArtifactContent } = await import(
      "@/app/org/[githubLogin]/_components/artifacts/useArtifactContent"
    );
    // Stored while the route needed the job: the extra fields are ignored.
    const ref = prRef({ jobId: "job-abc", swarmId: "swarm-1" });
    const { result } = renderHook(() => useArtifactContent(ref), { wrapper: Wrapper });
    await waitFor(() => {
      if (result.current.status !== "ready") return;
      expect((result.current.content as { state: string }).state).toBe("merged");
    });
    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).not.toContain("jobId");
    expect(url).not.toContain("swarmId");
  });

  it("does NOT poll when kind is not pull_request", async () => {
    const { Wrapper } = wrapper();
    const { useArtifactContent } = await import(
      "@/app/org/[githubLogin]/_components/artifacts/useArtifactContent"
    );
    const { result } = renderHook(() => useArtifactContent(markdownRef()), { wrapper: Wrapper });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.status).toBe("ready");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("card and panel share the query key — single fetch for two hooks", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(LIVE), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const { Wrapper } = wrapper();
    const { useArtifactContent } = await import(
      "@/app/org/[githubLogin]/_components/artifacts/useArtifactContent"
    );
    const ref = prRef();
    // Two hooks with the same ref — share the same QueryClient via Wrapper.
    renderHook(
      () => {
        const r1 = useArtifactContent(ref);
        const r2 = useArtifactContent(ref);
        return { r1, r2 };
      },
      { wrapper: Wrapper },
    );

    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    // Only one network request should be made despite two hook calls.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
