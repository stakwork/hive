import { EncryptionService } from "@/lib/encryption";
import type { EndpointNode } from "@/lib/vercel/path-matcher";

/**
 * Generate a pretty label from an API endpoint path
 *
 * Examples:
 * - /api/system/signups-enabled => System Signups Enabled
 * - /api/cron/update-bitcoin-price => Update Bitcoin Price
 * - /api/travel-times => Travel Times
 * - /api/w/[slug]/tasks => Tasks
 *
 * Rules:
 * - Remove /api prefix
 * - Skip single-letter segments and Next.js dynamic segments like [slug]
 * - If final segment has 3+ words, use only that segment
 * - Otherwise use more segments for context
 * - Capitalize each word intelligently
 */
export function formatEndpointLabel(endpoint: string): string {
  // Remove leading slash and split into segments
  const segments = endpoint.replace(/^\//, "").split("/");

  // Filter out: "api", single-letter segments, and Next.js dynamic segments like [slug]
  const filteredSegments = segments.filter(
    (s) => s.toLowerCase() !== "api" && s.length > 1 && !s.startsWith("["),
  );

  if (filteredSegments.length === 0) {
    return endpoint; // fallback to original
  }

  // Convert a segment to words (split on dashes)
  const segmentToWords = (segment: string): string[] =>
    segment
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .filter((w) => w.length > 0);

  // Get words from the final segment
  const finalSegmentWords = segmentToWords(filteredSegments[filteredSegments.length - 1]);

  // If final segment has 3+ words, use only that
  if (finalSegmentWords.length >= 3) {
    return finalSegmentWords.join(" ");
  }

  // Otherwise, use all filtered segments
  const allWords = filteredSegments.flatMap(segmentToWords);
  return allWords.join(" ");
}

/**
 * Fetch endpoint nodes from workspace swarm
 */
export async function fetchEndpointNodes(swarm: {
  swarmUrl: string | null;
  swarmApiKey: string | null;
}): Promise<EndpointNode[]> {
  if (!swarm.swarmUrl || !swarm.swarmApiKey) {
    console.warn("[fetchEndpointNodes] Missing swarm config");
    return [];
  }

  const encryptionService = EncryptionService.getInstance();

  try {
    // Extract hostname from swarm URL and construct gitree endpoint
    const swarmUrlObj = new URL(swarm.swarmUrl);
    const protocol = swarmUrlObj.hostname.includes("localhost") ? "http" : "https";

    // Allow environment overrides for development/testing
    let graphUrl = `${protocol}://${swarmUrlObj.hostname}:3355`;
    let apiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);

    if (process.env.CUSTOM_SWARM_URL) {
      graphUrl = `${process.env.CUSTOM_SWARM_URL}:3355`;
    }
    if (process.env.CUSTOM_SWARM_API_KEY) {
      apiKey = process.env.CUSTOM_SWARM_API_KEY;
    }

    // Fetch endpoint nodes from stakgraph
    const url = new URL(`${graphUrl}/nodes`);
    url.searchParams.set("node_type", "Endpoint");
    url.searchParams.set("concise", "true");
    url.searchParams.set("output", "json");

    const response = await fetch(url.toString(), {
      headers: {
        "x-api-token": apiKey,
      },
    });

    if (!response.ok) {
      console.error(`[fetchEndpointNodes] Failed to fetch endpoints: ${response.status} from ${url.toString()}`);
      return [];
    }

    const nodes: EndpointNode[] = await response.json();

    console.log(`[fetchEndpointNodes] Fetched ${nodes.length} endpoints from swarm`);

    return nodes;
  } catch (error) {
    console.error("[fetchEndpointNodes] Error fetching endpoint nodes:", error);
    return [];
  }
}
