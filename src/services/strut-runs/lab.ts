/**
 * Reading a strut run back from the lab that ran it: its event log and the
 * files its steps wrote. Always addressed from the `StrutRun` ROW (its swarm,
 * its workflow, its strut run id) — never from anything a caller supplied.
 *
 * What comes back is raw: an event's `input` / `output` hold whatever the
 * workflow handled. Callers project it before it reaches a browser.
 */

import { logger } from "@/lib/logger";
import { labForRow, STRUT_RUN_LOG_TAG, type StrutRunRow } from "@/services/strut-runs";

const EVENTS_TIMEOUT_MS = 30_000;
const ARTIFACT_TIMEOUT_MS = 15_000;

type LabRow = Pick<StrutRunRow, "id" | "swarmId" | "workflow" | "strutRunId">;

/** Every event of the run, in log order; null when the lab could not answer. */
export async function fetchStrutRunEvents(row: LabRow): Promise<unknown[] | null> {
  if (!row.strutRunId) return null;
  const lab = await labForRow(row);
  if (!lab) return null;
  try {
    const res = await fetch(
      `${lab.labBase}/workflows/${encodeURIComponent(row.workflow)}/runs/${encodeURIComponent(row.strutRunId)}/events`,
      {
        headers: { "x-api-token": lab.swarmApiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(EVENTS_TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const events = (await res.json()) as unknown;
    return Array.isArray(events) ? events : null;
  } catch (err) {
    logger.warn("Strut run events unavailable", STRUT_RUN_LOG_TAG, {
      runId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface StrutArtifact {
  body: ArrayBuffer;
  contentType: string;
}

/**
 * One file the run wrote. `path` is relative to the run's artifact root and
 * is the CALLER's to allowlist: this sends whatever it is given.
 */
export async function fetchStrutArtifact(row: LabRow, path: string): Promise<StrutArtifact | null> {
  if (!row.strutRunId) return null;
  const lab = await labForRow(row);
  if (!lab) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  try {
    const res = await fetch(`${lab.labBase}/artifacts/${encodeURIComponent(row.strutRunId)}/${encoded}`, {
      headers: { "x-api-token": lab.swarmApiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(ARTIFACT_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return {
      body: await res.arrayBuffer(),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  } catch (err) {
    logger.warn("Strut artifact unavailable", STRUT_RUN_LOG_TAG, {
      runId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
