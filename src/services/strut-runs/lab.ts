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

/** Every event of the run, in log order; null when the lab could not answer (within `timeoutMs`). */
export async function fetchStrutRunEvents(row: LabRow, timeoutMs = EVENTS_TIMEOUT_MS): Promise<unknown[] | null> {
  if (!row.strutRunId) return null;
  const lab = await labForRow(row);
  if (!lab) return null;
  try {
    const res = await fetch(
      `${lab.labBase}/workflows/${encodeURIComponent(row.workflow)}/runs/${encodeURIComponent(row.strutRunId)}/events`,
      {
        headers: { "x-api-token": lab.swarmApiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
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

/**
 * The full output of one tool call of the run, read from strut's
 * `GET /workflows/:wf/runs/:id/outputs/*` (the strut capture task) — the
 * bytes behind a `step.end`'s `outputRef`, when the event has one. Runs
 * from before that capture shipped have no `outputRef`, so this is never
 * called for them; callers fall back to the event's own (short) preview.
 */
export async function fetchStrutRunOutput(row: LabRow, outputRef: string, timeoutMs = EVENTS_TIMEOUT_MS): Promise<string | null> {
  if (!row.strutRunId) return null;
  // `outputRef` is a path strut wrote into the event log, not something a
  // caller may steer: no `..`, and only the segment strut itself uses.
  if (outputRef.includes("..") || !/^[A-Za-z0-9/_.-]+$/.test(outputRef)) return null;
  const lab = await labForRow(row);
  if (!lab) return null;
  const encoded = outputRef.split("/").map(encodeURIComponent).join("/");
  try {
    const res = await fetch(
      `${lab.labBase}/workflows/${encodeURIComponent(row.workflow)}/runs/${encodeURIComponent(row.strutRunId)}/outputs/${encoded}`,
      {
        headers: { "x-api-token": lab.swarmApiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    logger.warn("Strut run output unavailable", STRUT_RUN_LOG_TAG, {
      runId: row.id,
      outputRef,
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

/** Every file the run wrote, as paths relative to its artifact root; null when the lab could not answer. */
export async function fetchStrutArtifactList(row: LabRow): Promise<string[] | null> {
  if (!row.strutRunId) return null;
  const lab = await labForRow(row);
  if (!lab) return null;
  try {
    // No trailing slash: with one, the lab serves its UI instead of the listing.
    const res = await fetch(`${lab.labBase}/artifacts/${encodeURIComponent(row.strutRunId)}`, {
      headers: { "x-api-token": lab.swarmApiKey, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(ARTIFACT_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const listing = (await res.json()) as { files?: unknown };
    return Array.isArray(listing.files) ? listing.files.filter((f): f is string => typeof f === "string") : null;
  } catch (err) {
    logger.warn("Strut artifact list unavailable", STRUT_RUN_LOG_TAG, {
      runId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

const TRANSCRIPT_TIMEOUT_MS = 30_000;

/**
 * One agent's transcript (its model messages), by the link strut put on
 * the agent's `step.end` (`/workflows/<wf>/runs/<id>/transcripts/<path>`).
 * Only a link under THIS row's run is followed; null otherwise, or when the
 * lab could not answer.
 */
export async function fetchStrutTranscript(row: LabRow, link: string): Promise<unknown[] | null> {
  if (!row.strutRunId) return null;
  const scope = `/workflows/${encodeURIComponent(row.workflow)}/runs/${encodeURIComponent(row.strutRunId)}/transcripts/`;
  if (!link.startsWith(scope) || link.includes("..")) return null;
  const lab = await labForRow(row);
  if (!lab) return null;
  try {
    const res = await fetch(`${lab.labBase}${link}`, {
      headers: { "x-api-token": lab.swarmApiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(TRANSCRIPT_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const messages = (await res.json()) as unknown;
    return Array.isArray(messages) ? messages : null;
  } catch (err) {
    logger.warn("Strut transcript unavailable", STRUT_RUN_LOG_TAG, {
      runId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
