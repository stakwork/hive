/**
 * Guarded document packing for offline export.
 *
 * For each URL in a consolidated projection's `sourceFileLinks`, this module:
 *   1. Validates the URL through the existing SSRF guard (`validateReportUrl`).
 *   2. Fetches the content anonymously (no credentials attached — ever).
 *   3. Re-validates the final URL after any redirects (same pattern as fetch-bundle.ts).
 *   4. Caps each file at MAX_BUNDLE_BYTES (25 MB) and the total at PACK_MAX_TOTAL_BYTES (50 MB).
 *   5. Limits total document count to PACK_MAX_FILES (25).
 *   6. Sanitizes entry names: strips path separators, leading dots, control chars;
 *      uniquifies collisions; reserves `index.html` and `bundle.json`.
 *
 * Returns `{ packed, skipped }`. Every fetch/validation failure degrades to a
 * skipped entry — nothing throws out of this module.
 */

import { validateReportUrl } from "@/lib/run-report/url-guard";
import { MAX_BUNDLE_BYTES } from "@/lib/run-report/fetch-bundle";
import { logger } from "@/lib/logger";
import { safeUrlParts } from "@/lib/run-report/safe-url-log";

const LOG_SERVICE = "run-report/pack-documents";

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of documents to pack into a single export. */
export const PACK_MAX_FILES = 25;

/** Maximum combined byte size across all packed documents. */
export const PACK_MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB

/** Per-file cap — mirrors MAX_BUNDLE_BYTES from fetch-bundle.ts. */
const PER_FILE_BYTE_CAP = MAX_BUNDLE_BYTES; // 25 MB

/** Per-fetch network timeout (ms). */
const FETCH_TIMEOUT_MS = 20_000;

/** Entry names that must never be used by packed documents. */
const RESERVED_ENTRY_NAMES = new Set(["index.html", "bundle.json"]);

// ── Result types ─────────────────────────────────────────────────────────────

export interface PackedDocument {
  /** Original URL the document was fetched from. */
  url: string;
  /** Safe basename used as the ZIP entry name. */
  entryName: string;
  /** Raw bytes of the document. */
  bytes: Uint8Array;
}

export interface PackDocumentsResult {
  packed: PackedDocument[];
  skipped: string[];
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Pack a list of source-file URLs into in-memory byte buffers for ZIP assembly.
 *
 * @param urls  Array of URLs from `ConsolidatedReportProjection.sourceFileLinks`.
 *              May contain duplicates — each is attempted independently.
 */
export async function packDocuments(urls: string[]): Promise<PackDocumentsResult> {
  const packed: PackedDocument[] = [];
  const skipped: string[] = [];

  // Track used entry names for collision uniquification.
  const usedNames = new Set<string>(RESERVED_ENTRY_NAMES);
  let totalBytes = 0;

  for (const url of urls) {
    // ── File count budget ──────────────────────────────────────────────────
    if (packed.length >= PACK_MAX_FILES) {
      logger.info("[pack-documents] File count budget exceeded, skipping", LOG_SERVICE, {
        url: "redacted",
      });
      skipped.push(url);
      continue;
    }

    // ── Total byte budget ──────────────────────────────────────────────────
    if (totalBytes >= PACK_MAX_TOTAL_BYTES) {
      logger.info("[pack-documents] Total byte budget exceeded, skipping", LOG_SERVICE, {
        url: "redacted",
      });
      skipped.push(url);
      continue;
    }

    // ── SSRF guard ─────────────────────────────────────────────────────────
    const guard = validateReportUrl(url);
    if (!guard.ok) {
      logger.warn("[pack-documents] URL rejected by SSRF guard", LOG_SERVICE, {
        reason: guard.reason,
      });
      skipped.push(url);
      continue;
    }

    // ── Fetch (anonymous — no credentials ever attached) ───────────────────
    const { host, pathHash } = safeUrlParts(url);
    let bytes: Uint8Array;
    try {
      bytes = await fetchDocumentBytes(url, host, pathHash);
    } catch {
      // fetchDocumentBytes already logged; failure → skip
      skipped.push(url);
      continue;
    }

    // ── Per-file cap ───────────────────────────────────────────────────────
    if (bytes.byteLength > PER_FILE_BYTE_CAP) {
      logger.warn("[pack-documents] File exceeds per-file byte cap, skipping", LOG_SERVICE, {
        host,
        pathHash,
        bytes: bytes.byteLength,
        cap: PER_FILE_BYTE_CAP,
      });
      skipped.push(url);
      continue;
    }

    // ── Total byte budget check (post-fetch) ───────────────────────────────
    if (totalBytes + bytes.byteLength > PACK_MAX_TOTAL_BYTES) {
      logger.info("[pack-documents] Adding file would exceed total byte budget, skipping", LOG_SERVICE, {
        host,
        pathHash,
      });
      skipped.push(url);
      continue;
    }

    // ── Entry name ─────────────────────────────────────────────────────────
    const entryName = resolveEntryName(url, usedNames);
    usedNames.add(entryName);
    totalBytes += bytes.byteLength;

    packed.push({ url, entryName, bytes });

    logger.info("[pack-documents] Packed document", LOG_SERVICE, {
      host,
      pathHash,
      entryName,
      bytes: bytes.byteLength,
    });
  }

  return { packed, skipped };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Fetch document bytes with redirect re-validation and mid-stream byte cap.
 * Anonymous: no Authorization or credential headers are ever attached.
 *
 * Throws on any failure (caller skips the URL).
 */
async function fetchDocumentBytes(
  url: string,
  host: string,
  pathHash: string,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // Strictly anonymous: no Authorization, no GITHUB_TOKEN, no cookies.
      // The `credentials` option is only for browser fetch — in Node.js the
      // fetch implementation does not send cookies by default, but we
      // explicitly omit any credential header to make the intent clear.
      headers: {
        accept: "*/*",
      },
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    logger.warn("[pack-documents] Fetch failed", LOG_SERVICE, {
      host,
      pathHash,
      reason: isTimeout ? "timeout" : "network_error",
    });
    throw new Error("fetch_failed");
  }

  // Re-validate the final URL after any redirects (prevents redirect bypass).
  if (response.url && !validateReportUrl(response.url).ok) {
    logger.warn("[pack-documents] Redirect escaped the allowlist", LOG_SERVICE, {
      host,
      pathHash,
    });
    throw new Error("redirect_escaped_allowlist");
  }

  if (!response.ok) {
    logger.warn("[pack-documents] Non-OK response", LOG_SERVICE, {
      host,
      pathHash,
      status: response.status,
    });
    throw new Error(`http_error_${response.status}`);
  }

  // Pre-check declared content-length before reading.
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > PER_FILE_BYTE_CAP) {
    logger.warn("[pack-documents] Content-Length exceeds per-file cap", LOG_SERVICE, {
      host,
      pathHash,
      declared,
      cap: PER_FILE_BYTE_CAP,
    });
    throw new Error("too_large");
  }

  // Mid-stream byte cap (real enforcement).
  return readCapped(response, host, pathHash);
}

/**
 * Read a response body with a running byte counter.
 * Aborts and throws if the per-file cap is exceeded mid-stream.
 */
async function readCapped(
  response: Response,
  host: string,
  pathHash: string,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    logger.warn("[pack-documents] Response has no body", LOG_SERVICE, { host, pathHash });
    throw new Error("no_body");
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > PER_FILE_BYTE_CAP) {
        await reader.cancel().catch(() => {});
        logger.warn("[pack-documents] File exceeded per-file cap mid-stream", LOG_SERVICE, {
          host,
          pathHash,
          total,
          cap: PER_FILE_BYTE_CAP,
        });
        throw new Error("too_large");
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof Error && err.message === "too_large") throw err;
    logger.warn("[pack-documents] Stream read error", LOG_SERVICE, {
      host,
      pathHash,
      reason: err instanceof Error ? err.message : "unknown",
    });
    throw new Error("stream_error");
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Derive a safe ZIP entry name from a URL.
 *
 * Rules:
 *   - Use only the URL's basename (last path segment, query/hash dropped).
 *   - Strip path separators (/ and \), leading dots, and control chars.
 *   - Fall back to "document" when nothing usable remains.
 *   - Uniquify collisions with -2, -3, … suffixes.
 *   - Never collide with reserved names (index.html, bundle.json).
 */
export function resolveEntryName(url: string, usedNames: Set<string>): string {
  // Extract basename from the URL path (ignore query string and fragment).
  let raw = "";
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/");
    raw = segments[segments.length - 1] ?? "";
  } catch {
    raw = "";
  }

  // Strip path separators (both forward and back), leading dots, and control
  // characters (C0 + DEL + C1). This prevents ZIP traversal attacks.
  let name = raw
    .replace(/[/\\]/g, "")                // remove path separators
    .replace(/^\.+/, "")                  // strip leading dots
    .replace(/[\x00-\x1F\x7F\x80-\x9F]/g, ""); // strip control chars

  // Percent-decode for display purposes — but only after stripping traversal chars.
  try {
    name = decodeURIComponent(name);
    // Re-sanitize after decode in case decoding introduced dangerous chars.
    name = name
      .replace(/[/\\]/g, "")
      .replace(/^\.+/, "")
      .replace(/[\x00-\x1F\x7F\x80-\x9F]/g, "");
  } catch {
    // decodeURIComponent failure — keep the encoded name as-is
  }

  if (!name) name = "document";

  // Uniquify collisions (including reserved names).
  if (!usedNames.has(name)) return name;

  // Split on extension for nicer suffixing (e.g. foo-2.pdf not foo.pdf-2).
  const dotIdx = name.lastIndexOf(".");
  const base = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const ext = dotIdx > 0 ? name.slice(dotIdx) : "";

  let counter = 2;
  let candidate = `${base}-${counter}${ext}`;
  while (usedNames.has(candidate)) {
    counter++;
    candidate = `${base}-${counter}${ext}`;
  }
  return candidate;
}
