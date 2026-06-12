import type { JarvisConnectionConfig } from "@/types/jarvis";
import { logger } from "@/lib/logger";

/**
 * Looks up an AgentSession node in Jarvis by log URL.
 * Returns the ref_id of the first matching session, or null if not found.
 * Never throws — all errors are swallowed so the caller can proceed regardless.
 */
export async function lookupAgentSessionByLogUrl(
  config: JarvisConnectionConfig,
  logUrl: string,
): Promise<string | null> {
  try {
    const url = `${config.jarvisUrl}/v2/nodes?type=AgentSession&log_url=${encodeURIComponent(logUrl)}`;

    const response = await fetch(url, {
      headers: {
        "x-api-token": config.apiKey,
      },
    });

    if (!response.ok) {
      logger.warn(
        "[AgentSessionLookup] Non-OK response from Jarvis",
        `status=${response.status} logUrl=${logUrl}`,
      );
      return null;
    }

    const data = await response.json();
    const nodes = data?.nodes ?? [];

    if (!Array.isArray(nodes) || nodes.length === 0) {
      return null;
    }

    return nodes[0].ref_id ?? null;
  } catch (error) {
    logger.error(
      "[AgentSessionLookup] Error looking up AgentSession by log URL",
      `logUrl=${logUrl}`,
      String(error),
    );
    return null;
  }
}
