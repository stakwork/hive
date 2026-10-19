import { describe, expect, it } from "vitest";
import { mockBrainstormList, mockChoiceTree, mockLargeTree, MOCK_LARGE_ROOT } from "@/app/api/mock/graph/workbench-fixture";
import { buildChoiceTree } from "@/app/org/[githubLogin]/_components/artifacts/viewers/ChoiceTree";
import { deselectDraft, dropDraft, expandDraft, goWithDraft, reopenDraft } from "@/app/org/[githubLogin]/_components/brainstorm-board/actions";
import { boardCardHeight, CARD_W, layoutBoard } from "@/app/org/[githubLogin]/_components/brainstorm-board/layout";
import { matchMember } from "@/app/org/[githubLogin]/_components/brainstorm-board/model";

const mock = mockLargeTree();
const tree = buildChoiceTree(mock.nodes, mock.edges, MOCK_LARGE_ROOT);
const item = (id: string) => tree.items.find((i) => i.id === id)!;

describe("the large mock", () => {
  it("is the default brainstorm and a production-sized tree", () => {
    expect(mockBrainstormList()[0].ref_id).toBe(MOCK_LARGE_ROOT);
    expect(tree.items.length).toBeGreaterThanOrEqual(30);
    expect(item("mock-bl-q2-b").state).toBe("open");
    expect(item("mock-bl-q2-b").letter).toBe("2B");
    expect(item(MOCK_LARGE_ROOT).name.length).toBeGreaterThan(80);
  });

  it("opens any node as its own root", () => {
    const sub = mockChoiceTree("mock-bl-q2-c-q");
    expect(sub.nodes[0].ref_id).toBe("mock-bl-q2-c-q");
    expect(sub.nodes.length).toBeLessThan(mock.nodes.length);
  });
});

describe("layoutBoard", () => {
  const layout = layoutBoard(tree);
  const box = (id: string) => ({ ...layout.positions[id], w: CARD_W, h: layout.heights[id] });

  it("places every item, with the root leftmost and each child to the right of its parent", () => {
    expect(Object.keys(layout.positions).sort()).toEqual(tree.items.map((i) => i.id).sort());
    for (const l of tree.links) expect(layout.positions[l.target].x).toBeGreaterThan(layout.positions[l.source].x + CARD_W);
    const root = layout.positions[MOCK_LARGE_ROOT].x;
    for (const i of tree.items) expect(layout.positions[i.id].x).toBeGreaterThanOrEqual(root);
  });

  it("orders siblings top to bottom as buildChoiceTree orders them", () => {
    const kids = new Map<string, string[]>();
    for (const l of tree.links) kids.set(l.source, [...(kids.get(l.source) ?? []), l.target]);
    for (const [, ids] of kids) {
      const ys = ids.map((id) => layout.positions[id].y);
      expect(ys).toEqual([...ys].sort((a, b) => a - b));
    }
  });

  it("never overlaps two cards, with estimated or selected sizes", () => {
    for (const selectedId of [null, "mock-bl-q2-b", MOCK_LARGE_ROOT]) {
      const l = layoutBoard(tree, selectedId);
      const ids = tree.items.map((i) => i.id);
      for (let a = 0; a < ids.length; a++) {
        for (let b = a + 1; b < ids.length; b++) {
          const p = { ...l.positions[ids[a]], h: l.heights[ids[a]] };
          const q = { ...l.positions[ids[b]], h: l.heights[ids[b]] };
          const apart = p.x + CARD_W <= q.x || q.x + CARD_W <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
          expect(apart, `${ids[a]} overlaps ${ids[b]}`).toBe(true);
        }
      }
    }
  });

  it("uses measured heights over estimates", () => {
    const l = layoutBoard(tree, null, { "mock-bl-q2-b": 400 });
    expect(l.heights["mock-bl-q2-b"]).toBe(400);
    expect(box("mock-bl-q2-b").h).toBeLessThan(400);
  });

  it("a selected card is taller than an unselected one", () => {
    expect(boardCardHeight(item("mock-bl-q2-b"), true)).toBeGreaterThan(boardCardHeight(item("mock-bl-q2-b"), false));
  });
});

describe("signatures", () => {
  const members = [{ id: "u-bob", name: "Bob Dev", image: "t.png", githubUsername: null }];
  it("only members sign: plain user and unknown names do not", () => {
    expect(matchMember(members, item("mock-bl-q1-b"))?.id).toBe("u-bob");
    expect(matchMember(members, item("mock-bl-q1-c"))).toBeNull();
    expect(matchMember(members, item("mock-bl-q2-b"))).toBeNull();
    expect(matchMember([], item("mock-bl-q1-b"))).toBeNull();
  });
});

describe("drafts", () => {
  it("compose the messages the buttons leave in the chat", () => {
    const o = item("mock-bl-q2-b");
    expect(goWithDraft(o)).toBe(`Go with 2B: "${o.name}" (mock-bl-q2-b)`);
    expect(expandDraft(o)).toBe(`Expand 2B: "${o.name}" (mock-bl-q2-b)`);
    expect(deselectDraft(o)).toBe(`Deselect 2B: "${o.name}" (mock-bl-q2-b)`);
    expect(dropDraft(o)).toBe(`Drop 2B: "${o.name}" (mock-bl-q2-b)`);
    expect(reopenDraft(o)).toBe(`Reopen 2B: "${o.name}" (mock-bl-q2-b)`);
  });
});
