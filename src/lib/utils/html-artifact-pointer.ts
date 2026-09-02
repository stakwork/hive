/**
 * Validation for `ArtifactType.HTML` artifact content.
 *
 * HTML artifacts are **pointers only**: the page body lives in S3 and
 * Postgres stores `{ s3Key, slug, ... }`. Raw markup must never reach
 * `Artifact.content` — it bloats the row and, worse, becomes untrusted
 * HTML that a future reader could inject into Hive's DOM.
 *
 * So this validator fails closed on:
 *   - a string `content` (the old backlog "HTML in content" shape)
 *   - an `html` / `body` key at any depth of the object
 *   - a missing `s3Key` or `slug`
 *
 * Unrecognized extra keys are dropped rather than rejected, so an
 * agent sending a harmless extra field doesn't 400 the whole turn.
 */
import type { HtmlContent } from "@/lib/chat";

/** Keys that would carry a raw page body. Never accepted. */
const FORBIDDEN_KEYS = new Set(["html", "body"]);

export type HtmlPointerResult =
  | { ok: true; pointer: HtmlContent }
  | { ok: false; error: string };

function hasForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 5 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((v) => hasForbiddenKey(v, depth + 1));
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) return true;
    if (hasForbiddenKey(nested, depth + 1)) return true;
  }
  return false;
}

/**
 * Validate and narrow untrusted HTML artifact content to the
 * allowlisted pointer fields. Only `s3Key`/`slug` are required.
 */
export function validateHtmlPointerContent(content: unknown): HtmlPointerResult {
  if (typeof content === "string") {
    return {
      ok: false,
      error: "HTML artifact content must be a pointer object, not a string",
    };
  }
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return { ok: false, error: "HTML artifact content must be a pointer object" };
  }
  if (hasForbiddenKey(content)) {
    return {
      ok: false,
      error: "HTML artifact content must not contain raw HTML (`html`/`body`)",
    };
  }

  const raw = content as Record<string, unknown>;
  const s3Key = raw.s3Key;
  const slug = raw.slug;
  if (typeof s3Key !== "string" || !s3Key) {
    return { ok: false, error: "HTML artifact content requires a string `s3Key`" };
  }
  if (typeof slug !== "string" || !slug) {
    return { ok: false, error: "HTML artifact content requires a string `slug`" };
  }

  // Allowlist: anything not named here is discarded.
  const pointer: HtmlContent = {
    s3Key,
    slug,
    title: typeof raw.title === "string" ? raw.title : slug,
    size: typeof raw.size === "number" && Number.isFinite(raw.size) ? raw.size : 0,
    contentType: "text/html; charset=utf-8",
    uploadedAt:
      typeof raw.uploadedAt === "string" ? raw.uploadedAt : new Date().toISOString(),
  };

  return { ok: true, pointer };
}
