/**
 * The Domain nodes tab's Architecture view, as data: the System Map's
 * non-package nodes laid out in trust-zone lanes and four columns —
 *
 *   who (actors, principals) → entry points (interfaces) → components → data & storage
 *
 * — with the small supporting types folded into chips on the card they
 * describe (technologies, capabilities, operations, lockfiles, images,
 * sub-volumes, the actor a principal plays), data flows drawn as arrows,
 * and a READS_FROM + WRITES_TO pair merged into one "R/W" arrow. Packages
 * are left to the Dependencies view (`dependencies.ts`).
 *
 * A card with `GROUP_MIN`+ arrows into cards of one type in one column of
 * its lane gets those cards as a group (`brain ─processes→ [5 data assets]`),
 * drawn as one box with one arrow until expanded (`visibleArrows`).
 */

import type { SystemMapDomainEdge, SystemMapDomainNode } from "@/types/system-map";

export const PACKAGE_TYPE = "SysPackage";

/** Display order of the lanes, top to bottom. */
export const ZONE_ORDER = ["device", "ci", "tailnet", "internal", "loopback", "third-party"];
/** A node in several zones sits in the most inward one; the others show as an "also …" chip. */
const PICK_ORDER = ["device", "ci", "internal", "loopback", "tailnet", "third-party"];
/** The lane of nodes nothing places. */
export const UNPLACED_LANE = "unplaced";

export const COLUMNS = ["Who", "Entry points", "Components", "Data & storage"] as const;
const COLUMN_OF: Record<string, number> = {
  Actor: 0,
  SysActor: 0,
  SysPrincipal: 0,
  SysInterface: 1,
  SysComponent: 2,
  SysResource: 3,
  SysDataAsset: 3,
};
/** Types never drawn as cards: shown as chips, arrow labels or lane backgrounds. */
const FOLDED_TYPES = new Set([
  "SysTrustZone",
  "SysTechnology",
  "SysCapability",
  "SysOperation",
  "SysArtifact",
  "SysProtocol",
  "SysDataFlow",
]);

/** An unzoned node takes the lane of the neighbour it hangs off, by these edge types first. */
const LANE_FROM: Record<string, string[]> = {
  SysResource: ["WRITES_TO", "READS_FROM", "STORED_IN", "TARGETS"],
  SysDataAsset: ["PROCESSES", "AUTHENTICATES_WITH", "STORED_IN"],
  SysInterface: ["EXPOSES", "CALLS"],
  SysPrincipal: ["CALLS", "AUTHENTICATES_WITH", "PLAYS"],
  Actor: ["CAN_REACH", "PLAYS"],
};

export interface ArchChip {
  label: string;
  /** The node the chip stands for (opens it), when there is one. */
  refId?: string;
  /** Opens the Dependencies view. */
  packages?: boolean;
}

export interface ArchCard {
  node: SystemMapDomainNode;
  lane: string;
  column: number;
  chips: ArchChip[];
  secret: boolean;
  /** Other cards that may describe the same thing. */
  duplicates: string[];
}

export interface ArchArrow {
  id: string;
  source: string;
  target: string;
  label: string;
  /** Credential use (`AUTHENTICATES_WITH`), drawn dashed and hideable. */
  credential: boolean;
}

/** Fewest arrows from one card into one type that make a group. */
export const GROUP_MIN = 4;
export const GROUP_ID_PREFIX = "group:";

export interface ArchGroup {
  /** `group:` + source + type — never collides with a ref_id. */
  id: string;
  /** The card whose arrows the group gathers. */
  source: string;
  type: string;
  /** Member ref_ids, in column order. */
  members: string[];
  /** e.g. "5 data assets". */
  label: string;
  secretCount: number;
}

/** One slot in a lane column: a card, or a group of cards. */
export type ArchItem = { kind: "card"; card: ArchCard } | { kind: "group"; group: ArchGroup; cards: ArchCard[] };

export interface ArchLane {
  name: string;
  description: string;
  /** Items per column, in `COLUMNS` order. */
  columns: ArchItem[][];
}

export interface ArchitectureModel {
  lanes: ArchLane[];
  groups: Map<string, ArchGroup>;
  /** Member ref_id → its group id. */
  groupOf: Map<string, string>;
  cards: Map<string, ArchCard>;
  arrows: ArchArrow[];
  /** Nodes with no edges at all (packages and trust zones excepted). */
  isolated: SystemMapDomainNode[];
  /** Groups of cards that may describe the same thing. */
  duplicateGroups: string[][];
  /** Folded node count per type, for the "folded into cards" note. */
  folded: { type: string; count: number }[];
  packageCount: number;
}

interface Link {
  other: string;
  edgeType: string;
}

function columnOf(type: string): number {
  return COLUMN_OF[type] ?? 2;
}

/** `SysDataAsset` → "data assets". */
function pluralType(type: string, count: number): string {
  const words = type
    .replace(/^Sys(?=[A-Z])/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return count === 1 ? words : words.endsWith("s") ? `${words}es` : `${words}s`;
}

function words(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && w !== "stakwork");
}

function contains(small: string[], big: string[]): boolean {
  return small.length > 1 && small.every((w) => big.includes(w));
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function buildArchitecture(nodes: SystemMapDomainNode[], edges: SystemMapDomainEdge[]): ArchitectureModel {
  const byRef = new Map(nodes.map((n) => [n.refId, n]));
  const out = new Map<string, Link[]>();
  const inc = new Map<string, Link[]>();
  for (const e of edges) {
    if (!byRef.has(e.source) || !byRef.has(e.target)) continue;
    out.set(e.source, [...(out.get(e.source) ?? []), { other: e.target, edgeType: e.edgeType }]);
    inc.set(e.target, [...(inc.get(e.target) ?? []), { other: e.source, edgeType: e.edgeType }]);
  }
  const outOf = (id: string) => out.get(id) ?? [];
  const incOf = (id: string) => inc.get(id) ?? [];
  const type = (id: string) => byRef.get(id)?.type ?? "";
  const isPackage = (id: string) => type(id) === PACKAGE_TYPE;

  // A resource only ever contained by another resource (a volume of a container) is a chip on its parent.
  const subResource = (n: SystemMapDomainNode) =>
    n.type === "SysResource" &&
    outOf(n.refId).length === 0 &&
    incOf(n.refId).length > 0 &&
    incOf(n.refId).every((l) => l.edgeType === "CONTAINS" && type(l.other) === "SysResource");

  const shown = nodes.filter((n) => n.type !== PACKAGE_TYPE && !FOLDED_TYPES.has(n.type) && !subResource(n));
  const shownIds = new Set(shown.map((n) => n.refId));
  const zonesOf = (id: string) =>
    outOf(id)
      .filter((l) => l.edgeType === "IN_ZONE")
      .map((l) => byRef.get(l.other)!.name);

  // Lanes: own zone, else external → third-party, else the neighbour's lane.
  const lane = new Map<string, string>();
  for (const n of shown) {
    const zones = zonesOf(n.refId);
    if (zones.length) lane.set(n.refId, PICK_ORDER.find((z) => zones.includes(z)) ?? zones[0]);
    else if (n.type === "SysComponent" && n.properties.kind === "external") lane.set(n.refId, "third-party");
  }
  for (let pass = 0; pass < 4; pass++) {
    for (const n of shown) {
      if (lane.has(n.refId)) continue;
      const prefs = LANE_FROM[n.type] ?? [];
      const rank = (edgeType: string) => (prefs.includes(edgeType) ? prefs.indexOf(edgeType) : prefs.length);
      const placed = [...incOf(n.refId), ...outOf(n.refId)]
        .filter((l) => lane.has(l.other))
        .sort((a, b) => rank(a.edgeType) - rank(b.edgeType));
      if (placed.length) lane.set(n.refId, lane.get(placed[0].other)!);
    }
  }

  // Possible duplicates: the same source node, or resources of one kind whose names nest.
  const dupes = new Map<string, Set<string>>();
  const resources = shown.filter((n) => n.type === "SysResource");
  for (let i = 0; i < resources.length; i++) {
    for (let j = i + 1; j < resources.length; j++) {
      const a = resources[i];
      const b = resources[j];
      const sameSource = str(a.properties.source_ref_id) && a.properties.source_ref_id === b.properties.source_ref_id;
      const kind = str(a.properties.kind);
      const sameKind = kind && kind !== "volume" && kind === b.properties.kind;
      const wa = words(a.name);
      const wb = words(b.name);
      if (sameSource || (sameKind && (contains(wa, wb) || contains(wb, wa)))) {
        dupes.set(a.refId, (dupes.get(a.refId) ?? new Set()).add(b.refId));
        dupes.set(b.refId, (dupes.get(b.refId) ?? new Set()).add(a.refId));
      }
    }
  }

  const chipsFor = (n: SystemMapDomainNode, laneName: string): ArchChip[] => {
    const chips: ArchChip[] = [];
    const also = zonesOf(n.refId).filter((z) => z !== laneName);
    if (also.length) chips.push({ label: `also ${also.join(", ")}` });
    for (const l of outOf(n.refId)) {
      const t = type(l.other);
      const name = byRef.get(l.other)!.name;
      if (t === "SysTechnology" || t === "SysCapability") chips.push({ label: name, refId: l.other });
      else if (l.edgeType === "PLAYS") chips.push({ label: `plays ${name}`, refId: l.other });
      else if (l.edgeType === "CONTAINS" && !shownIds.has(l.other) && t === "SysResource") {
        chips.push({ label: name.replace(/^.*\bvolume\s+/, "vol "), refId: l.other });
      }
    }
    const operations = incOf(n.refId).filter((l) => l.edgeType === "PART_OF" && type(l.other) === "SysOperation");
    if (operations.length)
      chips.push({ label: `${operations.length} operation${operations.length === 1 ? "" : "s"}`, refId: n.refId });
    for (const l of incOf(n.refId)) {
      if (l.edgeType === "IMPLEMENTS" && type(l.other) === "SysArtifact") {
        chips.push({ label: `image ${byRef.get(l.other)!.name}`, refId: l.other });
      }
    }
    const lockfiles = outOf(n.refId).filter((l) => type(l.other) === "SysArtifact");
    if (lockfiles.length)
      chips.push({ label: `${lockfiles.length} lockfile${lockfiles.length === 1 ? "" : "s"}`, refId: n.refId });
    const packages = outOf(n.refId).filter((l) => isPackage(l.other));
    if (packages.length) chips.push({ label: `${packages.length} packages`, packages: true });
    return chips;
  };

  const cards = new Map<string, ArchCard>();
  for (const n of shown) {
    const laneName = lane.get(n.refId) ?? UNPLACED_LANE;
    cards.set(n.refId, {
      node: n,
      lane: laneName,
      column: columnOf(n.type),
      chips: chipsFor(n, laneName),
      secret: n.properties.classification === "secret",
      duplicates: [...(dupes.get(n.refId) ?? [])],
    });
  }

  // Arrows between cards, plus one per data flow (FROM → TO, labelled with its kind and protocol).
  const merged = new Map<string, { source: string; target: string; labels: string[]; credential: boolean }>();
  const addArrow = (source: string, target: string, label: string, credential = false) => {
    if (source === target) return;
    const key = `${source}>${target}`;
    const arrow = merged.get(key) ?? { source, target, labels: [], credential };
    if (!arrow.labels.includes(label)) arrow.labels.push(label);
    merged.set(key, arrow);
  };
  for (const e of edges) {
    if (!shownIds.has(e.source) || !shownIds.has(e.target) || e.edgeType === "PLAYS") continue;
    addArrow(e.source, e.target, e.edgeType, e.edgeType === "AUTHENTICATES_WITH");
  }
  for (const flow of nodes.filter((n) => n.type === "SysDataFlow")) {
    const from = outOf(flow.refId).find((l) => l.edgeType === "FROM")?.other;
    const to = outOf(flow.refId).find((l) => l.edgeType === "TO")?.other;
    if (!from || !to || !shownIds.has(from) || !shownIds.has(to)) continue;
    const protocol = outOf(flow.refId).find((l) => l.edgeType === "USES_PROTOCOL");
    const kind = str(flow.properties.kind) ?? "flow";
    addArrow(from, to, `flow:${kind}${protocol ? ` ${byRef.get(protocol.other)!.name}` : ""}`);
  }
  const arrows: ArchArrow[] = [...merged.values()].map((a) => {
    const rw = a.labels.includes("READS_FROM") && a.labels.includes("WRITES_TO");
    const label = [
      ...(rw ? ["R/W"] : []),
      ...a.labels
        .filter((l) => !(rw && (l === "READS_FROM" || l === "WRITES_TO")))
        // "R/W" already says read-write; a flow keeps only its protocol then.
        .map((l) =>
          l.startsWith("flow:")
            ? l.slice(5).replace(rw ? /^read-write\s*/ : /^$/, "")
            : l.replace(/_/g, " ").toLowerCase(),
        )
        .filter(Boolean),
    ].join(" · ");
    return { id: `${a.source}>${a.target}`, source: a.source, target: a.target, label, credential: a.credential };
  });

  const zoneNodes = nodes.filter((n) => n.type === "SysTrustZone");
  const zoneDescription = new Map(zoneNodes.map((z) => [z.name, str(z.properties.boundary_description) ?? ""]));
  const laneNames = [...new Set([...cards.values()].map((c) => c.lane))].sort((a, b) => {
    const rank = (z: string) => (z === UNPLACED_LANE ? 1000 : ZONE_ORDER.includes(z) ? ZONE_ORDER.indexOf(z) : 500);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  const byOrder = (a: ArchCard, b: ArchCard) =>
    a.node.type.localeCompare(b.node.type) || a.node.name.localeCompare(b.node.name);

  // Groups: biggest first, so a card that several sources fan into joins the largest group.
  const groups = new Map<string, ArchGroup>();
  const groupOf = new Map<string, string>();
  const candidates: { source: string; type: string; members: ArchCard[] }[] = [];
  for (const source of cards.values()) {
    const byType = new Map<string, ArchCard[]>();
    for (const a of arrows) {
      if (a.source !== source.node.refId) continue;
      const target = cards.get(a.target)!;
      if (target.lane !== source.lane || target.column === source.column) continue;
      byType.set(target.node.type, [...(byType.get(target.node.type) ?? []), target]);
    }
    for (const [t, members] of byType) {
      if (members.length >= GROUP_MIN) candidates.push({ source: source.node.refId, type: t, members });
    }
  }
  candidates.sort((a, b) => b.members.length - a.members.length);
  for (const c of candidates) {
    const free = c.members.filter((m) => !groupOf.has(m.node.refId) && !groups.has(m.node.refId));
    if (free.length < GROUP_MIN) continue;
    const members = free.sort(byOrder);
    const id = `${GROUP_ID_PREFIX}${c.source}:${c.type}`;
    groups.set(id, {
      id,
      source: c.source,
      type: c.type,
      members: members.map((m) => m.node.refId),
      label: `${members.length} ${pluralType(c.type, members.length)}`,
      secretCount: members.filter((m) => m.secret).length,
    });
    for (const m of members) groupOf.set(m.node.refId, id);
  }

  const lanes: ArchLane[] = laneNames.map((name) => {
    const inLane = [...cards.values()].filter((c) => c.lane === name);
    return {
      name,
      description: name === UNPLACED_LANE ? "no trust zone reaches these" : (zoneDescription.get(name) ?? ""),
      columns: COLUMNS.map((_, column) => {
        const items: ArchItem[] = [];
        const placed = new Set<string>();
        for (const card of inLane.filter((c) => c.column === column).sort(byOrder)) {
          const groupId = groupOf.get(card.node.refId);
          if (!groupId) items.push({ kind: "card", card });
          else if (!placed.has(groupId)) {
            placed.add(groupId);
            const group = groups.get(groupId)!;
            items.push({ kind: "group", group, cards: group.members.map((m) => cards.get(m)!) });
          }
        }
        return items;
      }),
    };
  });

  const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
  // Zones are lanes, not cards: an empty one is not a loose node.
  const isolated = nodes.filter((n) => n.type !== PACKAGE_TYPE && n.type !== "SysTrustZone" && !linked.has(n.refId));

  const seen = new Set<string>();
  const duplicateGroups: string[][] = [];
  for (const id of dupes.keys()) {
    if (seen.has(id)) continue;
    const group: string[] = [];
    const stack = [id];
    while (stack.length) {
      const x = stack.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      group.push(x);
      stack.push(...(dupes.get(x) ?? []));
    }
    duplicateGroups.push(group);
  }

  const foldedCounts = new Map<string, number>();
  for (const n of nodes)
    if (FOLDED_TYPES.has(n.type) && n.type !== "SysTrustZone")
      foldedCounts.set(n.type, (foldedCounts.get(n.type) ?? 0) + 1);

  return {
    lanes,
    groups,
    groupOf,
    cards,
    arrows,
    isolated,
    duplicateGroups,
    folded: [...foldedCounts.entries()].map(([t, count]) => ({ type: t, count })),
    packageCount: nodes.filter((n) => n.type === PACKAGE_TYPE).length,
  };
}

/**
 * The arrows to draw with `expanded` groups open: an end inside a closed
 * group moves to the group box, arrows that then share both ends merge
 * (labels joined), and arrows inside one closed group drop.
 */
export function visibleArrows(
  model: ArchitectureModel,
  expanded: ReadonlySet<string>,
  showCredentials = true,
): ArchArrow[] {
  const end = (refId: string) => {
    const groupId = model.groupOf.get(refId);
    return groupId && !expanded.has(groupId) ? groupId : refId;
  };
  const merged = new Map<string, ArchArrow & { labels: string[] }>();
  for (const a of model.arrows) {
    if (a.credential && !showCredentials) continue;
    const source = end(a.source);
    const target = end(a.target);
    if (source === target) continue;
    const id = `${source}>${target}`;
    const existing = merged.get(id);
    if (existing) {
      for (const l of a.label.split(" · ")) if (!existing.labels.includes(l)) existing.labels.push(l);
      existing.credential &&= a.credential;
    } else {
      merged.set(id, { ...a, id, source, target, labels: a.label.split(" · ") });
    }
  }
  return [...merged.values()].map(({ labels, ...a }) => ({ ...a, label: labels.join(" · ") }));
}
