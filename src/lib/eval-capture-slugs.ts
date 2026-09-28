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
