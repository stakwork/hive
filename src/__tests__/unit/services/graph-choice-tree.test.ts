import { describe, test, expect, vi, beforeEach } from "vitest";
import { runWorkspaceGraphQuery } from "@/services/graph/query";
import { getChoiceTree } from "@/services/graph/workbench";

vi.mock("@/services/graph/query", () => ({ runWorkspaceGraphQuery: vi.fn() }));

const mockedQuery = vi.mocked(runWorkspaceGraphQuery);
const caller = { slug: "ws", userId: "user-1" };
const meta = { requestedLimit: 1000, limitRewritten: false };
const FOCUS = "1d184bca-d7fd-4754-9977-f38d69d3f88f";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("USE_MOCKS", "false");
  mockedQuery.mockImplementation(async ({ query }) => {
    const q = String(query);
    // Columns deliberately in a different order than RETURN.
    if (q.includes("AS props")) {
      return {
        ok: true,
        meta,
        data: {
          columns: ["props", "labels", "id"],
          rows: [
            [[["text", "Root?"], ["question_id", 1], ["made_by", "user"], ["state", "decided"]], ["Data_Bank", "Question"], FOCUS],
            [[["text", "Opt"], ["choice_id", 2], ["kind", "option"], ["made_by", "model"], ["state", "open"]], ["Choice"], "child-1"],
            [[["text", "Old"], ["choice_id", 3], ["kind", "question"]], ["Choice"], "child-2"],
            [[["text", "New"], ["option_id", 4], ["kind", "option"]], ["Data_Bank", "Option"], "child-3"],
          ],
        },
      };
    }
    return { ok: true, meta, data: { columns: ["target", "source"], rows: [["child-1", FOCUS]] } };
  });
});

describe("getChoiceTree", () => {
  test("parses nodes and edges from upstream's shape, whatever the column order", async () => {
    const res = await getChoiceTree(caller, FOCUS);
    expect(res).toEqual({
      ok: true,
      data: {
        nodes: [
          { ref_id: FOCUS, type: "Question", properties: { text: "Root?", question_id: 1, made_by: "user", state: "decided" } },
          { ref_id: "child-1", type: "Choice", properties: { text: "Opt", choice_id: 2, kind: "option", made_by: "model", state: "open" } },
          { ref_id: "child-2", type: "Choice", properties: { text: "Old", choice_id: 3, kind: "question" } },
          { ref_id: "child-3", type: "Option", properties: { text: "New", option_id: 4, kind: "option" } },
        ],
        edges: [{ source: FOCUS, target: "child-1" }],
        truncated: false,
      },
    });
  });

  test("queries all three labels by default, with the focus and PARENT_OF, never node_type", async () => {
    await getChoiceTree(caller, FOCUS);
    const qs = mockedQuery.mock.calls.map(([a]) => String(a.query));
    expect(qs).toHaveLength(2);
    expect(qs.find((q) => q.includes("AS props"))).toContain("labels(n) AS labels");
    for (const q of qs) {
      expect(q).toContain("`Choice`");
      expect(q).toContain("`Option`");
      expect(q).toContain("`Question`");
      expect(q).toContain(`ref_id: '${FOCUS}'`);
      expect(q).toContain("PARENT_OF");
      expect(q).not.toContain("node_type");
    }
  });

  test("a label list restricts the query", async () => {
    await getChoiceTree(caller, FOCUS, ["Question"]);
    for (const [a] of mockedQuery.mock.calls) {
      expect(String(a.query)).toContain("`Question`");
      expect(String(a.query)).not.toContain("`Choice`");
    }
  });

  test("mock mode returns a question in the middle, typed", async () => {
    vi.stubEnv("USE_MOCKS", "true");
    const res = await getChoiceTree(caller, FOCUS);
    expect(res.ok && res.data.nodes.map((n) => n.type)).toEqual(["Question", "Question", "Question", "Option", "Option", "Option", "Question", "Option", "Option"]);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  test("flags truncation at the row cap", async () => {
    mockedQuery.mockResolvedValueOnce({
      ok: true,
      meta,
      data: { columns: ["id", "props"], rows: Array.from({ length: 1000 }, (_, i) => [`n${i}`, []]) },
    });
    const res = await getChoiceTree(caller, FOCUS);
    expect(res.ok && res.data.truncated).toBe(true);
  });

  test("rejects a bad label or ref_id without querying", async () => {
    for (const [focus, labels] of [[FOCUS, ["Choice`) DETACH DELETE n //"]], [FOCUS, ["Choice", ""]], [FOCUS, []], ["x'}) RETURN 1 //", ["Choice"]]] as const) {
      const res = await getChoiceTree(caller, focus, [...labels]);
      expect(res).toMatchObject({ ok: false, status: 400 });
    }
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  test("passes a query failure through", async () => {
    mockedQuery.mockResolvedValue({ ok: false, status: 503, message: "down" });
    expect(await getChoiceTree(caller, FOCUS)).toMatchObject({ ok: false, status: 503 });
  });

  describe("effects", () => {
    const effectRows = [
      { ref_id: "e1", name: "Low", description: "d", direction: "pro", impact: 0.2 },
      { ref_id: "e2", name: "High", description: "d", direction: "con", impact: 1.7 },
      { ref_id: "e3", name: "", description: "", direction: "pro", impact: 0.5 },
      { ref_id: "e4", name: "Bad dir", direction: "meh", impact: 0.5 },
      { ref_id: "e5", name: "No impact", direction: "pro", impact: "x" },
    ];
    beforeEach(() => {
      mockedQuery.mockImplementation(async ({ query }) => {
        if (String(query).includes("AS props")) {
          return {
            ok: true,
            meta,
            data: {
              columns: ["effects", "props", "labels", "id"],
              rows: [
                [[], [["text", "Q"]], ["Question"], FOCUS],
                [effectRows, [["text", "A"]], ["Option"], "o1"],
                [effectRows, [["text", "Q2"]], ["Question"], "q2"],
                [[], [["text", "B"]], ["Option"], "o2"],
              ],
            },
          };
        }
        return { ok: true, meta, data: { columns: ["source", "target"], rows: [] } };
      });
    });

    test("maps, sanitizes and sorts effects on options only; keeps them out of the tree walk", async () => {
      const res = await getChoiceTree(caller, FOCUS);
      if (!res.ok) throw new Error("expected ok");
      const by = Object.fromEntries(res.data.nodes.map((n) => [n.ref_id, n]));
      expect(by.o1.effects).toEqual([
        { ref_id: "e2", name: "High", description: "d", direction: "con", impact: 1 },
        { ref_id: "e1", name: "Low", description: "d", direction: "pro", impact: 0.2 },
        { ref_id: "e5", name: "No impact", description: "", direction: "pro", impact: null },
      ]);
      expect(by.q2.effects).toBeUndefined();
      expect(by[FOCUS].effects).toBeUndefined();
      expect(by.o2.effects).toBeUndefined();
      const q = mockedQuery.mock.calls.map(([a]) => String(a.query)).find((x) => x.includes("AS props"))!;
      expect(q).toContain("HAS_EFFECT");
      expect(q).toContain("AS effects");
      expect(q).toContain("`Question`");
      expect(q).not.toContain("`Effect`");
    });
  });
});
