/**
 * SSRF-guarded fetch of a report bundle from S3, at view time — the JSON lives
 * in S3 and is never copied into the database.
 *
 * `report_url` arrives on an unauthenticated webhook, so it is attacker
 * influenced: the URL is validated before the request and the URL actually
 * landed on is re-validated after redirects, so a redirect cannot escape the
 * allowlist. Body size is capped mid-stream, before any parse. Errors are
 * opaque and URL-free.
 *
 * Not built on `fetchBlobContent` — that helper is Vercel-Blob-only, does a
 * bare `fetch(url)` with no validation, and puts the URL in thrown messages.
 */

import { validateReportUrl } from "./url-guard";
import { safeUrlParts } from "./safe-url-log";
import { logger } from "@/lib/logger";

const LOG_SERVICE = "run-report/fetch";

/** Hard cap on the raw bundle body. Aborts mid-stream, before any parse. */
export const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

export type FetchFailureReason =
  | "url_rejected"
  | "redirect_escaped_allowlist"
  | "http_error"
  | "too_large"
  | "timeout"
  | "network_error";

/** Opaque, URL-free error. Never let a raw fetch error reach a caller. */
export class BundleFetchError extends Error {
  constructor(public readonly reason: FetchFailureReason) {
    super(`Run report bundle fetch failed: ${reason}`);
    this.name = "BundleFetchError";
  }
}

export interface FetchedBundle {
  /** Raw body text, under MAX_BUNDLE_BYTES. */
  text: string;
}

/**
 * Fetch the raw bundle body. Validates before the request and re-validates the
 * final URL after any redirects. Throws only `BundleFetchError`.
 */
export async function fetchReportBundle(rawUrl: string): Promise<FetchedBundle> {
  const guard = validateReportUrl(rawUrl);
  if (!guard.ok) {
    logger.error("[run-report] Fetch URL rejected by guard", LOG_SERVICE, {
      reason: guard.reason,
    });
    throw new BundleFetchError("url_rejected");
  }

  const { host, pathHash } = safeUrlParts(rawUrl);
  logger.info("[run-report] Bundle fetch start", LOG_SERVICE, { host, pathHash });

  let response: Response;
  try {
    response = await fetch(guard.url.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    logger.error("[run-report] Bundle fetch failed", LOG_SERVICE, {
      host,
      pathHash,
      reason: isTimeout ? "timeout" : "network_error",
    });
    throw new BundleFetchError(isTimeout ? "timeout" : "network_error");
  }

  // S3 issues regional-endpoint redirects, so redirects are followed rather
  // than rejected — but the URL we actually landed on must still be on the
  // allowlist, or a redirect would be an allowlist bypass.
  if (response.url && !validateReportUrl(response.url).ok) {
    logger.error("[run-report] Redirect escaped the allowlist", LOG_SERVICE, {
      host,
      pathHash,
    });
    throw new BundleFetchError("redirect_escaped_allowlist");
  }

  if (!response.ok) {
    logger.error("[run-report] Bundle fetch non-OK", LOG_SERVICE, {
      host,
      pathHash,
      status: response.status,
    });
    throw new BundleFetchError("http_error");
  }

  // Cheap pre-check; the streaming counter below is the real enforcement.
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > MAX_BUNDLE_BYTES) {
    throw new BundleFetchError("too_large");
  }

  const body = await readCapped(response);
  logger.info("[run-report] Bundle fetch ok", LOG_SERVICE, {
    host,
    pathHash,
    bytes: body.byteLength,
  });

  return { text: new TextDecoder().decode(body) };
}

/** Read with a running byte count, aborting over the cap before any parse. */
async function readCapped(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new BundleFetchError("network_error");

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BUNDLE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new BundleFetchError("too_large");
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof BundleFetchError) throw err;
    throw new BundleFetchError("network_error");
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
