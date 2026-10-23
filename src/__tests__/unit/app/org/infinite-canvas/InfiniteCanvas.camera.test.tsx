import React, { Profiler } from "react";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mockInitiativeTree, MOCK_INITIATIVES } from "@/app/api/mock/graph/initiative-fixture";
import { toBoard, type InitiativeEntry } from "@/app/org/[githubLogin]/_components/infinite-canvas/board";
import { InfiniteCanvas } from "@/app/org/[githubLogin]/_components/infinite-canvas/InfiniteCanvas";
import { initiativeStage } from "@/services/graph/workbench";

globalThis.React = React;

const entry = (id: string, name: string, updated: number): InitiativeEntry => {
  const t = mockInitiativeTree(id);
  return {
    summary: {
      ref_id: id,
      name,
      status: null,
      created_at: null,
      updated_at: updated,
      created_by: null,
      created_by_kind: null,
      assignee_id: null,
    },
    ws: "ws",
    tree: { ...t, stage: initiativeStage(t.nodes), truncated: false },
  };
};
const entries = MOCK_INITIATIVES.map((s, i) => entry(s.id, s.name, 100 - i));
const board = toBoard(entries, {});

vi.mock("next/font/google", () => ({
  Patrick_Hand: () => ({ style: { fontFamily: "hand" } }),
  Source_Serif_4: () => ({ style: { fontFamily: "serif" } }),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/org/[githubLogin]/_components/infinite-canvas/useCanvasBoard", () => ({
  useCanvasBoard: () => ({
    board,
    entries,
    loading: false,
    reading: false,
    failed: false,
    savePlan: vi.fn(),
    choose: vi.fn(),
  }),
}));
vi.mock("@/app/org/[githubLogin]/_components/infinite-canvas/useCanvasProposals", () => ({
  useCanvasProposals: () => ({ pending: [], decide: vi.fn() }),
}));
vi.mock("@/app/org/[githubLogin]/_state/useCanvasJobs", () => ({
  useCanvasJobs: () => ({ jobsByRef: {}, artifactsByRef: {} }),
}));
vi.mock("@/app/org/[githubLogin]/_components/infinite-canvas/JamieBar", () => ({
  JamieBar: () => null,
  useAskJamie: () => vi.fn(),
}));
// jsdom has no layout for the panel library to measure: plain boxes stand in for the artifact pane.
vi.mock("@/components/ui/resizable", () => ({
  RESIZABLE_PANEL_TRANSITION: "",
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: React.forwardRef(function MockPanel({ children }: { children: React.ReactNode }, ref) {
    React.useImperativeHandle(ref, () => ({ isCollapsed: () => true, collapse() {}, expand() {} }));
    return <div>{children}</div>;
  }),
  ResizableHandle: () => null,
}));
vi.mock("@/app/org/[githubLogin]/_components/artifacts/ArtifactPanel", () => ({ ArtifactPanel: () => null }));
vi.mock("@/app/org/[githubLogin]/_components/artifacts/ChatArtifacts", () => ({ ChatArtifacts: () => null }));

class FakeResizeObserver {
  constructor(private cb: () => void) {}
  observe() {
    this.cb();
  }
  disconnect() {}
}
const size = (prop: "clientWidth" | "clientHeight", px: number) =>
  Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => px });

describe("InfiniteCanvas camera", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    size("clientWidth", 1200);
    size("clientHeight", 800);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  it("zooms with the wheel without rendering the cards", async () => {
    const commits = vi.fn();
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <Profiler id="canvas" onRender={commits}>
          <InfiniteCanvas githubLogin="org" workspaceSlugs={["ws"]} renderChat={() => null} />
        </Profiler>
      </QueryClientProvider>,
    );
    await act(async () => {});
    const world = container.querySelector<HTMLElement>("[data-world]")!;
    const root = container.querySelector<HTMLElement>("[data-level]")!;
    expect(container.querySelectorAll("[data-node]").length).toBeGreaterThan(0);
    const before = world.style.transform;
    const rendered = commits.mock.calls.length;

    act(() => {
      for (let i = 0; i < 20; i++)
        root.dispatchEvent(new WheelEvent("wheel", { deltaY: -12, clientX: 600, clientY: 400, bubbles: true }));
    });

    expect(world.style.transform).not.toBe(before);
    expect(root.dataset.zoom).toBeDefined();
    expect(commits.mock.calls.length).toBe(rendered);
  });
});
