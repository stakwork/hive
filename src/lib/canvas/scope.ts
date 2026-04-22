/**
 * Scope parsing + live-id helpers.
 *
 * **The one id-convention rule** applied across the whole canvas system:
 *   - Live ids start with `<kind>:` (e.g. `ws:abc`, `feature:xyz`).
 *   - Authored ids don't.
 *
 * Every piece of code that needs to know "is this a DB entity or a
 * hand-drawn node?" calls `isLiveId`. Do not read prefixes inline.
 */
import type { Scope } from "./types";

/** Empty-string sentinel for the root canvas, matching the DB row. */
export const ROOT_REF = "";

/**
 * Known live-id prefixes. Listed explicitly (not inferred) so adding a
 * new entity kind is a single edit here plus a new projector. Anything
 * not in this set is treated as an authored id.
 */
const LIVE_ID_PREFIXES = ["ws:", "feature:", "repo:"] as const;

/** True iff `id` is prefixed with a known live-id kind. */
export function isLiveId(id: string): boolean {
  for (const prefix of LIVE_ID_PREFIXES) {
    if (id.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Parse a `Canvas.ref` column value into a Scope.
 *
 *   ""                   → root
 *   "node:<id>"          → authored-sub (zoom into an authored node)
 *   "ws:<cuid>"          → workspace team view (v3; projector is a
 *                          no-op in v1 but the parser accepts it so we
 *                          don't have to change refs later)
 *   "feature:<cuid>"     → feature deep-dive (same, v3+)
 *   anything else        → opaque (stored verbatim, no projection)
 *
 * Opaque scopes exist because sub-canvases predate the projection
 * work: before this pipeline, the library stored whatever string the
 * consumer set on `node.ref`. Parsing them as "opaque" preserves that
 * behavior and lets us adopt prefixed scopes incrementally.
 */
export function parseScope(ref: string): Scope {
  if (ref === ROOT_REF) return { kind: "root" };
  if (ref.startsWith("node:")) {
    const nodeId = ref.slice("node:".length);
    if (nodeId) return { kind: "authored", nodeId };
  } else if (ref.startsWith("ws:")) {
    const workspaceId = ref.slice("ws:".length);
    if (workspaceId) return { kind: "workspace", workspaceId };
  } else if (ref.startsWith("feature:")) {
    const featureId = ref.slice("feature:".length);
    if (featureId) return { kind: "feature", featureId };
  }
  return { kind: "opaque", ref };
}
