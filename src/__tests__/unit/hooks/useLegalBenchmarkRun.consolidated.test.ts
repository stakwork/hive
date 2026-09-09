/**
 * @vitest-environment jsdom
 *
 * Tests for useLegalBenchmarkRun:
 *  1. null runId — no-op: isLoading=false, run=null, no fetch, no Pusher sub
 *  2. the fetched row — LEGAL_BENCHMARK_RUNNER query shape and hasReport mapping
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useLegalBenchmarkRun } from "@/hooks/useLegalBenchmarkRun";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockChannel = {
  bind: vi.fn(),
  unbind: vi.fn(),
};

const mockPusherClient = {
  subscribe: vi.fn(() => mockChannel),
  unsubscribe: vi.fn(),
};

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(() => ({
    workspace: { id: "workspace-123", slug: "openlaw" },
  })),
}));

vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(() => mockPusherClient),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    STAKWORK_RUN_UPDATE: "stakwork-run-update",
  },
}));

global.fetch = vi.fn();

const MOCK_ROW = {
  id: "run-xyz",
  workspaceId: "workspace-123",
  type: "LEGAL_BENCHMARK_RUNNER",
  status: "COMPLETED",
  projectId: null,
  result: JSON.stringify({
    taskSlug: "antitrust/task-1",
    taskTitle: "Analyze Antitrust Strategy",
    hasReport: true,
  }),
  hasReport: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function setupFetch(overrides: Partial<typeof MOCK_ROW> = {}) {
  vi.mocked(global.fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ runs: [{ ...MOCK_ROW, ...overrides }] }),
  } as Response);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useLegalBenchmarkRun — null runId (no-op state)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns isLoading=false immediately when runId is null", () => {
    const { result } = renderHook(() => useLegalBenchmarkRun(null));
    // Synchronous — no async needed
    expect(result.current.isLoading).toBe(false);
    expect(result.current.run).toBeNull();
  });

  it("does not call fetch when runId is null", async () => {
    renderHook(() => useLegalBenchmarkRun(null));
    // Wait a tick to confirm no async fetch was started
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not subscribe to Pusher when runId is null", async () => {
    renderHook(() => useLegalBenchmarkRun(null));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(mockChannel.bind).not.toHaveBeenCalled();
  });

  it("starts fetching and subscribes when runId transitions from null to a real id", async () => {
    let runId: string | null = null;
    const { result, rerender } = renderHook(() => useLegalBenchmarkRun(runId));

    // Initially null — no fetch
    expect(result.current.isLoading).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();

    // Now provide a real id
    runId = "run-xyz";
    setupFetch();
    rerender();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(global.fetch).toHaveBeenCalledOnce();
    expect(result.current.run?.id).toBe("run-xyz");
  });
});

describe("useLegalBenchmarkRun — fetched row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFetch();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("queries LEGAL_BENCHMARK_RUNNER rows for the workspace with results included", async () => {
    renderHook(() => useLegalBenchmarkRun("run-xyz"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledOnce();
    });

    const url = String(vi.mocked(global.fetch).mock.calls[0][0]);
    expect(url).toContain("type=LEGAL_BENCHMARK_RUNNER");
    expect(url).toContain("workspace-123");
    expect(url).toContain("includeResult=true");
  });

  it("resolves hasReport correctly from the fetched row", async () => {
    setupFetch({ hasReport: true, status: "COMPLETED" });

    const { result } = renderHook(() => useLegalBenchmarkRun("run-xyz"));

    await waitFor(() => {
      expect(result.current.run).not.toBeNull();
    });

    expect(result.current.run?.hasReport).toBe(true);
    expect(result.current.run?.status).toBe("complete");
  });
});
