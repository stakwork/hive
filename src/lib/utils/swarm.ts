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

export function getRelayUrl(swarmName: string, swarmUrl?: string): string {
  if (swarmUrl?.includes("localhost")) return "http://localhost:3333";
  return `https://${swarmName}.sphinx.chat:3333`;
}

/**
 * Strips the leading "swarm" prefix from a swarm_id and returns the remainder.
 * e.g. "swarmPLuy9q" → "PLuy9q"
 * Returns the original string unchanged if it doesn't start with "swarm".
 */
export function extractSwarmSuffix(swarmId: string): string {
  return swarmId.startsWith("swarm") ? swarmId.slice("swarm".length) : swarmId;
}
