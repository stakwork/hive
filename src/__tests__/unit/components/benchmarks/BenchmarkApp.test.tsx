/**
 * A benchmark entry with a strut app (`Benchmark.app`) renders through the
 * app frame; one without keeps today's generic run view. `BenchmarkApp`
 * finds where the app is (the workspace's org and swarm) and hands the frame
 * that source, no conversation, and the workspace's strut view for deep links.
 */
import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Benchmark } from "@/lib/benchmarks/registry";
import type { BenchmarkRunDetail } from "@/types/benchmarks";
import type { StrutAppFrameProps } from "@/components/strut-app-frame";

const { frames, mockGetBenchmark } = vi.hoisted(() => ({ frames: [] as StrutAppFrameProps[], mockGetBenchmark: vi.fn() }));
vi.mock("@/components/strut-app-frame", () => ({
  StrutAppFrame: (props: StrutAppFrameProps) => {
    frames.push(props);
    return <div data-testid="app-frame" />;
  },
}));
vi.mock("@/lib/benchmarks/registry", () => ({ getBenchmark: mockGetBenchmark }));
vi.mock("@/components/MarkdownRenderer", () => ({ MarkdownRenderer: ({ children }: { children: string }) => <div>{children}</div> }));

globalThis.React = React;

const { RunDetail } = await import("@/components/benchmarks/RunDetail");

const WITH_APP: Benchmark = { slug: "bench", name: "Bench", runWorkflow: "wfbench-run", app: { name: "bench" } };
const WITHOUT: Benchmark = { slug: "plain", name: "Plain", runWorkflow: "plain-run" };

const RUN: BenchmarkRunDetail = {
  id: "row-1",
  status: "SUCCESS",
  taskId: 7,
  score: 0.8,
  metric: "f1",
  officialScore: null,
  error: null,
  createdAt: "2026-10-21T10:00:00.000Z",
  settledAt: "2026-10-21T10:05:00.000Z",
  summary: "All good.",
  artifacts: [],
  parentRunId: null,
  strutRunId: "1790000000123",
  params: { split: "public" },
  extra: { value: null, truncated: false },
};

const mockFetch = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  frames.length = 0;
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockResolvedValue(new Response(JSON.stringify({ githubLogin: "acme-org", swarmId: "swarm-1", app: { name: "bench" } }), { status: 200 }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a benchmark's run", () => {
  test("with an app: the app frame, opened on strut's id for the run — not the generic view", async () => {
    mockGetBenchmark.mockReturnValue(WITH_APP);
    render(<RunDetail workspaceSlug="acme" benchmarkSlug="bench" run={RUN} />);
    expect(await screen.findByTestId("app-frame")).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/acme/benchmarks/bench/app", { cache: "no-store" });
    const props = frames[frames.length - 1];
    expect(props.source).toEqual({ githubLogin: "acme-org", swarmId: "swarm-1", app: "bench" });
    expect(props.toolInput).toEqual({ runId: "1790000000123", workflow: "wfbench-run" });
    // No conversation on a benchmark page: no message handler, so the frame says so.
    expect(props.onMessage).toBeUndefined();
    expect(props.strutLinkHref?.("wf=wfbench-run&run=1")).toBe(`/w/acme/strut?strut=${encodeURIComponent("wf=wfbench-run&run=1")}`);
    expect(screen.queryByText("All good.")).toBeNull();
  });

  test("without an app: today's generic view, and no app is looked for", () => {
    mockGetBenchmark.mockReturnValue(WITHOUT);
    render(<RunDetail workspaceSlug="acme" benchmarkSlug="plain" run={RUN} />);
    expect(screen.getByText("All good.")).toBeTruthy();
    expect(screen.getByText("Params")).toBeTruthy();
    expect(screen.queryByTestId("app-frame")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("an app that cannot be found says why", async () => {
    mockGetBenchmark.mockReturnValue(WITH_APP);
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: "This workspace has no swarm" }), { status: 409 }));
    render(<RunDetail workspaceSlug="acme" benchmarkSlug="bench" run={RUN} />);
    expect(await screen.findByText("This workspace has no swarm")).toBeTruthy();
    expect(frames).toEqual([]);
  });
});
