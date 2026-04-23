export function transformSwarmUrlToRepo2Graph(
  swarmUrl: string | null | undefined,
): string {
  if (!swarmUrl) return "";

  return swarmUrl.endsWith("/api")
    ? swarmUrl.replace("/api", ":3355")
    : swarmUrl + ":3355";
}

export function getJarvisUrl(swarmName: string): string {
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
