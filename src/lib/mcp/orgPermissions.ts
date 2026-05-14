/**
 * Org-scope MCP permission vocabulary.
 *
 * Pulled out of `orgMcpTools.ts` into its own dep-free module so that
 * `orgTokenMint.ts` and `handler.ts` can import the permission types
 * + helpers without dragging in `runCanvasAgent` (and its transitive
 * `services/workspace.ts` → `config/services.ts` chain). That import
 * chain blew up unit tests that mock `@/config/env` because Vitest
 * evaluates the unmocked tail of the graph at module load.
 *
 * Anything added here MUST stay zero-import (or limited to type-only
 * imports from `@/types` etc) — the value of the split is that it
 * runs before any test mock setup can be assumed.
 */

/**
 * Valid permission values. `read` is the baseline (every org token
 * holds it). `write` enables direct mutations inside `runCanvasAgent`
 * (update_canvas, save_research, propose_*, etc).
 *
 * Kept as a flat array so additive future values (`admin`, `propose`,
 * etc) don't break existing tokens — absent values default to "not
 * granted".
 */
export type OrgPermission = "read" | "write";

export const ORG_PERMISSIONS: readonly OrgPermission[] = ["read", "write"];

export function isOrgPermission(v: unknown): v is OrgPermission {
  return typeof v === "string" && (ORG_PERMISSIONS as readonly string[]).includes(v);
}
