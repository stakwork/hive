import { describe, test, expect, vi, beforeEach } from "vitest";
import { runWorkspaceGraphQuery } from "@/services/graph/query";
import { BRAINSTORM_LIST_CAP, getChoiceTree, listBrainstormRoots } from "@/services/graph/workbench";

vi.mock("@/services/graph/query", () => ({ runWorkspaceGraphQuery: vi.fn() }));

const mockedQuery = vi.mocked(runWorkspaceGraphQuery);
const caller = { slug: "ws", userId: "user-1" };
const meta = { requestedLimit: 50, limitRewritten: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("USE_MOCKS", "false");
});

describe("listBrainstormRoots", () => {
  test("parses rows by column name, newest first as upstream ordered them", async () => {
    mockedQuery.mockResolvedValue({
      ok: true,
      meta,
      data: {
        columns: ["made_by", "job", "name", "text", "id"],
        rows: [
          ["user", "job-2", null, "Newer?", "root-2"],
          ["model", null, "Named only", null, "root-1"],
          ["user", null, null, null, "bad id'"],
        ],
      },
    });
    const res = await listBrainstormRoots(caller);
    expect(res).toEqual({
      ok: true,
      data: [
        { ref_id: "root-2", text: "Newer?", job: "job-2", made_by: "user" },
        { ref_id: "root-1", text: "Named only", job: null, made_by: "model" },
      ],
    });
  });

  test("queries question roots: no live PARENT_OF in, nodeLive, newest first, capped", async () => {
    mockedQuery.mockResolvedValue({ ok: true, meta, data: { columns: [], rows: [] } });
    await listBrainstormRoots(caller);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const { query, limit } = mockedQuery.mock.calls[0][0];
    const q = String(query);
    expect(limit).toBe(BRAINSTORM_LIST_CAP);
    expect(q).toContain("`Question`");
    expect(q).toContain("`Choice` AND n.kind = 'question'");
    expect(q).toContain("PARENT_OF");
    expect(q).toContain("n.deleted_at IS NULL");
    expect(q).toContain("p.deleted_at IS NULL");
    expect(q).toContain("parents = 0");
    expect(q).toContain("ORDER BY coalesce(n.date_added_to_graph, 0) DESC, n.ref_id DESC");
    expect(q).toContain(`LIMIT ${BRAINSTORM_LIST_CAP}`);
    expect(q).not.toContain("node_type");
  });

  test("passes an upstream failure through", async () => {
    mockedQuery.mockResolvedValue({ ok: false, status: 502, message: "down" });
    expect(await listBrainstormRoots(caller)).toEqual({ ok: false, status: 502, message: "down" });
  });

  test("USE_MOCKS: four roots, the first the large board mock and the second the board mock the choice tree answers for", async () => {
    vi.stubEnv("USE_MOCKS", "true");
    const res = await listBrainstormRoots(caller);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toHaveLength(4);
    expect(res.data[0].ref_id).toBe("mock-brainstorm-large");
    expect(mockedQuery).not.toHaveBeenCalled();
    const tree = await getChoiceTree(caller, res.data[1].ref_id);
    expect(tree.ok && tree.data.nodes.map((n) => n.properties.state)).toEqual(
      expect.arrayContaining(["decided", "chosen", "rejected", "open", "simulated"]),
    );
    expect(tree.ok && tree.data.nodes[0].properties).toMatchObject({ made_by: "user", speaker: "Tom", job: "job-mock-board" });
  });
});
