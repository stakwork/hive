import {
  getNodeAncestors,
  getNodeEdges,
  listNodesByType,
  type JarvisAncestor,
  type JarvisGraphNode,
} from "@/services/swarm/api/nodes";
import { parseFixTracking } from "@/lib/system-map/finding-fix";
import type { JarvisConnectionConfig } from "@/types/jarvis";
import type { SystemMapFinding, SystemMapFindingPathStep, SystemMapFindingRelated } from "@/types/system-map";

/** The security workflows write their findings as `Finding` nodes in the workspace graph's `infosec` namespace. */
export const FINDING_NODE_TYPE = "Finding";
export const FINDING_NAMESPACE = "infosec";
export const MAX_FINDINGS = 2000;
const PAGE_SIZE = 500;
const MAX_PAGES = MAX_FINDINGS / PAGE_SIZE;

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

function pick(properties: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

/**
 * A Finding node, its common fields read leniently (the workflows' property
 * names are not fixed yet) and every property kept for the detail view.
 */
export function parseFinding(node: JarvisGraphNode): SystemMapFinding | null {
  if (!node.ref_id) return null;
  const p = node.properties ?? {};
  const line = pick(p, ["line", "line_number", "start_line"]);
  return {
    refId: node.ref_id,
    title: pick(p, ["title", "name", "summary"]) ?? node.ref_id,
    severity: pick(p, ["severity", "risk", "risk_level"])?.toLowerCase() ?? null,
    status: pick(p, ["status", "state"]),
    cweId: pick(p, ["cwe_id", "cwe"]),
    file: pick(p, ["file", "file_path", "path", "location"]),
    line: line ? Number(line) || null : null,
    description: pick(p, ["description", "details", "body"]),
    dateAdded: Number.parseFloat(String(node.date_added_to_graph ?? "")) || null,
    fix: parseFixTracking(p),
    properties: p,
  };
}

function severityRank(severity: string | null): number {
  const index = severity ? SEVERITY_ORDER.indexOf(severity) : -1;
  return index === -1 ? SEVERITY_ORDER.length : index;
}

export type ListFindingsResult =
  | { ok: true; findings: SystemMapFinding[]; truncated: boolean }
  | { ok: false; error: string };

/**
 * Every `Finding` node in the workspace graph's `infosec` namespace (up to
 * `MAX_FINDINGS`), most severe first. The namespace is a server-side filter:
 * without it jarvis reads the default namespace only.
 */
export async function listFindings(config: JarvisConnectionConfig): Promise<ListFindingsResult> {
  const raw: JarvisGraphNode[] = [];
  let startingAfter: string | undefined;
  let truncated = true;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listNodesByType(config, FINDING_NODE_TYPE, PAGE_SIZE, {
      startingAfter,
      namespace: FINDING_NAMESPACE,
    });
    if (!result.ok) return { ok: false, error: result.error || `Failed to read findings from ${config.jarvisUrl}` };
    raw.push(...result.nodes);
    const lastRefId = result.nodes[result.nodes.length - 1]?.ref_id;
    if (result.nodes.length < PAGE_SIZE || !lastRefId) {
      truncated = false;
      break;
    }
    startingAfter = lastRefId;
  }

  const byRef = new Map<string, SystemMapFinding>();
  for (const node of raw) {
    if (node.node_type && node.node_type !== FINDING_NODE_TYPE) continue;
    const finding = parseFinding(node);
    if (finding && !byRef.has(finding.refId)) byRef.set(finding.refId, finding);
  }
  const findings = [...byRef.values()].sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      (b.dateAdded ?? 0) - (a.dateAdded ?? 0) ||
      a.title.localeCompare(b.title),
  );
  return { ok: true, findings, truncated };
}

// ── related nodes ───────────────────────────────────────────────────────────

/** Most edges one related read returns; jarvis bounds its traversal with it. */
export const FINDING_RELATED_MAX = 500;
/** The ref_id goes into the jarvis path; only this shape is ever sent. */
const REF_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;

export function isFindingRefId(refId: string): boolean {
  return REF_ID_RE.test(refId);
}

export type LoadFindingRelatedResult =
  | { ok: true; related: SystemMapFindingRelated[]; truncated: boolean }
  | { ok: false; error: string };

/**
 * A finding's neighbours, one per edge, through boltwall:
 * `GET /v2/nodes/:ref_id?expand=edges`. Jarvis matches the node by ref_id
 * alone and does not filter neighbours by namespace, so the read covers the
 * infosec, systemmap and default namespaces at once — but it strips
 * `namespace` from what it returns, so neighbours are told apart by type.
 */
export async function loadFindingRelated(
  config: JarvisConnectionConfig,
  refId: string,
): Promise<LoadFindingRelatedResult> {
  const read = await getNodeEdges(config, refId, { limit: FINDING_RELATED_MAX });
  if (!read.ok) return { ok: false, error: read.error || `Failed to read related nodes from ${config.jarvisUrl}` };

  const byRef = new Map(read.nodes.map((node) => [node.ref_id, node]));
  const seen = new Set<string>();
  const related: SystemMapFindingRelated[] = [];
  for (const edge of read.edges) {
    const direction = edge.source === refId ? "out" : edge.target === refId ? "in" : null;
    if (!direction) continue;
    const otherRef = direction === "out" ? edge.target : edge.source;
    const node = byRef.get(otherRef);
    const key = `${otherRef}|${edge.edge_type}|${direction}`;
    if (!node || otherRef === refId || seen.has(key)) continue;
    seen.add(key);
    const properties = node.properties ?? {};
    related.push({
      refId: otherRef,
      nodeType: node.node_type || "Node",
      edgeType: edge.edge_type,
      direction,
      name: pick(properties, ["name", "title", "cwe_id", "file"]) ?? otherRef,
      file: pick(properties, ["file"]),
      properties,
    });
  }
  related.sort((a, b) => a.nodeType.localeCompare(b.nodeType) || a.name.localeCompare(b.name));
  return { ok: true, related, truncated: read.edges.length >= FINDING_RELATED_MAX };
}

// ── a vulnerable package's way in ───────────────────────────────────────────

const PACKAGE_NODE_TYPE = "SysPackage";
const COMPONENT_NODE_TYPE = "SysComponent";
const DEPENDENCY_EDGE = "DEPENDS_ON";
/** Packages per finding walked up, paths kept, hops walked. */
const MAX_PATH_PACKAGES = 3;
export const MAX_FINDING_PATHS = 3;
const MAX_PATH_DEPTH = 10;

function pathStep(refId: string, nodeType: string, name: string | null, properties: Record<string, unknown> = {}) {
  return {
    refId,
    nodeType,
    name: pick(properties, ["name"]) ?? name ?? refId,
    version: pick(properties, ["version"]),
  } satisfies SystemMapFindingPathStep;
}

/**
 * The shortest way from each component down to `start`, rebuilt from its
 * `DEPENDS_ON` ancestors (component → direct package → … → `start`), one path
 * per component, nearest components first. The walk stops at a component.
 */
export function buildDependencyPaths(
  start: SystemMapFindingPathStep,
  ancestors: JarvisAncestor[],
  max = MAX_FINDING_PATHS,
): SystemMapFindingPathStep[][] {
  const byRef = new Map(ancestors.map((a) => [a.ref_id, a]));
  const byName = (a: string, b: string) => (byRef.get(a)?.name ?? a).localeCompare(byRef.get(b)?.name ?? b);
  const parentsOf = (id: string) =>
    (id === start.refId ? ancestors.filter((a) => a.depth === 1).map((a) => a.ref_id) : (byRef.get(id)?.parents ?? []))
      .filter((p) => byRef.has(p))
      .sort(byName);

  // Breadth-first up from `start`; `below` points each node back toward it.
  const below = new Map<string, string>();
  const components: string[] = [];
  const queue = [start.refId];
  const seen = new Set(queue);
  while (queue.length && components.length < max) {
    const id = queue.shift()!;
    for (const parent of parentsOf(id)) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      below.set(parent, id);
      if (byRef.get(parent)!.node_type === COMPONENT_NODE_TYPE) components.push(parent);
      else queue.push(parent);
    }
  }

  return components.slice(0, max).map((component) => {
    const path: SystemMapFindingPathStep[] = [];
    for (let id: string | undefined = component; id && id !== start.refId; id = below.get(id)) {
      const a = byRef.get(id)!;
      path.push(pathStep(a.ref_id, a.node_type, a.name, a.properties));
    }
    return [...path, start];
  });
}

export interface FindingPathsResult {
  paths: SystemMapFindingPathStep[][];
  /** Why a package could not be walked (an older jarvis has no `ancestors`). */
  errors: string[];
}

/** For each package a finding is about: its way in from the components, one `ancestors` read per package. */
export async function loadFindingPaths(
  config: JarvisConnectionConfig,
  related: SystemMapFindingRelated[],
): Promise<FindingPathsResult> {
  const packages = related.filter((r) => r.nodeType === PACKAGE_NODE_TYPE).slice(0, MAX_PATH_PACKAGES);
  const reads = await Promise.all(
    packages.map((pkg) =>
      getNodeAncestors(config, pkg.refId, {
        edgeType: DEPENDENCY_EDGE,
        direction: "in",
        maxDepth: MAX_PATH_DEPTH,
        includeProperties: true,
      }),
    ),
  );
  const paths: SystemMapFindingPathStep[][] = [];
  const errors: string[] = [];
  reads.forEach((read, i) => {
    const pkg = packages[i];
    if (!read.ok) {
      errors.push(`${pkg.refId}: ${read.endpointMissing ? "ancestors endpoint missing" : (read.error ?? "failed")}`);
      return;
    }
    paths.push(...buildDependencyPaths(pathStep(pkg.refId, pkg.nodeType, pkg.name, pkg.properties), read.ancestors));
  });
  paths.sort((a, b) => a.length - b.length);
  return { paths: paths.slice(0, MAX_FINDING_PATHS), errors };
}
