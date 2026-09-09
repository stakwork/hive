import type { WorkspaceConfig } from "./types";

/**
 * Timeout-wrapped `fetch` for swarm (stakgraph) calls.
 *
 * Plain `fetch` has NO total-request timeout — undici only enforces a
 * ~10s *connect* timeout. A swarm that accepts the TCP connection but
 * then stalls (slow stakgraph, overloaded pod) would hang the request
 * indefinitely, blocking the whole chat turn. We bound every swarm
 * call with an `AbortSignal.timeout` (the established pattern in this
 * repo — see `src/lib/pods/utils.ts`) so a flaky swarm fails fast and
 * the caller's existing try/catch can degrade gracefully.
 *
 * Callers should still wrap this in try/catch: on timeout it throws a
 * `TimeoutError` (DOMException), and on connect failure it throws the
 * usual `TypeError: fetch failed`.
 */
export const SWARM_FETCH_TIMEOUT_MS = 15000;

export async function swarmFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = SWARM_FETCH_TIMEOUT_MS,
): Promise<Response> {
  // Compose with any caller-supplied signal so an external abort still
  // works alongside our timeout.
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  return fetch(url, { ...init, signal });
}

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

/**
 * Master switch for concept PRE-SEEDING, OFF by default. When disabled:
 *   - the up-front swarm concept fetch (`listConcepts` /
 *     `fetchConceptsForWorkspaces`) is skipped entirely,
 *   - the prompt prefix carries NO synthetic `list_concepts`
 *     tool-call/tool-result pairs,
 *   - the per-conversation concept cache is neither read nor written,
 *   - `{slug}__read_concepts_for_repo` is not registered (it serves the
 *     pre-fetched catalog, which no longer exists).
 * The live concept tools (`list_concepts` / `learn_concept`) stay
 * registered either way — the agent can still fetch concepts on demand.
 *
 * Set CANVAS_CONCEPT_SEEDING=true to restore the pre-seeding behavior.
 */
export function isConceptSeedingEnabled(): boolean {
  return process.env.CANVAS_CONCEPT_SEEDING === "true";
}

/**
 * Hard cap on how many concepts we seed into the canvas-chat context per
 * workspace. Concept catalogs can grow unbounded as repos are indexed;
 * without a ceiling a single workspace could balloon the pre-seeded
 * `list_concepts` tool-result and blow out the context budget before the
 * agent even reads the user's question. Applied at both seeding
 * chokepoints (multi-workspace fetch and single-workspace prefix) so
 * neither path can regress independently.
 */
export const MAX_SEEDED_CONCEPTS_PER_WORKSPACE = 150;
