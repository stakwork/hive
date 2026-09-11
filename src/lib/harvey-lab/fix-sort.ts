/**
 * fix-sort.ts
 *
 * Shared comparator for ProposedFix rows used in:
 *   - `EvalRunsBox.tsx` (client-side `sortFixes`)
 *   - `GET /api/.../proposed-fixes/route.ts` (server-side sort)
 *
 * A single implementation is the only way to guarantee identical ordering
 * across both surfaces. `localeCompare` is intentionally avoided: it resolves
 * against differing ICU data in the browser vs Node, which is exactly the
 * source of the nondeterministic-ordering bug described in T3.
 *
 * Sort order (tiebreakers applied left-to-right):
 *   1. target_name  — leads because concept fixes never set criterion_id;
 *                     prompt fixes (which have criterion_id and lack target_name)
 *                     therefore fall through correctly to tier 2.
 *   2. criterion_id — demoted so prompt fixes keep their current relative ordering.
 *   3. ref_id       — final tiebreak for absolute stability.
 *
 * Nulls sort last at every tier.
 */

/**
 * Plain codepoint string comparison (< / >), stable across environments.
 * Returns negative, zero, or positive — the same contract as Array.sort's
 * comparator argument.
 */
function cmpStr(a: string | null | undefined, b: string | null | undefined): number {
  const an = a == null ? null : a.trim();
  const bn = b == null ? null : b.trim();

  if (an === bn) return 0;           // identical (including both null/empty)
  if (an === null || an === "") return 1;   // nulls last
  if (bn === null || bn === "") return -1;
  if (an < bn) return -1;
  if (an > bn) return 1;
  return 0;
}

/**
 * Canonical comparator for ProposedFix rows — call this from both the
 * client-side sort and the server-side sort so the ordering is provably
 * identical regardless of environment.
 *
 * The fields are read as plain strings (trimmed, nulls-last) and compared
 * via codepoint order — no locale, no collation.
 */
export function compareFixRows<
  T extends {
    target_name?: string | null;
    criterion_id?: string | null;
    ref_id?: string | null;
  }
>(a: T, b: T): number {
  const byTargetName = cmpStr(a.target_name, b.target_name);
  if (byTargetName !== 0) return byTargetName;

  const byCriterionId = cmpStr(a.criterion_id, b.criterion_id);
  if (byCriterionId !== 0) return byCriterionId;

  return cmpStr(a.ref_id, b.ref_id);
}
