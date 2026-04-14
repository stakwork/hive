import { retryWithExponentialBackoff } from "@/lib/utils/retry";
import { getSwarmCmdJwt, swarmCmdRequest } from "./cmd";

/**
 * Waits for jarvis/boltwall readiness via :8444/stats, then sends UpdateSecondBrainAbout
 * to set the graph title. Callers should wrap in try/catch and log only — never block on failure.
 *
 * Note: :8800 (sphinx-swarm cmd API) being up does NOT mean :8444 (jarvis/boltwall) is ready.
 */
export async function setGraphTitle(
  swarmUrl: string,
  swarmPassword: string,
  title: string,
): Promise<void> {
  const hostname = new URL(swarmUrl).hostname;
  const jarvisStatsUrl = `https://${hostname}:8444/stats`;

  // Step 1: Wait for jarvis/boltwall to be ready via :8444/stats (no auth required)
  await retryWithExponentialBackoff(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(jarvisStatsUrl, { signal: controller.signal });
        if (!res.ok) throw new Error(`Jarvis not ready: ${res.status}`);
      } finally {
        clearTimeout(timeout);
      }
    },
    { maxAttempts: 8, baseDelayMs: 2000, maxDelayMs: 30000 },
  );

  // Step 2: Jarvis is up — send UpdateSecondBrainAbout via sphinx-swarm cmd API (:8800)
  const jwt = await getSwarmCmdJwt(swarmUrl, swarmPassword);
  await swarmCmdRequest({
    swarmUrl,
    jwt,
    cmd: {
      type: "Swarm",
      data: { cmd: "UpdateSecondBrainAbout", content: { title, description: "" } },
    },
  });
}
