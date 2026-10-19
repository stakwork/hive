import { describe, it, expect } from "vitest";
import { buildChoiceTree, type ChoiceItem } from "@/app/org/[githubLogin]/_components/artifacts/viewers/ChoiceTree";
import { cardActions } from "@/app/org/[githubLogin]/_components/brainstorm-board/actions";
import {
  placeDesk,
  latestAdded,
  COLUMN_GAP,
  HEADING_ABOVE,
  MIN_COLUMN,
  STACK_GAP,
} from "@/app/org/[githubLogin]/_components/brainstorm-board/desk-layout";
import { searchDesk, type SearchEntry } from "@/app/org/[githubLogin]/_components/brainstorm-board/search";
import {
  addCard,
  clearSaved,
  discard,
  isPencilId,
  setText,
  withPencil,
  type Pencil,
  type RawTree,
} from "@/app/org/[githubLogin]/_components/brainstorm-board/pencil";

const raw: RawTree = {
  nodes: [
    {
      ref_id: "root",
      type: "Question",
      properties: { question_id: "1", text: "Where does it live?", made_by: "user", state: "decided" },
    },
    { ref_id: "a", type: "Option", properties: { option_id: "2", text: "A tab", made_by: "model", state: "chosen" } },
  ],
  edges: [{ source: "root", target: "a" }],
};

describe("pencil", () => {
  it("writes unsaved cards into the tree, after their saved siblings, as the person's", () => {
    let p: Pencil = {};
    p = addCard(p, "root", "hive", "root", { op: "add_option", temp: "t1", parent: "root", text: "A page" });
    p = addCard(p, "root", "hive", "root", { op: "add_question", temp: "t2", parent: "t1", text: "Who opens it?" });
    const shown = withPencil(raw, p.root, "Tom");
    const tree = buildChoiceTree(shown.nodes!, shown.edges!, "root");
    expect(tree.items.map((i) => i.id)).toEqual(["root", "a", "t1", "t2"]);
    const t1 = tree.items.find((i) => i.id === "t1")!;
    expect(t1).toMatchObject({ name: "A page", madeBy: "user", speaker: "Tom", state: "open", letter: "B" });
    expect(isPencilId(p.root, "t1")).toBe(true);
    expect(isPencilId(p.root, "a")).toBe(false);
    // The graph's own data is untouched.
    expect(raw.nodes).toHaveLength(2);
  });

  it("rewriting an unsaved card changes it in place; rewriting a saved card is one text edit", () => {
    let p: Pencil = addCard({}, "root", "hive", "root", {
      op: "add_option",
      temp: "t1",
      parent: "root",
      text: "A page",
    });
    p = setText(p, "root", "hive", "root", "t1", "A full page");
    p = setText(p, "root", "hive", "root", "a", "A tab on the canvas");
    p = setText(p, "root", "hive", "root", "a", "A tab on the org canvas");
    expect(p.root.ops).toEqual([
      { op: "add_option", temp: "t1", parent: "root", text: "A full page" },
      { op: "edit_text", ref: "a", text: "A tab on the org canvas" },
    ]);
    const shown = withPencil(raw, p.root, null);
    expect(shown.nodes!.find((n) => n.ref_id === "a")!.properties).toMatchObject({
      text: "A tab on the org canvas",
      pencil: true,
    });
  });

  it("discarding a card takes the unsaved cards under it, and an emptied batch goes", () => {
    let p: Pencil = addCard({}, "root", "hive", "root", { op: "add_option", temp: "t1", parent: "root", text: "x" });
    p = addCard(p, "root", "hive", "root", { op: "add_question", temp: "t2", parent: "t1", text: "y" });
    p = addCard(p, "root", "hive", "root", { op: "add_option", temp: "t3", parent: "root", text: "z" });
    p = discard(p, "root", "t1");
    expect(p.root.ops.map((o) => ("temp" in o ? o.temp : o.ref))).toEqual(["t3"]);
    expect(discard(p, "root", "t3")).toEqual({});
  });

  it("a brainstorm started on the desk is keyed by its first question; discarding it drops the whole batch", () => {
    let p: Pencil = addCard({}, "q", "hive", null, { op: "add_question", temp: "q", parent: null, text: "What next?" });
    p = addCard(p, "q", "hive", null, { op: "add_option", temp: "o", parent: "q", text: "This" });
    const tree = buildChoiceTree(
      withPencil(undefined, p.q, "Tom").nodes!,
      withPencil(undefined, p.q, "Tom").edges!,
      "q",
    );
    expect(tree.items.map((i) => i.id)).toEqual(["q", "o"]);
    expect(discard(p, "q", "q")).toEqual({});
    expect(clearSaved(p, "q")).toEqual({});
  });
});

describe("placeDesk", () => {
  const NOW = new Date(2026, 9, 19, 15, 0).getTime();
  const DAY = 86400000;
  const block = (key: string, at: number | undefined, width = 500, height = 300) => ({ key, ws: "hive", width, height, at });

  it("lays days out left to right, oldest first, today on the right", () => {
    const p = placeDesk([block("t", NOW), block("old", NOW - 30 * DAY), block("y", NOW - DAY)], NOW);
    expect(p.offsets.old.x).toBeLessThan(p.offsets.y.x);
    expect(p.offsets.y.x).toBeLessThan(p.offsets.t.x);
    expect(p.offsets.y.x).toBe(MIN_COLUMN + COLUMN_GAP);
  });

  it("stacks a day's trees newest first, and an empty day takes no space", () => {
    const p = placeDesk([block("a", NOW - 3600000), block("b", NOW), block("c", NOW - 5 * DAY, 1200)], NOW);
    expect(p.offsets.c).toEqual({ x: 0, y: 0 });
    expect(p.offsets.b).toEqual({ x: 1200 + COLUMN_GAP, y: 0 });
    expect(p.offsets.a).toEqual({ x: 1200 + COLUMN_GAP, y: 300 + STACK_GAP });
    expect(p.headings.map((h) => h.count)).toEqual([1, 2]);
    expect(p.headings[0].y).toBe(-HEADING_ABOVE);
  });

  it("trees without a time go far left", () => {
    const p = placeDesk([block("t", NOW), block("none", undefined)], NOW);
    expect(p.offsets.none).toEqual({ x: 0, y: 0 });
    expect(p.offsets.t.x).toBeGreaterThan(0);
  });

  it("a tree's time is the latest of its cards, seconds as number or string", () => {
    const n = (v: unknown) => ({ properties: { date_added_to_graph: v } });
    expect(latestAdded([n(100), n("300"), n(200), { properties: {} }])).toBe(300000);
    expect(latestAdded([{ properties: {} }])).toBeUndefined();
    expect(latestAdded(undefined)).toBeUndefined();
  });

  it("labels days", () => {
    const p = placeDesk([block("t", NOW), block("y", NOW - DAY), block("o", NOW - 6 * DAY), block("ly", new Date(2025, 9, 13, 9).getTime())], NOW);
    expect(p.headings.map((h) => h.title)).toEqual(["Mon 13 Oct 2025", "Tue 13 Oct", "Yesterday", "Today"]);
  });

  it("a brainstorm opened on the desk stays where it was opened", () => {
    const p = placeDesk([block("a", NOW), { ...block("n", NOW), anchor: { x: 4000, y: 900 } }], NOW);
    expect(p.offsets.n).toEqual({ x: 4000, y: 900 });
    expect(p.headings[0].count).toBe(1);
  });
});

describe("searchDesk", () => {
  const item = (id: string, name: string, state: ChoiceItem["state"], isQuestion = false): ChoiceItem => ({
    id,
    name,
    state,
    isQuestion,
  });
  const entries: SearchEntry[] = [
    { item: item("q", "Pricing page?", "decided", true), key: "q", ws: "hive", board: "Pricing page?" },
    { item: item("o1", "Usage pricing", "rejected"), key: "q", ws: "hive", board: "Pricing page?" },
    { item: item("o2", "Per-seat pricing", "chosen"), key: "q", ws: "hive", board: "Pricing page?" },
    { item: item("o3", "Free tier", "open"), key: "q", ws: "hive", board: "Pricing page?" },
  ];

  it("finds cards by text, decisions first, dropped last", () => {
    expect(searchDesk(entries, "pricing").map((e) => e.item.id)).toEqual(["q", "o2", "o1"]);
    expect(searchDesk(entries, "  ")).toEqual([]);
  });
});

describe("cardActions", () => {
  const item = (state: ChoiceItem["state"], isQuestion = false): ChoiceItem => ({
    id: "x",
    name: "x",
    state,
    isQuestion,
  });
  const labels = (i: ChoiceItem, pencil = false, person = false) =>
    cardActions(i, { pencil, person }).map((a) => a.label);

  it("an open option leads with Go with; a chosen one with a follow-up; a dropped one can only be reopened", () => {
    expect(labels(item("open"))).toEqual(["Go with", "Expand", "Ask a follow-up", "Drop"]);
    expect(labels(item("chosen"))).toEqual(["Ask a follow-up", "Expand", "Deselect"]);
    expect(labels(item("rejected"))).toEqual(["Reopen"]);
  });

  it("a question takes another option first; a person's own card can be rewritten", () => {
    expect(labels(item("open", true))).toEqual(["+ Option", "Ask Jamie for options"]);
    expect(labels(item("decided", true), false, true)).toEqual(["+ Option", "Ask Jamie for options", "Reopen", "Edit"]);
  });

  it("an unsaved card offers only pencil actions", () => {
    expect(labels(item("open"), true)).toEqual(["Ask a follow-up", "Edit", "Discard"]);
    expect(labels(item("open", true), true)).toEqual(["+ Option", "Edit", "Discard"]);
  });
});
