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
 * There is no caching: the whole lookup is bounded by a single 10s
 * deadline and ALWAYS falls back to the in-repo
 * `DEFAULT_CANVAS_SYSTEM_PROMPT` on timeout, error, missing config, or
 * dev/mock mode. The agent therefore never blocks on — or breaks
 * because of — the Prompt Manager.
 */

const PROMPT_NAME = "CANVAS_AGENT_SYSTEM_PROMPT";
const TIMEOUT_MS = 10_000;

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

export async function getCanvasSystemPrompt(): Promise<string> {
  // Dev/mock mode: the in-memory mock store has no CANVAS_AGENT_SYSTEM_PROMPT
  // and we can't reach the real Stakwork API, so use the in-repo copy.
  if (isDevelopmentMode()) {
    return DEFAULT_CANVAS_SYSTEM_PROMPT;
  }

  if (!config.STAKWORK_API_KEY || !config.STAKWORK_BASE_URL) {
    return DEFAULT_CANVAS_SYSTEM_PROMPT;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await resolvePublishedPrompt(controller.signal);
  } catch (error) {
    // Timeout (AbortError), network failure, bad JSON, missing prompt —
    // all collapse to the in-repo default.
    console.error("getCanvasSystemPrompt: falling back to default:", error);
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
