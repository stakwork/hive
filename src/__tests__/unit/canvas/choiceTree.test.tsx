import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

const setDraft = vi.fn();
vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => ({
  useCanvasChatStore: (sel: (s: unknown) => unknown) => sel({ setPendingInputDraft: setDraft }),
}));
vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
  Background: () => null,
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ReactFlow: ({ nodes, nodeTypes, onPaneClick }: { nodes: Array<{ id: string; type: string; data: unknown }>; nodeTypes: Record<string, React.ComponentType<never>>; onPaneClick?: () => void }) => (
    <div data-testid="pane" onClick={(e) => e.target === e.currentTarget && onPaneClick?.()}>
      {nodes.map((n) => {
        const C = nodeTypes[n.type] as React.ComponentType<{ data: unknown }>;
        return <C key={n.id} data={n.data} />;
      })}
    </div>
  ),
}));

import { estimateNodeHeight, buildChoiceTree, compareChoiceIds, layoutTree, isTreeArtifact, ChoiceTree } from "@/app/org/[githubLogin]/_components/artifacts/viewers/ChoiceTree";

// The choice-tree route returns label-filtered nodes with no node_type.
const n = (ref_id: string, props: Record<string, unknown>) => ({ ref_id, properties: props });
// Children are deliberately out of choice_id order (and ref_ids are not sortable to it).
const nodes = [
  n("r", { choice_id: 1, text: "Root?", kind: "question", made_by: "user", state: "chosen", quote: "the original ask" }),
  n("z3", { choice_id: "10", text: "C", kind: "option", made_by: "model", state: "simulated" }),
  n("b", { choice_id: 2, text: "A", kind: "option", made_by: "model", state: "open" }),
  n("q", { choice_id: 3, text: "Sub?", kind: "question", made_by: "model" }),
  n("a9", { choice_id: 9, text: "B", kind: "option", made_by: "user", state: "rejected" }),
  n("g", { choice_id: 4, name: "Legacy name", kind: "option", state: "open" }),
  n("x", { choice_id: 5, text: "Elsewhere" }),
  n("p", { choice_id: 0, text: "Parent" }),
];
const edges = [
  { source: "r", target: "z3" },
  { source: "r", target: "a9" },
  { source: "r", target: "b" },
  { source: "b", target: "q" },
  { source: "q", target: "g" },
  { source: "p", target: "r" },
  { source: "g", target: "r" },
];

describe("buildChoiceTree / layoutTree", () => {
  it("keeps the focus and its descendants only (x, p are not under it), via PARENT_OF (cycle-safe)", () => {
    const { items, links } = buildChoiceTree(nodes, edges, "r");
    expect(items.map((i) => i.id).sort()).toEqual(["a9", "b", "g", "q", "r", "z3"]);
    expect(links).toHaveLength(5);
  });

  it("orders children by choice_id (numeric, not API/ref_id order) and letters options", () => {
    const { items } = buildChoiceTree(nodes, edges, "r");
    expect(items.map((i) => [i.id, i.name, i.letter])).toEqual([
      ["r", "Root?", undefined],
      ["b", "A", "A"],
      ["q", "Sub?", undefined],
      ["g", "Legacy name", "AA"],
      ["a9", "B", "B"],
      ["z3", "C", "C"],
    ]);
    expect(items[0].quote).toBe("the original ask");
  });

  it("labels options by path: A, B, AA, AB; under a question the nearest lettered ancestor prefixes", () => {
    const o = (id: string, cid: number, kind = "option") => n(id, { choice_id: cid, text: id, kind });
    const ns = [o("r", 0, "question"), o("a", 1), o("b", 2), o("a1", 1), o("a2", 2), o("a2x", 1), o("bq", 1, "question"), o("bq1", 1), o("bq2", 2)];
    const es = [["r", "a"], ["r", "b"], ["a", "a1"], ["a", "a2"], ["a2", "a2x"], ["b", "bq"], ["bq", "bq1"], ["bq", "bq2"]].map(([source, target]) => ({ source, target }));
    const label = Object.fromEntries(buildChoiceTree(ns, es, "r").items.map((i) => [i.id, i.letter]));
    expect(label).toEqual({ r: undefined, a: "A", b: "B", a1: "AA", a2: "AB", a2x: "ABA", bq: undefined, bq1: "BA", bq2: "BB" });
  });

  it("estimates height growing with text, clamped to 3 lines unless selected", () => {
    const short = { name: "x" };
    const long = { name: "y".repeat(34 * 6) };
    expect(estimateNodeHeight(long, false)).toBe(estimateNodeHeight({ name: "y".repeat(34 * 3) }, false));
    expect(estimateNodeHeight(long, false)).toBeGreaterThan(estimateNodeHeight(short, false));
    expect(estimateNodeHeight(long, true)).toBeGreaterThan(estimateNodeHeight(long, false));
    expect(estimateNodeHeight({ ...short, quote: "q".repeat(70) }, true)).toBeGreaterThan(estimateNodeHeight(short, true));
  });

  it("does not overlap siblings vertically when heights differ", () => {
    const { items, links } = buildChoiceTree(nodes, edges, "r");
    const heights = Object.fromEntries(items.map((i, k) => [i.id, 40 + k * 30]));
    const pos = layoutTree(items.map((i) => i.id), links, heights);
    const sibs = ["b", "a9", "z3"].sort((x, y) => pos[x].y - pos[y].y);
    for (let k = 1; k < sibs.length; k++) expect(pos[sibs[k]].y).toBeGreaterThanOrEqual(pos[sibs[k - 1]].y + heights[sibs[k - 1]]);
  });

  it("compares choice_ids numerically when both numeric, else with numeric collation", () => {
    expect(compareChoiceIds(2, "10")).toBeLessThan(0);
    expect(compareChoiceIds("a2", "a10")).toBeLessThan(0);
  });

  it("lays out left to right, siblings top to bottom in choice_id order", () => {
    const { items, links } = buildChoiceTree(nodes, edges, "r");
    const pos = layoutTree(items.map((i) => i.id), links);
    expect(pos.r.x).toBeLessThan(pos.b.x);
    expect(pos.b.x).toBeLessThan(pos.q.x);
    expect(pos.b.y).toBeLessThan(pos.a9.y);
    expect(pos.a9.y).toBeLessThan(pos.z3.y);
  });

  it("is empty when the focus is not among the nodes", () => {
    expect(buildChoiceTree(nodes, edges, "missing").items).toEqual([]);
  });
});

describe("isTreeArtifact", () => {
  it("needs a focus and no proposal/changes, plus layout tree or the brainstorm-tree id", () => {
    expect(isTreeArtifact({ id: "brainstorm-tree" }, { workspace: "hive", focus: "r" })).toBe(true);
    expect(isTreeArtifact({ id: "x" }, { workspace: "hive", focus: "r", layout: "tree" })).toBe(true);
    expect(isTreeArtifact({ id: "x" }, { workspace: "hive", focus: "r" })).toBe(false);
    expect(isTreeArtifact({ id: "brainstorm-tree" }, { workspace: "hive" })).toBe(false);
    expect(isTreeArtifact({ id: "brainstorm-tree" }, { workspace: "hive", focus: "r", proposal: "p1" })).toBe(false);
  });
});

describe("ChoiceTree", () => {
  beforeEach(() => {
    setDraft.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nodes, edges, truncated: false }) }));
  });

  const mount = async () => {
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ChoiceTree workspace="hive" focus="r" />
      </QueryClientProvider>,
    );
    await screen.findByText("Root?");
  };

  it("renders unselected nodes quietly: no buttons, no text badges, icon cues with titles", async () => {
    await mount();
    expect(screen.queryByText("Expand")).toBeNull();
    expect(screen.queryByText("Go with")).toBeNull();
    expect(screen.queryByText("rejected")).toBeNull();
    expect(screen.queryByText("open")).toBeNull();
    expect(screen.getAllByTitle("made by user")).toHaveLength(2);
    expect(screen.getAllByTitle("made by model").length).toBeGreaterThan(0);
    expect(screen.getByTitle(/the original ask/)).toBeTruthy();
  });

  it("selecting a node shows its actions and drafts with path letters; click again or pane deselects", async () => {
    await mount();
    fireEvent.click(screen.getByText("Root?"));
    // A question: only Expand.
    expect(screen.queryByText("Go with")).toBeNull();
    fireEvent.click(screen.getByText("Expand"));
    expect(setDraft).toHaveBeenLastCalledWith('Expand "Root?" (r)');
    expect(screen.getByText(/the original ask/)).toBeTruthy();
    expect(screen.getByText("chosen")).toBeTruthy();
    // Selected node stays selected after pressing a button; clicking the node again deselects.
    fireEvent.click(screen.getByText("Root?"));
    expect(screen.queryByText("Expand")).toBeNull();

    fireEvent.click(screen.getByText("Legacy name"));
    fireEvent.click(screen.getByText("Go with"));
    expect(setDraft).toHaveBeenLastCalledWith('Go with AA: "Legacy name" (g)');

    fireEvent.click(screen.getByTestId("pane"));
    expect(screen.queryByText("Go with")).toBeNull();

    fireEvent.click(screen.getAllByText("B")[0]);
    expect(screen.getByText("rejected")).toBeTruthy();
    fireEvent.click(screen.getByText("Revisit"));
    expect(setDraft).toHaveBeenLastCalledWith('Revisit B: "B" (a9)');
  });

  const renderTree = async () => {
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ChoiceTree workspace="hive" focus="r" />
      </QueryClientProvider>,
    );
  };

  it("fetches the choice-tree route", async () => {
    await renderTree();
    await screen.findByText("Root?");
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/workspaces/hive/graph/choice-tree?focus=r&label=Choice");
  });

  it("shows the empty message only for a truly empty result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nodes: [], edges: [] }) }));
    await renderTree();
    expect(await screen.findByText("Nothing to show for this choice yet.")).toBeTruthy();
  });

  it("shows an error, not the empty message, when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    await renderTree();
    expect(await screen.findByText("Could not load the tree.")).toBeTruthy();
    expect(screen.queryByText("Nothing to show for this choice yet.")).toBeNull();
  });
});
