import { describe, expect, it, vi, beforeEach } from "vitest";
import { listSystemMapDomainNodes } from "@/lib/system-map/domain-nodes";
import * as nodes from "@/services/swarm/api/nodes";

vi.mock("@/services/swarm/api/nodes", () => ({
  listNodesByType: vi.fn(),
  getNodeEdges: vi.fn(),
}));

const CONFIG = { jarvisUrl: "https://jarvis.test", apiKey: "key" };

function node(
  refId: string,
  type: string,
  name?: string,
  properties: Record<string, unknown> = {},
  edges?: Record<string, number>,
) {
  return {
    ref_id: refId,
    node_type: type,
    properties: { ...properties, ...(name ? { name } : {}) },
    ...(edges ? { edges } : {}),
  };
}

function edge(source: string, target: string, edgeType: string) {
  return { source, target, edge_type: edgeType };
}

describe("listSystemMapDomainNodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(nodes.getNodeEdges).mockResolvedValue({ ok: true, edges: [], nodes: [] });
  });

  it("reads the systemmap namespace through /v2/nodes without a type filter", async () => {
    vi.mocked(nodes.listNodesByType).mockResolvedValue({
      ok: true,
      nodes: [node("b", "SysComponent", "stakwork/hive"), node("a", "SysComponent", "stakwork/stakgraph/mcp")],
    });

    const result = await listSystemMapDomainNodes(CONFIG);

    expect(nodes.listNodesByType).toHaveBeenCalledWith(CONFIG, "", 1000, {
      startingAfter: undefined,
      namespace: "systemmap",
      includeEdgeCounts: true,
    });
    expect(result.ok && result.nodes.map((n) => n.name)).toEqual(["stakwork/hive", "stakwork/stakgraph/mcp"]);
    expect(result.ok && result.types).toEqual([{ type: "SysComponent", count: 2 }]);
  });

  it("drops only nodes that name another namespace", async () => {
    vi.mocked(nodes.listNodesByType).mockResolvedValue({
      ok: true,
      nodes: [node("a", "Data_Bank", "kept"), node("b", "Function", "dropped", { namespace: "default" })],
    });

    const result = await listSystemMapDomainNodes(CONFIG);

    expect(result.ok && result.nodes.map((n) => n.name)).toEqual(["kept"]);
  });

  it("takes the edges from the listing and reads none per node when every count is met", async () => {
    vi.mocked(nodes.listNodesByType).mockResolvedValue({
      ok: true,
      nodes: [
        node("a", "SysComponent", "a", {}, { USES: 1 }),
        node("b", "SysTechnology", "b", {}, { USES: 1 }),
        node("c", "Actor", "c", {}, {}),
      ],
      edges: [edge("a", "b", "USES")],
    });

    const result = await listSystemMapDomainNodes(CONFIG);

    expect(result.ok && result.edges).toEqual([{ source: "a", target: "b", edgeType: "USES" }]);
    expect(result.ok && result.edgeReads).toBe(0);
    expect(nodes.getNodeEdges).not.toHaveBeenCalled();
  });

  it("reads per node only the nodes the listing came back short for (the 20-neighbour cap)", async () => {
    vi.mocked(nodes.listNodesByType).mockResolvedValue({
      ok: true,
      nodes: [
        node("hub", "SysComponent", "hub", {}, { DEPENDS_ON: 3 }),
        node("p1", "SysPackage", "p1", {}, { DEPENDS_ON: 1 }),
        node("p2", "SysPackage", "p2", {}, { DEPENDS_ON: 1 }),
        node("p3", "SysPackage", "p3", {}, { DEPENDS_ON: 1 }),
      ],
      edges: [edge("hub", "p1", "DEPENDS_ON"), edge("hub", "p2", "DEPENDS_ON")],
    });
    vi.mocked(nodes.getNodeEdges).mockImplementation(async (_config, refId) => ({
      ok: true,
      nodes: [],
      edges: refId === "hub" || refId === "p3" ? [edge("hub", "p3", "DEPENDS_ON")] : [],
    }));

    const result = await listSystemMapDomainNodes(CONFIG);

    expect(
      vi
        .mocked(nodes.getNodeEdges)
        .mock.calls.map((c) => c[1])
        .sort(),
    ).toEqual(["hub", "p3"]);
    expect(result.ok && result.edgeReads).toBe(2);
    expect(result.ok && result.edges.map((e) => e.target).sort()).toEqual(["p1", "p2", "p3"]);
  });

  it("reads every node per node when the listing carries no edges (an older jarvis)", async () => {
    vi.mocked(nodes.listNodesByType).mockResolvedValue({
      ok: true,
      nodes: [node("a", "SysComponent", "a", {}, { USES: 1 }), node("b", "SysTechnology", "b", {}, { USES: 1 })],
    });

    const result = await listSystemMapDomainNodes(CONFIG);

    expect(result.ok && result.edgeReads).toBe(2);
  });

  it("keeps edges between System Map nodes only, deduplicated", async () => {
    vi.mocked(nodes.listNodesByType).mockResolvedValue({
      ok: true,
      nodes: [node("a", "SysComponent", "a"), node("b", "SysTechnology", "b")],
    });
    vi.mocked(nodes.getNodeEdges).mockImplementation(async (_config, refId) => ({
      ok: true,
      nodes: [],
      edges:
        refId === "a"
          ? [edge("a", "b", "USES"), edge("a", "file-1", "CONTAINS"), edge("a", "a", "SELF")]
          : [edge("a", "b", "USES"), edge("b", "a", "SUPPORTS")],
    }));

    const result = await listSystemMapDomainNodes(CONFIG);

    expect(result.ok && result.edges).toEqual([
      { source: "a", target: "b", edgeType: "USES" },
      { source: "b", target: "a", edgeType: "SUPPORTS" },
    ]);
    // Restricted to the map's own types so endpoint edges can't use up the limit.
    expect(nodes.getNodeEdges).toHaveBeenCalledWith(CONFIG, "a", {
      limit: 200,
      nodeTypes: ["SysComponent", "SysTechnology"],
    });
  });

  it("reads another namespace when asked (infosec), dropping nodes that name a different one", async () => {
    vi.mocked(nodes.listNodesByType).mockResolvedValue({
      ok: true,
      nodes: [node("a", "Finding", "kept"), node("b", "Finding", "dropped", { namespace: "systemmap" })],
    });

    const result = await listSystemMapDomainNodes(CONFIG, "infosec");

    expect(nodes.listNodesByType).toHaveBeenCalledWith(CONFIG, "", 1000, {
      startingAfter: undefined,
      namespace: "infosec",
      includeEdgeCounts: true,
    });
    expect(result.ok && result.nodes.map((n) => n.name)).toEqual(["kept"]);
  });

  it("counts nodes whose edges failed to load instead of failing the read", async () => {
    vi.mocked(nodes.listNodesByType).mockResolvedValue({ ok: true, nodes: [node("a", "SysComponent", "a")] });
    vi.mocked(nodes.getNodeEdges).mockResolvedValue({ ok: false, edges: [], nodes: [], error: "timeout" });

    const result = await listSystemMapDomainNodes(CONFIG);

    expect(result.ok && result.edgeReadFailures).toBe(1);
    expect(result.ok && result.nodes).toHaveLength(1);
  });

  it("pages with the last ref id", async () => {
    vi.mocked(nodes.listNodesByType)
      .mockResolvedValueOnce({ ok: true, nodes: Array.from({ length: 1000 }, (_, i) => node(`n${i}`, "SysComponent")) })
      .mockResolvedValueOnce({ ok: true, nodes: [node("last", "SysComponent")] });

    const result = await listSystemMapDomainNodes(CONFIG);

    expect(vi.mocked(nodes.listNodesByType).mock.calls[1][3]).toEqual({
      startingAfter: "n999",
      namespace: "systemmap",
      includeEdgeCounts: true,
    });
    expect(result.ok && result.nodes).toHaveLength(1001);
    expect(result.ok && result.truncated).toBe(false);
  });

  it("fails when the node read fails", async () => {
    vi.mocked(nodes.listNodesByType).mockResolvedValue({ ok: false, nodes: [], error: "401" });

    expect(await listSystemMapDomainNodes(CONFIG)).toEqual({ ok: false, error: "401" });
  });
});
