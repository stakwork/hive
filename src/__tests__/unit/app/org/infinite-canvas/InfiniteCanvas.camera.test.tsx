import React, { Profiler } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockInitiativeTree, MOCK_INITIATIVES } from "@/app/api/mock/graph/initiative-fixture";
import {
  initiativesByRecency,
  kids,
  toBoard,
  type InitiativeEntry,
} from "@/app/org/[githubLogin]/_components/infinite-canvas/board";
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
  useCanvasProposals: () => ({ pending: [], deciding: {}, decide: vi.fn() }),
}));
vi.mock("@/app/org/[githubLogin]/_state/useCanvasJobs", () => ({
  useCanvasJobs: () => ({ jobsByRef: {}, artifactsByRef: {} }),
}));
vi.mock("@/app/org/[githubLogin]/_components/infinite-canvas/JamieBar", () => ({
  JamieBar: () => null,
  useAskJamie: () => vi.fn(),
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

describe("InfiniteCanvas cards keep their state", () => {
  // Each test starts at the org, not at the level the last one left in the URL.
  beforeEach(() => window.history.replaceState(null, "", "/"));
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    // Flights land at once.
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    size("clientWidth", 1200);
    size("clientHeight", 800);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  const initiative = initiativesByRecency(board)[0]!.id;
  const milestone = kids(board, initiative, "milestone")[0]!.id;
  const card = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-node="${id}"]`);
  const enter = (c: HTMLElement, id: string) => fireEvent.click(card(c, id)!.querySelector("[data-part=face]")!);
  const draft = (c: HTMLElement, id: string) => c.querySelector<HTMLTextAreaElement>(`[data-edit-input="${id}"]`);
  const startRename = (c: HTMLElement, id: string, text: string) => {
    act(() => fireEvent.click(c.querySelector(`[data-edit="${id}"]`)!));
    act(() => fireEvent.change(draft(c, id)!, { target: { value: text } }));
  };
  /** Drag the desk by `dx` screen px, then let the camera settle. */
  const pan = async (c: HTMLElement, dx: number) => {
    const root = c.querySelector<HTMLElement>("[data-level]")!;
    const at = (type: string, x: number) =>
      root.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: 400, bubbles: true }));
    act(() => {
      at("pointerdown", 600);
      for (let i = 1; i <= 20; i++) at("pointermove", 600 + (dx * i) / 20);
      at("pointerup", 600 + dx);
    });
    await act(() => new Promise((r) => setTimeout(r, 200)));
  };

  it("keeps a rename draft while its card is panned out of view and back", async () => {
    const { container } = canvas();
    await act(async () => {});
    act(() => enter(container, initiative));
    act(() => enter(container, milestone));
    startRename(container, milestone, "Renamed mid-pan");

    await pan(container, 20_000);
    expect(card(container, milestone)!.style.display).toBe("none");
    expect(draft(container, milestone)!.value).toBe("Renamed mid-pan");

    await pan(container, -20_000);
    expect(card(container, milestone)!.style.display).toBe("");
    expect(draft(container, milestone)!.value).toBe("Renamed mid-pan");
  });

  it("keeps a rename draft across a level change away and back", async () => {
    const { container } = canvas();
    await act(async () => {});
    act(() => enter(container, initiative));
    act(() => enter(container, milestone));
    startRename(container, milestone, "Renamed mid-flight");

    const escape = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    act(escape);
    act(escape);
    expect(container.querySelector("[data-level]")!.getAttribute("data-level")).not.toBe(milestone);
    expect(card(container, milestone)!.style.display).toBe("none");
    expect(draft(container, milestone)!.value).toBe("Renamed mid-flight");

    act(() => enter(container, initiative));
    act(() => enter(container, milestone));
    expect(card(container, milestone)!.style.display).toBe("");
    expect(draft(container, milestone)!.value).toBe("Renamed mid-flight");
  });

  it("doesn't save a draft when its field blurs because the card was hidden", async () => {
    const { container } = canvas();
    await act(async () => {});
    act(() => enter(container, initiative));
    act(() => enter(container, milestone));
    startRename(container, milestone, "Half typed");
    const field = draft(container, milestone)!;
    field.checkVisibility = () => false;
    act(() => fireEvent.blur(field));
    expect(draft(container, milestone)!.value).toBe("Half typed");
  });

  it("mounts no card it has never shown", async () => {
    const { container } = canvas();
    await act(async () => {});
    expect(card(container, milestone)).toBeNull();
  });
});
