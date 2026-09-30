/**
 * Strut JOBS — what hive and the `job` strut workflow agree on (strut
 * `plans/jobs.md`; the tools in `lib/ai/strutTools.ts`, the completion
 * handler in `services/strut-runs/job-turn.ts`, the artifact reader route
 * at `api/orgs/[githubLogin]/strut/artifacts`). Pure: no server or client
 * imports, so both sides can use it.
 *
 * A job is an id hive mints (a UUID) and passes on every launch of the
 * `job` workflow; strut keeps one directory and one agent thread per job,
 * so the same id again is the next turn. What a turn produced comes back
 * as strut-relative links — `/jobs/<job>/files/<path>` for a file in the
 * job's directory, `/artifacts/<runId>/<path>` for a run's own — which a
 * message stores as `graph` refs (`{ swarmId, key }`) and the reader route
 * serves from the swarm behind hive's session.
 */

import { z } from "zod";

/** `StrutRun.kind` of a job turn — the completion handler's discriminator. */
export const JOB_TURN_KIND = "job_turn";
/** The seeded strut workflow (stakgraph mcp `src/lab/job/`). */
export const JOB_WORKFLOW = "job";

/** Cap on a key the reader accepts (a path on the swarm). */
const MAX_KEY_LENGTH = 1_024;

/**
 * A strut-relative artifact link, as strut resolves a `path`: a file in a
 * job's directory, or in a run's own artifact directory.
 */
export const STRUT_ARTIFACT_KEY = /^\/(jobs\/[^/]+\/files|artifacts\/[^/]+)\/.+$/;

/** What a strut-relative link names — checked against hive's own rows before the swarm is asked. */
export type StrutArtifactKey = { job: string; path: string } | { runId: string; path: string };

/**
 * A key the reader will serve: one of the two link shapes, no `..` or
 * empty segment, no query or fragment, within the cap. Null otherwise.
 */
export function parseStrutArtifactKey(key: unknown): StrutArtifactKey | null {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH) return null;
  if (!STRUT_ARTIFACT_KEY.test(key) || /[?#\\]/.test(key)) return null;
  const segments = key.split("/");
  if (segments.some((s, i) => (i > 0 && s.length === 0) || s === "." || s === "..")) return null;
  const [, root, owner, ...rest] = segments;
  if (root === "jobs") {
    // /jobs/<job>/files/<path>
    const [files, ...path] = rest;
    return files === "files" && path.length > 0 ? { job: decodeURIComponent(owner), path: path.join("/") } : null;
  }
  return rest.length > 0 ? { runId: decodeURIComponent(owner), path: rest.join("/") } : null;
}

/** The reader route's URL for a `graph` ref, root-relative (hive's own origin). */
export function strutArtifactReaderUrl(githubLogin: string, swarmId: string, key: string): string {
  return `/api/orgs/${encodeURIComponent(githubLogin)}/strut/artifacts?${new URLSearchParams({ swarmId, key })}`;
}

/** The workflow `input` a job turn is launched with: the prompt, and the job's title riding along for the reply's header (strut ignores it). */
export const jobTurnInputSchema = z.object({ prompt: z.string(), title: z.string().optional() }).passthrough();

/** The title `start_job` put on the launch, carried on every turn's input. */
export function jobTitleOf(row: { input: unknown }): string {
  const input = jobTurnInputSchema.safeParse(row.input);
  return (input.success && input.data.title?.trim()) || "Job";
}
