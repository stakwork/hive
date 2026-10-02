import { describe, test, expect, vi, beforeEach } from "vitest";
import { runWorkspaceGraphQuery } from "@/services/graph/query";
import { GRAPH_ROW_CAP, getConnectionPage, getHierarchy, getNodeConnections } from "@/services/graph/workbench";

vi.mock("@/services/graph/query", () => ({
  runWorkspaceGraphQuery: vi.fn(),
}));

const mockedQuery = vi.mocked(runWorkspaceGraphQuery);
const caller = { slug: "ws", userId: "user-1" };
const meta = { requestedLimit: 100, limitRewritten: false };

/** What each query returns, by a fragment only that query has. */
const HIERARCHY_NODES = "AS reads";
const HIERARCHY_EDGES = "type(r) AS type";
const NODE = "AS props";
const CONNECTIONS = "AS items";
const CONNECTION_PAGE = "RETURN o.ref_id AS id";

/** Answer each query by the fragment it holds. */
function answer(byFragment: Record<string, { columns: string[]; rows: unknown[][] }>) {
  mockedQuery.mockImplementation(async ({ query }) => {
    const fragment = Object.keys(byFragment).find((f) => String(query).includes(f));
    return { ok: true, data: fragment ? byFragment[fragment] : { columns: [], rows: [] }, meta };
  });
}

const queries = () => mockedQuery.mock.calls.map(([args]) => String(args.query));

/** Jarvis mutes an edge instead of deleting it: every edge read must leave muted edges out. */
const LIVE_EDGE = "coalesce(r.is_muted, false) = false AND coalesce(r.is_deleted, false) = false";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getHierarchy", () => {
  test("rejects a label that could break out of the query without asking the graph", async () => {
    const result = await getHierarchy(caller, "Concept`) DETACH DELETE n //");

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  test("reads rows by column name, whatever order upstream returns them in", async () => {
    answer({
      [HIERARCHY_NODES]: {
        columns: ["reads", "name", "id", "key", "docs", "approvers", "description", "repo"],
        rows: [[3, "Coding", "c-1", "stakwork/hive/coding", "# Coding", ["Tom"], "Root", null]],
      },
      [HIERARCHY_EDGES]: { columns: ["target", "type", "source"], rows: [["c-2", "PARENT_OF", "c-1"]] },
    });

    const result = await getHierarchy(caller, "Concept");

    expect(result).toEqual({
      ok: true,
      data: {
        nodes: [
          {
            id: "c-1",
            key: "stakwork/hive/coding",
            name: "Coding",
            description: "Root",
            docs: "# Coding",
            repo: null,
            reads: 3,
            approvers: ["Tom"],
          },
        ],
        edges: [{ type: "PARENT_OF", source: "c-1", target: "c-2" }],
        truncated: false,
      },
    });
    expect(queries().every((q) => q.includes("`Concept`"))).toBe(true);
    expect(queries().find((q) => q.includes(HIERARCHY_EDGES))).toContain(`WHERE ${LIVE_EDGE}`);
  });

  test("flags a result that hit upstream's row cap", async () => {
    answer({
      [HIERARCHY_NODES]: {
        columns: ["id", "name"],
        rows: Array.from({ length: GRAPH_ROW_CAP }, (_, i) => [`c-${i}`, `C ${i}`]),
      },
    });

    const result = await getHierarchy(caller, "Concept");

    expect(result.ok && result.data.truncated).toBe(true);
  });

  test("passes the membership gate's refusal through", async () => {
    mockedQuery.mockResolvedValue({ ok: false, status: 404, message: "Workspace not found or access denied" });

    const result = await getHierarchy(caller, "Concept");

    expect(result).toEqual({ ok: false, status: 404, message: "Workspace not found or access denied" });
  });
});

describe("getNodeConnections", () => {
  test("rejects a ref_id that could break out of the query", async () => {
    const result = await getNodeConnections(caller, "x' OR 1=1 //");

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  test("says not found when the node doesn't exist", async () => {
    answer({ [NODE]: { columns: ["props", "labels", "name"], rows: [] } });

    expect(await getNodeConnections(caller, "missing")).toMatchObject({ ok: false, status: 404 });
  });

  test("types groups by their labels and merges label sets that share a type", async () => {
    answer({
      [NODE]: {
        columns: ["props", "labels", "name"],
        rows: [
          [
            [
              ["name", "Coding"],
              ["docs", "# Coding"],
            ],
            ["Data_Bank", "Concept"],
            "Coding",
          ],
        ],
      },
      [CONNECTIONS]: {
        columns: ["edge", "outgoing", "labels", "count", "items"],
        rows: [
          [
            "ACCESSED",
            false,
            ["Data_Bank", "Node", "Domain_strut", "StrutToolCall"],
            5,
            [{ id: "t-1", name: "graph_get" }],
          ],
          ["ACCESSED", false, ["Data_Bank", "StrutToolCall"], 4, [{ id: "t-2", name: "graph_search" }]],
          ["MODIFIES", true, ["Data_Bank", "File"], 18549, [{ id: "f-1", name: "route.ts" }]],
        ],
      },
    });

    const result = await getNodeConnections(caller, "c-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.node).toEqual({
      id: "c-1",
      type: "Concept",
      name: "Coding",
      properties: { name: "Coding", docs: "# Coding" },
    });
    // The vectors are left on the swarm, not dropped after the read.
    expect(queries().find((q) => q.includes(NODE))).toContain("NOT k IN ['embeddings','text_embeddings'");
    expect(queries().find((q) => q.includes(CONNECTIONS))).toContain(`-[r]-(o) WHERE ${LIVE_EDGE}`);
    expect(result.data.groups).toEqual([
      {
        edge: "MODIFIES",
        outgoing: true,
        other: "File",
        count: 18549,
        items: [{ id: "f-1", name: "route.ts", type: "File" }],
      },
      {
        edge: "ACCESSED",
        outgoing: false,
        other: "StrutToolCall",
        count: 9,
        items: [
          { id: "t-1", name: "graph_get", type: "StrutToolCall" },
          { id: "t-2", name: "graph_search", type: "StrutToolCall" },
        ],
      },
    ]);
  });
});

describe("getConnectionPage", () => {
  test("rejects an edge type that could break out of the query", async () => {
    const result = await getConnectionPage(caller, {
      refId: "c-1",
      edge: "ACCESSED`]-() DETACH DELETE c //",
      outgoing: false,
      other: "StrutToolCall",
      limit: 25,
    });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  test("follows the group's direction and type, and caps the limit at upstream's", async () => {
    answer({
      [CONNECTION_PAGE]: {
        columns: ["id", "name", "labels"],
        rows: [["t-1", "graph_get", ["Data_Bank", "StrutToolCall"]]],
      },
    });

    const result = await getConnectionPage(caller, {
      refId: "c-1",
      edge: "ACCESSED",
      outgoing: false,
      other: "StrutToolCall",
      limit: 50_000,
    });

    expect(result).toEqual({ ok: true, data: [{ id: "t-1", name: "graph_get", type: "StrutToolCall" }] });
    expect(queries()[0]).toContain(`<-[r:\`ACCESSED\`]-(o:\`StrutToolCall\`) WHERE ${LIVE_EDGE}`);
    expect(mockedQuery.mock.calls[0][0].limit).toBe(GRAPH_ROW_CAP);
  });
});
