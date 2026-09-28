/**
 * Shared fetch helper for talking to a workspace swarm's strut lab
 * (`{mcp}/lab`, see `strut-target.ts` / `strut-delegation.ts`).
 *
 * Moved out of `src/lib/ai/strutTools.ts` (where it was a private helper)
 * so the OpenHealth benchmark routes can reuse the exact same request
 * shape — the `x-api-token` swarm gate, the `x-strut-actor` header, and the
 * timeout/abort behaviour — without duplicating it.
 *
 * `strutTools.ts`'s own usages must see NO behaviour change: the default
 * method (GET with no body, POST with one) and the default timeout
 * (15s) are unchanged: only `method` and `timeoutMs` are now overridable.
 */
import { STRUT_ACTOR_HEADER } from "@/services/bifrost/strut-delegation";
import type { StrutTarget } from "@/services/strut-target";

/** Default per-request timeout, matching the prior hardcoded value in strutTools.ts. */
export const STRUT_FETCH_DEFAULT_TIMEOUT_MS = 15_000;

export interface StrutFetchInit {
  /** JSON-serialized as the request body. Presence alone used to imply POST. */
  body?: unknown;
  /** HTTP method. Defaults to POST when `body` is set, else GET — unchanged behaviour. */
  method?: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  /**
   * Per-request timeout in ms. `undefined` uses the default (15s, unchanged).
   * `null` disables the timeout entirely (no `AbortSignal.timeout`) — needed
   * by the OpenHealth run stream route, which must stay open for the whole
   * run.
   */
  timeoutMs?: number | null;
  /** The caller's own abort signal (e.g. from the inbound request), merged with the timeout signal. */
  signal?: AbortSignal;
}

/**
 * POST/GET (or any method) `{target.labBase}${path}`, authenticated with the
 * swarm API key and the caller's strut actor. Never logs the raw token or
 * the full URL with credentials.
 */
export async function strutFetch(
  target: StrutTarget,
  path: string,
  init?: StrutFetchInit,
): Promise<Response> {
  const method = init?.method ?? (init?.body !== undefined ? "POST" : "GET");
  const timeoutMs = init?.timeoutMs === undefined ? STRUT_FETCH_DEFAULT_TIMEOUT_MS : init.timeoutMs;

  const signals: AbortSignal[] = [];
  if (timeoutMs !== null) signals.push(AbortSignal.timeout(timeoutMs));
  if (init?.signal) signals.push(init.signal);

  return fetch(`${target.labBase}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-api-token": target.swarmApiKey,
      [STRUT_ACTOR_HEADER]: target.actor,
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    ...(signals.length > 0 ? { signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) } : {}),
  });
}
