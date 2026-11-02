/**
 * Mock mode (`USE_MOCKS`): a small System Map for the org canvas's System
 * view — 2 trust zones, 5 components with their interfaces, resources and
 * repo artifacts — so the view has districts to draw when the mock swarm's
 * graph has no `systemmap` namespace. The repo artifacts are named for the
 * repos the mock jobs' pull requests are in (`strut-artifacts.ts`), so the
 * view's repo → district fallback places the built and in-progress mock
 * features without any stored edge.
 */

import type { SystemMapDomainEdge, SystemMapDomainNode, SystemMapDomainType } from "@/types/system-map";

const node = (refId: string, type: string, name: string, extra: Record<string, unknown> = {}): SystemMapDomainNode => ({
  refId,
  type,
  name,
  properties: { name, ...extra },
});
const edge = (source: string, edgeType: string, target: string): SystemMapDomainEdge => ({ source, target, edgeType });

/** The mock components' ref_ids, for the mock stored edges (`mockSetup.ts`). */
export const MOCK_SYS = {
  web: "mock-sys-web",
  hive: "mock-sys-hive",
  auth: "mock-sys-auth",
  graph: "mock-sys-stakgraph",
  janitor: "mock-sys-janitor",
};

const NODES: SystemMapDomainNode[] = [
  node("mock-sys-zone-device", "SysTrustZone", "device", { boundary_description: "The user's browser" }),
  node("mock-sys-zone-internal", "SysTrustZone", "internal", { boundary_description: "Behind the load balancer" }),
  node(MOCK_SYS.web, "SysComponent", "hive web app", { kind: "frontend", date_added_to_graph: 1 }),
  node(MOCK_SYS.hive, "SysComponent", "hive", { kind: "service", date_added_to_graph: 2 }),
  node(MOCK_SYS.auth, "SysComponent", "auth service", { kind: "service", date_added_to_graph: 3 }),
  node(MOCK_SYS.graph, "SysComponent", "stakgraph", { kind: "service", date_added_to_graph: 4 }),
  node(MOCK_SYS.janitor, "SysComponent", "janitor worker", { kind: "worker", date_added_to_graph: 5 }),
  node("mock-sys-if-ui", "SysInterface", "web ui", { kind: "http" }),
  node("mock-sys-if-api", "SysInterface", "hive REST api", { kind: "http" }),
  node("mock-sys-if-oauth", "SysInterface", "github oauth callback", { kind: "http" }),
  node("mock-sys-if-mcp", "SysInterface", "graph mcp", { kind: "mcp" }),
  node("mock-sys-db-pg", "SysResource", "hive postgres", { kind: "database" }),
  node("mock-sys-db-neo", "SysResource", "graph neo4j", { kind: "database" }),
  node("mock-sys-db-sessions", "SysResource", "session store", { kind: "database" }),
  node("mock-sys-op-sweep", "SysOperation", "nightly sweep"),
  node("mock-sys-art-hive", "SysArtifact", "stakwork/hive"),
  node("mock-sys-art-graph", "SysArtifact", "stakwork/stakgraph"),
  node("mock-sys-art-janitor", "SysArtifact", "stakwork/janitor-runner"),
];

const EDGES: SystemMapDomainEdge[] = [
  edge(MOCK_SYS.web, "IN_ZONE", "mock-sys-zone-device"),
  edge(MOCK_SYS.hive, "IN_ZONE", "mock-sys-zone-internal"),
  edge(MOCK_SYS.auth, "IN_ZONE", "mock-sys-zone-internal"),
  edge(MOCK_SYS.graph, "IN_ZONE", "mock-sys-zone-internal"),
  edge(MOCK_SYS.janitor, "IN_ZONE", "mock-sys-zone-internal"),
  edge("mock-sys-if-ui", "IN_ZONE", "mock-sys-zone-device"),
  edge(MOCK_SYS.web, "EXPOSES", "mock-sys-if-ui"),
  edge(MOCK_SYS.hive, "EXPOSES", "mock-sys-if-api"),
  edge(MOCK_SYS.auth, "EXPOSES", "mock-sys-if-oauth"),
  edge(MOCK_SYS.graph, "EXPOSES", "mock-sys-if-mcp"),
  edge(MOCK_SYS.hive, "READS_FROM", "mock-sys-db-pg"),
  edge(MOCK_SYS.hive, "WRITES_TO", "mock-sys-db-pg"),
  edge(MOCK_SYS.graph, "WRITES_TO", "mock-sys-db-neo"),
  edge(MOCK_SYS.auth, "WRITES_TO", "mock-sys-db-sessions"),
  edge(MOCK_SYS.janitor, "PROVIDES", "mock-sys-op-sweep"),
  edge(MOCK_SYS.hive, "DEPENDS_ON", "mock-sys-art-hive"),
  edge(MOCK_SYS.graph, "DEPENDS_ON", "mock-sys-art-graph"),
  edge(MOCK_SYS.janitor, "DEPENDS_ON", "mock-sys-art-janitor"),
];

/** What the nodes route answers under mocks when the swarm has no System Map of its own. */
export function mockSystemMapNodes(types?: string[]) {
  const allowed = types?.length ? new Set(types) : null;
  const nodes = NODES.filter((n) => !allowed || allowed.has(n.type));
  const ids = new Set(nodes.map((n) => n.refId));
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  const listedTypes: SystemMapDomainType[] = [...counts].map(([type, count]) => ({ type, count }));
  return {
    ok: true as const,
    types: listedTypes,
    nodes,
    edges: EDGES.filter((e) => ids.has(e.source) && ids.has(e.target)),
    truncated: false,
    edgeReadFailures: 0,
    edgeReads: 0,
  };
}
