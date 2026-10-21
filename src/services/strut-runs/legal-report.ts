/**
 * The legal run report for a `harvey-lab-run` run (strut legal workspaces),
 * read back from the lab that ran it: the event log, the file listing, the
 * converted sources, the deliverables and the working files, built into a
 * report bundle (`lib/run-report/strut-bundle`) and projected by the same
 * pipeline as a Stakwork run's S3 bundle. Nothing is stored.
 *
 * A settled run's log and files no longer change, so its payload is kept
 * briefly once every read succeeded.
 *
 * Never throws: every failure becomes a payload the renderer can display.
 */

import { logger } from "@/lib/logger";
import { docxToHtml } from "@/lib/run-report/docx-html";
import { projectBundle } from "@/lib/run-report/project";
import {
  buildStrutReportBundle,
  reportFilesOf,
  type StrutReportDeliverable,
  type StrutReportSource,
} from "@/lib/run-report/strut-bundle";
import type { RunReportPayload } from "@/lib/run-report/types";
import type { StrutRunEvent } from "@/lib/legal-cascade/strut";
import { STRUT_RUN_LOG_TAG, type StrutRunRow } from "@/services/strut-runs";
import { fetchStrutArtifact, fetchStrutArtifactList, fetchStrutRunEvents } from "@/services/strut-runs/lab";
import { deliverablesOf, hasStrutReport } from "@/services/strut-runs/legal-benchmark";

const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHED = 10;

/** Deliverables shown as their text. A .docx is converted; anything else (.xlsx, .pdf) is not viewable. */
const TEXT_DELIVERABLE = /\.(md|txt|csv|json|eml|html?)$/i;

const cache = new Map<string, { at: number; payload: RunReportPayload }>();

/** For tests. */
export function clearStrutReportCache() {
  cache.clear();
}

const decode = (body: ArrayBuffer) => new TextDecoder().decode(body);

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `fetched` false: the lab did not answer. A file it served may still not be viewable (`deliverable` null). */
async function readDeliverable(
  row: StrutRunRow,
  name: string,
  path: string,
): Promise<{ fetched: boolean; deliverable: StrutReportDeliverable | null }> {
  if (!/\.docx$/i.test(name) && !TEXT_DELIVERABLE.test(name)) return { fetched: true, deliverable: null };
  const file = await fetchStrutArtifact(row, path);
  if (!file) return { fetched: false, deliverable: null };
  if (/\.docx$/i.test(name)) {
    const converted = await docxToHtml(file.body);
    return { fetched: true, deliverable: converted ? { name, ...converted } : null };
  }
  const text = decode(file.body);
  return { fetched: true, deliverable: { name, html: `<pre>${escapeHtml(text)}</pre>`, text } };
}

export async function loadStrutRunReport(row: StrutRunRow, now = Date.now()): Promise<RunReportPayload> {
  if (!hasStrutReport(row)) return { runId: row.id, hasReport: false, projection: null };

  const hit = cache.get(row.id);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.payload;

  const [events, files] = await Promise.all([fetchStrutRunEvents(row), fetchStrutArtifactList(row)]);
  if (!events) {
    logger.warn("Strut run report: event log unavailable", STRUT_RUN_LOG_TAG, { runId: row.id });
    return { runId: row.id, hasReport: true, error: "unavailable", projection: null };
  }

  const picked = reportFilesOf(files ?? []);
  const deliverables = [...deliverablesOf(row)];
  const [sourceFiles, workfileFiles, deliverableFiles] = await Promise.all([
    Promise.all(picked.sources.map((path) => fetchStrutArtifact(row, path))),
    Promise.all(picked.workfiles.map((path) => fetchStrutArtifact(row, path))),
    Promise.all(deliverables.map(([name, path]) => readDeliverable(row, name, path))),
  ]);

  const sources: StrutReportSource[] = [];
  picked.sources.forEach((path, i) => {
    const file = sourceFiles[i];
    if (file) sources.push({ name: path.slice("sources/".length, -".txt".length), text: decode(file.body) });
  });
  const workfiles: Array<{ name: string; text: string }> = [];
  picked.workfiles.forEach((path, i) => {
    const file = workfileFiles[i];
    if (file) workfiles.push({ name: path, text: decode(file.body) });
  });

  const bundle = buildStrutReportBundle({
    workflow: row.workflow,
    strutRunId: row.strutRunId as string,
    input: row.input,
    output: row.output,
    durationMs: row.durationMs,
    events: events as StrutRunEvent[],
    sources,
    deliverables: deliverableFiles.flatMap((d) => (d.deliverable ? [d.deliverable] : [])),
    workfiles,
  });
  const outcome = projectBundle(JSON.stringify(bundle));
  if (outcome.status !== "ok") {
    logger.error("Strut run report did not project", STRUT_RUN_LOG_TAG, { runId: row.id });
    return { runId: row.id, hasReport: true, error: "unavailable", projection: null };
  }

  const payload: RunReportPayload = { runId: row.id, hasReport: true, projection: outcome.projection };
  // A partial read is not kept: the next view tries the missing files again.
  const complete =
    files !== null &&
    sourceFiles.every(Boolean) &&
    workfileFiles.every(Boolean) &&
    deliverableFiles.every((d) => d.fetched);
  if (complete) {
    cache.delete(row.id);
    cache.set(row.id, { at: now, payload });
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
  }
  return payload;
}
