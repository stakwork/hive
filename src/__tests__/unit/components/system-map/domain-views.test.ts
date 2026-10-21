/**
 * Unit tests for the Domain nodes tab's Architecture and Dependencies
 * models (`DomainNodesTab/architecture.ts`, `dependencies.ts`), on a small
 * graph shaped like a real System Map: an app on the device, a service in
 * several zones, an external API, secrets, a data flow, operations, a
 * lockfile and a few packages.
 */

import { describe, it, expect } from "vitest";
import {
  buildArchitecture,
  GROUP_ID_PREFIX,
  UNPLACED_LANE,
  visibleArrows,
} from "@/components/system-map/DomainNodesTab/architecture";
import { buildDependencies, pullsIn, whyChain } from "@/components/system-map/DomainNodesTab/dependencies";
import type { SystemMapDomainEdge, SystemMapDomainNode } from "@/types/system-map";

function node(refId: string, type: string, properties: Record<string, unknown> = {}): SystemMapDomainNode {
  return { refId, type, name: (properties.name as string) ?? refId, properties };
}
function edge(source: string, edgeType: string, target: string): SystemMapDomainEdge {
  return { source, target, edgeType };
}

const NODES: SystemMapDomainNode[] = [
  node("device", "SysTrustZone", { name: "device", boundary_description: "end-user device" }),
  node("internal", "SysTrustZone", { name: "internal" }),
  node("tailnet", "SysTrustZone", { name: "tailnet" }),
  node("third", "SysTrustZone", { name: "third-party" }),
  node("app", "SysComponent", { name: "app", kind: "frontend" }),
  node("brain", "SysComponent", { name: "brain", kind: "service" }),
  node("api", "SysComponent", { name: "api.example.com", kind: "external" }),
  node("cli", "SysInterface", { name: "app cli", kind: "cli" }),
  node("user", "Actor", { name: "Authenticated User" }),
  node("owner", "SysPrincipal", { name: "device owner" }),
  node("db", "SysResource", { name: "app SQLite", kind: "database" }),
  node("db2", "SysResource", { name: "app.sqlite", kind: "database" }),
  node("vol", "SysResource", { name: "brain volume ./data", kind: "volume" }),
  node("sidecar", "SysResource", { name: "sidecar" }),
  node("sidecarVol", "SysResource", { name: "sidecar volume ts-state" }),
  node("key", "SysDataAsset", { name: "API_KEY", classification: "secret" }),
  node("swift", "SysTechnology", { name: "Swift" }),
  node("op", "SysOperation", { name: "backup" }),
  node("flow", "SysDataFlow", { name: "app -> app SQLite", kind: "read-write" }),
  node("sqlite", "SysProtocol", { name: "SQLite file" }),
  node("lock", "SysArtifact", { name: "Cargo.lock" }),
  node("lonely", "SysProtocol", { name: "MQTT" }),
  node("top", "SysPackage", { name: "top", version: "1.0.0", ecosystem: "crates.io", source_path: "repo/Cargo.lock" }),
  node("mid", "SysPackage", { name: "mid", version: "0.2.0", ecosystem: "crates.io", source_path: "repo/Cargo.lock" }),
  node("leaf1", "SysPackage", {
    name: "leaf",
    version: "1.0.0",
    ecosystem: "crates.io",
    source_path: "repo/Cargo.lock",
  }),
  node("leaf2", "SysPackage", {
    name: "leaf",
    version: "2.0.0",
    ecosystem: "crates.io",
    source_path: "repo/Cargo.lock",
  }),
  node("swiftpkg", "SysPackage", { name: "swift-nio", ecosystem: "Swift", source_path: "repo/Package.resolved" }),
];

const EDGES: SystemMapDomainEdge[] = [
  edge("app", "IN_ZONE", "device"),
  edge("brain", "IN_ZONE", "tailnet"),
  edge("brain", "IN_ZONE", "internal"),
  edge("app", "EXPOSES", "cli"),
  edge("user", "CAN_REACH", "cli"),
  edge("owner", "PLAYS", "user"),
  edge("owner", "CALLS", "cli"),
  edge("app", "READS_FROM", "db"),
  edge("app", "WRITES_TO", "db"),
  edge("flow", "FROM", "app"),
  edge("flow", "TO", "db"),
  edge("flow", "USES_PROTOCOL", "sqlite"),
  edge("app", "DEPENDS_ON", "brain"),
  edge("app", "DEPENDS_ON", "api"),
  edge("app", "USES_TECHNOLOGY", "swift"),
  edge("op", "PART_OF", "app"),
  edge("op", "TARGETS", "db"),
  edge("app", "DEPENDS_ON", "lock"),
  edge("app", "WRITES_TO", "db2"),
  edge("brain", "WRITES_TO", "vol"),
  edge("brain", "PROCESSES", "key"),
  edge("owner", "AUTHENTICATES_WITH", "key"),
  edge("sidecar", "CONTAINS", "sidecarVol"),
  edge("sidecar", "IN_ZONE", "tailnet"),
  edge("app", "DEPENDS_ON", "top"),
  edge("app", "DEPENDS_ON", "mid"),
  edge("app", "DEPENDS_ON", "leaf1"),
  edge("lock", "CONTAINS", "top"),
  edge("top", "DEPENDS_ON", "mid"),
  edge("mid", "DEPENDS_ON", "leaf1"),
  edge("top", "DEPENDS_ON", "leaf2"),
];

describe("buildArchitecture", () => {
  const model = buildArchitecture(NODES, EDGES);
  const card = (id: string) => model.cards.get(id)!;

  it("draws only the architecture types as cards, folding the rest and leaving packages out", () => {
    expect([...model.cards.keys()].sort()).toEqual(
      ["api", "app", "brain", "cli", "db", "db2", "key", "owner", "sidecar", "user", "vol"].sort(),
    );
    expect(model.packageCount).toBe(5);
    expect(model.folded).toEqual(
      expect.arrayContaining([
        { type: "SysTechnology", count: 1 },
        { type: "SysOperation", count: 1 },
        { type: "SysDataFlow", count: 1 },
        { type: "SysArtifact", count: 1 },
      ]),
    );
  });

  it("puts cards in their column", () => {
    expect([
      card("user").column,
      card("owner").column,
      card("cli").column,
      card("app").column,
      card("db").column,
    ]).toEqual([0, 0, 1, 2, 3]);
  });

  it("places lanes by zone, the most inward zone first, externals in third-party, the rest by neighbour", () => {
    expect(card("app").lane).toBe("device");
    expect(card("brain").lane).toBe("internal");
    expect(card("brain").chips).toContainEqual({ label: "also tailnet" });
    expect(card("api").lane).toBe("third-party");
    expect(card("db").lane).toBe("device");
    expect(card("vol").lane).toBe("internal");
    expect(card("cli").lane).toBe("device");
    expect(card("owner").lane).toBe("device");
    expect(model.lanes.map((l) => l.name)).toEqual(["device", "tailnet", "internal", "third-party"]);
    expect(model.lanes[0].description).toBe("end-user device");
    expect(model.lanes.some((l) => l.name === UNPLACED_LANE)).toBe(false);
  });

  it("folds technologies, operations, lockfiles, packages, plays and sub-volumes into chips", () => {
    expect(card("app").chips).toEqual(
      expect.arrayContaining([
        { label: "Swift", refId: "swift" },
        { label: "1 operation", refId: "app" },
        { label: "1 lockfile", refId: "app" },
        { label: "3 packages", packages: true },
      ]),
    );
    expect(card("owner").chips).toContainEqual({ label: "plays Authenticated User", refId: "user" });
    expect(card("sidecar").chips).toContainEqual({ label: "vol ts-state", refId: "sidecarVol" });
    expect(model.cards.has("sidecarVol")).toBe(false);
  });

  it("merges read + write and the data flow into one arrow, and marks credential arrows", () => {
    const appDb = model.arrows.filter((a) => a.source === "app" && a.target === "db");
    expect(appDb).toHaveLength(1);
    expect(appDb[0].label).toBe("R/W · SQLite file");
    expect(model.arrows.find((a) => a.source === "app" && a.target === "db2")?.label).toBe("writes to");
    expect(model.arrows.find((a) => a.source === "owner" && a.target === "key")?.credential).toBe(true);
    expect(model.arrows.some((a) => a.source === "owner" && a.target === "user")).toBe(false);
  });

  it("flags secrets, possible duplicates and nodes with no edges", () => {
    expect(card("key").secret).toBe(true);
    expect(card("db").duplicates).toEqual(["db2"]);
    expect(card("vol").duplicates).toEqual([]);
    expect(model.duplicateGroups).toEqual([expect.arrayContaining(["db", "db2"])]);
    expect(model.isolated.map((n) => n.refId)).toEqual(["lonely"]);
  });
});

describe("grouping", () => {
  // A hub service that reads and writes four stores and processes two secrets, one of them a principal's key.
  const nodes = [
    node("zone", "SysTrustZone", { name: "internal" }),
    node("hub", "SysComponent", { name: "hub" }),
    node("holder", "SysPrincipal", { name: "key holder" }),
    ...["s1", "s2", "s3", "s4"].map((id) => node(id, "SysResource", { name: `store ${id}` })),
    node("k1", "SysDataAsset", { name: "KEY_1", classification: "secret" }),
    node("k2", "SysDataAsset", { name: "KEY_2", classification: "secret" }),
  ];
  const edges = [
    edge("hub", "IN_ZONE", "zone"),
    ...["s1", "s2", "s3", "s4"].flatMap((id) => [edge("hub", "READS_FROM", id), edge("hub", "WRITES_TO", id)]),
    edge("s1", "STORED_IN", "s2"),
    edge("hub", "PROCESSES", "k1"),
    edge("hub", "PROCESSES", "k2"),
    edge("holder", "AUTHENTICATES_WITH", "s3"),
  ];
  const model = buildArchitecture(nodes, edges);
  const groupId = `${GROUP_ID_PREFIX}hub:SysResource`;

  it("groups GROUP_MIN+ cards of one type a card fans into, and leaves smaller fans alone", () => {
    expect([...model.groups.keys()]).toEqual([groupId]);
    const group = model.groups.get(groupId)!;
    expect(group).toMatchObject({ source: "hub", type: "SysResource", label: "4 resources", secretCount: 0 });
    expect(group.members).toEqual(["s1", "s2", "s3", "s4"]);
    expect(model.groupOf.get("s3")).toBe(groupId);
    expect(model.groupOf.has("k1")).toBe(false);
    const data = model.lanes[0].columns[3];
    expect(data.map((item) => (item.kind === "group" ? item.group.id : item.card.node.refId))).toEqual([
      "k1",
      "k2",
      groupId,
    ]);
  });

  it("points arrows at a closed group once, drops arrows inside it, and splits them when open", () => {
    const closed = visibleArrows(model, new Set());
    expect(closed.filter((a) => a.target === groupId).map((a) => [a.source, a.label, a.credential])).toEqual([
      ["hub", "R/W", false],
      ["holder", "authenticates with", true],
    ]);
    expect(closed.some((a) => a.source === groupId)).toBe(false);

    const open = visibleArrows(model, new Set([groupId]));
    expect(open.filter((a) => a.source === "hub" && a.label === "R/W")).toHaveLength(4);
    expect(open.some((a) => a.source === "s1" && a.target === "s2")).toBe(true);
    expect(visibleArrows(model, new Set(), false).some((a) => a.credential)).toBe(false);
  });
});

describe("buildDependencies", () => {
  const model = buildDependencies(NODES, EDGES);
  const row = (id: string) => model.byRef.get(id)!;

  it("reads uses, users, declarers, direct packages and repeated names", () => {
    expect(model.packages).toHaveLength(5);
    expect(row("mid").usedBy).toEqual(["top"]);
    expect(row("mid").dependsOn).toEqual(["leaf1"]);
    expect(row("top").declaredBy).toEqual(
      expect.arrayContaining([
        { refId: "app", edgeType: "DEPENDS_ON" },
        { refId: "lock", edgeType: "CONTAINS" },
      ]),
    );
    expect(
      model.packages
        .filter((p) => p.direct)
        .map((p) => p.node.refId)
        .sort(),
    ).toEqual(["swiftpkg", "top"]);
    expect(model.directCount).toBe(2);
    expect(row("leaf1").versions).toBe(2);
    expect(model.multiVersionNames).toBe(1);
    expect(model.sources).toEqual([
      { source: "repo/Cargo.lock", count: 4 },
      { source: "repo/Package.resolved", count: 1 },
    ]);
  });

  it("counts everything a package pulls in", () => {
    const cache = new Map<string, number>();
    expect(pullsIn(model, "top", cache)).toBe(3);
    expect(pullsIn(model, "leaf1", cache)).toBe(0);
    expect(cache.get("top")).toBe(3);
  });

  it("finds the shortest chain from a direct package", () => {
    expect(whyChain(model, "leaf1")).toEqual(["top", "mid", "leaf1"]);
    expect(whyChain(model, "leaf2")).toEqual(["top", "leaf2"]);
    expect(whyChain(model, "top")).toEqual(["top"]);
    expect(whyChain(model, "nope")).toBeNull();
  });
});
