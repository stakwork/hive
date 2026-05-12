import type { WorkspaceConfig } from "./types";

/**
 * Concept-list trimming threshold for multi-workspace chats.
 *
 * With 3+ workspaces the pre-seeded `{slug}__list_concepts` tool-results
 * would balloon the context — every workspace contributes its full
 * concept catalog before the agent has even read the user's question.
 * Above the threshold we collapse each concept to just its `id` (which
 * is repo-prefixed, e.g. `"owner/repo/slug"`) and rely on
 * `{slug}__read_concepts_for_repo` to fetch `{id,name,description}`
 * on demand for whichever repo the agent decides is relevant.
 *
 * Single source of truth so the prompt seeder and the tool registrar
 * can never disagree about which mode they're in.
 */
export function shouldTrimConceptsToIds(workspaces: WorkspaceConfig[]): boolean {
  return workspaces.length > 2;
}
