/**
 * Authored-node rollups.
 *
 * Projectors emit live nodes from the DB. Rollups are different: they
 * take **existing authored nodes** and enrich their `customData` based
 * on the state of their **child canvas** (one level down). This is the
 * "the roadmap is the product" pattern — an objective with 4 of 5
 * mini-objectives done reads as 80% automatically, without the user
 * or agent having to type a number.
 *
 * Keep this file focused on the aggregation shape. `readCanvas` is the
 * only caller; it folds the result into the merge pipeline.
 */
import type { CanvasNode } from "system-canvas";
import { db } from "@/lib/db";
import type { CanvasBlob } from "./types";

/**
 * Parse the stored JSON blob shape defensively. Matches the helper in
 * `io.ts` (kept local so this module has no upward imports).
 */
function asBlob(value: unknown): Pick<CanvasBlob, "nodes"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { nodes: [] };
  }
  const v = value as Partial<CanvasBlob>;
  return { nodes: Array.isArray(v.nodes) ? (v.nodes as CanvasNode[]) : [] };
}

/**
 * Aggregate one child canvas's authored objective nodes into a
 * { done, total, percent } summary.
 *
 * "Done" = `customData.status === "ok"`. A child objective is counted
 * in the denominator iff its category is `"objective"` — notes and
 * decisions don't affect the parent's roll-up (they're UX scaffolding,
 * not work items). This keeps the math transparent: users can see
 * which nodes count by looking at their category.
 *
 * Returns `null` for an empty canvas so callers can decide whether to
 * stamp anything (no children → nothing to report, better than "0%").
 */
export function summarizeChildObjectives(
  nodes: CanvasNode[],
): { done: number; total: number; percent: number } | null {
  let done = 0;
  let total = 0;
  for (const n of nodes) {
    if (n.category !== "objective") continue;
    total += 1;
    if (n.customData?.status === "ok") done += 1;
  }
  if (total === 0) return null;
  return { done, total, percent: done / total };
}

/**
 * For each parent authored node that has a child sub-canvas, compute
 * a rollup of its child objectives' status. Returns a map keyed by
 * parent node id → partial customData to merge in.
 *
 * We batch the child-canvas reads into ONE query (`findMany` on `ref
 * IN (...)`) so the canvas-read cost stays O(1) DB round-trips
 * regardless of how many drillable objectives the parent has.
 */
export async function computeChildRollups(
  orgId: string,
  parentNodes: CanvasNode[],
): Promise<Record<string, Record<string, unknown>>> {
  // Only look at authored nodes whose `ref` addresses a child sub-
  // canvas. `splitCanvas` auto-stamps `ref: "node:<id>"` on drillable
  // categories, so presence of that ref is the signal we're looking
  // at a container worth rolling up.
  const candidates = parentNodes.filter((n) => n.ref?.startsWith("node:"));
  if (candidates.length === 0) return {};

  const refs = candidates.map((n) => n.ref as string);
  const rows = await db.canvas.findMany({
    where: { orgId, ref: { in: refs } },
    select: { ref: true, data: true },
  });

  // Index by ref for O(1) lookup; missing rows (no child canvas yet)
  // drop through untouched.
  const blobByRef = new Map<string, Pick<CanvasBlob, "nodes">>();
  for (const row of rows) blobByRef.set(row.ref, asBlob(row.data));

  const out: Record<string, Record<string, unknown>> = {};
  for (const parent of candidates) {
    const blob = blobByRef.get(parent.ref as string);
    if (!blob) continue;
    const summary = summarizeChildObjectives(blob.nodes);
    if (!summary) continue;

    // Derive a status hint from the progress. "ok" at 100%; otherwise
    // "attn" while in flight. Never "risk" — the child canvas doesn't
    // have enough signal for a risk call on its own; users/agents can
    // still set `customData.status` manually, and that wins (see
    // `applyRollup`'s manual-wins rule).
    const status = summary.percent >= 1 ? "ok" : "attn";

    // The renderer uses `customData.primary` in two places:
    //   - progress-bar slot: parses via `parsePercent`, which accepts
    //     `"N%"` or `0.N` and returns 0..1.
    //   - footer text: String()-coerced verbatim.
    // Formatting as `"N%"` satisfies both: the bar fills to N/100 and
    // the footer shows "80%".
    const pct = Math.round(summary.percent * 100);
    out[parent.id] = {
      primary: `${pct}%`,
      secondary: `${summary.done}/${summary.total}`,
      status,
    };
  }
  return out;
}
