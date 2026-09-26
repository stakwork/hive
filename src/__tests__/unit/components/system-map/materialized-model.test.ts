/**
 * Unit tests for `MaterializedGraph/model.ts` — the parser and grouping for
 * the `swarm-systemmap-graph-materialize` output.
 *
 * Coverage: accepted (observedGraph) and rejected (rejectedItems) merged
 * with a status; `proposed_id` used as the id of a rejected node; coverage
 * counts and version read; rejection reasons tallied; grouping by type
 * and relation with status counts; filtering by status and text; canvas
 * elements typed by mode with dangling edges left undrawn; non-matching
 * output → null.
 */

import { describe, it, expect } from "vitest";
import {
  buildCanvasElements,
  edgeStyleForLabel,
  encodeEdgeLabel,
  groupEdgesByType,
  groupNodesByType,
  parseMaterializedGraph,
  reasonCategory,
  STATUS_HEX,
  typeFamily,
  FAMILY_COLOR_MAP,
  type MaterializedStatus,
} from "@/components/system-map/MaterializedGraph/model";
import { MATERIALIZED_FIXTURE } from "./materialized-fixture";

const NO_FILTER = { statuses: new Set<MaterializedStatus>(), query: "" };

describe("parseMaterializedGraph", () => {
  it("merges accepted and rejected items with a status and reads the run metadata", () => {
    const g = parseMaterializedGraph(MATERIALIZED_FIXTURE)!;
    expect(g.nodes.map((n) => [n.id, n.status])).toEqual([
      ["tech:postgres", "accepted"],
      ["app:hive", "rejected"],
      ["tech:nextjs", "rejected"],
      ["tech:express", "rejected"],
      ["cache:hive-redis-instance", "rejected"],
    ]);
    expect(g.nodes[1].name).toBe("hive");
    expect(g.nodes[1].type).toBe("SysWebApplication");
    expect(g.nodes[1].reasons).toEqual(["missing_required_properties:id"]);
    expect(g.nodes[1].properties.description).toMatch(/Next\.js/);
    expect(g.edges.map((e) => [e.edgeType, e.status])).toEqual([
      ["USES_TECHNOLOGY", "accepted"],
      ["USES_TECHNOLOGY", "rejected"],
      ["CONNECTS_TO", "rejected"],
      ["USES_TECHNOLOGY", "rejected"],
    ]);
    expect(g.coverage.nodes).toEqual({ accepted: 1, rejected: 4 });
    expect(g.coverage.edges).toEqual({ accepted: 1, rejected: 3 });
    expect(g.coverage.observedNodeTypes).toBe(1);
    expect(g.coverage.allowedNodeTypes).toBe(144);
    expect(g.ontologyVersion).toEqual({ hash: MATERIALIZED_FIXTURE.ontologyVersion.hash, match: true, typeCount: 144, edgeCount: 167 });
    expect(g.swarmUrl).toBe("https://swarm38.sphinx.chat:3355");
    expect(g.note).toMatch(/^Ontology fetched/);
  });

  it("tallies rejection reasons most frequent first and counts dangling edges", () => {
    const g = parseMaterializedGraph(MATERIALIZED_FIXTURE)!;
    expect(g.reasons).toEqual([
      { reason: "missing_required_properties:id", count: 4 },
      { reason: "missing_endpoint:source", count: 3 },
      { reason: "missing_endpoint:target", count: 2 },
    ]);
    expect(g.reasonCategories).toEqual([
      { category: "missing_endpoint", count: 5, variants: 2 },
      { category: "missing_required_properties", count: 4, variants: 1 },
    ]);
    // svc:staklink-ext-server is not among the nodes.
    expect(g.danglingEdges).toBe(1);
  });

  it("splits a reason into its category", () => {
    expect(reasonCategory("missing_endpoint:source")).toBe("missing_endpoint");
    expect(reasonCategory("invalid_source_target_relationship:EXPOSES::SysWebApplication::SysRESTEndpoint")).toBe(
      "invalid_source_target_relationship",
    );
    expect(reasonCategory("timeout")).toBe("timeout");
  });

  it("derives counts when coverage is absent and returns null for other output", () => {
    const g = parseMaterializedGraph({ observedGraph: { nodes: [{ id: "a", type: "T" }], edges: [] } })!;
    expect(g.coverage.nodes).toEqual({ accepted: 1, rejected: 0 });
    expect(g.ontologyVersion).toBeNull();
    expect(parseMaterializedGraph("done")).toBeNull();
    expect(parseMaterializedGraph({ nodeTypes: [], edges: [], summary: {} })).toBeNull();
    expect(parseMaterializedGraph(null)).toBeNull();
  });
});

describe("grouping and filtering", () => {
  const g = parseMaterializedGraph(MATERIALIZED_FIXTURE)!;

  it("groups nodes by ontology type with status counts", () => {
    const groups = groupNodesByType(g.nodes);
    expect(groups.map((x) => [x.type, x.counts])).toEqual([
      ["SysRelationalDatabaseTechnology", { accepted: 1, rejected: 0 }],
      ["SysWebApplication", { accepted: 0, rejected: 1 }],
      ["SysFrameworkTechnology", { accepted: 0, rejected: 2 }],
      ["SysCacheInstance", { accepted: 0, rejected: 1 }],
    ]);
  });

  it("groups edges by relation and applies the filter", () => {
    expect(groupEdgesByType(g.edges).map((x) => [x.edgeType, x.edges.length])).toEqual([
      ["USES_TECHNOLOGY", 3],
      ["CONNECTS_TO", 1],
    ]);
    const accepted = groupEdgesByType(g.edges, { statuses: new Set<MaterializedStatus>(["accepted"]), query: "" });
    expect(accepted.map((x) => [x.edgeType, x.edges.length])).toEqual([["USES_TECHNOLOGY", 1]]);
    const byText = groupNodesByType(g.nodes, { statuses: new Set(), query: "redis" });
    expect(byText.map((x) => x.type)).toEqual(["SysCacheInstance"]);
    const byReason = groupNodesByType(g.nodes, { statuses: new Set(), query: "missing_required" });
    expect(byReason.reduce((n, x) => n + x.nodes.length, 0)).toBe(4);
  });
});

describe("type families", () => {
  it("reads a type's family off its name", () => {
    expect(typeFamily("SysRESTEndpoint")).toBe("Interface");
    expect(typeFamily("SysWebApplication")).toBe("Component");
    expect(typeFamily("SysBackendService")).toBe("Component");
    expect(typeFamily("SysStorageCloudService")).toBe("Technology");
    expect(typeFamily("SysFrameworkTechnology")).toBe("Technology");
    expect(typeFamily("SysCacheInstance")).toBe("Resource");
    expect(typeFamily("SysEnvironmentVariable")).toBe("Resource");
    expect(typeFamily("SysDeploymentManifest")).toBe("Artifact");
    expect(typeFamily("SysContainerImage")).toBe("Artifact");
    expect(typeFamily("SysDataCapability")).toBe("Capability");
    expect(typeFamily("SysThing")).toBe("Other");
  });
});

describe("canvas", () => {
  const g = parseMaterializedGraph(MATERIALIZED_FIXTURE)!;

  it("colours by family by default, only for families present", () => {
    const out = buildCanvasElements(g, NO_FILTER, "family");
    expect(out.nodes.map((n) => n.type)).toEqual(["Technology", "Component", "Technology", "Technology", "Resource"]);
    expect(Object.keys(out.colorMap)).toEqual(["Component", "Technology", "Resource"]);
    expect(out.colorMap.Component).toBe(FAMILY_COLOR_MAP.Component);
  });

  it("types nodes by ontology type without the Sys prefix and drops dangling edges", () => {
    const out = buildCanvasElements(g, NO_FILTER, "type");
    expect(out.nodes).toHaveLength(5);
    expect(out.nodes[1].type).toBe("WebApplication");
    expect(out.colorMap.WebApplication).toBeDefined();
    // The staklink edge has no source node here.
    expect(out.edges).toHaveLength(3);
  });

  it("types nodes by status when asked", () => {
    const out = buildCanvasElements(g, NO_FILTER, "status");
    expect(out.nodes.map((n) => n.type)).toEqual(["Accepted", "Rejected", "Rejected", "Rejected", "Rejected"]);
    expect(out.colorMap).toEqual({ Accepted: STATUS_HEX.accepted, Rejected: STATUS_HEX.rejected });
  });

  it("styles accepted edges solid and rejected ones dashed", () => {
    expect(edgeStyleForLabel(encodeEdgeLabel("CALLS", "accepted"))).toEqual({ stroke: STATUS_HEX.accepted, strokeWidth: 2 });
    expect(edgeStyleForLabel(encodeEdgeLabel("CALLS", "rejected")).strokeDasharray).toBe("4 3");
  });
});
