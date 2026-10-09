/**
 * @vitest-environment jsdom
 *
 * Tests for the Pusher-driven live-PR nudge in useArtifactContent.ts.
 *
 * The 30s poll (tested in useArtifactContent-pr.test.tsx) is the backup;
 * `CANVAS_PR_UPDATED` on the org channel is what makes a merge/close/
 * reopen/check update show up immediately. The webhook payload carries no
 * PR data — only `{ repo, number }` — so the client just invalidates the
 * matching `canvas-pr-live` query, which refetches through the existing
 * per-viewer-token route.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { PUSHER_EVENTS } from "@/lib/pusher";

vi.mock(
  "@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel",
  () => ({ useChatOrgLogin: () => "acme-org" }),
);

// A controllable fake channel: capture every handler bound to
// CANVAS_PR_UPDATED so the test can fire it directly, and record
// unbind calls so the cleanup can be asserted.
const boundHandlers = new Map<string, Set<(payload: unknown) => void>>();
const mockChannel = {
  bind: vi.fn((event: string, handler: (payload: unknown) => void) => {
    if (!boundHandlers.has(event)) boundHandlers.set(event, new Set());
    boundHandlers.get(event)!.add(handler);
  }),
  unbind: vi.fn((event: string, handler: (payload: unknown) => void) => {
    boundHandlers.get(event)?.delete(handler);
  }),
};
function fireCanvasPrUpdated(payload: { repo: string; number: number }) {
  for (const handler of boundHandlers.get(PUSHER_EVENTS.CANVAS_PR_UPDATED) ?? []) {
    handler({ ...payload, at: Date.now() });
  }
}

vi.mock("@/hooks/usePusherChannel", () => ({
  usePusherChannel: vi.fn((name: string | null) => (name ? mockChannel : null)),
}));

const mockFetch = vi.fn();

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { Wrapper, qc };
}

function prRef(repo: string, number: number): ArtifactRef {
  return {
    id: `pr-${repo}-${number}`,
    kind: "pull_request",
    title: "My PR",
    source: {
      type: "inline",
      content: { url: `https://github.com/${repo}/pull/${number}`, repo, number, state: "open" },
    },
  };
}

beforeEach(() => {
  boundHandlers.clear();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useArtifactContent — CANVAS_PR_UPDATED live nudge", () => {
  it("refetches the matching PR query when the nudge lands", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ state: "open" }), { status: 200 }),
    );
    const { Wrapper } = wrapper();
    const { useArtifactContent } = await import(
      "@/app/org/[githubLogin]/_components/artifacts/useArtifactContent"
    );
    renderHook(() => useArtifactContent(prRef("acme/app", 7)), { wrapper: Wrapper });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ state: "merged" }), { status: 200 }),
    );
    act(() => {
      fireCanvasPrUpdated({ repo: "acme/app", number: 7 });
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  it("matches the repo case-insensitively (GitHub's full_name casing may differ from the ref's)", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ state: "open" }), { status: 200 }),
    );
    const { Wrapper } = wrapper();
    const { useArtifactContent } = await import(
      "@/app/org/[githubLogin]/_components/artifacts/useArtifactContent"
    );
    renderHook(() => useArtifactContent(prRef("acme/app", 7)), { wrapper: Wrapper });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ state: "merged" }), { status: 200 }),
    );
    act(() => {
      fireCanvasPrUpdated({ repo: "ACME/App", number: 7 });
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });

  it("ignores a nudge for a different repo/number — no refetch", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ state: "open" }), { status: 200 }),
    );
    const { Wrapper } = wrapper();
    const { useArtifactContent } = await import(
      "@/app/org/[githubLogin]/_components/artifacts/useArtifactContent"
    );
    renderHook(() => useArtifactContent(prRef("acme/app", 7)), { wrapper: Wrapper });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    act(() => {
      fireCanvasPrUpdated({ repo: "acme/other", number: 7 });
      fireCanvasPrUpdated({ repo: "acme/app", number: 99 });
    });

    // Give any stray refetch a chance to happen, then assert it didn't.
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("two viewers of different PRs: a nudge only refetches its own query", async () => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(new Response(JSON.stringify({ state: "open", url }), { status: 200 })),
    );
    const { Wrapper } = wrapper();
    const { useArtifactContent } = await import(
      "@/app/org/[githubLogin]/_components/artifacts/useArtifactContent"
    );
    renderHook(
      () => {
        useArtifactContent(prRef("acme/app", 7));
        useArtifactContent(prRef("acme/app", 8));
      },
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    act(() => {
      fireCanvasPrUpdated({ repo: "acme/app", number: 7 });
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
    // Only #7 refetched — #8 stays at its one initial fetch.
    const urls = mockFetch.mock.calls.map((c) => c[0] as string);
    expect(urls.filter((u) => u.includes("number=7"))).toHaveLength(2);
    expect(urls.filter((u) => u.includes("number=8"))).toHaveLength(1);
  });

  it("unbinds the handler on unmount", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ state: "open" }), { status: 200 }));
    const { Wrapper } = wrapper();
    const { useArtifactContent } = await import(
      "@/app/org/[githubLogin]/_components/artifacts/useArtifactContent"
    );
    const { unmount } = renderHook(() => useArtifactContent(prRef("acme/app", 7)), { wrapper: Wrapper });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(boundHandlers.get(PUSHER_EVENTS.CANVAS_PR_UPDATED)?.size).toBe(1);
    unmount();
    expect(boundHandlers.get(PUSHER_EVENTS.CANVAS_PR_UPDATED)?.size).toBe(0);
  });
});
