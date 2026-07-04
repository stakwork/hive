/**
 * Workspaces where eval-capture UI features (per-turn Flag button,
 * AgentSessionCaptureModal, etc.) are enabled.
 *
 * Keep this the single source of truth — import from here everywhere
 * instead of hardcoding slug comparisons.
 */
export const STAK_TOOLKIT_SLUGS: ReadonlyArray<string> = ["stakwork", "hive"];

/**
 * Returns true when eval-capture features should be shown for the given
 * workspace slug.
 */
export function isEvalCaptureEnabled(slug: string): boolean {
  return STAK_TOOLKIT_SLUGS.includes(slug);
}
