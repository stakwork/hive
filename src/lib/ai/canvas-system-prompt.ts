import { isDevelopmentMode } from "@/lib/runtime";
import { DEFAULT_CANVAS_SYSTEM_PROMPT } from "@/lib/constants/prompt";
import { getResolvedPrompt } from "@/services/prompts/prompt-read";

/**
 * Resolve the canvas agent's persona/reply-style preamble from Hive's DB.
 *
 * The prompt is looked up by name (`CANVAS_AGENT_SYSTEM_PROMPT`) via
 * `getResolvedPrompt`, the same path MCP tools use. On missing row, DB
 * error, or dev/mock mode the agent falls back to the in-repo
 * `DEFAULT_CANVAS_SYSTEM_PROMPT` — it never blocks on or breaks because
 * of a missing prompt row.
 *
 * ## Caching (Vercel-aware)
 *
 * Resolved prompts are cached in-memory with a TTL so we don't hit the
 * DB on every agent turn.
 *
 * On Vercel each serverless instance has its OWN memory, so this is a
 * best-effort per-instance cache (warm instances reuse it; cold starts
 * refetch) — exactly what we want for a value that changes rarely. The
 * cache is anchored on `globalThis` rather than a plain module-level
 * `let` because Next.js can re-evaluate a module (route recompiles in
 * dev, multiple bundles in prod) and reset module scope; `globalThis`
 * survives that within the same process. A single in-flight promise is
 * also memoized to dedupe concurrent turns (no thundering herd).
 */

export const CANVAS_SYSTEM_PROMPT_NAME = "CANVAS_AGENT_SYSTEM_PROMPT";
const PROMPT_NAME = CANVAS_SYSTEM_PROMPT_NAME;
// Covers the DB read + any nested prompt resolution.
const TIMEOUT_MS = 15_000;
// Cache a successful resolution for 5 min. Cache a fallback (not found /
// DB error) for only 30s so a freshly-published prompt shows up quickly.
const SUCCESS_TTL_MS = 5 * 60_000;
const FALLBACK_TTL_MS = 30_000;

/**
 * The resolved canvas system prompt plus the Hive Prompt coordinates
 * it came from. `promptId` / `promptVersionId` are null whenever the
 * value is the in-repo `DEFAULT_CANVAS_SYSTEM_PROMPT` (dev/mock mode,
 * missing DB row, or DB error) — i.e. when there is no Hive prompt to
 * attribute.
 */
export interface CanvasSystemPromptResult {
  value: string;
  name: string;
  promptId: string | null;
  promptVersionId: string | null;
}

interface CanvasPromptCacheEntry {
  result: CanvasSystemPromptResult;
  expiresAt: number;
}

interface CanvasPromptCacheStore {
  entry?: CanvasPromptCacheEntry;
  inFlight?: Promise<CanvasSystemPromptResult>;
}

// Built lazily (not a module-level const) so importing this module does
// NOT eagerly read `DEFAULT_CANVAS_SYSTEM_PROMPT` — tests that mock
// `@/lib/constants/prompt` without that export would otherwise crash at
// import time.
function defaultResult(): CanvasSystemPromptResult {
  return {
    value: DEFAULT_CANVAS_SYSTEM_PROMPT,
    name: PROMPT_NAME,
    promptId: null,
    promptVersionId: null,
  };
}

// Anchor the cache on globalThis so it survives module re-evaluation
// within a single (warm) serverless instance / dev process.
const globalForCanvasPrompt = globalThis as typeof globalThis & {
  __canvasSystemPromptCache?: CanvasPromptCacheStore;
};
const cacheStore: CanvasPromptCacheStore =
  globalForCanvasPrompt.__canvasSystemPromptCache ??
  (globalForCanvasPrompt.__canvasSystemPromptCache = {});

export async function getCanvasSystemPrompt(): Promise<CanvasSystemPromptResult> {
  // Dev/mock mode: the in-memory mock store may have no CANVAS_AGENT_SYSTEM_PROMPT
  // row. Use the in-repo copy to avoid a DB hit that returns notFound anyway.
  // (Not cached — it's a constant.)
  if (isDevelopmentMode()) {
    return defaultResult();
  }

  // Fresh cache hit.
  const cached = cacheStore.entry;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  // Dedupe concurrent refreshes: the first caller starts the fetch and
  // everyone else awaits the same promise.
  if (cacheStore.inFlight) {
    return cacheStore.inFlight;
  }

  const fetchPromise = fetchAndCache();
  cacheStore.inFlight = fetchPromise;
  try {
    return await fetchPromise;
  } finally {
    cacheStore.inFlight = undefined;
  }
}

async function fetchAndCache(): Promise<CanvasSystemPromptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const result = await resolvePublishedPrompt(controller.signal);
    cacheStore.entry = { result, expiresAt: Date.now() + SUCCESS_TTL_MS };
    return result;
  } catch (error) {
    // Timeout (AbortError), DB error, or missing prompt — all collapse to
    // the in-repo default, cached briefly to avoid hammering the DB on
    // every turn during an outage.
    console.error("getCanvasSystemPrompt: falling back to default:", error);
    cacheStore.entry = {
      result: defaultResult(),
      expiresAt: Date.now() + FALLBACK_TTL_MS,
    };
    return defaultResult();
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePublishedPrompt(
  _signal: AbortSignal,
): Promise<CanvasSystemPromptResult> {
  const result = await getResolvedPrompt(PROMPT_NAME, {});

  if ("notFound" in result || "error" in result) {
    const reason = "notFound" in result ? "not found" : result.error;
    throw new Error(`canvas prompt "${PROMPT_NAME}": ${reason}`);
  }

  return {
    value: result.resolvedText,
    name: result.name,
    promptId: result.id,
    promptVersionId: result.versionId,
  };
}
