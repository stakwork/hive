/**
 * Resolving "pull up the auth component / the repo picker feature" to a node
 * on the infinite canvas. Pure: shared by the `focus_canvas` agent tool
 * (server) and the Jamie bar's "pull up …" (client, System view).
 *
 * Same rule as the Plan view's `bestMatch`: an exact name first, then a name
 * containing the words, then most words matched; ties go to the bigger thing
 * (`rank`, lower first). Features and system nodes compete in one list.
 */

export type FocusKind = "feature" | "component" | "zone" | "initiative" | "milestone" | "resource" | "interface";
export type FocusView = "plan" | "system";

export interface FocusCandidate {
  kind: FocusKind;
  ref: string;
  name: string;
  /** The view that shows it. */
  view: FocusView;
}

export interface FocusResult {
  kind: FocusKind;
  ref: string;
  name: string;
  view: FocusView;
}

/** Lower is bigger; the tie-break between two equal scores. */
const RANK: Record<FocusKind, number> = {
  zone: 0,
  initiative: 1,
  component: 2,
  milestone: 3,
  feature: 4,
  interface: 5,
  resource: 6,
};

const clean = (q: string) =>
  q
    .toLowerCase()
    .replace(/[.?!]+$/, "")
    .replace(/^(?:the|a|an)\s+/, "")
    // "the auth component" → "auth"; "that failing tier" is left to the caller.
    .replace(/\s+(?:component|feature|tier|district|zone|area|initiative|milestone)$/, "")
    .trim();

function scoreOf(c: FocusCandidate, q: string, words: string[]): number {
  const name = c.name.toLowerCase();
  return (name === q ? 100 : name.includes(q) ? 50 : 0) + words.filter((w) => name.includes(w)).length * 5 - RANK[c.kind];
}

/** The best candidate for `target`, preferring `view` on a tie; undefined when nothing matches. */
export function resolveFocus(
  candidates: readonly FocusCandidate[],
  target: string,
  prefer?: FocusView,
): FocusResult | undefined {
  const raw = target
    .toLowerCase()
    .replace(/[.?!]+$/, "")
    .trim();
  // As said, and with the kind word ("the auth component") taken off.
  const queries = [...new Set([raw, clean(target)])]
    .filter(Boolean)
    .map((q) => ({ q, words: q.split(/\s+/).filter(Boolean) }));
  let best: { c: FocusCandidate; score: number } | undefined;
  for (const c of candidates) {
    const score = Math.max(0, ...queries.map(({ q, words }) => scoreOf(c, q, words))) + (prefer && c.view === prefer ? 0.5 : 0);
    if (score > 4 && (!best || score > best.score)) best = { c, score };
  }
  return best && { kind: best.c.kind, ref: best.c.ref, name: best.c.name, view: best.c.view };
}

/** Whether two words start the same way for at least four letters (or all of the shorter, when it is shorter). */
const alike = (x: string, y: string) => {
  const n = Math.min(4, x.length, y.length);
  return n >= 3 && x.slice(0, n) === y.slice(0, n);
};

/** Close names to suggest when nothing matched: those with a word that starts like one of the query's. */
export function closeNames(candidates: readonly FocusCandidate[], target: string, limit = 5): string[] {
  const words = clean(target)
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  const scored = candidates
    .map((c) => {
      const theirs = c.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      return { name: c.name, hits: words.filter((w) => theirs.some((t) => alike(w, t))).length };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name));
  return [...new Set(scored.map((x) => x.name))].slice(0, limit);
}
