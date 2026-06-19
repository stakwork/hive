import { config } from "@/config/env";
import { isDevelopmentMode } from "@/lib/runtime";
import { DEFAULT_CANVAS_SYSTEM_PROMPT } from "@/lib/constants/prompt";

/**
 * Resolve the canvas agent's persona/reply-style preamble from the
 * Stakwork Prompt Manager.
 *
 * The prompt is looked up by **name** (`CANVAS_AGENT_SYSTEM_PROMPT`) so
 * the same code works across environments without hardcoding an
 * environment-specific prompt id. We use the **published** version's
 * value (what an editor explicitly promoted), falling back to the
 * prompt's current `value` if nothing is published.
 *
 * The whole lookup is bounded by a single 15s deadline and ALWAYS falls
 * back to the in-repo `DEFAULT_CANVAS_SYSTEM_PROMPT` on timeout, error,
 * missing config, or dev/mock mode. The agent therefore never blocks on
 * — or breaks because of — the Prompt Manager.
 *
 * ## Caching (Vercel-aware)
 *
 * Resolved prompts are cached in-memory with a TTL so we don't make
 * 3 sequential Stakwork calls on every agent turn.
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

const PROMPT_NAME = "CANVAS_AGENT_SYSTEM_PROMPT";
// Covers all 3 sequential Stakwork calls (search → detail → version).
const TIMEOUT_MS = 15_000;
// Cache a successful resolution for 5 min. Cache a fallback (Stakwork
// down / not found) for only 30s so a freshly-published prompt — or
// recovery from an outage — shows up quickly instead of being pinned to
// the default for the full TTL.
const SUCCESS_TTL_MS = 5 * 60_000;
const FALLBACK_TTL_MS = 30_000;

interface StakworkPromptListItem {
  id: number;
  name: string;
}

interface StakworkPromptDetail {
  id: number;
  name: string;
  value: string;
  published_version_id: number | null;
}

interface StakworkPromptVersionDetail {
  value: string;
}

interface CanvasPromptCacheEntry {
  value: string;
  expiresAt: number;
}

interface CanvasPromptCacheStore {
  entry?: CanvasPromptCacheEntry;
  inFlight?: Promise<string>;
}

// Anchor the cache on globalThis so it survives module re-evaluation
// within a single (warm) serverless instance / dev process.
const globalForCanvasPrompt = globalThis as typeof globalThis & {
  __canvasSystemPromptCache?: CanvasPromptCacheStore;
};
const cacheStore: CanvasPromptCacheStore =
  globalForCanvasPrompt.__canvasSystemPromptCache ??
  (globalForCanvasPrompt.__canvasSystemPromptCache = {});

export async function getCanvasSystemPrompt(): Promise<string> {
  // Dev/mock mode: the in-memory mock store has no CANVAS_AGENT_SYSTEM_PROMPT
  // and we can't reach the real Stakwork API, so use the in-repo copy.
  // (Not cached — it's a constant.)
  if (isDevelopmentMode()) {
    return DEFAULT_CANVAS_SYSTEM_PROMPT;
  }

  if (!config.STAKWORK_API_KEY || !config.STAKWORK_BASE_URL) {
    return DEFAULT_CANVAS_SYSTEM_PROMPT;
  }

  // Fresh cache hit.
  const cached = cacheStore.entry;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
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

async function fetchAndCache(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const value = await resolvePublishedPrompt(controller.signal);
    cacheStore.entry = { value, expiresAt: Date.now() + SUCCESS_TTL_MS };
    return value;
  } catch (error) {
    // Timeout (AbortError), network failure, bad JSON, missing prompt —
    // all collapse to the in-repo default, cached briefly to avoid
    // hammering Stakwork (with 15s timeouts) on every turn during an
    // outage.
    console.error("getCanvasSystemPrompt: falling back to default:", error);
    cacheStore.entry = {
      value: DEFAULT_CANVAS_SYSTEM_PROMPT,
      expiresAt: Date.now() + FALLBACK_TTL_MS,
    };
    return DEFAULT_CANVAS_SYSTEM_PROMPT;
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePublishedPrompt(signal: AbortSignal): Promise<string> {
  const headers = {
    Authorization: `Token token=${config.STAKWORK_API_KEY}`,
    "Content-Type": "application/json",
  };

  // 1. Find the prompt id by name.
  const searchUrl = `${config.STAKWORK_BASE_URL}/prompts?search=${encodeURIComponent(PROMPT_NAME)}`;
  const searchRes = await fetch(searchUrl, { method: "GET", headers, signal });
  if (!searchRes.ok) {
    throw new Error(`prompt search failed: ${searchRes.status}`);
  }
  const searchJson = await searchRes.json();
  const prompts: StakworkPromptListItem[] = searchJson?.data?.prompts ?? [];
  const match = prompts.find((p) => p.name === PROMPT_NAME);
  if (!match) {
    throw new Error(`prompt "${PROMPT_NAME}" not found`);
  }

  // 2. Fetch the prompt detail to learn the published version id.
  const detailUrl = `${config.STAKWORK_BASE_URL}/prompts/${match.id}`;
  const detailRes = await fetch(detailUrl, { method: "GET", headers, signal });
  if (!detailRes.ok) {
    throw new Error(`prompt detail failed: ${detailRes.status}`);
  }
  const detailJson = await detailRes.json();
  const detail: StakworkPromptDetail | undefined = detailJson?.data;
  if (!detail) {
    throw new Error("prompt detail missing data");
  }

  // 3. Prefer the published version's value; fall back to the current value.
  if (detail.published_version_id != null) {
    const versionUrl = `${config.STAKWORK_BASE_URL}/prompts/${match.id}/versions/${detail.published_version_id}`;
    const versionRes = await fetch(versionUrl, { method: "GET", headers, signal });
    if (versionRes.ok) {
      const versionJson = await versionRes.json();
      const version: StakworkPromptVersionDetail | undefined = versionJson?.data;
      if (version?.value) {
        return version.value;
      }
    }
  }

  if (detail.value) {
    return detail.value;
  }

  throw new Error("prompt has no usable value");
}
