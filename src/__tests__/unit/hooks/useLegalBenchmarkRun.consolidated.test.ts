/**
 * @vitest-environment jsdom
 *
 * Tests for the additions made to useLegalBenchmarkRun:
 *  1. null runId — no-op: isLoading=false, run=null, no fetch, no Pusher sub
 *  2. optional runType param — fetch URL contains the overridden type value;
 *     default remains LEGAL_BENCHMARK_RUNNER.
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useLegalBenchmarkRun } from "@/hooks/useLegalBenchmarkRun";
import { StakworkRunType } from "@prisma/client";

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

describe("useLegalBenchmarkRun — optional runType param", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFetch();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to LEGAL_BENCHMARK_RUNNER type in fetch URL", async () => {
    renderHook(() => useLegalBenchmarkRun("run-xyz"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledOnce();
    });

    const url = String(vi.mocked(global.fetch).mock.calls[0][0]);
    expect(url).toContain("LEGAL_BENCHMARK_RUNNER");
    expect(url).not.toContain("CONSOLIDATED");
  });

  it("uses overridden runType in fetch URL when CONSOLIDATED is passed", async () => {
    setupFetch({ type: "LEGAL_BENCHMARK_CONSOLIDATED" });

    renderHook(() =>
      useLegalBenchmarkRun("run-xyz", StakworkRunType.LEGAL_BENCHMARK_CONSOLIDATED),
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledOnce();
    });

    const url = String(vi.mocked(global.fetch).mock.calls[0][0]);
    expect(url).toContain("LEGAL_BENCHMARK_CONSOLIDATED");
    expect(url).not.toContain("LEGAL_BENCHMARK_RUNNER");
  });

  it("uses overridden runType RECURSION in fetch URL", async () => {
    setupFetch({ type: "LEGAL_BENCHMARK_RECURSION" });

    renderHook(() =>
      useLegalBenchmarkRun("run-xyz", StakworkRunType.LEGAL_BENCHMARK_RECURSION),
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledOnce();
    });

    const url = String(vi.mocked(global.fetch).mock.calls[0][0]);
    expect(url).toContain("LEGAL_BENCHMARK_RECURSION");
  });

  it("existing callers with just runId string get RUNNER behaviour unchanged", async () => {
    // Simulate an existing caller passing only the runId (no type).
    renderHook(() => useLegalBenchmarkRun("run-xyz"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledOnce();
    });

    const url = String(vi.mocked(global.fetch).mock.calls[0][0]);
    expect(url).toContain("LEGAL_BENCHMARK_RUNNER");
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
