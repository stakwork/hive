import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildDependencyPaths,
  listFindings,
  loadFindingPaths,
  loadFindingRelated,
  parseFinding,
} from "@/lib/system-map/findings";
import * as nodes from "@/services/swarm/api/nodes";

vi.mock("@/services/swarm/api/nodes", () => ({
  listNodesByType: vi.fn(),
  getNodeEdges: vi.fn(),
  getNodeAncestors: vi.fn(),
}));

const CONFIG = { jarvisUrl: "https://jarvis.test", apiKey: "key" };

function finding(refId: string, properties: Record<string, unknown>, dateAdded?: number) {
  return { ref_id: refId, node_type: "Finding", properties, date_added_to_graph: dateAdded };
}

describe("parseFinding", () => {
  it("reads the fix tracking written on the node", () => {
    const parsed = parseFinding(
      finding("f9", {
        title: "t",
        fix_state: "launched",
        fix_conversation_id: "c1",
        fix_kind: "code_issue",
        fix_started_by: "u1",
      }),
    );
    expect(parsed?.fix).toMatchObject({ state: "launched", conversationId: "c1", kind: "code_issue", startedBy: "u1" });
  });

  it("reads the common fields under their usual names and keeps every property", () => {
    expect(
      parseFinding(
        finding(
          "f1",
          { name: "XSS in search", severity: "HIGH", cwe: "CWE-79", file_path: "src/a.ts", line: 12 },
          1700000000.5,
        ),
      ),
    ).toEqual({
      refId: "f1",
      title: "XSS in search",
      severity: "high",
      status: null,
      cweId: "CWE-79",
      file: "src/a.ts",
      line: 12,
      fix: null,
      description: null,
      dateAdded: 1700000000.5,
      properties: { name: "XSS in search", severity: "HIGH", cwe: "CWE-79", file_path: "src/a.ts", line: 12 },
    });
  });

  it("falls back to the ref_id for a title", () => {
    expect(parseFinding(finding("f2", {}))?.title).toBe("f2");
  });
});

describe("listFindings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads Finding nodes by type in the infosec namespace and sorts them most severe, then newest, first", async () => {
    vi.mocked(nodes.listNodesByType).mockResolvedValue({
      ok: true,
      nodes: [
        finding("low", { title: "c", severity: "low" }),
        finding("none", { title: "d" }),
        finding("high-old", { title: "b", severity: "high" }, 1),
        finding("high-new", { title: "a", severity: "high" }, 2),
        finding("crit", { title: "e", severity: "critical" }),
      ],
    });

    const result = await listFindings(CONFIG);

    expect(nodes.listNodesByType).toHaveBeenCalledWith(CONFIG, "Finding", 500, {
      startingAfter: undefined,
      namespace: "infosec",
    });
    expect(result.ok && result.findings.map((f) => f.refId)).toEqual(["crit", "high-new", "high-old", "low", "none"]);
    expect(result.ok && result.truncated).toBe(false);
  });

  it("pages with starting_after while pages come back full", async () => {
    const page = (start: number) =>
      Array.from({ length: 500 }, (_, i) => finding(`f${start + i}`, { title: `t${start + i}` }));
    vi.mocked(nodes.listNodesByType)
      .mockResolvedValueOnce({ ok: true, nodes: page(0) })
      .mockResolvedValueOnce({ ok: true, nodes: page(500).slice(0, 10) });

    const result = await listFindings(CONFIG);

    expect(nodes.listNodesByType).toHaveBeenLastCalledWith(CONFIG, "Finding", 500, {
      startingAfter: "f499",
      namespace: "infosec",
    });
    expect(result.ok && result.findings).toHaveLength(510);
  });

  it("reports a failed read", async () => {
    vi.mocked(nodes.listNodesByType).mockResolvedValue({ ok: false, nodes: [], error: "401 Unauthorized" });

    expect(await listFindings(CONFIG)).toEqual({ ok: false, error: "401 Unauthorized" });
  });
});

describe("loadFindingRelated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the finding's edges through jarvis' expand and keeps one row per neighbour edge", async () => {
    vi.mocked(nodes.getNodeEdges).mockResolvedValue({
      ok: true,
      nodes: [
        { ref_id: "f-1", node_type: "Finding", properties: { title: "XSS" } },
        { ref_id: "fn-1", node_type: "Function", properties: { name: "search", file: "src/a.ts" } },
        { ref_id: "cwe-1", node_type: "CWE", properties: { cwe_id: "CWE-79" } },
      ],
      edges: [
        { source: "f-1", target: "fn-1", edge_type: "AFFECTS" },
        { source: "f-1", target: "fn-1", edge_type: "AFFECTS" },
        { source: "cwe-1", target: "f-1", edge_type: "INSTANCE_OF" },
        { source: "fn-1", target: "cwe-1", edge_type: "UNRELATED" },
      ],
    });

    const result = await loadFindingRelated(CONFIG, "f-1");

    expect(nodes.getNodeEdges).toHaveBeenCalledWith(CONFIG, "f-1", { limit: 500 });
    expect(result).toEqual({
      ok: true,
      truncated: false,
      related: [
        {
          refId: "cwe-1",
          nodeType: "CWE",
          edgeType: "INSTANCE_OF",
          direction: "in",
          name: "CWE-79",
          file: null,
          properties: { cwe_id: "CWE-79" },
        },
        {
          refId: "fn-1",
          nodeType: "Function",
          edgeType: "AFFECTS",
          direction: "out",
          name: "search",
          file: "src/a.ts",
          properties: { name: "search", file: "src/a.ts" },
        },
      ],
    });
  });

  it("reports a failed read", async () => {
    vi.mocked(nodes.getNodeEdges).mockResolvedValue({ ok: false, nodes: [], edges: [], error: "502 Bad Gateway" });

    expect(await loadFindingRelated(CONFIG, "f-1")).toEqual({ ok: false, error: "502 Bad Gateway" });
  });
});

function ancestor(refId: string, nodeType: string, depth: number, parents: string[], version?: string) {
  return {
    ref_id: refId,
    name: refId,
    node_type: nodeType,
    depth,
    parents,
    properties: version ? { name: refId, version } : undefined,
  };
}

// peel → sphinx-memes → aws-creds → quick-xml; brain → quick-xml directly; aws-creds also used by staklink.
const ANCESTORS = [
  ancestor("aws-creds", "SysPackage", 1, ["sphinx-memes", "staklink"], "0.36.0"),
  ancestor("brain", "SysComponent", 1, []),
  ancestor("sphinx-memes", "SysPackage", 2, ["peel"], "0.1.0"),
  ancestor("staklink", "SysComponent", 2, []),
  ancestor("peel", "SysComponent", 3, []),
];
const QUICK_XML = { refId: "quick-xml", nodeType: "SysPackage", name: "quick-xml", version: "0.30.0" };
const names = (paths: { name: string; version: string | null }[][]) =>
  paths.map((path) => path.map((s) => (s.version ? `${s.name}@${s.version}` : s.name)).join(" → "));

describe("buildDependencyPaths", () => {
  it("runs from each component down to the package, nearest components first", () => {
    expect(names(buildDependencyPaths(QUICK_XML, ANCESTORS))).toEqual([
      "brain → quick-xml@0.30.0",
      "staklink → aws-creds@0.36.0 → quick-xml@0.30.0",
      "peel → sphinx-memes@0.1.0 → aws-creds@0.36.0 → quick-xml@0.30.0",
    ]);
  });

  it("keeps at most `max` paths", () => {
    expect(names(buildDependencyPaths(QUICK_XML, ANCESTORS, 2))).toEqual([
      "brain → quick-xml@0.30.0",
      "staklink → aws-creds@0.36.0 → quick-xml@0.30.0",
    ]);
  });

  it("does not walk past a component", () => {
    const withParent = [
      ancestor("brain", "SysComponent", 1, ["monorepo"]),
      ancestor("monorepo", "SysComponent", 2, []),
    ];
    expect(names(buildDependencyPaths(QUICK_XML, withParent))).toEqual(["brain → quick-xml@0.30.0"]);
  });

  it("is empty when nothing above the package is a component", () => {
    expect(buildDependencyPaths(QUICK_XML, [ancestor("aws-creds", "SysPackage", 1, [])])).toEqual([]);
  });
});

describe("loadFindingPaths", () => {
  beforeEach(() => vi.clearAllMocks());
  const related = (refId: string, nodeType: string) => ({
    refId,
    nodeType,
    edgeType: "AFFECTS",
    direction: "out" as const,
    name: refId,
    file: null,
    properties: { name: refId, version: "0.30.0" },
  });

  it("walks DEPENDS_ON up from each related package with its properties", async () => {
    vi.mocked(nodes.getNodeAncestors).mockResolvedValue({ ok: true, ancestors: ANCESTORS });

    const result = await loadFindingPaths(CONFIG, [related("cwe-1", "CWE"), related("quick-xml", "SysPackage")]);

    expect(nodes.getNodeAncestors).toHaveBeenCalledTimes(1);
    expect(nodes.getNodeAncestors).toHaveBeenCalledWith(CONFIG, "quick-xml", {
      edgeType: "DEPENDS_ON",
      direction: "in",
      maxDepth: 10,
      includeProperties: true,
    });
    expect(names(result.paths)[0]).toBe("brain → quick-xml@0.30.0");
    expect(result.errors).toEqual([]);
  });

  it("reports a jarvis without the ancestors endpoint and returns no paths", async () => {
    vi.mocked(nodes.getNodeAncestors).mockResolvedValue({
      ok: false,
      ancestors: [],
      status: 404,
      endpointMissing: true,
    });

    expect(await loadFindingPaths(CONFIG, [related("quick-xml", "SysPackage")])).toEqual({
      paths: [],
      errors: ["quick-xml: ancestors endpoint missing"],
    });
  });
});
