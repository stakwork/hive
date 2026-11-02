/**
 * The System view's model: the System Map's areas as districts, with the
 * plan's features standing on them as stacks of tiers. Pure: no React, no
 * fetch (like `board.ts`, `build.ts`, `scene.ts`).
 *
 *  - **Districts** are the System Map's SysComponents, grouped into trust
 *    zones, with what each claims (interfaces, resources, operations,
 *    artifacts) in its slot. The grouping is `buildMapLayout`'s (the Domain
 *    nodes tab's Map view): zone = the node's region, claims = `owner`, slot =
 *    where the Map puts it relative to its hub, wires = its flows.
 *  - **Tiers** are features. A feature's work state (`build.ts`) says which
 *    tier it is: not started → planned, in progress or blocked → in progress,
 *    done → built. A stack is a feature and the ones that `EXTENDS` it.
 *  - **Placement** of a feature: its stored `IN_AREA` edge, else the district
 *    whose component or repo names match the repos of its pull requests, else
 *    the "Unassigned" district.
 *  - **Unmapped**: jobs and pull requests that build no feature of the plan.
 */

import { buildMapLayout, type MapNode, ZONE_ROW } from "@/components/system-map/DomainNodesTab/map-layout";
import type { SystemMapDomainEdge, SystemMapDomainNode } from "@/types/system-map";
import type { CanvasJob } from "@/lib/canvas/canvas-jobs";
import type { ArtifactRef } from "../../../_state/canvasChatArtifacts";
import { type Board, type PlanNode, byId } from "../board";
import { type BuildPr, featureWork, prsOf, reposOf } from "../build";
import { type EdgeMaps, MAX_CHAIN } from "./edges";

export type TierState = "built" | "building" | "planned";
export type Slot = "front" | "back" | "left" | "right";
export const UNASSIGNED = "unassigned";

export interface Claimed {
  id: string;
  name: string;
  type: string;
  slot: Slot;
}

export interface Person {
  id: string;
  name: string;
}

export interface Tier {
  /** The feature's ref_id. */
  id: string;
  name: string;
  ws: string;
  state: TierState;
  /** In progress, but blocked (a failed job or failing CI): wants attention. */
  blocked: boolean;
  /** One line: why it's blocked, else how far it is. */
  line: string;
  initiative: { id: string; name: string };
  milestone?: { id: string; name: string };
  jobs: CanvasJob[];
  prs: BuildPr[];
  /** The people who started the jobs on it. */
  people: Person[];
  running: number;
  /** Bricks inside the tier: the requirements its chosen answers argued for. */
  requirements: string[];
  /** Brainstorm questions about it. */
  decisions: Array<{ id: string; name: string; decided: boolean }>;
  /** How it came to stand here. */
  placedBy: "edge" | "derived" | "unassigned";
  /** The feature it extends, when that is in the same district. */
  extendsId?: string;
  /** Its district. */
  district: string;
}

export interface Rollup {
  built: number;
  building: number;
  planned: number;
  attention: boolean;
}

export interface District {
  id: string;
  name: string;
  zone: string;
  ws: string;
  /** Stable order key within a zone. */
  key: string;
  claimed: Claimed[];
  /** Feature stacks, each bottom tier first, in stable order. */
  stacks: Tier[][];
  rollup: Rollup;
  unassigned: boolean;
}

export interface Unmapped {
  jobs: CanvasJob[];
  prs: BuildPr[];
}

export interface DistrictWire {
  from: string;
  to: string;
  label: string;
}

export interface SystemModel {
  /** Zone order, left to right. */
  zones: Array<{ key: string; label: string; districts: District[] }>;
  districts: Map<string, District>;
  tiers: Map<string, Tier>;
  unmapped: Unmapped;
  wires: DistrictWire[];
  /** Whether the System Map read gave any components at all. */
  mapped: boolean;
}

export interface SystemInput {
  nodes: readonly SystemMapDomainNode[];
  edges: readonly SystemMapDomainEdge[];
  /** Which workspace each system node was read from. */
  wsOf?: (refId: string) => string | undefined;
  board: Board;
  jobsByRef: Record<string, CanvasJob[]>;
  artifactsByRef: Record<string, ArtifactRef[]>;
  edgeMaps: EdgeMaps;
}

/** Zone order across the world is the Map's `ZONE_ROW`; the zones it doesn't list follow by name, "unassigned" is last. */
const zoneRank = (zone: string) => {
  if (zone === UNASSIGNED) return Number.MAX_SAFE_INTEGER;
  const i = ZONE_ROW.indexOf(zone);
  return i === -1 ? ZONE_ROW.length : i;
};
export const compareZones = (a: string, b: string) => zoneRank(a) - zoneRank(b) || a.localeCompare(b);

export const ZONE_LABEL = (zone: string) => (zone === UNASSIGNED ? "Unassigned" : zone);

/** A node's stable order key: when the graph first saw it (zero-padded), else its ref_id. */
export function stableKey(node: SystemMapDomainNode): string {
  const p = node.properties;
  const t = Number(p.date_added_to_graph ?? p.created_at ?? NaN);
  return `${Number.isFinite(t) ? String(Math.floor(t)).padStart(16, "0") : "~"}|${node.refId}`;
}

function slotOf(hub: MapNode, n: MapNode): Slot {
  const dx = n.x - hub.x;
  const dy = n.y - hub.y;
  // The Map's +y is towards the actors (front).
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? "front" : "back";
  return dx < 0 ? "left" : "right";
}

const lower = (s: string) => s.toLowerCase();

/** Names a district answers to when a pull request's repo is matched to it. */
function namesOf(d: District, hub?: MapNode, nodes?: readonly SystemMapDomainNode[]): string[] {
  const names = new Set<string>([lower(d.name)]);
  if (hub) names.add(lower(hub.label));
  for (const c of d.claimed) if (c.type === "SysArtifact") names.add(lower(c.name));
  const p = nodes?.find((n) => n.refId === d.id)?.properties;
  for (const k of ["repo", "repository", "repo_name"]) if (typeof p?.[k] === "string") names.add(lower(p[k] as string));
  return [...names].filter(Boolean);
}

/**
 * The district whose names match a repo ("owner/name"): an exact full or short
 * name beats a contained one; ties go to the first district in order.
 */
export function deriveDistrict(
  repos: readonly string[],
  districts: ReadonlyArray<{ id: string; names: string[] }>,
): string | undefined {
  let best: { id: string; score: number } | undefined;
  for (const repo of repos) {
    const full = lower(repo.trim());
    const short = full.split("/").pop() ?? full;
    for (const d of districts) {
      let score = 0;
      for (const name of d.names) {
        if (name === full || name === short || name.endsWith(`/${short}`)) score = Math.max(score, 3);
        else if (short.length >= 3 && name.length >= 3 && (name.includes(short) || short.includes(name)))
          score = Math.max(score, 1);
      }
      if (score && (!best || score > best.score)) best = { id: d.id, score };
    }
  }
  return best?.id;
}

const emptyRollup = (): Rollup => ({ built: 0, building: 0, planned: 0, attention: false });

/** Districts from the System Map nodes, in world order (zone, then stable key), the Unassigned one last. */
export function buildDistricts(
  nodes: readonly SystemMapDomainNode[],
  edges: readonly SystemMapDomainEdge[],
  wsOf: (refId: string) => string | undefined = () => undefined,
): { districts: District[]; hubs: Map<string, MapNode>; wires: DistrictWire[] } {
  const map = buildMapLayout([...nodes], [...edges]);
  const byOwner = new Map<string, MapNode[]>();
  for (const n of map.nodes.values()) if (n.owner) byOwner.set(n.owner, [...(byOwner.get(n.owner) ?? []), n]);
  const hubs = new Map<string, MapNode>();
  const districts: District[] = [];
  for (const node of nodes) {
    if (node.type !== "SysComponent") continue;
    const hub = map.nodes.get(node.refId);
    if (hub) hubs.set(node.refId, hub);
    const claimed: Claimed[] = hub
      ? (byOwner.get(node.refId) ?? [])
          .filter((n) => n.node.type !== "SysComponent")
          .map((n) => ({ id: n.node.refId, name: n.label, type: n.node.type, slot: slotOf(hub, n) }))
          .sort((a, b) => a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      : [];
    districts.push({
      id: node.refId,
      name: hub?.label ?? node.name,
      zone: hub?.region ?? "catalog",
      ws: wsOf(node.refId) ?? "",
      key: stableKey(node),
      claimed,
      stacks: [],
      rollup: emptyRollup(),
      unassigned: false,
    });
  }
  districts.sort((a, b) => compareZones(a.zone, b.zone) || a.key.localeCompare(b.key));

  // Data flows between districts (a claimed node counts as its hub).
  const owner = (id: string) => map.nodes.get(id)?.owner ?? id;
  const ids = new Set(districts.map((d) => d.id));
  const seen = new Set<string>();
  const wires: DistrictWire[] = [];
  for (const w of map.wires) {
    if (w.kind !== "flow" && w.kind !== "cross") continue;
    const from = owner(w.source);
    const to = owner(w.target);
    const key = `${from}>${to}`;
    if (from === to || !ids.has(from) || !ids.has(to) || seen.has(key)) continue;
    seen.add(key);
    wires.push({ from, to, label: w.label });
  }
  return { districts, hubs, wires };
}

/** A feature's requirements: the ones its chosen answers argued for (`SATISFIES`, as the options' pros name them). */
function requirementsOf(board: Board, featureId: string): string[] {
  const out: string[] = [];
  for (const q of board.nodes) {
    if (q.type !== "question" || q.about !== featureId) continue;
    for (const o of q.options ?? []) {
      if (!o.chosen) continue;
      for (const p of o.pros) {
        const req = p.req ? byId(board, p.req)?.name : undefined;
        if (req && !out.includes(req)) out.push(req);
      }
    }
  }
  return out;
}

/** A tier's state from its work state. */
export const tierState = (s: "not-started" | "in-progress" | "done" | "blocked"): TierState =>
  s === "done" ? "built" : s === "not-started" ? "planned" : "building";

function peopleOf(jobs: readonly CanvasJob[]): Person[] {
  const seen = new Map<string, Person>();
  for (const j of jobs)
    if (j.startedBy && !seen.has(j.startedBy.id))
      seen.set(j.startedBy.id, { id: j.startedBy.id, name: j.startedBy.name ?? "Someone" });
  return [...seen.values()];
}

/** Every district, stack and tier for the system and the plan, read the same graph. Pure. */
export function buildSystemModel(input: SystemInput): SystemModel {
  const { nodes, edges, board, jobsByRef, artifactsByRef, edgeMaps } = input;
  const { districts: real, hubs, wires } = buildDistricts(nodes, edges, input.wsOf);
  const unassigned: District = {
    id: UNASSIGNED,
    name: "Unassigned",
    zone: UNASSIGNED,
    ws: "",
    key: "~",
    claimed: [],
    stacks: [],
    rollup: emptyRollup(),
    unassigned: true,
  };
  const districts = [...real, unassigned];
  const byId_ = new Map(districts.map((d) => [d.id, d]));
  const names = real.map((d) => ({ id: d.id, names: namesOf(d, hubs.get(d.id), nodes) }));

  const features = board.nodes.filter((n) => n.type === "feature" && !n.pencil);
  const featureIds = new Set(features.map((f) => f.id));

  // Tiers.
  const tiers = new Map<string, Tier>();
  for (const f of features) {
    const jobs = jobsByRef[f.id] ?? [];
    const prs = prsOf(artifactsByRef[f.id]);
    const work = featureWork(jobs, prs);
    const edgeArea = edgeMaps.inArea.get(f.id);
    const derived = deriveDistrict(reposOf(prs), names);
    const placedBy: Tier["placedBy"] = edgeArea && byId_.has(edgeArea) ? "edge" : derived ? "derived" : "unassigned";
    const district = placedBy === "edge" ? edgeArea! : (derived ?? UNASSIGNED);
    const m = f.parent ? byId(board, f.parent) : undefined;
    const init = initiativeAbove(board, f);
    tiers.set(f.id, {
      id: f.id,
      name: f.name || "Untitled",
      ws: f.ws,
      state: tierState(work.state),
      blocked: work.state === "blocked",
      line: work.line,
      initiative: { id: init?.id ?? "", name: init?.name ?? "" },
      ...(m?.type === "milestone" ? { milestone: { id: m.id, name: m.name } } : {}),
      jobs,
      prs,
      people: peopleOf(jobs),
      running: jobs.filter((j) => j.state === "running").length,
      requirements: requirementsOf(board, f.id),
      decisions: board.nodes
        .filter((q) => q.type === "question" && q.about === f.id && !q.follows)
        .map((q) => ({ id: q.id, name: q.name, decided: !!q.decided })),
      placedBy,
      district,
    });
  }

  // Stacks: a feature and the ones extending it (in the same district), flattened in stable order.
  const childrenOf = new Map<string, string[]>();
  const roots: Record<string, string[]> = {};
  for (const id of [...featureIds].sort()) {
    const t = tiers.get(id)!;
    const parent = edgeMaps.extendsOf.get(id);
    if (parent && tiers.get(parent)?.district === t.district) {
      t.extendsId = parent;
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), id]);
    } else (roots[t.district] ??= []).push(id);
  }
  const walk = (id: string, out: Tier[], seen: Set<string>) => {
    if (seen.has(id) || out.length >= MAX_CHAIN * 4) return;
    seen.add(id);
    out.push(tiers.get(id)!);
    for (const c of childrenOf.get(id) ?? []) walk(c, out, seen);
  };
  for (const [districtId, rootIds] of Object.entries(roots)) {
    const d = byId_.get(districtId)!;
    for (const r of rootIds) {
      const stack: Tier[] = [];
      walk(r, stack, new Set());
      d.stacks.push(stack);
    }
  }
  for (const d of districts) {
    for (const t of d.stacks.flat()) {
      d.rollup[t.state]++;
      if (t.blocked) d.rollup.attention = true;
    }
  }

  // Unmapped: jobs and pull requests on no feature of the plan.
  const unmapped: Unmapped = { jobs: [], prs: [] };
  for (const [ref, js] of Object.entries(jobsByRef)) if (!featureIds.has(ref)) unmapped.jobs.push(...js);
  for (const [ref, list] of Object.entries(artifactsByRef)) if (!featureIds.has(ref)) unmapped.prs.push(...prsOf(list));
  unmapped.jobs.sort((a, b) => b.updatedAt - a.updatedAt);

  // Zones in world order (the Unassigned one only when something stands in it, or the map is empty).
  const zoneMap = new Map<string, District[]>();
  for (const d of districts) {
    if (d.unassigned && !d.stacks.length && real.length) continue;
    zoneMap.set(d.zone, [...(zoneMap.get(d.zone) ?? []), d]);
  }
  const zones = [...zoneMap.keys()].sort(compareZones).map((key) => ({
    key,
    label: ZONE_LABEL(key),
    districts: zoneMap.get(key)!,
  }));
  return {
    zones,
    districts: new Map(zones.flatMap((z) => z.districts).map((d) => [d.id, d])),
    tiers,
    unmapped,
    wires,
    mapped: real.length > 0,
  };
}

function initiativeAbove(board: Board, n: PlanNode): PlanNode | undefined {
  let at: PlanNode | undefined = n;
  for (let i = 0; at && i < 8; i++) {
    if (at.type === "initiative") return at;
    at = at.parent ? byId(board, at.parent) : undefined;
  }
  return undefined;
}
