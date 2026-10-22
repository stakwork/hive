/**
 * Unit tests for the Domain nodes tab's Map view model
 * (`DomainNodesTab/map-layout.ts`): hub ownership and slots, plate packing
 * and arrangement, wires, and the package board, on the same small graph
 * the Architecture tests use plus a cross-zone flow and an actor with no
 * reach.
 */

import { describe, it, expect } from "vitest";
import {
  ancestors,
  buildMapLayout,
  descendants,
  neighbourhood,
  type MapModel,
  type MapRegion,
} from "@/components/system-map/DomainNodesTab/map-layout";
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
  node("nobody", "Actor", { name: "Unauthenticated User" }),
  node("owner", "SysPrincipal", { name: "device owner" }),
  node("db", "SysResource", { name: "app SQLite", kind: "database" }),
  node("vol", "SysResource", { name: "brain volume ./data", kind: "volume" }),
  node("sidecar", "SysResource", { name: "sidecar" }),
  node("sidecarVol", "SysResource", { name: "sidecar volume ts-state" }),
  node("key", "SysDataAsset", { name: "API_KEY (brain)", classification: "secret" }),
  node("swift", "SysTechnology", { name: "Swift" }),
  node("op", "SysOperation", { name: "backup" }),
  node("flow", "SysDataFlow", { name: "app -> app SQLite", kind: "read-write" }),
  node("flow2", "SysDataFlow", { name: "app -> api.example.com", kind: "request" }),
  node("sqlite", "SysProtocol", { name: "SQLite file" }),
  node("lock", "SysArtifact", { name: "Cargo.lock" }),
  node("top", "SysPackage", { name: "top", version: "1.0.0", ecosystem: "cargo" }),
  node("mid", "SysPackage", { name: "mid", version: "0.2.0", ecosystem: "cargo" }),
  node("leaf1", "SysPackage", { name: "leaf", version: "1.0.0", ecosystem: "cargo" }),
  node("leaf2", "SysPackage", { name: "leaf", version: "2.0.0", ecosystem: "cargo" }),
  node("swiftpkg", "SysPackage", { name: "swift-nio", ecosystem: "swift" }),
];

const EDGES: SystemMapDomainEdge[] = [
  edge("app", "IN_ZONE", "device"),
  edge("brain", "IN_ZONE", "tailnet"),
  edge("brain", "IN_ZONE", "internal"),
  edge("api", "IN_ZONE", "third"),
  edge("app", "EXPOSES", "cli"),
  edge("user", "CAN_REACH", "cli"),
  edge("owner", "PLAYS", "user"),
  edge("owner", "CALLS", "cli"),
  edge("app", "READS_FROM", "db"),
  edge("app", "WRITES_TO", "db"),
  edge("flow", "FROM", "app"),
  edge("flow", "TO", "db"),
  edge("flow", "USES_PROTOCOL", "sqlite"),
  edge("flow2", "FROM", "app"),
  edge("flow2", "TO", "api"),
  edge("app", "DEPENDS_ON", "brain"),
  edge("app", "DEPENDS_ON", "api"),
  edge("app", "USES_TECHNOLOGY", "swift"),
  edge("op", "PART_OF", "app"),
  edge("op", "TARGETS", "db"),
  edge("app", "DEPENDS_ON", "lock"),
  edge("brain", "WRITES_TO", "vol"),
  edge("brain", "PROCESSES", "key"),
  edge("owner", "AUTHENTICATES_WITH", "key"),
  edge("sidecar", "CONTAINS", "sidecarVol"),
  edge("sidecar", "IN_ZONE", "tailnet"),
  edge("app", "DEPENDS_ON", "top"),
  edge("app", "DEPENDS_ON", "mid"),
  edge("app", "DEPENDS_ON", "leaf1"),
  edge("lock", "CONTAINS", "top"),
  edge("lock", "CONTAINS", "mid"),
  edge("lock", "CONTAINS", "leaf1"),
  edge("lock", "CONTAINS", "leaf2"),
  edge("top", "DEPENDS_ON", "mid"),
  edge("mid", "DEPENDS_ON", "leaf1"),
  edge("top", "DEPENDS_ON", "leaf2"),
];

const region = (model: MapModel, key: string): MapRegion => model.regions.find((r) => r.key === key)!;
const overlaps = (a: MapRegion, b: MapRegion) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe("buildMapLayout", () => {
  const model = buildMapLayout(NODES, EDGES);
  const at = (id: string) => model.nodes.get(id)!;

  it("draws every architecture node once, leaving packages, zones and flows out", () => {
    expect([...model.nodes.keys()].sort()).toEqual(
      [
        "api",
        "app",
        "brain",
        "cli",
        "db",
        "key",
        "lock",
        "lonely",
        "nobody",
        "op",
        "owner",
        "sidecar",
        "sidecarVol",
        "sqlite",
        "swift",
        "user",
        "vol",
      ]
        .filter((id) => id !== "lonely")
        .sort(),
    );
    expect(model.stats.drawn).toBe(16);
    expect(model.stats.packages).toBe(5);
  });

  it("lets hubs claim what belongs to them: interfaces in front, storage and secrets behind, operations and artifacts beside", () => {
    expect(at("cli").owner).toBe("app");
    expect(at("db").owner).toBe("app");
    expect(at("op").owner).toBe("app");
    expect(at("lock").owner).toBe("app");
    expect(at("vol").owner).toBe("brain");
    expect(at("key").owner).toBe("brain");
    expect(at("sidecarVol").owner).toBe("sidecar");
    // +y is towards the actors: the interface sits in front of the hub, the database behind it.
    expect(at("cli").y).toBeGreaterThan(at("app").y);
    expect(at("db").y).toBeLessThan(at("app").y);
    // Beside the hub, on opposite sides, level with it.
    expect(Math.sign(at("op").x - at("app").x)).toBe(-Math.sign(at("lock").x - at("app").x));
    expect(Math.abs(at("op").y - at("app").y)).toBeLessThan(2);
    expect(at("app").hub).toBe(true);
    expect(at("sidecar").hub).toBe(true);
    expect(at("cli").hub).toBe(false);
  });

  it("strips the owner's prefix from labels and marks secrets and unreachable actors", () => {
    expect(at("cli").label).toBe("cli");
    expect(at("vol").label).toBe("volume ./data");
    expect(at("key").label).toBe("API_KEY");
    expect(at("key").secret).toBe(true);
    expect(at("key").glyph).toBe("secret");
    expect(at("nobody").ghost).toBe(true);
    expect(at("user").ghost).toBe(false);
    expect(at("db").glyph).toBe("database");
    expect(at("app").labelTier).toBe(1);
    expect(at("op").labelTier).toBe(2);
  });

  it("puts nodes on their plate: zones across the middle, actors and identities below, outside services and the catalogue above", () => {
    expect(model.regions.map((r) => r.key).sort()).toEqual(
      ["actors", "catalog", "device", "identities", "internal", "internet", "tailnet"].sort(),
    );
    expect(at("app").region).toBe("device");
    expect(at("brain").region).toBe("internal");
    expect(at("api").region).toBe("internet");
    expect(at("user").region).toBe("actors");
    expect(at("owner").region).toBe("identities");
    expect(at("swift").region).toBe("catalog");
    expect(at("sidecar").region).toBe("tailnet");
    expect(region(model, "device").description).toBe("end-user device");
    const mid = (r: MapRegion) => (r.y0 + r.y1) / 2;
    const zones = ["device", "tailnet", "internal"].map((k) => region(model, k));
    for (const z of zones) {
      expect(mid(region(model, "actors"))).toBeGreaterThan(mid(z));
      expect(mid(region(model, "identities"))).toBeGreaterThan(mid(z));
      expect(mid(region(model, "internet"))).toBeLessThan(mid(z));
      expect(mid(region(model, "catalog"))).toBeLessThan(mid(z));
    }
    // ci, device, tailnet, internal, loopback: left to right.
    expect(region(model, "device").x1).toBeLessThan(region(model, "tailnet").x0);
    expect(region(model, "tailnet").x1).toBeLessThan(region(model, "internal").x0);
  });

  it("keeps every node inside its plate and the plates apart", () => {
    for (const n of model.nodes.values()) {
      const r = region(model, n.region);
      expect(r.ids).toContain(n.node.refId);
      expect(n.x - n.w / 2).toBeGreaterThanOrEqual(r.x0);
      expect(n.x + n.w / 2).toBeLessThanOrEqual(r.x1);
      expect(n.y - n.h / 2).toBeGreaterThanOrEqual(r.y0);
      expect(n.y + n.h / 2).toBeLessThanOrEqual(r.y1);
    }
    for (const a of model.regions) for (const b of model.regions) if (a !== b) expect(overlaps(a, b)).toBe(false);
  });

  it("wires flows, reach and secret access, and flags the flow that leaves its zone", () => {
    const by = (id: string) => model.wires.find((w) => w.id === id)!;
    expect(by("flow:flow")).toMatchObject({ kind: "flow", source: "app", target: "db", label: "read-write" });
    expect(by("flow:flow2")).toMatchObject({ kind: "cross", source: "app", target: "api" });
    expect(by("flow:flow2").label).toContain("crosses device → internet");
    expect(by("reach:user>cli")).toMatchObject({ kind: "reach", arrow: true });
    expect(by("guard:owner>key")).toMatchObject({ kind: "guard", source: "owner", target: "key" });
    const struct = model.wires.filter((w) => w.kind === "struct");
    expect(struct.map((w) => w.label)).toContain("exposes");
    expect(struct.find((w) => w.source === "app" && w.target === "cli")!.arrow).toBe(false);
    expect(struct.find((w) => w.source === "app" && w.target === "brain")!.arrow).toBe(true);
    expect(struct.find((w) => w.source === "owner" && w.target === "user")!.label).toBe("plays");
    expect(model.wires.some((w) => w.label === "in zone" || w.label === "uses protocol" || w.label === "from")).toBe(
      false,
    );
    expect(model.stats).toMatchObject({ flows: 2, crossZone: 1, reach: 1, secrets: 1 });
  });

  it("lays packages out as a board to the right: depth rows, direct packages at the bottom", () => {
    const chip = (id: string) => model.chips.get(id)!;
    expect(chip("top")).toMatchObject({ depth: 0, direct: true });
    expect(chip("mid")).toMatchObject({ depth: 1, direct: false });
    expect(chip("leaf1")).toMatchObject({ depth: 2, direct: false });
    expect(chip("leaf2")).toMatchObject({ depth: 1, direct: false });
    expect(chip("swiftpkg")).toMatchObject({ depth: 0, direct: true });
    expect(chip("leaf1").y).toBeLessThan(chip("mid").y);
    expect(chip("mid").y).toBeLessThan(chip("top").y);
    expect(model.boards.map((b) => b.key)).toEqual(["Cargo.lock", "swift · no lockfile"]);
    expect(model.boards[0].sub).toBe("pinned by Cargo.lock");
    const mapRight = Math.max(...model.regions.map((r) => r.x1));
    for (const b of model.boards) expect(b.x0).toBeGreaterThan(mapRight);
    expect(model.boards[0].x1).toBeLessThan(model.boards[1].x0);
    expect(model.depEdges).toHaveLength(3);
    expect(model.stats).toMatchObject({ direct: 2, depth: 3, hubMin: 5 });
    expect([...model.chips.values()].some((c) => c.hub)).toBe(false);
  });

  it("walks the package graph", () => {
    expect(model.pathsToRoots("leaf1")).toEqual([["top", "mid", "leaf1"]]);
    expect(model.pathsToRoots("top")).toEqual([["top"]]);
    expect(model.pathsToRoots("app")).toEqual([]);
    expect([...ancestors(model, "leaf1")].sort()).toEqual(["mid", "top"]);
    expect([...descendants(model, "top")].sort()).toEqual(["leaf1", "leaf2", "mid"]);
    expect([...neighbourhood(model, "app")].sort()).toEqual(
      ["api", "app", "brain", "cli", "db", "lock", "op", "swift"].sort(),
    );
  });

  it("copes with an empty graph", () => {
    const empty = buildMapLayout([], []);
    expect(empty.nodes.size).toBe(0);
    expect(empty.regions).toEqual([]);
    expect(empty.boards).toEqual([]);
    expect(empty.stats.depth).toBe(0);
  });
});
