/**
 * Shared SSRF guard for S3 URLs arriving on unauthenticated webhook bodies.
 *
 * This is the promoted form of the `ALLOWED_S3_HOST_PATTERN` / `isAllowedS3Url`
 * pair that previously lived privately in `src/services/stakwork-run.ts` and
 * guarded only `output_s3_url`. It is now the single validator for both that
 * field and the run report bundle's `report_url`, so the two cannot drift.
 *
 * Layered on top of the original host regex:
 *   - explicit `https:` protocol check
 *   - empty username/password — `https://user:pass@bucket.s3.us-east-1.amazonaws.com/x`
 *     passes both `z.url()` and a naive host regex, and would otherwise leak
 *     credentials into the outbound request and into any log of the URL
 *   - empty or explicitly-allowed port
 *
 * `RUN_REPORT_ALLOWED_HOSTS` narrows/extends this by exact hostname. It does
 * NOT fail closed when unset: a new env var that must be populated in every
 * environment before anything renders would ship the feature dark and present
 * as a rendering bug rather than a config gap.
 */

import { config } from "@/config/env";

/**
 * Allowlisted S3 host pattern for Harvey LAB output URLs.
 * Must be https:// and must match the Stakwork uploads bucket domain.
 */
const ALLOWED_S3_HOST_PATTERN =
  /^[a-zA-Z0-9-]+\.s3\.[a-z0-9-]+\.amazonaws\.com$/;

/** Ports we will connect to. Empty (default 443) is the normal case. */
const ALLOWED_PORTS = new Set(["", "443"]);

export type UrlRejectionReason =
  | "unparseable"
  | "not_https"
  | "userinfo_present"
  | "port_not_allowed"
  | "host_not_allowed";

export type UrlGuardResult =
  | { ok: true; url: URL }
  | { ok: false; reason: UrlRejectionReason };

/**
 * Hostnames from `RUN_REPORT_ALLOWED_HOSTS`, blank entries filtered.
 * Read lazily so tests can mutate the env between cases.
 */
function extraAllowedHosts(): string[] {
  const raw = config.RUN_REPORT_ALLOWED_HOSTS ?? "";
  return raw
    .split(",")
    .map((h: string) => h.trim().toLowerCase())
    .filter((h: string) => h.length > 0);
}

/**
 * Loopback exemption for local mock fixtures. Deliberately narrow: it requires
 * mocks to be on, a non-production build, a loopback host, AND a path under the
 * mock report route. Never allowlist the whole self-origin.
 */
function isAllowedMockUrl(parsed: URL): boolean {
  if (!config.USE_MOCKS) return false;
  if (process.env.NODE_ENV === "production") return false;
  const host = parsed.hostname.toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (!isLoopback) return false;
  return parsed.pathname.startsWith("/api/mock/run-report/");
}

/**
 * Validate a URL for outbound fetch. Returns a reason code on rejection so
 * callers can log WHY without ever logging the URL itself.
 */
export function validateReportUrl(raw: string): UrlGuardResult {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "unparseable" };
  }

  // The mock exemption still requires http(s) and no userinfo, but skips the
  // S3 host check — it is checked before the protocol gate only so that a
  // plain-http loopback fixture URL can be served in dev.
  if (isAllowedMockUrl(parsed)) {
    if (parsed.username !== "" || parsed.password !== "") {
      return { ok: false, reason: "userinfo_present" };
    }
    return { ok: true, url: parsed };
  }

  if (parsed.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reason: "userinfo_present" };
  }
  if (!ALLOWED_PORTS.has(parsed.port)) {
    return { ok: false, reason: "port_not_allowed" };
  }

  const host = parsed.hostname.toLowerCase();
  const extras = extraAllowedHosts();

  // When the env var is set it NARROWS: the host must match it exactly.
  // When unset, the regex default alone governs (per-bucket/per-region hosts).
  const allowed = extras.length > 0
    ? extras.includes(host) || ALLOWED_S3_HOST_PATTERN.test(host)
    : ALLOWED_S3_HOST_PATTERN.test(host);

  if (!allowed) return { ok: false, reason: "host_not_allowed" };

  return { ok: true, url: parsed };
}

/** Boolean convenience wrapper — the shape the old `isAllowedS3Url` had. */
export function isAllowedS3Url(raw: string): boolean {
  return validateReportUrl(raw).ok;
}
