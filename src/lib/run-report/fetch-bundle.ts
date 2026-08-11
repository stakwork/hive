/**
 * SSRF-hardened fetch of a run report bundle.
 *
 * Deliberately NOT built on `fetchBlobContent` (src/lib/utils/blob-fetch.ts):
 * that helper is Vercel-Blob-only, does a bare `fetch(url)` with no validation,
 * and embeds the target URL in the messages it throws.
 *
 * Controls, in order:
 *   1. Full URL validation through the shared guard (protocol, userinfo, port,
 *      host allowlist).
 *   2. DNS resolution + private-range rejection, then connection PINNED to the
 *      resolved address via an undici Agent with a custom `connect.lookup`.
 *      Resolve-then-`fetch` re-resolves independently, which is a DNS-rebinding
 *      TOCTOU hole — the pin is not optional.
 *   3. `redirect: "manual"` with a bounded hop count, re-running the full
 *      validator (and the DNS pin) on every hop. NOT `redirect: "error"`: S3
 *      legitimately issues regional-endpoint redirects, and hard-failing those
 *      turns a valid report into a permanent failure.
 *   4. Timeout, Content-Length cap, and a streaming byte-count abort that fires
 *      BEFORE parsing.
 *
 * Every error thrown here is opaque and URL-free.
 */

import { Agent } from "undici";
import { lookup as dnsLookup } from "dns";
import { isIP } from "net";
import { createHash } from "crypto";
import { validateReportUrl } from "./url-guard";
import { safeUrlParts } from "./safe-url-log";
import { logger } from "@/lib/logger";

const LOG_SERVICE = "run-report/fetch";

/** Hard cap on the raw bundle body. Aborts mid-stream, before any parse. */
export const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 2;

export type FetchFailureReason =
  | "url_rejected"
  | "dns_private_address"
  | "dns_unresolvable"
  | "too_many_redirects"
  | "redirect_missing_location"
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
  /** SHA-256 of the raw bytes — integrity anchor for a future re-sanitize. */
  hash: string;
}

/**
 * Reject addresses that must never be reachable from a webhook-supplied URL:
 * loopback, RFC1918, link-local, CGNAT, unique-local v6, and unspecified.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    const parts = address.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
    const [a, b] = parts;
    if (a === 0) return true;                      // 0.0.0.0/8
    if (a === 10) return true;                     // RFC1918
    if (a === 127) return true;                    // loopback
    if (a === 169 && b === 254) return true;       // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true;       // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true;                     // multicast + reserved
    return false;
  }

  if (version === 6) {
    const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fe80")) return true; // link-local
    if (/^f[cd]/.test(normalized)) return true;     // unique-local
    // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded v4 address.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  // Not an IP literal at all — refuse rather than guess.
  return true;
}

/** Resolve a hostname to a single address, rejecting private ranges. */
async function resolvePublicAddress(
  hostname: string,
): Promise<{ address: string; family: number }> {
  // An IP literal needs no resolution, but still needs the range check.
  const literal = isIP(hostname);
  if (literal) {
    if (isPrivateAddress(hostname)) throw new BundleFetchError("dns_private_address");
    return { address: hostname, family: literal };
  }

  const resolved = await new Promise<{ address: string; family: number }>(
    (resolve, reject) => {
      dnsLookup(hostname, { verbatim: true }, (err, address, family) => {
        if (err || !address) reject(new BundleFetchError("dns_unresolvable"));
        else resolve({ address, family });
      });
    },
  );

  if (isPrivateAddress(resolved.address)) {
    throw new BundleFetchError("dns_private_address");
  }
  return resolved;
}

/**
 * Build an undici Agent whose connections are pinned to `address`, while the
 * original hostname is preserved for TLS/SNI and certificate validation.
 */
function pinnedAgent(address: string, family: number): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, address, family);
      },
    },
  });
}

/**
 * Fetch and return the raw bundle body. Validates, pins DNS and re-validates on
 * every redirect hop. Throws only `BundleFetchError`.
 */
export async function fetchReportBundle(rawUrl: string): Promise<FetchedBundle> {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Re-validate at fetch time and on EVERY hop — a Location header is
    // attacker-influenced input exactly like the original URL.
    const guard = validateReportUrl(currentUrl);
    if (!guard.ok) {
      logger.error("[run-report] Fetch URL rejected by guard", LOG_SERVICE, {
        reason: guard.reason,
        hop,
      });
      throw new BundleFetchError("url_rejected");
    }

    const parsed = guard.url;
    const { host, pathHash } = safeUrlParts(currentUrl);
    const { address, family } = await resolvePublicAddress(parsed.hostname);
    const dispatcher = pinnedAgent(address, family);

    logger.info("[run-report] Bundle fetch start", LOG_SERVICE, { host, pathHash, hop });

    let response: Response;
    try {
      response = await fetch(parsed.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: "application/json" },
        // @ts-expect-error — `dispatcher` is an undici extension to RequestInit
        // that Node's fetch honours but the DOM lib's types do not declare.
        dispatcher,
      });
    } catch (err) {
      await dispatcher.close().catch(() => {});
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      logger.error("[run-report] Bundle fetch failed", LOG_SERVICE, {
        host,
        pathHash,
        reason: isTimeout ? "timeout" : "network_error",
      });
      throw new BundleFetchError(isTimeout ? "timeout" : "network_error");
    }

    // Follow a bounded number of redirects, re-validating each Location.
    if (response.status >= 300 && response.status < 400) {
      await dispatcher.close().catch(() => {});
      const location = response.headers.get("location");
      if (!location) throw new BundleFetchError("redirect_missing_location");
      if (hop === MAX_REDIRECTS) throw new BundleFetchError("too_many_redirects");
      // Resolve relative Locations against the current URL before re-checking.
      currentUrl = new URL(location, parsed).toString();
      continue;
    }

    try {
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

      return {
        text: new TextDecoder().decode(body),
        hash: createHash("sha256").update(body).digest("hex"),
      };
    } finally {
      await dispatcher.close().catch(() => {});
    }
  }

  throw new BundleFetchError("too_many_redirects");
}

/**
 * Read the body with a running byte counter, aborting as soon as the cap is
 * exceeded — before any JSON parsing, so an oversized body is never buffered
 * whole and never reaches the parser.
 */
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
