/**
 * A node in ANOTHER workspace's graph, as the trace names it.
 *
 * Strut tags a ref a peer's run touched with the peer's id — on a hive org
 * strut, the workspace's slug (`services/strut-peers.ts`); a `ref_id` means
 * something only against the graph that recorded it. The trace keeps such a
 * node apart from this workspace's own by a qualified id, `@<slug>:<ref_id>`:
 * a local ref id never holds `@` or `:`, so the two can never collide, and
 * everything that keys by id (layout, lineage, replay, selection) stays
 * unchanged. Pure; safe on the client.
 */

/** A workspace slug, as hive mints them. */
const PEER_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const QUALIFIED_RE = /^@([a-z0-9][a-z0-9-]{0,63}):(.+)$/i;

/** Is this a peer id the trace will qualify a ref with? */
export function isPeerSlug(peer: unknown): peer is string {
  return typeof peer === "string" && PEER_RE.test(peer);
}

/** The trace's id for `refId` in `peer`'s graph; the bare ref id for this workspace's own. */
export function qualifyRef(refId: string, peer?: string): string {
  return peer ? `@${peer}:${refId}` : refId;
}

/** A trace id back to the graph it names and the ref id there: `peer` absent for this workspace's own. */
export function parseQualifiedRef(id: string): { peer?: string; refId: string } {
  const m = QUALIFIED_RE.exec(id);
  return m ? { peer: m[1], refId: m[2] } : { refId: id };
}
