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

/** The workflow `input` a job turn is launched with: the prompt, the job's title riding along for the reply's header (strut ignores it), and the workspace the job belongs to — the hive workspace id a pod is claimed for (strut's `job` v6 declares it; an older one strips it). */
export const jobTurnInputSchema = z.object({ prompt: z.string(), title: z.string().optional(), workspace: z.string().optional() }).passthrough();

/** The title `start_job` put on the launch, carried on every turn's input. */
export function jobTitleOf(row: { input: unknown }): string {
  const input = jobTurnInputSchema.safeParse(row.input);
  return (input.success && input.data.title?.trim()) || "Job";
}

// ─── Artifact events ──────────────────────────────────────────────────────

/**
 * An event about an artifact a job reported — a pull request merging,
 * closing, failing its checks — reaches the job as a TURN whose message
 * begins with this line (strut `plans/job-artifact-events.md` §3):
 *
 *   [artifact-event] <kind> <url> <what happened>
 *
 * the specifics on the lines below. The kind is the ref's, the URL the join
 * key, the rest names the event; a source (the GitHub webhook) fills the
 * three slots and a card's action composes the same line. Every reader —
 * the `Pod` page the job's agent follows, the wake, the conversation row —
 * parses the first line and nothing else, so a later source (a comment on
 * a document, a failed deploy) adds nothing here.
 */
export const ARTIFACT_EVENT_PREFIX = "[artifact-event]";

export interface ArtifactEvent {
  /** The ref's kind (`pull_request`). */
  kind: string;
  url: string;
  /** What happened, one line (`merged`, `closed`, `checks failed`). */
  what: string;
}

/** The turn's message: the line, then the details, one per line. */
export function formatArtifactEvent(event: ArtifactEvent, details: string[] = []): string {
  const line = `${ARTIFACT_EVENT_PREFIX} ${event.kind} ${event.url} ${event.what.trim().replace(/\s+/g, " ")}`;
  const rest = details.map((d) => d.trim()).filter(Boolean);
  return rest.length > 0 ? `${line}\n${rest.join("\n")}` : line;
}

const EVENT_LINE = /^\[artifact-event\] (\S+) (\S+) (.+)$/;

/** The event a turn's message carries, read off its first line; null for a turn a person asked for. */
export function parseArtifactEvent(text: unknown): ArtifactEvent | null {
  if (typeof text !== "string") return null;
  const first = text.split("\n", 1)[0].trim();
  const m = EVENT_LINE.exec(first);
  return m ? { kind: m[1], url: m[2], what: m[3].trim() } : null;
}

const GITHUB_PR = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)(?:[/?#]|$)/i;

/** The event for a person: `pull request acme/app#12 merged`, else the line's own words. */
export function describeArtifactEvent(event: ArtifactEvent): string {
  const pr = GITHUB_PR.exec(event.url);
  if (event.kind === "pull_request" && pr) return `pull request ${pr[1]}#${pr[2]} ${event.what}`;
  return `${event.kind.replace(/_/g, " ")} ${event.url} ${event.what}`;
}
