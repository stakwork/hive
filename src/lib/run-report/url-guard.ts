/**
 * Shared SSRF guard for S3 URLs arriving on unauthenticated webhook bodies.
 * Validates both `report_url` and the sibling `output_s3_url` so the two
 * controls cannot drift.
 *
 * Beyond the host allowlist: userinfo is rejected, because
 * `https://user:pass@bucket.s3.us-east-1.amazonaws.com/x` passes both `z.url()`
 * and a naive host regex while leaking credentials into the request and logs.
 *
 * `RUN_REPORT_ALLOWED_HOSTS` extends by exact hostname. It does NOT fail
 * closed when unset — an env var that must be set everywhere before anything
 * renders would ship the feature dark and look like a rendering bug.
 */

import { config } from "@/config/env";
import { logger } from "@/lib/logger";

// ── Known upload bucket ────────────────────────────────────────────────────

/**
 * The Stakwork uploads bucket name. Pinned so admitting extra host FORMS is a
 * net-tighter change, not a broadening: we still only fetch from one bucket.
 */
const KNOWN_BUCKETS = ["stakwork-uploads"];

/**
 * Known AWS regions that the runner may deliver reports from.
 * Conservative list — extend here when a new region is added, not by loosening
 * the pattern to accept arbitrary labels.
 */
const KNOWN_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-central-1",
  "eu-north-1",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-south-1",
  "ca-central-1",
  "sa-east-1",
  "me-south-1",
  "af-south-1",
];

const BUCKET_PATTERN = KNOWN_BUCKETS.map((b) => b.replace(/[-]/g, "\\-")).join("|");
const REGION_PATTERN = KNOWN_REGIONS.join("|");

/**
 * Allowlisted S3 host patterns for Harvey LAB output URLs.
 *
 * Covers three host forms the runner may emit, all pinned to the known bucket
 * and known regions:
 *   1. Legacy-global:      stakwork-uploads.s3.amazonaws.com
 *   2. Dot-regional:       stakwork-uploads.s3.us-east-1.amazonaws.com
 *   3. Dash-regional:      stakwork-uploads.s3-us-east-1.amazonaws.com
 *
 * Path-style, dualstack, and accelerate are deliberately not covered.
 * Must be https:// and port 443 (checked separately, before this).
 */
const ALLOWED_S3_HOST_PATTERNS: RegExp[] = [
  // legacy-global: <bucket>.s3.amazonaws.com
  new RegExp(`^(?:${BUCKET_PATTERN})\\.s3\\.amazonaws\\.com$`),
  // dot-regional: <bucket>.s3.<region>.amazonaws.com
  new RegExp(`^(?:${BUCKET_PATTERN})\\.s3\\.(?:${REGION_PATTERN})\\.amazonaws\\.com$`),
  // dash-regional: <bucket>.s3-<region>.amazonaws.com
  new RegExp(`^(?:${BUCKET_PATTERN})\\.s3-(?:${REGION_PATTERN})\\.amazonaws\\.com$`),
];

function isAllowedS3Host(host: string): boolean {
  return ALLOWED_S3_HOST_PATTERNS.some((p) => p.test(host));
}

// ── Host-form classifier ────────────────────────────────────────────────────

/**
 * Fixed enum of S3 URL host forms.
 *
 * Used at ingest-rejection logging so operators can see which form the runner
 * emitted without ever logging the raw hostname (which arrives on an
 * unauthenticated webhook body and is attacker-controlled).
 */
export type S3HostForm =
  | "legacy_global"   // <bucket>.s3.amazonaws.com
  | "dash_regional"   // <bucket>.s3-<region>.amazonaws.com
  | "path_style"      // s3.amazonaws.com/<bucket> or s3.<region>.amazonaws.com/<bucket>
  | "dualstack"       // <bucket>.s3.dualstack.<region>.amazonaws.com
  | "accelerate"      // <bucket>.s3-accelerate.amazonaws.com
  | "non_s3"          // amazonaws.com domain but none of the above shapes
  | "unparseable";    // not a URL at all, or no amazonaws.com

/**
 * Classify the host portion of a URL string into a known S3 form.
 *
 * Pure: no I/O, no logging. Never returns the raw hostname.
 */
export function classifyS3HostForm(raw: string): S3HostForm {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "unparseable";
  }

  const host = parsed.hostname.toLowerCase();

  if (!host.endsWith(".amazonaws.com") && host !== "amazonaws.com") {
    return "unparseable";
  }

  // Path-style: s3.amazonaws.com/<bucket>  or  s3.<region>.amazonaws.com/<bucket>
  if (/^s3(\.[a-z0-9-]+)?\.amazonaws\.com$/.test(host)) {
    return "path_style";
  }

  // Dualstack: <bucket>.s3.dualstack.<region>.amazonaws.com
  if (/\.s3\.dualstack\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) {
    return "dualstack";
  }

  // Accelerate: <bucket>.s3-accelerate.amazonaws.com
  if (/\.s3-accelerate\.amazonaws\.com$/.test(host)) {
    return "accelerate";
  }

  // Dash-regional: <bucket>.s3-<region>.amazonaws.com
  if (/\.[a-zA-Z0-9-]+\.s3-[a-z0-9-]+\.amazonaws\.com$/.test(host) ||
      /^[a-zA-Z0-9-]+\.s3-[a-z0-9-]+\.amazonaws\.com$/.test(host)) {
    return "dash_regional";
  }

  // Legacy-global: <bucket>.s3.amazonaws.com
  if (/^[a-zA-Z0-9-]+\.s3\.amazonaws\.com$/.test(host)) {
    return "legacy_global";
  }

  // Dot-regional: <bucket>.s3.<region>.amazonaws.com  (also matches our allowed pattern)
  // This is the "standard regional" form already accepted before this change.
  // Falls through to non_s3 for anything else.

  return "non_s3";
}

// ── Ports ──────────────────────────────────────────────────────────────────

/** Ports we will connect to. Empty string means default (443 for https). */
const ALLOWED_PORTS = new Set(["", "443"]);

// ── Types ──────────────────────────────────────────────────────────────────

export type UrlRejectionReason =
  | "unparseable"
  | "not_https"
  | "userinfo_present"
  | "port_not_allowed"
  | "host_not_allowed";

export type UrlGuardResult =
  | { ok: true; url: URL }
  | { ok: false; reason: UrlRejectionReason };

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Hostnames from `RUN_REPORT_ALLOWED_HOSTS` that extend the S3 allowlist.
 *
 * Invalid entries (IP literals, loopback/link-local names, non-public shapes)
 * are discarded with a log rather than failing closed — a misconfigured deploy
 * should not make every report unreachable.
 *
 * Read lazily so tests can mutate the env between cases.
 */
function extraAllowedHosts(): string[] {
  const raw = config.RUN_REPORT_ALLOWED_HOSTS ?? "";
  const candidates = raw
    .split(",")
    .map((h: string) => h.trim().toLowerCase())
    .filter((h: string) => h.length > 0);

  const valid: string[] = [];
  for (const h of candidates) {
    if (isInvalidHostEntry(h)) {
      logger.warn("[run-report] RUN_REPORT_ALLOWED_HOSTS entry discarded", "url-guard", {
        reason: "invalid_host_entry",
      });
      continue;
    }
    valid.push(h);
  }
  return valid;
}

/**
 * Returns true for entries that must not be allowlisted:
 * - bare IP literals (v4 or v6)
 * - loopback names (localhost, 127.*, ::1)
 * - link-local addresses (169.254.*)
 * - anything that doesn't look like a public hostname (must contain a dot,
 *   must consist only of hostname-safe chars)
 */
function isInvalidHostEntry(h: string): boolean {
  // IPv4 literal: four dot-separated decimal groups
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  // IPv6 literal (bracketed or bare)
  if (/^\[?[0-9a-f:]+\]?$/.test(h)) return true;
  // Loopback
  if (h === "localhost" || h.startsWith("127.") || h === "::1") return true;
  // Link-local
  if (h.startsWith("169.254.")) return true;
  // Must contain at least one dot (e.g. "example.com") and only valid chars
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h)) return true;
  if (!h.includes(".")) return true;
  return false;
}

/**
 * Loopback exemption for local mock fixtures.
 *
 * Deliberately narrow: requires mocks to be on, a non-production build, a
 * loopback host, AND a path under the mock report route. The port gate runs
 * INSIDE this function (not skipped) — only dev ports ("" and "3000") are
 * admitted, so an arbitrary port cannot be reached via this branch on staging
 * or preview builds.
 */
function isAllowedMockUrl(parsed: URL): { ok: boolean } {
  if (!config.USE_MOCKS) return { ok: false };
  if (process.env.NODE_ENV === "production") return { ok: false };

  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1";
  if (!isLoopback) return { ok: false };

  // Only allow dev-standard ports inside the mock branch.
  const DEV_PORTS = new Set(["", "3000"]);
  if (!DEV_PORTS.has(parsed.port)) return { ok: false };

  if (!parsed.pathname.startsWith("/api/mock/run-report/")) return { ok: false };

  return { ok: true };
}

// ── Main guard ─────────────────────────────────────────────────────────────

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

  // Userinfo check runs unconditionally — before the mock branch — because
  // credentials must never be forwarded, even to the mock server.
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reason: "userinfo_present" };
  }

  // Port check runs before the mock branch too: the mock branch applies its
  // own (narrower) dev-port allowlist internally, so if a non-dev port slips
  // through, the check below would reject it anyway — but being explicit
  // prevents the mock branch from being used as a loopback port scanner on
  // non-production builds.
  //
  // Exception: the mock branch allows plain-http loopback, so we skip the
  // https check here and let the mock checker decide.
  const mockResult = isAllowedMockUrl(parsed);
  if (mockResult.ok) {
    // Port already validated inside isAllowedMockUrl; userinfo already checked.
    return { ok: true, url: parsed };
  }

  if (parsed.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (!ALLOWED_PORTS.has(parsed.port)) {
    return { ok: false, reason: "port_not_allowed" };
  }

  const host = parsed.hostname.toLowerCase();
  const extras = extraAllowedHosts();

  // `RUN_REPORT_ALLOWED_HOSTS` extends the S3 allowlist: the host may satisfy
  // EITHER the bucket-pinned S3 patterns OR an exact entry from the env var.
  const allowed = isAllowedS3Host(host) || extras.includes(host);

  if (!allowed) return { ok: false, reason: "host_not_allowed" };

  return { ok: true, url: parsed };
}

/** Boolean convenience wrapper — the shape the old `isAllowedS3Url` had. */
export function isAllowedS3Url(raw: string): boolean {
  return validateReportUrl(raw).ok;
}
