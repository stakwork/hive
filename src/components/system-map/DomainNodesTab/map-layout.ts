/**
 * The Domain nodes tab's Map view, as data: the System Map's architecture
 * nodes drawn as a plan — components are hubs that claim the nodes that
 * belong to them into semantic slots (interfaces in front, storage behind,
 * operations left, artifacts right), clusters are packed into one plate per
 * trust zone, and the plates are arranged outside-in: actors and identities
 * at the bottom (front), the zones in a row across the middle, third-party
 * services and the technology catalogue at the top (back). Data flows,
 * actor reach and secret access are wires between placed nodes.
 *
 * Packages are laid out separately as a board to the right of the map:
 * rows are dependency depth (the bottom row is what the repo declares
 * directly), ordered by barycenter so chains run straight.
 *
 * Everything is in map units (a component is 11 wide); the renderer scales.
 */

import type { SystemMapDomainEdge, SystemMapDomainNode } from "@/types/system-map";
import { PACKAGE_TYPE } from "./architecture";

/** Zone order across the middle row, left to right on screen. */
export const ZONE_ROW = ["ci", "device", "tailnet", "internal", "loopback"];
/** A node in several zones sits in the most inward one. */
const PICK_ORDER = ["device", "ci", "internal", "loopback", "tailnet", "third-party"];
const ACTOR_TYPES = new Set(["Actor", "SysActor"]);
/** Types drawn with a primary (always visible) label. */
const TIER1 = new Set(["SysComponent", "SysResource", "SysInterface", "Actor", "SysActor", "SysPrincipal"]);
/** Edges that are drawn as flows, reach or guards, or not at all. */
const STRUCT_SKIP = new Set(["AUTHENTICATES_WITH", "CAN_REACH", "IN_ZONE", "FROM", "TO", "CARRIES", "USES_PROTOCOL"]);
const GAP = 3.2;
const PLATE_PAD = 5;

export type GlyphKind =
  | "component"
  | "database"
  | "volume"
  | "resource"
  | "interface"
  | "operation"
  | "artifact"
  | "capability"
  | "secret"
  | "asset"
  | "principal"
  | "actor"
  | "other";

export interface MapNode {
  node: SystemMapDomainNode;
  /** Name with the owner's prefix stripped (`stakwork/peel cli peel` → `cli peel`). */
  label: string;
  glyph: GlyphKind;
  /** Centre, map units; +y is down (towards the actors). */
  x: number;
  y: number;
  w: number;
  h: number;
  region: string;
  /** The hub this node was claimed by, if any. */
  owner: string | null;
  secret: boolean;
  /** An actor with no reach path: drawn faded. */
  ghost: boolean;
  /** 1 = always labelled, 2 = labelled when zoomed in or on demand. */
  labelTier: 1 | 2;
  hub: boolean;
}

export interface MapRegion {
  key: string;
  label: string;
  /** The zone's boundary description, when it is a trust zone. */
  description: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  ids: string[];
  /** Drawn quieter (the catalogue). */
  dim: boolean;
}

export type WireKind = "flow" | "cross" | "reach" | "guard" | "struct";

export interface MapWire {
  id: string;
  kind: WireKind;
  source: string;
  target: string;
  label: string;
  /** Drawn without an arrowhead (a hub and the node it owns). */
  arrow: boolean;
  /** How far the curve bows, map units; undefined = by distance. */
  bow?: number;
}

export interface MapChip {
  node: SystemMapDomainNode;
  name: string;
  version: string;
  ecosystem: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  direct: boolean;
  hub: boolean;
  dependents: string[];
  dependsOn: string[];
}

export interface MapBoard {
  key: string;
  label: string;
  sub: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  ids: string[];
}

export interface MapModel {
  nodes: Map<string, MapNode>;
  regions: MapRegion[];
  wires: MapWire[];
  chips: Map<string, MapChip>;
  boards: MapBoard[];
  /** Package → package it depends on. */
  depEdges: [string, string][];
  /** Shortest chain from each direct package down to `refId` (direct first). */
  pathsToRoots: (refId: string) => string[][];
  stats: {
    drawn: number;
    flows: number;
    crossZone: number;
    reach: number;
    secrets: number;
    packages: number;
    direct: number;
    depth: number;
    hubMin: number;
  };
}

interface Link {
  s: string;
  t: string;
  v: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function glyphOf(node: SystemMapDomainNode, secret: boolean): GlyphKind {
  const kind = str(node.properties.kind);
  switch (node.type) {
    case "SysComponent":
      return "component";
    case "SysResource":
      return kind === "database" ? "database" : kind === "volume" ? "volume" : "resource";
    case "SysInterface":
      return "interface";
    case "SysOperation":
      return "operation";
    case "SysArtifact":
      return "artifact";
    case "SysCapability":
      return "capability";
    case "SysDataAsset":
      return secret ? "secret" : "asset";
    case "SysPrincipal":
      return "principal";
    case "Actor":
    case "SysActor":
      return "actor";
    default:
      return "other";
  }
}

/** [width, height] of a glyph on the plate, map units. */
export function glyphSize(glyph: GlyphKind): [number, number] {
  switch (glyph) {
    case "component":
      return [12, 8];
    case "database":
      return [6, 6];
    case "volume":
      return [7, 5];
    case "resource":
      return [7, 6];
    case "interface":
      return [5, 5];
    case "operation":
      return [5, 3.6];
    case "artifact":
      return [5.5, 3.8];
    case "capability":
      return [4, 4];
    case "secret":
    case "asset":
      return [4.5, 4.5];
    case "principal":
      return [5, 5];
    case "actor":
      return [6, 6];
    default:
      return [5, 3.2];
  }
}

export function buildMapLayout(nodes: SystemMapDomainNode[], edges: SystemMapDomainEdge[]): MapModel {
  const byRef = new Map(nodes.map((n) => [n.refId, n]));
  const links: Link[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (!byRef.has(e.source) || !byRef.has(e.target) || e.source === e.target) continue;
    const key = `${e.source}|${e.edgeType}|${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ s: e.source, t: e.target, v: e.edgeType });
  }
  const outMap = new Map<string, Link[]>();
  const inMap = new Map<string, Link[]>();
  for (const l of links) {
    outMap.set(l.s, [...(outMap.get(l.s) ?? []), l]);
    inMap.set(l.t, [...(inMap.get(l.t) ?? []), l]);
  }
  const outOf = (id: string) => outMap.get(id) ?? [];
  const into = (id: string) => inMap.get(id) ?? [];
  const type = (id: string) => byRef.get(id)?.type ?? "";

  // ---- zones: the primary zone of each node, from IN_ZONE ----
  const zoneOf = new Map<string, string>();
  const zoneDescription = new Map<string, string>();
  for (const n of nodes)
    if (n.type === "SysTrustZone") zoneDescription.set(n.name, str(n.properties.boundary_description));
  for (const n of nodes) {
    const zones = outOf(n.refId)
      .filter((l) => l.v === "IN_ZONE")
      .map((l) => byRef.get(l.t)!.name);
    if (zones.length) zoneOf.set(n.refId, PICK_ORDER.find((z) => zones.includes(z)) ?? zones[0]);
  }
  const secretOf = (n: SystemMapDomainNode) => n.properties.classification === "secret";

  // Drawn: everything but packages, zones and flows (flows are wires).
  const drawn = nodes.filter((n) => n.type !== PACKAGE_TYPE && n.type !== "SysTrustZone" && n.type !== "SysDataFlow");
  const drawnIds = new Set(drawn.map((n) => n.refId));

  // ---- ownership: hubs claim the nodes that belong to them, into a slot ----
  const owner = new Map<string, string>();
  const slot = new Map<string, "front" | "back" | "left" | "right">();
  const claim = (id: string, hub: SystemMapDomainNode, side: "front" | "back" | "left" | "right") => {
    const n = byRef.get(id);
    if (!n || !drawnIds.has(id) || id === hub.refId || owner.has(id) || n.type === "SysComponent") return;
    const nz = zoneOf.get(id);
    const hz = zoneOf.get(hub.refId);
    if (nz && hz && nz !== hz) return; // a thing in another zone stays there
    owner.set(id, hub.refId);
    slot.set(id, side);
  };
  const isExternal = (n: SystemMapDomainNode) =>
    n.type === "SysComponent" && (zoneOf.get(n.refId) === "third-party" || str(n.properties.kind) === "external");
  const hubs = drawn
    .filter((n) => n.type === "SysComponent" && zoneOf.has(n.refId) && !isExternal(n))
    .concat(drawn.filter((n) => n.type === "SysResource" && outOf(n.refId).some((l) => l.v === "CONTAINS")));
  for (const h of hubs) {
    for (const l of outOf(h.refId)) {
      if (l.v === "EXPOSES") claim(l.t, h, "front");
      else if (l.v === "READS_FROM" || l.v === "WRITES_TO" || l.v === "CONTAINS" || l.v === "PROCESSES")
        claim(l.t, h, "back");
      else if (l.v === "DEPENDS_ON" && type(l.t) === "SysArtifact") claim(l.t, h, "right");
      else if (l.v === "PROVIDES") claim(l.t, h, "right");
    }
    for (const l of into(h.refId)) {
      if (l.v === "PART_OF") claim(l.s, h, "left");
      else if (l.v === "IMPLEMENTS") claim(l.s, h, "right");
    }
  }
  // A secret nobody owns hangs off a component in its zone.
  for (const d of drawn) {
    if (d.type !== "SysDataAsset" || owner.has(d.refId)) continue;
    const h = hubs.find((x) => x.type === "SysComponent" && zoneOf.get(x.refId) === zoneOf.get(d.refId));
    if (h) {
      owner.set(d.refId, h.refId);
      slot.set(d.refId, "back");
    }
  }

  const regionOf = (n: SystemMapDomainNode): string => {
    const o = owner.get(n.refId);
    if (o) return regionOf(byRef.get(o)!);
    if (ACTOR_TYPES.has(n.type)) return "actors";
    if (n.type === "SysPrincipal") return "identities";
    if (n.type === "SysTechnology" || n.type === "SysProtocol") return "catalog";
    if (isExternal(n)) return "internet";
    const z = zoneOf.get(n.refId);
    if (z && z !== "third-party") return z;
    return "catalog";
  };

  // ---- labels and footprints ----
  const displayName = (n: SystemMapDomainNode): string => {
    let t = n.name;
    const o = owner.get(n.refId) ? byRef.get(owner.get(n.refId)!) : undefined;
    if (o) {
      if (t.startsWith(o.name + " ")) t = t.slice(o.name.length + 1);
      else if (t.startsWith(o.name + "/")) t = t.slice(o.name.length + 1);
      t = t.replace(" (" + o.name + ")", "");
    }
    if (n.type === "SysDataAsset" && secretOf(n)) t = t.replace(/ \(.*\)$/, "");
    return t;
  };
  const labelTier = (n: SystemMapDomainNode): 1 | 2 =>
    TIER1.has(n.type) || (n.type === "SysDataAsset" && secretOf(n)) ? 1 : 2;
  const footprint = (n: SystemMapDomainNode): [number, number] => {
    const [w, h] = glyphSize(glyphOf(n, secretOf(n)));
    const lw = labelTier(n) === 1 ? 0.5 * displayName(n).length + 3 : 0;
    return [Math.max(w, lw), h];
  };

  // ---- layout, in the isometric map's (x, z) frame; flipped to screen at the end ----
  const pos = new Map<string, { x: number; z: number }>();
  const fp = new Map<string, [number, number]>();
  for (const n of drawn) fp.set(n.refId, footprint(n));
  const fpOf = (id: string) => fp.get(id) ?? [5, 3.2];

  const rowPlace = (items: SystemMapDomainNode[], cz: number, cx0: number): number => {
    const widths = items.map((n) => fpOf(n.refId)[0]);
    const total = widths.reduce((a, b) => a + b, 0) + GAP * Math.max(0, items.length - 1);
    let x = cx0 - total / 2;
    items.forEach((n, i) => {
      pos.set(n.refId, { x: x + widths[i] / 2, z: cz });
      x += widths[i] + GAP;
    });
    return total;
  };
  const gridPlace = (
    items: SystemMapDomainNode[],
    x0: number,
    z0: number,
    cols: number,
    dirX: number,
  ): [number, number] => {
    const cw = Math.max(...items.map((n) => fpOf(n.refId)[0]), 0) + GAP;
    const cd = Math.max(...items.map((n) => fpOf(n.refId)[1]), 0) + GAP;
    const rows = Math.ceil(items.length / cols);
    items.forEach((n, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      pos.set(n.refId, { x: x0 + dirX * (c * cw + cw / 2), z: z0 - ((rows - 1) * cd) / 2 + r * cd });
    });
    return [cols * cw, rows * cd];
  };
  const bandPlace = (
    items: SystemMapDomainNode[],
    zStart: number,
    dirZ: number,
    maxPerRow: number,
  ): [number, number] => {
    let w = 0;
    let z = zStart;
    let depth = 0;
    for (let i = 0; i < items.length; i += maxPerRow) {
      const row = items.slice(i, i + maxPerRow);
      const rd = Math.max(...row.map((n) => fpOf(n.refId)[1]));
      z += (dirZ * rd) / 2;
      w = Math.max(w, rowPlace(row, z, 0));
      z += dirZ * (rd / 2 + GAP);
      depth += rd + GAP;
    }
    return [w, depth - GAP];
  };
  const shift = (ids: string[], dx: number, dz: number) => {
    for (const id of ids) {
      const p = pos.get(id)!;
      p.x += dx;
      p.z += dz;
    }
  };
  const clusterLayout = (hub: SystemMapDomainNode) => {
    const members = drawn.filter((n) => owner.get(n.refId) === hub.refId);
    const S = {
      front: [] as SystemMapDomainNode[],
      back: [] as SystemMapDomainNode[],
      left: [] as SystemMapDomainNode[],
      right: [] as SystemMapDomainNode[],
    };
    for (const m of members) S[slot.get(m.refId)!].push(m);
    const [hw, hd] = fpOf(hub.refId);
    pos.set(hub.refId, { x: 0, z: 0 });
    let minX = -hw / 2;
    let maxX = hw / 2;
    let minZ = -hd / 2;
    let maxZ = hd / 2;
    if (S.front.length) {
      const [w, d] = bandPlace(S.front, -(hd / 2 + 6), -1, 5);
      minZ = Math.min(minZ, -(hd / 2 + 6) - d);
      minX = Math.min(minX, -w / 2);
      maxX = Math.max(maxX, w / 2);
    }
    if (S.back.length) {
      const [w, d] = bandPlace(S.back, hd / 2 + 6, 1, 5);
      maxZ = Math.max(maxZ, hd / 2 + 6 + d);
      minX = Math.min(minX, -w / 2);
      maxX = Math.max(maxX, w / 2);
    }
    if (S.left.length) {
      const [w, d] = gridPlace(S.left, -(hw / 2 + 4), 0, S.left.length > 4 ? 2 : 1, -1);
      minX = Math.min(minX, -(hw / 2 + 4) - w);
      minZ = Math.min(minZ, -d / 2);
      maxZ = Math.max(maxZ, d / 2);
    }
    if (S.right.length) {
      const [w, d] = gridPlace(S.right, hw / 2 + 4, 0, S.right.length > 4 ? 2 : 1, 1);
      maxX = Math.max(maxX, hw / 2 + 4 + w);
      minZ = Math.min(minZ, -d / 2);
      maxZ = Math.max(maxZ, d / 2);
    }
    const ids = [hub.refId, ...members.map((m) => m.refId)];
    return { ids, minX, maxX, minZ, maxZ, w: maxX - minX, d: maxZ - minZ };
  };

  const REGION_LABEL: Record<string, string> = {
    actors: "ACTORS · who is out there",
    identities: "IDENTITIES · how they show up",
    internet: "THIRD-PARTY · outside services",
    catalog: "catalog · tech & protocols",
  };
  interface Region {
    key: string;
    ids: string[];
    w: number;
    d: number;
    cx: number;
    cz: number;
  }
  const regions = new Map<string, Region>();
  const layoutRegion = (key: string) => {
    const inRegion = drawn.filter((n) => regionOf(n) === key);
    if (!inRegion.length) return;
    const regionHubs = hubs.filter((h) => regionOf(h) === key);
    const clusters = regionHubs.map(clusterLayout);
    const loose = inRegion.filter((n) => !owner.has(n.refId) && !regionHubs.includes(n));
    let x = 0;
    const ids: string[] = [];
    let maxD = 0;
    clusters.forEach((c, i) => {
      if (i) x += 10;
      shift(c.ids, x - c.minX, -(c.minZ + c.maxZ) / 2);
      x += c.w;
      ids.push(...c.ids);
      maxD = Math.max(maxD, c.d);
    });
    let w = x;
    if (loose.length) {
      const perRow = Math.max(3, Math.ceil(Math.sqrt(loose.length * 1.8)));
      const rows: SystemMapDomainNode[][] = [];
      for (let i = 0; i < loose.length; i += perRow) rows.push(loose.slice(i, i + perRow));
      let z = clusters.length ? maxD / 2 + 7 : 0;
      let rw = 0;
      for (const r of rows) {
        rw = Math.max(rw, rowPlace(r, z, w / 2));
        z += Math.max(...r.map((n) => fpOf(n.refId)[1])) + GAP;
        ids.push(...r.map((n) => n.refId));
      }
      if (rw > w) {
        shift(ids, (rw - w) / 2, 0);
        w = rw;
      }
    }
    // centre the region on (0, 0)
    let mnx = Infinity;
    let mxx = -Infinity;
    let mnz = Infinity;
    let mxz = -Infinity;
    for (const id of ids) {
      const [fw, fd] = fpOf(id);
      const p = pos.get(id)!;
      mnx = Math.min(mnx, p.x - fw / 2);
      mxx = Math.max(mxx, p.x + fw / 2);
      mnz = Math.min(mnz, p.z - fd / 2);
      mxz = Math.max(mxz, p.z + fd / 2);
    }
    shift(ids, -(mnx + mxx) / 2, -(mnz + mxz) / 2);
    regions.set(key, { key, ids, w: mxx - mnx + PLATE_PAD * 2, d: mxz - mnz + PLATE_PAD * 2, cx: 0, cz: 0 });
  };
  const zoneKeys = [...new Set(drawn.map(regionOf))].filter(
    (k) => !["actors", "identities", "internet", "catalog"].includes(k),
  );
  for (const key of ["actors", "identities", "internet", "catalog", ...zoneKeys]) layoutRegion(key);

  // Arrange: the zone row across the middle (ZONE_ROW first, other zones after it, alphabetically).
  const row = [...ZONE_ROW.filter((k) => regions.has(k)), ...zoneKeys.filter((k) => !ZONE_ROW.includes(k)).sort()];
  {
    const gap = 12;
    const total = row.reduce((a, k) => a + regions.get(k)!.w, 0) + gap * (row.length - 1);
    // In the (x, z) frame +x shows on the left, so the row is laid right-to-left.
    let x = total / 2;
    for (const k of row) {
      const r = regions.get(k)!;
      r.cx = x - r.w / 2;
      r.cz = 0;
      x -= r.w + gap;
    }
  }
  const midDepth = Math.max(0, ...row.map((k) => regions.get(k)!.d));
  const identities = regions.get("identities");
  if (identities) {
    identities.cx = 0;
    identities.cz = -(midDepth / 2 + 16 + identities.d / 2);
  }
  const actors = regions.get("actors");
  if (actors) {
    actors.cx = 0;
    actors.cz = (identities ? identities.cz - identities.d / 2 : -(midDepth / 2 + 16)) - 14 - actors.d / 2;
  }
  {
    const back = ["catalog", "internet"].filter((k) => regions.has(k));
    const gap = 16;
    const total = back.reduce((a, k) => a + regions.get(k)!.w, 0) + gap * (back.length - 1);
    let x = -total / 2;
    for (const k of back) {
      const r = regions.get(k)!;
      r.cx = x + r.w / 2;
      r.cz = midDepth / 2 + 18 + r.d / 2;
      x += r.w + gap;
    }
  }
  for (const r of regions.values()) shift(r.ids, r.cx, r.cz);

  // ---- to screen: X = -x, Y = -z (actors at the bottom) ----
  const reachOf = (id: string) => outOf(id).some((l) => l.v === "CAN_REACH");
  const mapNodes = new Map<string, MapNode>();
  for (const n of drawn) {
    const p = pos.get(n.refId);
    if (!p) continue;
    const secret = secretOf(n);
    const glyph = glyphOf(n, secret);
    const [w, h] = glyphSize(glyph);
    mapNodes.set(n.refId, {
      node: n,
      label: displayName(n),
      glyph,
      x: -p.x,
      y: -p.z,
      w,
      h,
      region: regionOf(n),
      owner: owner.get(n.refId) ?? null,
      secret,
      ghost: ACTOR_TYPES.has(n.type) && !reachOf(n.refId),
      labelTier: labelTier(n),
      hub: hubs.includes(n),
    });
  }
  const mapRegions: MapRegion[] = [...regions.values()].map((r) => ({
    key: r.key,
    label: REGION_LABEL[r.key] ?? r.key,
    description: zoneDescription.get(r.key) ?? "",
    x0: -r.cx - r.w / 2,
    y0: -r.cz - r.d / 2,
    x1: -r.cx + r.w / 2,
    y1: -r.cz + r.d / 2,
    ids: r.ids,
    dim: r.key === "catalog",
  }));

  // ---- wires ----
  const wires: MapWire[] = [];
  const placed = (id: string) => mapNodes.has(id);
  let crossZone = 0;
  let flowCount = 0;
  for (const flow of nodes.filter((n) => n.type === "SysDataFlow")) {
    const from = outOf(flow.refId).find((l) => l.v === "FROM")?.t;
    const to = outOf(flow.refId).find((l) => l.v === "TO")?.t;
    if (!from || !to || !placed(from) || !placed(to) || from === to) continue;
    flowCount++;
    const fz = mapNodes.get(from)!.region;
    const tz = mapNodes.get(to)!.region;
    const cross = fz !== tz && !(fz === "catalog" || tz === "catalog");
    if (cross) crossZone++;
    const kind = str(flow.properties.kind) || "flow";
    wires.push({
      id: `flow:${flow.refId}`,
      kind: cross ? "cross" : "flow",
      source: from,
      target: to,
      label: cross ? `${kind} · crosses ${fz} → ${tz}` : kind,
      arrow: true,
    });
  }
  let reachCount = 0;
  for (const l of links) {
    if (!placed(l.s) || !placed(l.t)) continue;
    if (l.v === "CAN_REACH") {
      reachCount++;
      wires.push({
        id: `reach:${l.s}>${l.t}`,
        kind: "reach",
        source: l.s,
        target: l.t,
        label: "can reach",
        arrow: true,
      });
    } else if (l.v === "AUTHENTICATES_WITH") {
      wires.push({
        id: `guard:${l.s}>${l.t}`,
        kind: "guard",
        source: l.s,
        target: l.t,
        label: "authenticates with",
        arrow: true,
      });
    } else if (!STRUCT_SKIP.has(l.v)) {
      const sameOwner = owner.get(l.s) === l.t || owner.get(l.t) === l.s;
      wires.push({
        id: `struct:${l.s}>${l.v}>${l.t}`,
        kind: "struct",
        source: l.s,
        target: l.t,
        label: l.v.replace(/_/g, " ").toLowerCase(),
        arrow: !sameOwner,
        bow: sameOwner ? 0.8 : undefined,
      });
    }
  }

  // ---- the package board ----
  const packages = nodes.filter((n) => n.type === PACKAGE_TYPE);
  const pkgIds = new Set(packages.map((p) => p.refId));
  const dependsOn = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  const depEdges: [string, string][] = [];
  for (const l of links) {
    if (l.v !== "DEPENDS_ON" || !pkgIds.has(l.s) || !pkgIds.has(l.t)) continue;
    depEdges.push([l.s, l.t]);
    dependsOn.set(l.s, [...(dependsOn.get(l.s) ?? []), l.t]);
    dependents.set(l.t, [...(dependents.get(l.t) ?? []), l.s]);
  }
  // Depth = longest chain from a direct package (one no package depends on); cycles stop at the first repeat.
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const d = depth.get(id);
    if (d !== undefined) return d;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const ups = dependents.get(id) ?? [];
    const value = ups.length ? 1 + Math.max(...ups.map(depthOf)) : 0;
    visiting.delete(id);
    depth.set(id, value);
    return value;
  };
  for (const p of packages) depthOf(p.refId);
  const hubMin = packages.length >= 200 ? 20 : 5;

  const CHIP = { w: 4.2, h: 2.4, hw: 5.4, hh: 3.1, sx: 5.3, sy: 3.4, band: 2.6, perRow: 34 };
  const chipPos = new Map<string, { x: number; z: number }>();
  const layoutBoard = (ps: SystemMapDomainNode[]): { w: number; d: number } => {
    const layers: SystemMapDomainNode[][] = [];
    for (const p of ps) (layers[depthOf(p.refId)] ??= []).push(p);
    const bary = (p: SystemMapDomainNode) => {
      const ups = (dependents.get(p.refId) ?? [])
        .map((q) => chipPos.get(q))
        .filter((q): q is { x: number; z: number } => !!q);
      return ups.length ? ups.reduce((a, q) => a + q.x, 0) / ups.length : 0;
    };
    let z = 0;
    let maxW = 0;
    layers.forEach((L, li) => {
      if (!L) return;
      if (li === 0) L.sort((a, b) => a.name.localeCompare(b.name));
      else L.sort((a, b) => bary(a) - bary(b));
      const rows = Math.ceil(L.length / CHIP.perRow);
      const per = Math.ceil(L.length / rows);
      for (let r = 0; r < rows; r++) {
        const chunk = L.slice(r * per, (r + 1) * per);
        const w = (chunk.length - 1) * CHIP.sx;
        maxW = Math.max(maxW, w);
        chunk.forEach((p, i) => chipPos.set(p.refId, { x: i * CHIP.sx - w / 2, z }));
        z += CHIP.sy;
      }
      z += CHIP.band;
    });
    const d = z - CHIP.band;
    for (const p of ps) chipPos.get(p.refId)!.z -= d / 2;
    return { w: maxW + CHIP.hw + 12, d: d + CHIP.hh + 12 };
  };
  const lockfileOf = (id: string) => into(id).find((l) => l.v === "CONTAINS" && type(l.s) === "SysArtifact")?.s;
  const groups = new Map<string, SystemMapDomainNode[]>();
  for (const p of packages) {
    const lock = lockfileOf(p.refId);
    const key = lock ? byRef.get(lock)!.name : `${str(p.properties.ecosystem) || "other"} · no lockfile`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const mapRight = Math.max(0, ...mapRegions.map((r) => r.x1));
  const boards: MapBoard[] = [];
  const chips = new Map<string, MapChip>();
  let bx = mapRight + 90;
  for (const [key, ps] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const { w, d } = layoutBoard(ps);
    bx += w / 2;
    const cx = bx;
    bx += w / 2 + 14;
    const eco = [...new Set(ps.map((p) => str(p.properties.ecosystem)).filter(Boolean))].join(", ");
    boards.push({
      key,
      label: `PACKAGES · ${eco || key}`,
      sub: key.endsWith("no lockfile") ? "no lockfile edge" : `pinned by ${key}`,
      x0: cx - w / 2,
      y0: -d / 2,
      x1: cx + w / 2,
      y1: d / 2,
      ids: ps.map((p) => p.refId),
    });
    for (const p of ps) {
      const q = chipPos.get(p.refId)!;
      const ups = dependents.get(p.refId) ?? [];
      const hub = ups.length >= hubMin;
      chips.set(p.refId, {
        node: p,
        name: p.name,
        version: str(p.properties.version),
        ecosystem: str(p.properties.ecosystem),
        x: q.x + cx,
        y: -q.z,
        w: hub ? CHIP.hw : CHIP.w,
        h: hub ? CHIP.hh : CHIP.h,
        depth: depthOf(p.refId),
        direct: ups.length === 0,
        hub,
        dependents: ups,
        dependsOn: dependsOn.get(p.refId) ?? [],
      });
    }
  }
  const pathsToRoots = (refId: string): string[][] => {
    if (!chips.has(refId)) return [];
    const prev = new Map<string, string | null>([[refId, null]]);
    const queue = [refId];
    const roots: string[] = [];
    while (queue.length) {
      const u = queue.shift()!;
      const ups = dependents.get(u) ?? [];
      if (!ups.length) roots.push(u);
      for (const p of ups) {
        if (prev.has(p)) continue;
        prev.set(p, u);
        queue.push(p);
      }
    }
    return roots.map((r) => {
      const path: string[] = [];
      let u: string | null = r;
      while (u !== null) {
        path.push(u);
        u = prev.get(u) ?? null;
      }
      return path;
    });
  };

  return {
    nodes: mapNodes,
    regions: mapRegions,
    wires,
    chips,
    boards,
    depEdges,
    pathsToRoots,
    stats: {
      drawn: mapNodes.size,
      flows: flowCount,
      crossZone,
      reach: reachCount,
      secrets: [...mapNodes.values()].filter((n) => n.secret).length,
      packages: packages.length,
      direct: [...chips.values()].filter((c) => c.direct).length,
      depth: Math.max(0, ...[...chips.values()].map((c) => c.depth)) + (chips.size ? 1 : 0),
      hubMin,
    },
  };
}

/** Everything `refId` is pulled in by (upstream packages), transitively. */
export function ancestors(model: MapModel, refId: string): Set<string> {
  const out = new Set<string>();
  const stack = [refId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const up of model.chips.get(id)?.dependents ?? []) {
      if (!out.has(up)) {
        out.add(up);
        stack.push(up);
      }
    }
  }
  return out;
}

/** Everything `refId` pulls in, transitively. */
export function descendants(model: MapModel, refId: string): Set<string> {
  const out = new Set<string>();
  const stack = [refId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const down of model.chips.get(id)?.dependsOn ?? []) {
      if (!out.has(down)) {
        out.add(down);
        stack.push(down);
      }
    }
  }
  return out;
}

/** The placed nodes `refId` touches on the map: wire ends and the hub/owned pair. */
export function neighbourhood(model: MapModel, refId: string): Set<string> {
  const out = new Set([refId]);
  for (const w of model.wires) {
    if (w.source === refId || w.target === refId) {
      out.add(w.source);
      out.add(w.target);
    }
  }
  const n = model.nodes.get(refId);
  if (n?.owner) out.add(n.owner);
  for (const other of model.nodes.values()) if (other.owner === refId) out.add(other.node.refId);
  return out;
}
