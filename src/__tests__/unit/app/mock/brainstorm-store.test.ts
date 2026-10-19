import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  mockBrainstormListWithWrites,
  mockBrainstormWrite,
  mockChoiceTreeWithWrites,
  resetMockBrainstormStore,
} from "@/app/api/mock/graph/brainstorm-store";
import { MOCK_BOARD_ROOT, mockBoardTree } from "@/app/api/mock/graph/workbench-fixture";

const LABELS = ["Question", "Option", "Choice"];

beforeEach(() => resetMockBrainstormStore());

describe("mock brainstorm store", () => {
  test("with no saves the tree is the fixture, stamped with when it was added", () => {
    vi.useFakeTimers({ now: new Date("2026-10-19T12:00:00Z") });
    try {
      const at = Date.now() - 86400000 - 3600000; // the board mock is a day old
      const fixture = mockBoardTree(LABELS);
      const tree = mockChoiceTreeWithWrites(MOCK_BOARD_ROOT, LABELS);
      expect(tree).toEqual({
        ...fixture,
        nodes: fixture.nodes.map((n) => ({ ...n, properties: { date_added_to_graph: at, ...n.properties } })),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("a saved card reads back under its parent, and a saved change applies to a fixture card", () => {
    const [question] = mockBoardTree(LABELS).nodes.filter((n) => n.type === "Question");
    const created = mockBrainstormWrite({
      creates: [
        {
          temp: "t1",
          nodeType: "Option",
          data: { text: "Hand-written", state: "open" },
          parent: { ref: question.ref_id },
        },
      ],
      patches: { [question.ref_id]: { state: "decided" } },
      links: [],
    });
    const tree = mockChoiceTreeWithWrites(MOCK_BOARD_ROOT, LABELS);
    expect(tree.nodes.find((n) => n.ref_id === created.t1)?.properties.text).toBe("Hand-written");
    expect(tree.edges).toContainEqual({ source: question.ref_id, target: created.t1 });
    expect(tree.nodes.find((n) => n.ref_id === question.ref_id)?.properties.state).toBe("decided");
  });

  test("a removed card and everything under it drop out", () => {
    const tree = mockBoardTree(LABELS);
    const parent = tree.edges[0].target;
    mockBrainstormWrite({ creates: [], patches: { [parent]: { deleted_at: 1, is_deleted: true } }, links: [] });
    const ids = mockChoiceTreeWithWrites(MOCK_BOARD_ROOT, LABELS).nodes.map((n) => n.ref_id);
    expect(ids).not.toContain(parent);
  });

  test("a new brainstorm leads the list and opens as its own tree", () => {
    const created = mockBrainstormWrite({
      creates: [
        { temp: "q", nodeType: "Question", data: { text: "Fresh?", state: "open" }, parent: null },
        { temp: "o", nodeType: "Option", data: { text: "Yes", state: "open" }, parent: { temp: "q" } },
      ],
      patches: {},
      links: [],
    });
    expect(mockBrainstormListWithWrites()[0]).toEqual({
      ref_id: created.q,
      text: "Fresh?",
      job: null,
      made_by: "user",
    });
    const tree = mockChoiceTreeWithWrites(created.q, LABELS);
    expect(tree.nodes.map((n) => n.ref_id).sort()).toEqual([created.q, created.o].sort());
  });
});
