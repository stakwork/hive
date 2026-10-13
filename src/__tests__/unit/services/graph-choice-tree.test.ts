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
          columns: ["props", "id"],
          rows: [
            [[["text", "Root?"], ["choice_id", 1], ["kind", "question"], ["made_by", "user"], ["state", "chosen"]], FOCUS],
            [[["text", "Opt"], ["choice_id", 2], ["kind", "option"], ["made_by", "model"], ["state", "open"]], "child-1"],
          ],
        },
      };
    }
    return { ok: true, meta, data: { columns: ["target", "source"], rows: [["child-1", FOCUS]] } };
  });
});

describe("getChoiceTree", () => {
  test("parses nodes and edges from upstream's shape, whatever the column order", async () => {
    const res = await getChoiceTree(caller, FOCUS, "Choice");
    expect(res).toEqual({
      ok: true,
      data: {
        nodes: [
          { ref_id: FOCUS, properties: { text: "Root?", choice_id: 1, kind: "question", made_by: "user", state: "chosen" } },
          { ref_id: "child-1", properties: { text: "Opt", choice_id: 2, kind: "option", made_by: "model", state: "open" } },
        ],
        edges: [{ source: FOCUS, target: "child-1" }],
        truncated: false,
      },
    });
  });

  test("queries by label, focus and PARENT_OF, never node_type", async () => {
    await getChoiceTree(caller, FOCUS, "Choice");
    const qs = mockedQuery.mock.calls.map(([a]) => String(a.query));
    expect(qs).toHaveLength(2);
    for (const q of qs) {
      expect(q).toContain("`Choice`");
      expect(q).toContain(`ref_id: '${FOCUS}'`);
      expect(q).toContain("PARENT_OF");
      expect(q).not.toContain("node_type");
    }
  });

  test("flags truncation at the row cap", async () => {
    mockedQuery.mockResolvedValueOnce({
      ok: true,
      meta,
      data: { columns: ["id", "props"], rows: Array.from({ length: 1000 }, (_, i) => [`n${i}`, []]) },
    });
    const res = await getChoiceTree(caller, FOCUS, "Choice");
    expect(res.ok && res.data.truncated).toBe(true);
  });

  test("rejects a bad label or ref_id without querying", async () => {
    for (const [focus, label] of [[FOCUS, "Choice`) DETACH DELETE n //"], [FOCUS, ""], ["x'}) RETURN 1 //", "Choice"]]) {
      const res = await getChoiceTree(caller, focus, label);
      expect(res).toMatchObject({ ok: false, status: 400 });
    }
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  test("passes a query failure through", async () => {
    mockedQuery.mockResolvedValue({ ok: false, status: 503, message: "down" });
    expect(await getChoiceTree(caller, FOCUS, "Choice")).toMatchObject({ ok: false, status: 503 });
  });
});
