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
const LIVE_ID_PREFIXES = [
  "ws:",
  "feature:",
  "repo:",
  "initiative:",
  "milestone:",
] as const;

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
 *   "ws:<cuid>"          → workspace sub-canvas (repos)
 *   "initiative:<cuid>"  → initiative timeline (milestones)
 *   "node:<id>"          → legacy authored-sub. The pre-cutover plan
 *                          (`docs/plans/org-canvas.md`) used these for
 *                          drillable authored objectives. Those are
 *                          gone, but we still parse the prefix so any
 *                          orphaned blobs round-trip through reads
 *                          without crashing — projection no-ops on
 *                          this scope kind.
 *   "feature:<cuid>"     → feature deep-dive (reserved; no projector)
 *   "milestone:<cuid>"   → milestone deep-dive (reserved; no projector
 *                          in v1 — features/tasks projection is v2)
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
  } else if (ref.startsWith("initiative:")) {
    const initiativeId = ref.slice("initiative:".length);
    if (initiativeId) return { kind: "initiative", initiativeId };
  } else if (ref.startsWith("milestone:")) {
    const milestoneId = ref.slice("milestone:".length);
    if (milestoneId) return { kind: "milestone", milestoneId };
  } else if (ref.startsWith("feature:")) {
    const featureId = ref.slice("feature:".length);
    if (featureId) return { kind: "feature", featureId };
  }
  return { kind: "opaque", ref };
}
