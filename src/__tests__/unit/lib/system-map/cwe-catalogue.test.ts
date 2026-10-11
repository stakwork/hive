import { describe, expect, it, vi, beforeEach } from "vitest";
import { listCweView, loadCweRelated } from "@/lib/system-map/cwe-catalogue";
import * as infosec from "@/lib/system-map/infosec-graph";

vi.mock("@/lib/system-map/infosec-graph", () => ({
  findInfosecNode: vi.fn(),
  expandInfosecNode: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function cwe(id: string, props: Record<string, unknown> = {}) {
  return {
    ref_id: `ref-${id}`,
    node_type: "CWE",
    properties: { cwe_id: id, name: `name ${id}`, kind: "weakness", mapping_usage: "Allowed", ...props },
  };
}

const CATALOGUE = Object.fromEntries(
  [
    cwe("CWE-1435", { kind: "view", name: "Top 25" }),
    cwe("CWE-1344", { kind: "view", name: "OWASP" }),
    cwe("CWE-1345", { kind: "category", name: "A01" }),
    cwe("CWE-79"),
    cwe("CWE-284", { mapping_usage: "Discouraged", abstraction: "Pillar" }),
    cwe("CWE-285", { mapping_usage: "Discouraged" }),
    cwe("CWE-862", { mapping_usage: "Allowed-with-Review" }),
    cwe("CWE-863"),
    cwe("CWE-999", { cwe_status: "Deprecated" }),
  ].map((node) => [node.ref_id, node]),
);

/**
 * edges[refId] → what `expandInfosecNode(refId, edgeTypes)` returns: the
 * matching edges plus the node itself and its neighbours, like jarvis' expand.
 */
function edgesFor(map: Record<string, Array<[string, string, string]>>) {
  vi.mocked(infosec.expandInfosecNode).mockImplementation(async (refId, edgeTypes) => {
    const edges = (map[refId] ?? [])
      .filter(([, type]) => edgeTypes.includes(type))
      .map(([source, edge_type, target]) => ({ source, edge_type, target }));
    const refs = new Set([refId, ...edges.flatMap((e) => [e.source, e.target])]);
    return { edges, nodes: [...refs].map((ref) => CATALOGUE[ref]).filter(Boolean) };
  });
}

describe("listCweView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(infosec.findInfosecNode).mockImplementation(async (_type, key) =>
      CATALOGUE[`ref-${key}`] ? `ref-${key}` : null,
    );
  });

  it("looks the view up and lists its members, walking unusable ones for usable children", async () => {
    edgesFor({
      "ref-CWE-1435": [
        ["ref-CWE-79", "MEMBER_OF", "ref-CWE-1435"],
        ["ref-CWE-284", "MEMBER_OF", "ref-CWE-1435"],
      ],
      "ref-CWE-284": [["ref-CWE-284", "PARENT_OF", "ref-CWE-285"], ["ref-CWE-284", "PARENT_OF", "ref-CWE-999"]],
      "ref-CWE-285": [["ref-CWE-285", "PARENT_OF", "ref-CWE-862"], ["ref-CWE-285", "PARENT_OF", "ref-CWE-863"]],
    });

    const result = await listCweView("CWE-1435");

    expect(infosec.findInfosecNode).toHaveBeenCalledWith("CWE", "CWE-1435");
    expect(infosec.expandInfosecNode).toHaveBeenCalledWith("ref-CWE-1435", ["MEMBER_OF"], 1000);
    expect(infosec.expandInfosecNode).toHaveBeenCalledWith("ref-CWE-284", ["PARENT_OF"], 1000);
    if (!result.ok) throw new Error(result.error);
    expect(result.view).toEqual({ id: "CWE-1435", name: "Top 25" });
    expect(result.members.map((m) => [m.id, m.usableChildren.map((c) => [c.id, c.via])])).toEqual([
      ["CWE-79", []],
      [
        "CWE-284",
        [
          ["CWE-862", ["CWE-285"]],
          ["CWE-863", ["CWE-285"]],
        ],
      ],
    ]);
  });

  it("flattens an OWASP view's categories into their weaknesses", async () => {
    edgesFor({
      "ref-CWE-1344": [["ref-CWE-1345", "MEMBER_OF", "ref-CWE-1344"]],
      "ref-CWE-1345": [
        ["ref-CWE-862", "MEMBER_OF", "ref-CWE-1345"],
        ["ref-CWE-863", "MEMBER_OF", "ref-CWE-1345"],
      ],
    });

    const result = await listCweView("CWE-1344");

    if (!result.ok) throw new Error(result.error);
    expect(result.members.map((m) => [m.id, m.category?.id])).toEqual([
      ["CWE-862", "CWE-1345"],
      ["CWE-863", "CWE-1345"],
    ]);
  });

  it("reads each node's children once even when members share it", async () => {
    edgesFor({
      "ref-CWE-1435": [
        ["ref-CWE-284", "MEMBER_OF", "ref-CWE-1435"],
        ["ref-CWE-285", "MEMBER_OF", "ref-CWE-1435"],
      ],
      "ref-CWE-284": [["ref-CWE-284", "PARENT_OF", "ref-CWE-285"]],
      "ref-CWE-285": [["ref-CWE-285", "PARENT_OF", "ref-CWE-862"]],
    });

    await listCweView("CWE-1435");

    const reads = vi.mocked(infosec.expandInfosecNode).mock.calls.filter(([ref]) => ref === "ref-CWE-285");
    expect(reads).toHaveLength(1);
  });

  it("says so when the view is not on the infosec graph", async () => {
    vi.mocked(infosec.findInfosecNode).mockResolvedValue(null);

    expect(await listCweView("CWE-1435")).toEqual({
      ok: false,
      error: "CWE-1435 is not in the infosec graph's CWE catalogue",
    });
  });

  it("reports a failed lookup as the infosec graph's", async () => {
    vi.mocked(infosec.findInfosecNode).mockRejectedValue(new Error("402 Payment required"));

    expect(await listCweView("CWE-1435")).toEqual({ ok: false, error: "Infosec graph: 402 Payment required" });
  });

  it("keeps the member but reports a failed children walk", async () => {
    vi.mocked(infosec.expandInfosecNode).mockImplementation(async (refId) => {
      if (refId !== "ref-CWE-1435") throw new Error("timeout");
      return {
        edges: [{ source: "ref-CWE-284", edge_type: "MEMBER_OF", target: "ref-CWE-1435" }],
        nodes: [CATALOGUE["ref-CWE-1435"], CATALOGUE["ref-CWE-284"]],
      };
    });

    const result = await listCweView("CWE-1435");

    expect(result.ok && result.members[0]).toMatchObject({
      id: "CWE-284",
      usableChildren: [],
      childrenError: "Infosec graph: timeout",
    });
  });
});

describe("loadCweRelated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sorts a CWE's outgoing related edges into buckets with their facts, in one filtered expand", async () => {
    vi.mocked(infosec.expandInfosecNode).mockResolvedValue({
      nodes: [
        { ref_id: "cwe", node_type: "CWE", properties: { cwe_id: "CWE-79" } },
        { ref_id: "m1", node_type: "Mitigation", properties: { name: "Encode output", phases: ["Implementation"], description: "d" } },
        { ref_id: "d1", node_type: "DetectionMethod", properties: { name: "Automated Static Analysis" } },
        { ref_id: "p1", node_type: "SysTechnology", properties: { name: "JavaScript" } },
        { ref_id: "x", node_type: "CWE", properties: { cwe_id: "CWE-80" } },
      ],
      edges: [
        { source: "cwe", target: "m1", edge_type: "MITIGATED_BY", properties: { ordinal: 1 } },
        { source: "cwe", target: "d1", edge_type: "DETECTABLE_BY", properties: { effectiveness: "High" } },
        { source: "cwe", target: "p1", edge_type: "APPLIES_TO", properties: { prevalence: "Often" } },
        { source: "x", target: "cwe", edge_type: "MITIGATED_BY", properties: {} },
      ],
    });

    const related = await loadCweRelated("cwe");

    expect(infosec.expandInfosecNode).toHaveBeenCalledWith("cwe", [
      "HAS_TEST_TEMPLATE",
      "MITIGATED_BY",
      "DETECTABLE_BY",
      "APPLIES_TO",
    ]);
    expect(related).toEqual({
      status: "ready",
      templates: [],
      mitigations: [
        { refId: "m1", nodeType: "Mitigation", name: "Encode output", description: "d", details: ["Implementation", "primary"] },
      ],
      detection: [
        { refId: "d1", nodeType: "DetectionMethod", name: "Automated Static Analysis", description: null, details: ["effectiveness High"] },
      ],
      platforms: [{ refId: "p1", nodeType: "SysTechnology", name: "JavaScript", description: null, details: ["Often"] }],
    });
  });
});
