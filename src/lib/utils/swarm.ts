/**
 * Strips trailing "/api" from stored swarmUrl.
 * e.g. "https://ai.sphinx.chat/api" → "https://ai.sphinx.chat"
 * Returns "" for nullish or empty input.
 */
export function getSwarmBaseUrl(swarmUrl: string | null | undefined): string {
  if (!swarmUrl) return "";
  return swarmUrl.endsWith("/api") ? swarmUrl.slice(0, -4) : swarmUrl;
}

/**
 * Strips "/api" and appends ":8444" to the stored swarmUrl.
 * e.g. "https://ai.sphinx.chat/api" → "https://ai.sphinx.chat:8444"
 * Returns "" for nullish or empty input.
 */
export function getSecondBrainBaseUrl(swarmUrl: string | null | undefined): string {
  if (!swarmUrl) return "";
  const base = swarmUrl.endsWith("/api") ? swarmUrl.slice(0, -4) : swarmUrl;
  return `${base}:8444`;
}

export function transformSwarmUrlToRepo2Graph(
  swarmUrl: string | null | undefined,
): string {
  if (!swarmUrl) return "";

  return swarmUrl.endsWith("/api")
    ? swarmUrl.replace("/api", ":3355")
    : swarmUrl + ":3355";
}

/** Wildcard cert only covers `advisor-<label>.sphinx.chat` — one label deep. */
export const ADVISOR_SWARM_DOMAIN = "sphinx.chat";

/**
 * Derives the AWS Advisor origin for a swarm, e.g.
 * `https://swarm38.sphinx.chat/api` -> `https://advisor-swarm38.sphinx.chat`.
 *
 * Parses with `new URL()` and keeps only the hostname (mirrors
 * `deriveBifrostBaseUrl` in `src/services/bifrost/resolve.ts`) — port, path
 * (including `/api`), query and hash are all dropped.
 *
 * Returns `""` for empty/unparseable input, non-`https` URLs, `localhost`/IP
 * hosts, and any host that isn't exactly one label under `sphinx.chat` (the
 * wildcard certificate only covers a single level).
 */
export function transformSwarmUrlToAdvisor(
  swarmUrl: string | null | undefined,
): string {
  if (!swarmUrl) return "";

  let parsed: URL;
  try {
    parsed = new URL(swarmUrl);
  } catch {
    return "";
  }

  if (parsed.protocol !== "https:") return "";

  const hostname = parsed.hostname;
  if (!hostname || hostname === "localhost") return "";
  // Reject bare IPv4/IPv6 hosts.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) return "";

  const suffix = `.${ADVISOR_SWARM_DOMAIN}`;
  if (!hostname.endsWith(suffix)) return "";
  const label = hostname.slice(0, -suffix.length);
  // Must be exactly one label under sphinx.chat (no dots left in the label).
  if (!label || label.includes(".")) return "";

  return `https://advisor-${label}.${ADVISOR_SWARM_DOMAIN}`;
}

// Mock mode — resolved at module load, mirroring src/config/env.ts. In local
// dev with USE_MOCKS=true every Jarvis call would otherwise dead-end against
// a nonexistent `<swarm>.sphinx.chat` host; routing to the local mock Jarvis
// endpoints instead makes the graph-backed surfaces (legal benchmarks, node
// peeks) exercisable without a live swarm. Never active in production.
const USE_MOCK_JARVIS =
  process.env.USE_MOCKS === "true" && process.env.NODE_ENV !== "production";
const MOCK_JARVIS_BASE = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/mock/jarvis`;

export function getJarvisUrl(swarmName: string): string {
  if (USE_MOCK_JARVIS) return MOCK_JARVIS_BASE;
  return `https://${swarmName}.sphinx.chat:8444`;
}

/**
 * Strips the leading "swarm" prefix from a swarm_id and returns the remainder.
 * e.g. "swarmPLuy9q" → "PLuy9q"
 * Returns the original string unchanged if it doesn't start with "swarm".
 */
export function extractSwarmSuffix(swarmId: string): string {
  return swarmId.startsWith("swarm") ? swarmId.slice("swarm".length) : swarmId;
}
