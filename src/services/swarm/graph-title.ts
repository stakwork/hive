import { retryWithExponentialBackoff } from "@/lib/utils/retry";
import { getSwarmCmdJwt, swarmCmdRequest } from "./cmd";

/**
 * Sets the graph title on a GraphMindset sphinx-swarm instance.
 *
 * Step 1: Wait for jarvis/boltwall (:8444) to be ready via GET :8444/stats (no auth required).
 *         Note: :8800 (sphinx-swarm cmd API) being up does NOT mean :8444 (jarvis) is ready.
 * Step 2: Send UpdateSecondBrainAbout via the sphinx-swarm cmd API (:8800).
 *
 * This is fire-and-forget safe — retries are handled internally via retryWithExponentialBackoff.
 */
export async function setGraphTitle(
  swarmUrl: string,
  swarmPassword: string,
  title: string,
): Promise<void> {
  const hostname = new URL(swarmUrl).hostname;

  // Step 1: Wait for jarvis/boltwall to be ready via :8444/stats
  await retryWithExponentialBackoff(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(`https://${hostname}:8444/stats`, { signal: controller.signal });
        if (!res.ok) throw new Error(`Jarvis not ready: ${res.status}`);
      } finally {
        clearTimeout(timeout);
      }
    },
    { maxAttempts: 8, baseDelayMs: 2000, maxDelayMs: 30000 },
  );

  // Step 2: Send UpdateSecondBrainAbout via sphinx-swarm cmd API (:8800)
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
