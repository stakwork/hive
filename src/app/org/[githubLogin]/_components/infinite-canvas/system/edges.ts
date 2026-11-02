/**
 * The System view's two stored edge types, as `UrnEdge` rows (no graph
 * ontology change yet; promoting them to graph edges is a later stage):
 *
 *  - `IN_AREA`  feature → SysComponent: the district a feature stands in.
 *  - `EXTENDS`  later feature → the earlier feature it builds on. At most one
 *               parent, no cycles; walks are bounded.
 *
 * Pure: no db, no React. The routes (`api/orgs/[githubLogin]/system-edges`)
 * validate with these; the model reads the rows through `edgeMaps`.
 */

import { formatUrn, parseUrn } from "@/lib/urn/parse";

export const IN_AREA = "IN_AREA";
export const EXTENDS = "EXTENDS";
export type SystemEdgeType = typeof IN_AREA | typeof EXTENDS;
export const SYSTEM_EDGE_TYPES: readonly SystemEdgeType[] = [IN_AREA, EXTENDS];

/** A walk up an EXTENDS chain stops here: no real chain is longer, and a corrupt one can't loop forever. */
export const MAX_CHAIN = 50;

export const FEATURE_TYPE = "InitiativeFeature";

/** A graph node's URN: `urn:<org>:kg:<workspace>:<type>:<ref_id>`. */
export const graphUrn = (org: string, workspace: string, type: string, id: string) =>
  formatUrn({ realm: "kg", org, workspace, type, id });

/** The ref_id and type of a kg URN; null for anything else. */
export function graphRef(urn: string): { workspace: string; type: string; id: string } | null {
  const p = parseUrn(urn);
  return p?.realm === "kg" ? { workspace: p.workspace, type: p.type, id: p.id } : null;
}

export interface EdgeRow {
  fromUrn: string;
  toUrn: string;
  type: string;
}

export interface EdgeMaps {
  /** Feature ref_id → the SysComponent ref_id it stands in (the newest row wins when a feature has several). */
  inArea: Map<string, string>;
  /** Feature ref_id → the feature it extends. Rows that would make a second parent or a cycle are skipped. */
  extendsOf: Map<string, string>;
}

/** The first ancestor of `from` that is `target`, walking `parentOf`, bounded. */
export function reaches(parentOf: ReadonlyMap<string, string>, from: string, target: string): boolean {
  let at: string | undefined = from;
  for (let i = 0; at !== undefined && i < MAX_CHAIN; i++) {
    if (at === target) return true;
    at = parentOf.get(at);
  }
  return false;
}

export type ExtendsCheck = { ok: true } | { ok: false; reason: "self" | "second-parent" | "cycle" };

/**
 * Can `child` extend `parent`, given the parents already stored? Re-writing the
 * same parent is fine (idempotent); a different second parent, a self edge, or
 * a parent whose chain leads back to the child is not.
 */
export function checkExtends(parentOf: ReadonlyMap<string, string>, child: string, parent: string): ExtendsCheck {
  if (child === parent) return { ok: false, reason: "self" };
  const current = parentOf.get(child);
  if (current !== undefined && current !== parent) return { ok: false, reason: "second-parent" };
  if (reaches(parentOf, parent, child)) return { ok: false, reason: "cycle" };
  return { ok: true };
}

/** Stored rows as the maps the model reads; invalid EXTENDS rows (older first) are dropped, never thrown. */
export function edgeMaps(rows: readonly EdgeRow[]): EdgeMaps {
  const inArea = new Map<string, string>();
  const extendsOf = new Map<string, string>();
  for (const row of rows) {
    const from = graphRef(row.fromUrn);
    const to = graphRef(row.toUrn);
    if (!from || !to || from.type !== FEATURE_TYPE) continue;
    if (row.type === IN_AREA && to.type.startsWith("Sys")) inArea.set(from.id, to.id);
    else if (row.type === EXTENDS && to.type === FEATURE_TYPE && checkExtends(extendsOf, from.id, to.id).ok)
      extendsOf.set(from.id, to.id);
  }
  return { inArea, extendsOf };
}
