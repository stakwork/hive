import { describe, expect, it, vi, beforeEach } from "vitest";
import { listSystemMapDomainNodes } from "@/lib/system-map/domain-nodes";
import * as nodes from "@/services/swarm/api/nodes";

vi.mock("@/services/swarm/api/nodes", () => ({
  listNodesByType: vi.fn(),
  getNodeEdges: vi.fn(),
}));

const CONFIG = { jarvisUrl: "https://jarvis.test", apiKey: "key" };

function node(refId: string, type: string, name?: string, properties: Record<string, unknown> = {}) {
  return { ref_id: refId, node_type: type, properties: { ...properties, ...(name ? { name } : {}) } };
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

    expect(nodes.listNodesByType).toHaveBeenCalledWith(CONFIG, "", 500, { startingAfter: undefined, namespace: "systemmap" });
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
      namespace: "systemmap",
    });
  });

  it("reads and filters a different namespace when the caller passes one (infosec)", async () => {
    vi.mocked(nodes.listNodesByType).mockResolvedValue({
      ok: true,
      nodes: [node("a", "Finding", "kept"), node("b", "Finding", "dropped", { namespace: "systemmap" })],
    });

    const result = await listSystemMapDomainNodes(CONFIG, "infosec");

    expect(nodes.listNodesByType).toHaveBeenCalledWith(CONFIG, "", 500, { startingAfter: undefined, namespace: "infosec" });
    expect(result.ok && result.nodes.map((n) => n.name)).toEqual(["kept"]);
    expect(nodes.getNodeEdges).toHaveBeenCalledWith(CONFIG, "a", {
      limit: 200,
      nodeTypes: ["Finding"],
      namespace: "infosec",
    });
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
      .mockResolvedValueOnce({ ok: true, nodes: Array.from({ length: 500 }, (_, i) => node(`n${i}`, "SysComponent")) })
      .mockResolvedValueOnce({ ok: true, nodes: [node("last", "SysComponent")] });

    const result = await listSystemMapDomainNodes(CONFIG);

    expect(vi.mocked(nodes.listNodesByType).mock.calls[1][3]).toEqual({ startingAfter: "n499", namespace: "systemmap" });
    expect(result.ok && result.nodes).toHaveLength(501);
    expect(result.ok && result.truncated).toBe(false);
  });

  it("fails when the node read fails", async () => {
    vi.mocked(nodes.listNodesByType).mockResolvedValue({ ok: false, nodes: [], error: "401" });

    expect(await listSystemMapDomainNodes(CONFIG)).toEqual({ ok: false, error: "401" });
  });
});

