/**
 * Pure model for the System Map report — the `swarm-systemmap-schema-sync`
 * workflow's output: a verification of an ontology (Sys* node types and
 * the edges between them) against the workspace's own knowledge graph.
 *
 * `parseSystemMapReport` recognises that shape (leniently — extra keys are
 * kept out, missing optional ones default) so the UI can fall back to the
 * generic output view for anything else. The rest builds what the view
 * renders: the node-type tree from each type's `parent`, per-group counts,
 * and verdict + text filtering that keeps a matching row's ancestors.
 */

export const VERDICTS = ["MATCH", "PARTIAL", "MISSING", "UNKNOWN", "CONFLICT"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface ReportNodeType {
  type: string;
  parent: string | null;
  verdict: Verdict;
  reason: string | null;
  evidence: string[];
}

export interface ReportEdge {
  edge_type: string;
  source_type: string;
  target_type: string;
  verdict: Verdict;
  reason: string | null;
  evidence: string[];
}

export type VerdictCounts = Record<Verdict, number>;

export interface SystemMapReport {
  note: string | null;
  swarmUrl: string | null;
  sessionId: string | null;
  ontologyVersion: { hash: string | null; typeCount: number | null; edgeCount: number | null } | null;
  summary: {
    counts: VerdictCounts;
    consideredNodeTypes: number | null;
    consideredEdges: number | null;
  };
  nodeTypes: ReportNodeType[];
  edges: ReportEdge[];
}

/** The root every family hangs off in the ontology. */
export const ROOT_PARENT = "Thing";

function isVerdict(v: unknown): v is Verdict {
  return typeof v === "string" && (VERDICTS as readonly string[]).includes(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

export function emptyCounts(): VerdictCounts {
  return { MATCH: 0, PARTIAL: 0, MISSING: 0, UNKNOWN: 0, CONFLICT: 0 };
}

export function countVerdicts(items: Array<{ verdict: Verdict }>): VerdictCounts {
  const counts = emptyCounts();
  for (const item of items) counts[item.verdict]++;
  return counts;
}

/**
 * Recognise a workflow output as a System Map report. Returns null for
 * anything else so the caller can fall back to the generic renderer.
 */
export function parseSystemMapReport(output: unknown): SystemMapReport | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const o = output as Record<string, unknown>;
  if (!Array.isArray(o.nodeTypes) || !Array.isArray(o.edges)) return null;

  const nodeTypes: ReportNodeType[] = [];
  for (const raw of o.nodeTypes) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const type = str(r.type);
    if (!type || !isVerdict(r.verdict)) continue;
    nodeTypes.push({
      type,
      parent: str(r.parent),
      verdict: r.verdict,
      reason: str(r.reason),
      evidence: strings(r.evidence),
    });
  }

  const edges: ReportEdge[] = [];
  for (const raw of o.edges) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const edgeType = str(r.edge_type);
    const source = str(r.source_type);
    const target = str(r.target_type);
    if (!edgeType || !source || !target || !isVerdict(r.verdict)) continue;
    edges.push({
      edge_type: edgeType,
      source_type: source,
      target_type: target,
      verdict: r.verdict,
      reason: str(r.reason),
      evidence: strings(r.evidence),
    });
  }

  if (nodeTypes.length === 0 && edges.length === 0) return null;

  const summary = (o.summary && typeof o.summary === "object" ? o.summary : {}) as Record<string, unknown>;
  const rawCounts = (summary.counts && typeof summary.counts === "object" ? summary.counts : null) as Record<
    string,
    unknown
  > | null;
  // The summary's counts cover node types AND edges together; trust them
  // when present, else derive.
  const counts = emptyCounts();
  if (rawCounts) {
    for (const v of VERDICTS) counts[v] = num(rawCounts[v]) ?? 0;
  } else {
    const derived = countVerdicts([...nodeTypes, ...edges]);
    for (const v of VERDICTS) counts[v] = derived[v];
  }

  const version = (o.ontologyVersion && typeof o.ontologyVersion === "object" ? o.ontologyVersion : null) as Record<
    string,
    unknown
  > | null;

  return {
    note: str(o.note),
    swarmUrl: str(o.swarm_url),
    sessionId: str(o.sessionId),
    ontologyVersion: version
      ? { hash: str(version.hash), typeCount: num(version.typeCount), edgeCount: num(version.edgeCount) }
      : null,
    summary: {
      counts,
      consideredNodeTypes: num(summary.consideredNodeTypes),
      consideredEdges: num(summary.consideredEdges),
    },
    nodeTypes,
    edges,
  };
}

// ─── Node-type tree ───────────────────────────────────────────────────────

export interface TypeTreeNode {
  item: ReportNodeType;
  children: TypeTreeNode[];
  /** Verdict counts over this node's whole subtree, itself included. */
  counts: VerdictCounts;
}

function addCounts(into: VerdictCounts, from: VerdictCounts): void {
  for (const v of VERDICTS) into[v] += from[v];
}

/**
 * Build the family tree from `parent` links. Roots are types whose parent
 * is `Thing`, null, or a type not in the report. Siblings keep the report's
 * order. Every node carries subtree verdict counts.
 */
export function buildTypeTree(nodeTypes: ReportNodeType[]): TypeTreeNode[] {
  const byType = new Map(nodeTypes.map((t) => [t.type, t]));
  const childrenOf = new Map<string, ReportNodeType[]>();
  const roots: ReportNodeType[] = [];
  for (const t of nodeTypes) {
    if (t.parent && t.parent !== ROOT_PARENT && byType.has(t.parent)) {
      const list = childrenOf.get(t.parent) ?? [];
      list.push(t);
      childrenOf.set(t.parent, list);
    } else {
      roots.push(t);
    }
  }
  const seen = new Set<string>();
  const build = (item: ReportNodeType): TypeTreeNode => {
    seen.add(item.type);
    const children = (childrenOf.get(item.type) ?? []).filter((c) => !seen.has(c.type)).map(build);
    const counts = emptyCounts();
    counts[item.verdict]++;
    for (const c of children) addCounts(counts, c.counts);
    return { item, children, counts };
  };
  return roots.map(build);
}

export interface ReportFilter {
  /** Empty = every verdict. */
  verdicts: ReadonlySet<Verdict>;
  /** Case-insensitive substring over type / edge names, evidence and reason. */
  query: string;
}

function matchesText(text: string[], query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return text.some((t) => t.toLowerCase().includes(q));
}

function nodeMatches(item: ReportNodeType, filter: ReportFilter): boolean {
  if (filter.verdicts.size > 0 && !filter.verdicts.has(item.verdict)) return false;
  return matchesText([item.type, item.reason ?? "", ...item.evidence], filter.query);
}

/**
 * Prune a tree to the nodes that match, keeping every ancestor of a match
 * (dimmed by the view when it does not match itself). Subtree counts are
 * recomputed over the kept nodes.
 */
export function filterTypeTree(tree: TypeTreeNode[], filter: ReportFilter): TypeTreeNode[] {
  const isEmpty = filter.verdicts.size === 0 && !filter.query;
  if (isEmpty) return tree;
  const prune = (node: TypeTreeNode): TypeTreeNode | null => {
    const children = node.children.map(prune).filter((c): c is TypeTreeNode => c !== null);
    const self = nodeMatches(node.item, filter);
    if (!self && children.length === 0) return null;
    const counts = emptyCounts();
    if (self) counts[node.item.verdict]++;
    for (const c of children) addCounts(counts, c.counts);
    return { item: node.item, children, counts };
  };
  return tree.map(prune).filter((n): n is TypeTreeNode => n !== null);
}

export function nodeMatchesFilter(item: ReportNodeType, filter: ReportFilter): boolean {
  return nodeMatches(item, filter);
}

// ─── Edges ────────────────────────────────────────────────────────────────

export interface EdgeGroup {
  edgeType: string;
  edges: ReportEdge[];
  counts: VerdictCounts;
}

/** Group edges by relation, in first-seen order, with counts. */
export function groupEdges(edges: ReportEdge[], filter?: ReportFilter): EdgeGroup[] {
  const groups = new Map<string, ReportEdge[]>();
  for (const e of edges) {
    if (filter) {
      if (filter.verdicts.size > 0 && !filter.verdicts.has(e.verdict)) continue;
      if (!matchesText([e.edge_type, e.source_type, e.target_type, e.reason ?? "", ...e.evidence], filter.query)) continue;
    }
    const list = groups.get(e.edge_type) ?? [];
    list.push(e);
    groups.set(e.edge_type, list);
  }
  return [...groups.entries()].map(([edgeType, list]) => ({ edgeType, edges: list, counts: countVerdicts(list) }));
}

/** Verdict shares for a segmented bar, in fixed verdict order, zeros dropped. */
export function verdictSegments(counts: VerdictCounts): Array<{ verdict: Verdict; count: number; share: number }> {
  const total = VERDICTS.reduce((n, v) => n + counts[v], 0);
  if (total === 0) return [];
  return VERDICTS.filter((v) => counts[v] > 0).map((v) => ({ verdict: v, count: counts[v], share: counts[v] / total }));
}
