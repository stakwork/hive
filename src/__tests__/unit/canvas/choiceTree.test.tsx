import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

const setDraft = vi.fn();
const appendDraft = vi.fn();
vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => ({
  useCanvasChatStore: (sel: (s: unknown) => unknown) => sel({ setPendingInputDraft: setDraft, appendPendingInputDraft: appendDraft }),
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

import { estimateNodeHeight, buildChoiceTree, compareChoiceIds, layoutTree, isTreeArtifact, treeContentOfJson, ChoiceTree, impactLevel } from "@/app/org/[githubLogin]/_components/artifacts/viewers/ChoiceTree";

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

  it("estimates a taller selected question with criteria and reversibility", () => {
    const q = { name: "Do we extend existing tooling or build a new component for PII conversion?", isQuestion: true, state: "open" as const, madeBy: "model" };
    const withDetails = { ...q, criteria: "effort, fit with pseudonymization needs, maintenance, reuse", reversibility: "two_way" };
    expect(estimateNodeHeight(withDetails, true)).toBeGreaterThan(estimateNodeHeight(q, true));
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

describe("effects", () => {
  const effects = [
    { ref_id: "e1", name: "Fast", description: "Ships soon, and a long description that wraps over more than one line of the card", direction: "pro", impact: 0.8 },
    { ref_id: "e2", name: "Risky", description: "", direction: "con", impact: 0.3 },
    { ref_id: "e3", name: "bad", direction: "other", impact: 0.3 },
  ];
  it("buildChoiceTree maps effects onto options only", () => {
    const { items } = buildChoiceTree(
      [
        { ref_id: "r", type: "Question", properties: { text: "Q" }, effects },
        { ref_id: "a", type: "Option", properties: { text: "A", option_id: 1 }, effects },
        { ref_id: "b", type: "Option", properties: { text: "B", option_id: 2 } },
      ],
      [{ source: "r", target: "a" }, { source: "r", target: "b" }],
      "r",
    );
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.a.effects?.map((e) => e.name)).toEqual(["Fast", "Risky"]);
    expect(by.r.effects).toBeUndefined();
    expect(by.b.effects).toBeUndefined();
  });
  it("estimateNodeHeight grows with effects when selected, unchanged otherwise", () => {
    const base = { name: "Opt", quote: undefined };
    const withFx = { ...base, effects: effects.slice(0, 2) as never };
    expect(estimateNodeHeight(withFx, true)).toBeGreaterThan(estimateNodeHeight(base, true));
    expect(estimateNodeHeight(withFx, false)).toBe(estimateNodeHeight(base, false));
    expect(estimateNodeHeight({ ...base, effects: [] }, true)).toBe(estimateNodeHeight(base, true));
  });
});

describe("isTreeArtifact", () => {
  const ws = { workspace: "hive" };
  it("layout tree, a brainstorm id (any case, any prefix) or a Choice/Question label — focus or not", () => {
    expect(isTreeArtifact({ id: "x" }, { ...ws, focus: "r", layout: "tree" })).toBe(true);
    expect(isTreeArtifact({ id: "brainstorm-tree" }, { ...ws, focus: "r" })).toBe(true);
    expect(isTreeArtifact({ id: "job-x:brainstorm-tree" }, ws)).toBe(true);
    expect(isTreeArtifact({ id: "My-BrainStorm" }, ws)).toBe(true);
    expect(isTreeArtifact({ id: "x" }, { ...ws, label: "Choice" })).toBe(true);
    expect(isTreeArtifact({ id: "x" }, { ...ws, label: "Question" })).toBe(true);
  });

  it("ignores a stray proposal or changes on a tree", () => {
    expect(isTreeArtifact({ id: "brainstorm-tree" }, { ...ws, focus: "r", proposal: "p1" })).toBe(true);
    expect(isTreeArtifact({ id: "x" }, { ...ws, focus: "r", layout: "tree", proposal: "p1", changes: [{ kind: "node", name: "n" } as never] })).toBe(true);
  });

  it("leaves proposal artifacts and plain graph cards to the workbench", () => {
    expect(isTreeArtifact({ id: "x" }, { ...ws, focus: "r" })).toBe(false);
    expect(isTreeArtifact({ id: "proposal-1" }, { ...ws, focus: "r", proposal: "p1", changes: [{ kind: "node", name: "n" } as never] })).toBe(false);
    expect(isTreeArtifact({ id: "x" }, { ...ws, label: "Other" })).toBe(false);
  });
});

describe("questions and options (IBIS)", () => {
  const tn = (ref_id: string, type: string, props: Record<string, unknown>) => ({ ref_id, type, properties: props });
  const ns = [
    tn("r", "Question", { question_id: 1, text: "Root?", state: "decided", made_by: "user" }),
    tn("b", "Choice", { choice_id: 2, text: "B", kind: "option" }),
    tn("a", "Choice", { choice_id: 1, text: "A", kind: "option" }),
    tn("q", "Question", { question_id: 1, text: "Sub?" }),
    tn("aa", "Choice", { choice_id: 1, text: "AA" }),
    tn("old", "Choice", { choice_id: 2, text: "Old q", kind: "question" }),
    tn("ab", "Choice", { choice_id: 3, text: "AB", kind: "option" }),
  ];
  const es = [["r", "a"], ["r", "b"], ["a", "q"], ["a", "old"], ["q", "aa"], ["q", "ab"]].map(([source, target]) => ({ source, target }));

  it("a Question label or a legacy kind question is a question; the rest are options lettered through questions", () => {
    const items = buildChoiceTree(ns, es, "r").items;
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.r.isQuestion && by.q.isQuestion && by.old.isQuestion).toBe(true);
    expect(by.a.isQuestion || by.aa.isQuestion).toBe(false);
    expect(Object.fromEntries(items.map((i) => [i.id, i.letter]))).toEqual({ r: undefined, a: "A", q: undefined, old: undefined, aa: "AA", ab: "AB", b: "B" });
  });

  it("orders by choice_id, falling back to question_id", () => {
    const items = buildChoiceTree(
      [tn("r", "Question", { question_id: 1 }), tn("x", "Question", { question_id: 5, text: "x" }), tn("y", "Question", { question_id: 2, text: "y" }), tn("z", "Choice", { choice_id: 3, text: "z" })],
      [{ source: "r", target: "x" }, { source: "r", target: "z" }, { source: "r", target: "y" }],
      "r",
    ).items;
    expect(items.map((i) => i.id)).toEqual(["r", "y", "z", "x"]);
  });

  describe("rendered", () => {
    const mountWith = async (data: unknown, focus = "r") => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
      const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
      render(
        <QueryClientProvider client={new QueryClient()}>
          <ChoiceTree workspace="hive" focus={focus} />
        </QueryClientProvider>,
      );
    };

    it("a question shows 'decided' even unselected, no letter, and only Expand (More options) when selected, with criteria and reversibility", async () => {
      const withExtras = ns.map((x) => (x.ref_id === "r" ? { ...x, properties: { ...x.properties, criteria: "cheap to run", reversibility: "two-way door", speaker: "Dana", quote: "ask" } } : x));
      await mountWith({ nodes: withExtras, edges: es });
      await screen.findByText("Root?");
      expect(screen.getByText("decided")).toBeTruthy();
      expect(screen.queryByText("Expand")).toBeNull();
      fireEvent.click(screen.getByText("Root?"));
      expect(screen.getByText(/cheap to run/)).toBeTruthy();
      expect(screen.getByText(/two-way door/)).toBeTruthy();
      expect(screen.queryByText("Go with")).toBeNull();
      expect(screen.queryByText("Revisit")).toBeNull();
      const expand = screen.getByText("Expand");
      expect(expand.getAttribute("title")).toBe("More options");
      fireEvent.click(expand);
      expect(setDraft).toHaveBeenLastCalledWith('Expand "Root?" (r)');
    });

    it("a speaker replaces made_by as text and in the icon title", async () => {
      const sp = ns.map((x) => (x.ref_id === "r" ? { ...x, properties: { ...x.properties, speaker: "Dana" } } : x));
      await mountWith({ nodes: sp, edges: es });
      await screen.findByText("Root?");
      expect(screen.getByTitle("made by Dana")).toBeTruthy();
      expect(screen.queryByTitle("made by user")).toBeNull();
      fireEvent.click(screen.getByText("Root?"));
      expect(screen.getByText("Dana")).toBeTruthy();
      expect(screen.queryByText("user")).toBeNull();
    });
  });
});

describe("sub-questions and options (Question / Option nodes)", () => {
  const tn = (ref_id: string, type: string, props: Record<string, unknown>) => ({ ref_id, type, properties: props });
  const qn = (id: string, k: number) => tn(id, "Question", { question_id: k, text: `Q ${id}` });
  const on = (id: string, k: number) => tn(id, "Option", { option_id: k, text: `O ${id}`, kind: "option" });
  const E = (...pairs: string[][]) => pairs.map(([source, target]) => ({ source, target }));
  const labels = (ns: ReturnType<typeof tn>[], es: ReturnType<typeof E>) => Object.fromEntries(buildChoiceTree(ns, es, "r").items.map((i) => [i.id, i.letter]));

  const mockTree = {
    nodes: [
      tn("r", "Question", { question_id: 1, text: "Root?" }),
      tn("q2", "Question", { question_id: 3, text: "Second?" }),
      tn("q1", "Question", { question_id: 2, text: "First?" }),
      on("b", 5),
      on("a", 4),
      on("c", 6),
      tn("f", "Question", { question_id: 7, text: "Follow-up?" }),
      on("fa", 8),
      on("fb", 9),
    ],
    edges: E(["r", "q2"], ["r", "q1"], ["q1", "b"], ["q1", "a"], ["q2", "c"], ["a", "f"], ["f", "fa"], ["f", "fb"]),
  };

  it("(a) numbers sub-questions, letters options under them, follow-ups pass the label through", () => {
    expect(labels(mockTree.nodes, mockTree.edges)).toEqual({ r: undefined, q1: "1", q2: "2", a: "1A", b: "1B", c: "2A", f: undefined, fa: "1AA", fb: "1AB" });
    const by = Object.fromEntries(buildChoiceTree(mockTree.nodes, mockTree.edges, "r").items.map((i) => [i.id, i]));
    expect(by.q1.isQuestion && by.q2.isQuestion && by.f.isQuestion).toBe(true);
    expect(by.a.isQuestion).toBe(false);
  });

  it("(a) renders chips; sub-questions only Expand; drafts use labels", async () => {
    setDraft.mockClear();
    appendDraft.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => mockTree }));
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ChoiceTree workspace="hive" focus="r" />
      </QueryClientProvider>,
    );
    await screen.findByText("Root?");
    for (const l of ["1", "2", "1A", "1B", "2A", "1AA", "1AB"]) expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Second?"));
    expect(screen.queryByText("Go with")).toBeNull();
    expect(screen.queryByText("Revisit")).toBeNull();
    fireEvent.click(screen.getByText("Expand"));
    expect(setDraft).toHaveBeenLastCalledWith('Expand 2: "Second?" (q2)');
    fireEvent.click(screen.getByText("Second?"));
    fireEvent.click(screen.getByText("O b"));
    fireEvent.click(screen.getByText("Go with"));
    expect(appendDraft).toHaveBeenLastCalledWith('Go with 1B: "O b" (b)');
    fireEvent.click(screen.getByText("O b"));
    fireEvent.click(screen.getByText("Follow-up?"));
    fireEvent.click(screen.getByText("Expand"));
    expect(setDraft).toHaveBeenLastCalledWith('Expand "Follow-up?" (f)');
    fireEvent.click(screen.getByText("Follow-up?"));
    fireEvent.click(screen.getByText("O fb"));
    fireEvent.click(screen.getByText("Expand"));
    expect(setDraft).toHaveBeenLastCalledWith('Expand 1AB: "O fb" (fb)');
  });

  it("(b) an old all-Choice tree still renders A, B, AA, AB", async () => {
    const c = (id: string, k: number, kind: string) => tn(id, "Choice", { choice_id: k, text: `C ${id}`, kind });
    const ns = [c("r", 1, "question"), c("b", 3, "option"), c("a", 2, "option"), c("lq", 4, "question"), c("x", 5, "option"), c("y", 6, "option")];
    const es = E(["r", "a"], ["r", "b"], ["a", "lq"], ["lq", "x"], ["lq", "y"]);
    expect(labels(ns, es)).toEqual({ r: undefined, a: "A", b: "B", lq: undefined, x: "AA", y: "AB" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nodes: ns, edges: es }) }));
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ChoiceTree workspace="hive" focus="r" />
      </QueryClientProvider>,
    );
    await screen.findByText("C r");
    for (const l of ["A", "B", "AA", "AB"]) expect(screen.getAllByText(l).length).toBeGreaterThan(0);
  });

  it("(c) sorts siblings by option_id", () => {
    const ns = [qn("r", 1), on("z", 10), on("y", 2), on("x", 3)];
    expect(labels(ns, E(["r", "z"], ["r", "y"], ["r", "x"]))).toEqual({ r: undefined, y: "A", x: "B", z: "C" });
  });

  it("(d) Question -> Question -> Question gives 1, 1.1 (and options 1.1A)", () => {
    const ns = [qn("r", 1), qn("s", 2), qn("t", 3), on("o", 4)];
    expect(labels(ns, E(["r", "s"], ["s", "t"], ["t", "o"]))).toEqual({ r: undefined, s: "1", t: "1.1", o: "1.1A" });
  });

  it("a sub-question under a follow-up under option A is A1, its options A1A", () => {
    const ns = [qn("r", 1), on("a", 2), qn("f", 3), qn("s", 4), on("o", 5)];
    expect(labels(ns, E(["r", "a"], ["a", "f"], ["f", "s"], ["s", "o"]))).toEqual({ r: undefined, a: "A", f: undefined, s: "A1", o: "A1A" });
  });

  it("(e) a root with both sub-questions and options numbers and letters them side by side", () => {
    const ns = [qn("r", 1), qn("s1", 2), on("a", 3), qn("s2", 4), on("b", 5)];
    expect(labels(ns, E(["r", "s1"], ["r", "a"], ["r", "s2"], ["r", "b"]))).toEqual({ r: undefined, s1: "1", s2: "2", a: "A", b: "B" });
  });
});

describe("ChoiceTree", () => {
  beforeEach(() => {
    setDraft.mockClear();
    appendDraft.mockClear();
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
    expect(appendDraft).toHaveBeenLastCalledWith('Go with AA: "Legacy name" (g)');

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
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/workspaces/hive/graph/choice-tree?focus=r");
  });

  it("restricts to one label only when given", async () => {
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ChoiceTree workspace="hive" focus="r" label="Choice" />
      </QueryClientProvider>,
    );
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

describe("treeContentOfJson — a json card that is really a brainstorm tree", () => {
  const value = { workspace: "hive", focus: "f1", layout: "tree" };
  it("opens as the tree", () => {
    expect(treeContentOfJson({ id: "x" }, { value })).toEqual(value);
    expect(treeContentOfJson({ id: "brainstorm-tree" }, { value: { workspace: "hive", focus: "f1" } })).toEqual({ workspace: "hive", focus: "f1", layout: "tree" });
  });
  it("leaves other json alone", () => {
    expect(treeContentOfJson({ id: "x" }, { value: { workspace: "hive", focus: "f1" } })).toBeNull();
    expect(treeContentOfJson({ id: "brainstorm-tree" }, { value: { focus: "f1" } })).toBeNull();
    expect(treeContentOfJson({ id: "x" }, { value: [1] })).toBeNull();
    expect(treeContentOfJson({ id: "x" }, { value: "s" })).toBeNull();
  });
});

describe("impactLevel", () => {
  it.each([
    [0, "low"],
    [0.39, "low"],
    [0.4, "medium"],
    [0.55, "medium"],
    [0.7, "medium"],
    [0.71, "high"],
    [1, "high"],
    [null, null],
  ])("maps %s to %s", (impact, level) => {
    expect(impactLevel(impact)).toBe(level);
  });
});
