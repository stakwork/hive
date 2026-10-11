import { logger } from "@/lib/logger";
import type { CweEntry, CweListMember, CweMappingUsage, CweRelatedResponse, CweUsableChild } from "@/types/system-map";
import { isUsableCwe } from "./cwe-lists";
import { expandInfosecNode, findInfosecNode, type InfosecNode } from "./infosec-graph";

const CWE_NODE_TYPE = "CWE";
/** How deep the PARENT_OF walk goes looking for usable children. */
const CHILD_DEPTH = 3;
const EDGE_LIMIT = 1000;
const CONCURRENCY = 8;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function toUsage(v: unknown): CweMappingUsage {
  return v === "Allowed" || v === "Allowed-with-Review" || v === "Discouraged" || v === "Prohibited" ? v : "Unknown";
}

export function toCweEntry(node: InfosecNode): CweEntry | null {
  const p = node.properties ?? {};
  const id = str(p.cwe_id);
  if (!id || !node.ref_id || (node.node_type && node.node_type !== CWE_NODE_TYPE)) return null;
  return {
    refId: node.ref_id,
    id,
    number: Number(id.replace(/^CWE-/i, "")) || 0,
    name: str(p.name) ?? id,
    description: str(p.description) ?? "",
    kind: str(p.kind) ?? "weakness",
    abstraction: str(p.abstraction),
    status: str(p.cwe_status),
    usage: toUsage(p.mapping_usage),
    usageRationale: str(p.mapping_rationale),
    likelihood: str(p.likelihood_of_exploit),
    url: str(p.url),
  };
}

/** Run `fn` with at most `limit` calls in flight across every caller of the returned function. */
function limiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

/** The CWEs on the other end of `refId`'s `edgeType` edges, in the given direction. */
/**
 * The CWEs on the other end of `refId`'s `edgeType` edges, in the given
 * direction — one expand read, filtered to that edge type server-side; the
 * neighbour nodes come back with their properties.
 */
async function neighbours(
  refId: string,
  edgeType: string,
  direction: "in" | "out",
): Promise<{ self: CweEntry | null; others: CweEntry[] }> {
  const read = await expandInfosecNode(refId, [edgeType], EDGE_LIMIT).catch((error: unknown) => {
    throw new Error(`Infosec graph: ${error instanceof Error ? error.message : String(error)}`);
  });
  const byRef = new Map(read.nodes.map((node) => [node.ref_id, node]));
  const self = byRef.get(refId);
  const others: CweEntry[] = [];
  for (const edge of read.edges) {
    if (edge.edge_type !== edgeType) continue;
    const other = direction === "in" ? (edge.target === refId ? edge.source : null) : edge.source === refId ? edge.target : null;
    const node = other ? byRef.get(other) : undefined;
    const cwe = node ? toCweEntry(node) : null;
    if (cwe) others.push(cwe);
  }
  return { self: self ? toCweEntry(self) : null, others };
}

const byNumber = (a: CweEntry, b: CweEntry) => a.number - b.number;

export type ListCweViewResult =
  | { ok: true; view: { id: string; name: string }; members: CweListMember[] }
  | { ok: false; error: string };

/**
 * A curated CWE view from the shared infosec graph's CWE catalogue
 * (`infosec-graph.ts`) — the same catalogue for every workspace.
 *
 * Members are what is `MEMBER_OF` the view; an OWASP view holds categories,
 * so their weaknesses (one hop down) are listed with `category` set. A member
 * MITRE marks Discouraged / Prohibited (or without a usage) is too abstract to
 * review, so its `PARENT_OF` descendants are walked up to three levels for
 * usable ones. Edges are read with a server-side edge-type filter, never a
 * node's whole neighbourhood.
 */
export async function listCweView(viewId: string): Promise<ListCweViewResult> {
  let viewRef: string | null;
  try {
    viewRef = await findInfosecNode(CWE_NODE_TYPE, viewId);
  } catch (error) {
    return { ok: false, error: `Infosec graph: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!viewRef) return { ok: false, error: `${viewId} is not in the infosec graph's CWE catalogue` };

  const run = limiter(CONCURRENCY);
  const read = (refId: string, edgeType: string, direction: "in" | "out") =>
    run(() => neighbours(refId, edgeType, direction));

  let view: { id: string; name: string };
  let direct: CweEntry[];
  try {
    const members = await read(viewRef, "MEMBER_OF", "in");
    view = { id: viewId, name: members.self?.name ?? viewId };
    direct = members.others;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const categories = direct.filter((c) => c.kind === "category");
  const fromCategories = await Promise.all(
    categories.map(async (category) => {
      const inner = await read(category.refId, "MEMBER_OF", "in")
        .then((r) => r.others)
        .catch(() => [] as CweEntry[]);
      return inner.filter((c) => c.kind === "weakness").map((c) => ({ cwe: c, category }));
    }),
  );

  const seen = new Set<string>();
  const listed = [
    ...direct.filter((c) => c.kind === "weakness").map((cwe) => ({ cwe, category: null as CweEntry | null })),
    ...fromCategories.flat(),
  ].filter(({ cwe }) => (seen.has(cwe.id) ? false : (seen.add(cwe.id), true)));

  // One PARENT_OF read per node across the whole list: members share ancestors.
  const childReads = new Map<string, Promise<CweEntry[]>>();
  const childrenOf = (cwe: CweEntry) => {
    let pending = childReads.get(cwe.refId);
    if (!pending) {
      pending = read(cwe.refId, "PARENT_OF", "out").then(({ others }) =>
        others.filter((c) => c.kind === "weakness" && c.status !== "Deprecated"),
      );
      childReads.set(cwe.refId, pending);
    }
    return pending;
  };

  const usableBelow = async (member: CweEntry): Promise<CweUsableChild[]> => {
    const found: CweUsableChild[] = [];
    const visited = new Set([member.id]);
    let frontier: Array<{ cwe: CweEntry; via: string[] }> = [{ cwe: member, via: [] }];
    for (let depth = 0; depth < CHILD_DEPTH && frontier.length; depth++) {
      const next: typeof frontier = [];
      const levels = await Promise.all(frontier.map(async (f) => ({ f, children: await childrenOf(f.cwe) })));
      for (const { f, children } of levels) {
        for (const child of children) {
          if (visited.has(child.id)) continue;
          visited.add(child.id);
          if (isUsableCwe(child.usage)) found.push({ ...child, via: f.via });
          else next.push({ cwe: child, via: [...f.via, child.id] });
        }
      }
      frontier = next;
    }
    return found.sort(byNumber);
  };

  const members: CweListMember[] = await Promise.all(
    listed.map(async ({ cwe, category }) => {
      const base = {
        ...cwe,
        category: category ? { id: category.id, name: category.name } : null,
        usableChildren: [] as CweUsableChild[],
        childrenError: null as string | null,
      };
      if (isUsableCwe(cwe.usage)) return base;
      try {
        return { ...base, usableChildren: await usableBelow(cwe) };
      } catch (error) {
        return { ...base, childrenError: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  members.sort(byNumber);

  logger.info("[SystemMap] CWE view", "system-map", {
    view: viewId,
    members: members.length,
    edgeReads: childReads.size + 1 + categories.length,
  });

  return { ok: true, view, members };
}

// ── related catalogue nodes ─────────────────────────────────────────────────

export type CweRelated = Extract<CweRelatedResponse, { status: "ready" }>;
type RelatedBucket = Exclude<keyof CweRelated, "status">;

/** Outgoing CWE edges the detail panel shows, and where each lands. */
const RELATED_EDGES: Record<string, RelatedBucket> = {
  HAS_TEST_TEMPLATE: "templates",
  MITIGATED_BY: "mitigations",
  DETECTABLE_BY: "detection",
  APPLIES_TO: "platforms",
};

function text(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return Array.isArray(v) ? v.map(String).join(", ") : String(v);
}

function relatedDetails(bucket: RelatedBucket, node: Record<string, unknown>, edge: Record<string, unknown>): string[] {
  const facts: Array<string | null> =
    bucket === "templates"
      ? [text(node.lifecycle), text(node.target_type) && `target ${text(node.target_type)}`, text(node.version) && `v${text(node.version)}`]
      : bucket === "mitigations"
        ? [text(node.phases), text(node.strategy), text(edge.effectiveness) && `effectiveness ${text(edge.effectiveness)}`, text(edge.ordinal) === "1" ? "primary" : null]
        : bucket === "detection"
          ? [text(edge.effectiveness) && `effectiveness ${text(edge.effectiveness)}`, text(edge.description)]
          : [text(edge.prevalence)];
  return facts.filter((f): f is string => !!f);
}

/**
 * A CWE's test templates, mitigations, detection methods and platforms —
 * its outgoing HAS_TEST_TEMPLATE / MITIGATED_BY / DETECTABLE_BY / APPLIES_TO
 * edges on the infosec graph, in one filtered expand.
 */
export async function loadCweRelated(refId: string): Promise<CweRelated> {
  const read = await expandInfosecNode(refId, Object.keys(RELATED_EDGES));
  const byRef = new Map(read.nodes.map((node) => [node.ref_id, node]));
  const out: CweRelated = { status: "ready", templates: [], mitigations: [], detection: [], platforms: [] };
  for (const edge of read.edges) {
    const bucket = RELATED_EDGES[edge.edge_type];
    const node = bucket && edge.source === refId ? byRef.get(edge.target) : undefined;
    if (!bucket || !node) continue;
    const p = node.properties ?? {};
    out[bucket].push({
      refId: node.ref_id,
      nodeType: node.node_type,
      name: str(p.name) ?? str(p.template_id) ?? str(p.mitigation_id) ?? node.ref_id,
      description: str(p.description),
      details: relatedDetails(bucket, p, edge.properties ?? {}),
    });
  }
  for (const bucket of Object.values(RELATED_EDGES)) out[bucket].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
