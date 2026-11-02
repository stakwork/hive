/**
 * Workspaces where eval-capture UI features (per-turn Flag button,
 * AgentSessionCaptureModal, etc.) are enabled.
 *
 * Keep this the single source of truth — import from here everywhere
 * instead of hardcoding slug comparisons.
 */
export const STAK_TOOLKIT_SLUGS: ReadonlyArray<string> = ["stakwork", "hive"];

/**
 * Workspaces where the Legal section (Harvey LAB benchmarks, etc.) is visible.
 */
export const LEGAL_SLUGS: ReadonlyArray<string> = ["openlaw"];

/**
 * Workspaces whose Legal Benchmarks run on the swarm's strut
 * (`harvey-lab-run`, the `harvey-lab` benchmark) instead of Stakwork: the
 * Benchmark and Runs tabs only, no recursion. Kept apart from LEGAL_SLUGS,
 * whose routes and Stakwork flow stay `openlaw`'s.
 */
export const LEGAL_STRUT_SLUGS: ReadonlyArray<string> = ["openlaw-1"];

/** Does the workspace run its Legal Benchmarks on strut? */
export function isLegalStrutWorkspace(slug: string | null | undefined): boolean {
  return !!slug && LEGAL_STRUT_SLUGS.includes(slug);
}

/** Does the workspace have the Legal Benchmarks page (either runner)? */
export function isLegalBenchmarksWorkspace(slug: string | null | undefined): boolean {
  return !!slug && (LEGAL_SLUGS.includes(slug) || LEGAL_STRUT_SLUGS.includes(slug));
}

/**
 * Workspaces with the LongMemory benchmark page (`longmemory-run` /
 * `longmemory-batch` on the swarm's strut). Kept apart from LEGAL_SLUGS.
 */
export const LONGMEMORY_SLUGS: ReadonlyArray<string> = ["openlaw-1"];

/** Does the workspace have the LongMemory benchmark page? */
export function isLongMemoryWorkspace(slug: string | null | undefined): boolean {
  return !!slug && LONGMEMORY_SLUGS.includes(slug);
}

/**
 * Workspaces where the OpenHealth Benchmarks section is visible.
 *
 * Gated to the `hive` workspace only — kept SEPARATE from LEGAL_SLUGS — do
 * not add "openhealth" there, and do not import this constant from MCP
 * tools or ask-tool callers. This file is the single source of truth for
 * the slug list; the sidebar flag it drives is NOT the page/route gate
 * (each page and API route re-checks independently).
 */
export const OPENHEALTH_SLUGS: ReadonlyArray<string> = ["hive"];

/**
 * Returns true when eval-capture features should be shown for the given
 * workspace slug.
 */
export function isEvalCaptureEnabled(slug: string): boolean {
  return STAK_TOOLKIT_SLUGS.includes(slug);
}
