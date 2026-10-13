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
  ReactFlow: ({ nodes, nodeTypes }: { nodes: Array<{ id: string; type: string; data: unknown }>; nodeTypes: Record<string, React.ComponentType<never>> }) => (
    <div>
      {nodes.map((n) => {
        const C = nodeTypes[n.type] as React.ComponentType<{ data: unknown }>;
        return <C key={n.id} data={n.data} />;
      })}
    </div>
  ),
}));

import { buildChoiceTree, compareChoiceIds, layoutTree, isTreeArtifact, ChoiceTree } from "@/app/org/[githubLogin]/_components/artifacts/viewers/ChoiceTree";

const n = (ref_id: string, props: Record<string, unknown>, node_type = "Choice") => ({ ref_id, node_type, properties: props });
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
  n("o", { text: "Other" }, "Concept"),
];
const edges = [
  { source: "r", target: "z3", edge_type: "PARENT_OF" },
  { source: "r", target: "a9", edge_type: "PARENT_OF" },
  { source: "r", target: "b", edge_type: "PARENT_OF" },
  { source: "b", target: "q", edge_type: "PARENT_OF" },
  { source: "q", target: "g", edge_type: "PARENT_OF" },
  { source: "p", target: "r", edge_type: "PARENT_OF" },
  { source: "r", target: "o", edge_type: "PARENT_OF" },
  { source: "g", target: "r", edge_type: "PARENT_OF" },
  { source: "x", target: "b", edge_type: "RELATED" },
];

describe("buildChoiceTree / layoutTree", () => {
  it("keeps the focus and its Choice descendants only, via PARENT_OF (cycle-safe)", () => {
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
      ["g", "Legacy name", "A"],
      ["a9", "B", "B"],
      ["z3", "C", "C"],
    ]);
    expect(items[0].quote).toBe("the original ask");
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

  it("is empty when the focus is not a Choice", () => {
    expect(buildChoiceTree(nodes, edges, "o").items).toEqual([]);
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { nodes, edges } }) }));
  });

  it("shows badges and drafts messages from the buttons", async () => {
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ChoiceTree workspace="hive" focus="r" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Root?")).toBeTruthy();
    expect(screen.getAllByText("rejected")).toHaveLength(1);
    expect(screen.getAllByText("simulated")).toHaveLength(1);
    expect(screen.getAllByText("user")).toHaveLength(2);
    expect(screen.getByTitle("the original ask")).toBeTruthy();
    // Rendered in tree order: r, b(A), q, g(A), a9(B), z3(C).
    fireEvent.click(screen.getAllByText("Expand")[0]);
    expect(setDraft).toHaveBeenLastCalledWith('Expand "Root?" (r)');
    fireEvent.click(screen.getAllByText("Go with")[1]);
    expect(setDraft).toHaveBeenLastCalledWith('Go with A: "A" (b)');
    fireEvent.click(screen.getByText("Revisit"));
    expect(setDraft).toHaveBeenLastCalledWith('Revisit B: "B" (a9)');
  });
});
