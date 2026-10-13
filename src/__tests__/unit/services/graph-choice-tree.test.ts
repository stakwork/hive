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
        ],
        edges: [{ source: FOCUS, target: "child-1" }],
        truncated: false,
      },
    });
  });

  test("queries both labels by default, with the focus and PARENT_OF, never node_type", async () => {
    await getChoiceTree(caller, FOCUS);
    const qs = mockedQuery.mock.calls.map(([a]) => String(a.query));
    expect(qs).toHaveLength(2);
    expect(qs.find((q) => q.includes("AS props"))).toContain("labels(n) AS labels");
    for (const q of qs) {
      expect(q).toContain("`Choice`");
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
    expect(res.ok && res.data.nodes.map((n) => n.type)).toEqual(["Question", "Choice", "Choice", "Question", "Choice", "Choice"]);
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
});
