import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  DOMAIN_PAGE_ROWS,
  domainEdgesQuery,
  domainNodesQuery,
  listSystemMapDomainNodesCypher,
  parseDomainEdgeRecord,
  parseDomainNodeRecord,
} from "@/lib/system-map/domain-nodes-cypher";
import * as query from "@/services/graph/query";

vi.mock("@/services/graph/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/graph/query")>()),
  runWorkspaceGraphQuery: vi.fn(),
}));

const META = { requestedLimit: DOMAIN_PAGE_ROWS, limitRewritten: false };
const ok = (columns: string[], rows: unknown[][]) => ({ ok: true as const, data: { columns, rows }, meta: META });
const nodeRow = (refId: string, type: string, name: string, extra: [string, unknown][] = []) => [
  refId,
  ["Data_Bank", type],
  [["name", name], ...extra],
];

const run = vi.mocked(query.runWorkspaceGraphQuery);

describe("queries", () => {
  it("are read-only, scoped to the namespace and types, and paged by ref_id", () => {
    for (const q of [
      domainNodesQuery("systemmap", ["SysComponent"], null),
      domainEdgesQuery("systemmap", ["SysComponent"], "c1"),
    ]) {
      expect(query.isWriteQuery(q)).toBe(false);
      expect(q).toContain("namespace = 'systemmap'");
      expect(q).toContain("['SysComponent']");
      expect(q).not.toMatch(/\bLIMIT\b/);
    }
    expect(domainNodesQuery("systemmap", undefined, null)).not.toContain("labels(n) WHERE");
    expect(domainEdgesQuery("systemmap", undefined, "c1")).toContain("AND a.ref_id > 'c1'");
    expect(domainNodesQuery("systemmap", undefined, null)).toContain("'embeddings'");
  });

  it("refuses a cursor that could break out of the string", () => {
    expect(() => domainNodesQuery("systemmap", undefined, "x' OR 1=1 //")).toThrow();
  });

  it("stays within the query service's length cap with every type", () => {
    const all = [
      "SysTrustZone",
      "SysComponent",
      "SysInterface",
      "SysResource",
      "SysDataAsset",
      "SysDataFlow",
      "SysPrincipal",
      "SysActor",
      "Actor",
      "SysTechnology",
      "SysCapability",
      "SysOperation",
      "SysArtifact",
      "SysProtocol",
      "SysPackage",
    ];
    expect(domainEdgesQuery("systemmap", all, "a".repeat(64)).length).toBeLessThan(query.GRAPH_QUERY_MAX_LENGTH);
  });
});

describe("row parsing", () => {
  it("reads a node's type from its System Map label and its properties", () => {
    const node = parseDomainNodeRecord({
      ref_id: "c1",
      labels: ["Data_Bank", "Domain_x", "SysComponent"],
      props: [
        ["name", " api "],
        ["version", "1.0"],
      ],
    });
    expect(node).toEqual({
      refId: "c1",
      type: "SysComponent",
      name: "api",
      properties: { name: " api ", version: "1.0" },
    });
  });

  it("unfolds a source's links", () => {
    expect(parseDomainEdgeRecord({ source: "c1", links: ["p1|DEPENDS_ON", "bad", "p2|USES"] })).toEqual([
      { source: "c1", target: "p1", edgeType: "DEPENDS_ON" },
      { source: "c1", target: "p2", edgeType: "USES" },
    ]);
  });
});

describe("listSystemMapDomainNodesCypher", () => {
  beforeEach(() => {
    run.mockReset();
  });

  it("builds the graph from both queries, keeping edges among the nodes read", async () => {
    run.mockImplementation(async ({ query: q }) =>
      String(q).includes("collect(")
        ? ok(["links", "source"], [[["p1|DEPENDS_ON", "elsewhere|USES", "c1|SELF"], "c1"]])
        : ok(
            ["props", "ref_id", "labels"],
            [
              [[["name", "api"]], "c1", ["Data_Bank", "SysComponent"]],
              [[["name", "lodash"]], "p1", ["Data_Bank", "SysPackage"]],
            ],
          ),
    );
    const result = await listSystemMapDomainNodesCypher({
      slug: "acme",
      userId: "u1",
      types: ["SysComponent", "SysPackage"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodes.map((n) => [n.refId, n.type, n.name])).toEqual([
      ["c1", "SysComponent", "api"],
      ["p1", "SysPackage", "lodash"],
    ]);
    expect(result.edges).toEqual([{ source: "c1", target: "p1", edgeType: "DEPENDS_ON" }]);
    expect(result.truncated).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("pages until a short page, passing the last ref_id as the cursor", async () => {
    const full = Array.from({ length: DOMAIN_PAGE_ROWS }, (_, i) =>
      nodeRow(`n${String(i).padStart(4, "0")}`, "SysComponent", `c${i}`),
    );
    run.mockImplementation(async ({ query: q }) => {
      const text = String(q);
      if (text.includes("collect(")) return ok(["source", "links"], []);
      return text.includes("n.ref_id >")
        ? ok(["ref_id", "labels", "props"], [nodeRow("z1", "SysComponent", "last")])
        : ok(["ref_id", "labels", "props"], full);
    });
    const result = await listSystemMapDomainNodesCypher({ slug: "acme", userId: "u1" });
    expect(result.ok && result.nodes.length).toBe(DOMAIN_PAGE_ROWS + 1);
    expect(run.mock.calls.some(([a]) => String(a.query).includes("n.ref_id > 'n0999'"))).toBe(true);
  });

  it("reports stakgraph's error", async () => {
    run.mockResolvedValue({ ok: false, status: 502, message: "Query failed", details: { error: "boom" } });
    expect(await listSystemMapDomainNodesCypher({ slug: "acme", userId: "u1" })).toEqual({
      ok: false,
      error: "Query failed: boom",
    });
  });

  it("refuses unsafe type names without querying", async () => {
    const result = await listSystemMapDomainNodesCypher({ slug: "acme", userId: "u1", types: ["Sys'Component"] });
    expect(result.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
