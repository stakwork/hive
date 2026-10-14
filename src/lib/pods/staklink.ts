import { buildPodUrl } from "@/lib/pods/queries";
import { POD_PORTS } from "@/lib/pods/constants";
import { JlistResponseSchema, type JlistProcess } from "@/types/pod-repair";

export interface StaklinkPod {
  podId: string;
  password: string | null;
}

/**
 * Call staklink (the pod control server) on a pod.
 * `path` may include a query string (e.g. `/logs?lines=200`).
 * Adds `Authorization: Bearer <password>` only when the pod has a password.
 * Never logs the password.
 */
export async function staklinkFetch(
  pod: StaklinkPod,
  path: string,
  { timeoutMs = 5000 }: { timeoutMs?: number } = {},
): Promise<Response> {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return fetch(`${buildPodUrl(pod.podId, POD_PORTS.CONTROL)}${suffix}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(pod.password ? { Authorization: `Bearer ${pod.password}` } : {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Fetch + validate the pod's `/jlist`. Returns null on any failure. */
export async function fetchJlist(
  podId: string,
  password: string | null,
  timeoutMs = 5000,
): Promise<JlistProcess[] | null> {
  try {
    const response = await staklinkFetch({ podId, password }, "/jlist", { timeoutMs });

    if (!response.ok) {
      console.warn(`[staklink] jlist ${response.status} for ${podId}`);
      return null;
    }

    const data = await response.json();
    const parsed = JlistResponseSchema.safeParse(data);
    if (!parsed.success) {
      console.warn(`[staklink] invalid jlist payload for ${podId}: ${parsed.error.message}`);
      return null;
    }
    return parsed.data as JlistProcess[];
  } catch (error) {
    console.warn(`[staklink] jlist fetch error for ${podId}:`, error);
    return null;
  }
}
