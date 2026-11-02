import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockInitiativeTree, MOCK_INITIATIVES } from "@/app/api/mock/graph/initiative-fixture";
import { toBoard, type InitiativeEntry } from "@/app/org/[githubLogin]/_components/infinite-canvas/board";
import { InfiniteCanvas } from "@/app/org/[githubLogin]/_components/infinite-canvas/InfiniteCanvas";
import { useCanvasChatStore } from "@/app/org/[githubLogin]/_state/canvasChatStore";
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

const sys = vi.hoisted(() => {
  const node = (refId: string, type: string, name: string) => ({ refId, type, name, properties: { name } });
  return {
    nodes: [
      node("z", "SysTrustZone", "internal"),
      node("auth", "SysComponent", "auth service"),
      node("web", "SysComponent", "web app"),
    ],
    edges: [
      { source: "auth", target: "z", edgeType: "IN_ZONE" },
      { source: "web", target: "z", edgeType: "IN_ZONE" },
    ],
  };
});

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
  useCanvasProposals: () => ({ pending: [], deciding: {}, decide: vi.fn() }),
}));
vi.mock("@/app/org/[githubLogin]/_state/useCanvasJobs", () => ({
  useCanvasJobs: () => ({ jobsByRef: {}, artifactsByRef: {} }),
}));
vi.mock("@/app/org/[githubLogin]/_components/infinite-canvas/system/useSystemData", () => ({
  useSystemNodes: () => ({ nodes: sys.nodes, edges: sys.edges, wsOf: () => "ws", loading: false }),
  useOrgCanvasJobs: () => ({ jobsByRef: {}, artifactsByRef: {} }),
  useSystemEdges: () => ({
    maps: { inArea: new Map(), extendsOf: new Map() },
    saving: false,
    placeIn: vi.fn(),
    unplace: vi.fn(),
    extend: vi.fn(),
    unextend: vi.fn(),
  }),
}));
vi.mock("@/app/org/[githubLogin]/_components/infinite-canvas/JamieBar", () => ({
  JamieBar: () => null,
  useAskJamie: () => vi.fn(),
}));
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

const canvas = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InfiniteCanvas githubLogin="org" workspaceSlugs={["ws"]} renderChat={() => null} />
    </QueryClientProvider>,
  );

describe("InfiniteCanvas Plan | System", () => {
  beforeEach(() => window.history.replaceState(null, "", "/?view=canvas&tab=brainstorm"));
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    size("clientWidth", 1200);
    size("clientHeight", 800);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  it("opens on the Plan, with the toggle", async () => {
    const { container } = canvas();
    await act(async () => {});
    expect(container.querySelector("[data-view-toggle]")).not.toBeNull();
    expect(container.querySelector("[data-view=plan]")?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("[data-system-view]")).toBeNull();
    expect(container.querySelector<HTMLElement>("[data-plan-layer]")!.style.display).toBe("contents");
    expect(new URLSearchParams(window.location.search).get("v")).toBeNull();
  });

  it("switches to the System view and back, mirroring ?v=system", async () => {
    const { container } = canvas();
    await act(async () => {});
    act(() => {
      fireEvent.click(container.querySelector("[data-view=system]")!);
    });
    await act(async () => {});
    expect(container.querySelector("[data-system-view]")).not.toBeNull();
    expect(container.querySelector<HTMLElement>("[data-plan-layer]")!.style.display).toBe("none");
    expect(new URLSearchParams(window.location.search).get("v")).toBe("system");
    expect(container.querySelector("[data-sys-district=auth]")).not.toBeNull();
    expect(container.querySelector("[data-sys-unmapped]")).not.toBeNull();

    act(() => {
      fireEvent.click(container.querySelector("[data-view=plan]")!);
    });
    expect(container.querySelector("[data-system-view]")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("v")).toBeNull();
    expect(container.querySelector<HTMLElement>("[data-plan-layer]")!.style.display).toBe("contents");
  });

  it("goes into a district by click and mirrors it as ?at=", async () => {
    const { container } = canvas();
    await act(async () => {});
    act(() => {
      fireEvent.click(container.querySelector("[data-view=system]")!);
    });
    await act(async () => {});
    act(() => {
      fireEvent.click(container.querySelector("[data-sys-district=auth]")!);
    });
    expect(new URLSearchParams(window.location.search).get("at")).toBe("auth");
    expect(container.querySelector<HTMLElement>("[data-system-view]")!.dataset.sysLevelNow).toBe("2");
    // Esc goes back out to the world.
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(new URLSearchParams(window.location.search).get("at")).toBeNull();
  });

  it("shows the List as the same data by district", async () => {
    const { container } = canvas();
    await act(async () => {});
    act(() => {
      fireEvent.click(container.querySelector("[data-view=system]")!);
    });
    await act(async () => {});
    act(() => {
      fireEvent.click(container.querySelector("[data-sys-mode=list]")!);
    });
    expect(container.querySelector("[data-sys-list]")).not.toBeNull();
    expect(container.querySelector("[data-sys-list-district=auth]")).not.toBeNull();
    expect(container.querySelector("[data-sys-list-unmapped]")).not.toBeNull();
  });

  it("flies to what the agent's focus_canvas names, switching view and clearing the slot", async () => {
    const { container } = canvas();
    await act(async () => {});
    expect(container.querySelector("[data-system-view]")).toBeNull();
    act(() => {
      useCanvasChatStore.getState().triggerCanvasFocus({ kind: "component", ref: "web", name: "web app", view: "system" });
    });
    await act(async () => {});
    expect(container.querySelector("[data-system-view]")).not.toBeNull();
    expect(new URLSearchParams(window.location.search).get("at")).toBe("web");
    expect(useCanvasChatStore.getState().pendingCanvasFocus).toBeNull();
    expect(container.querySelector("[data-sys-district=web]")?.className).toContain("sys-flash");
  });
});
