/**
 * Completion handler for `kind: "job_turn"` — one turn of the `job` strut
 * workflow behind `start_job` / `continue_job` (strut `plans/jobs.md`; the
 * tools are in `lib/ai/strutTools.ts`).
 *
 * The turn's run settled; this is where its reply reaches the Jamie chat.
 * The `job` workflow's agent answers in a fixed shape — its `pack` step is
 * the run's `output`:
 *
 *   { text, artifacts: [{ id, kind?, title, label?, summary?, path | url | content }], ask?: { message }, cost, session }
 *
 * and strut RESOLVES that `artifacts` list where a host receives it: the
 * `run.end` callback carries it as a top-level `artifacts`, and
 * `GET {lab}/workflows/job/runs/<runId>/artifacts` returns the same list
 * (`[{ id, kind, title, label?, summary?, url? | content? | error? }]` —
 * `url` strut-relative like `/jobs/<job>/files/plan.md`, `kind` inferred
 * from the extension when the agent gave none). The handler reads THAT
 * endpoint from the ROW's swarm rather than the callback body, so the
 * webhook and the reconcile path are one code path and the row needs no
 * `artifacts` column.
 *
 * It appends ONE assistant row to the row's conversation — `content` is a
 * header line the canvas agent reads the job id back from (`**Job · <id> ·
 * <title>**`, the strut-chat convention), the agent's `text`, and its
 * `ask` when it stopped for a decision — with `artifacts: ArtifactRef[]`
 * mapped from strut's list (`mapStrutArtifacts`, pure): a strut-relative
 * `url` becomes a `graph` source (`{ swarmId, key: <that url> }`) that the
 * reader route serves from the swarm; an absolute `url` and inline
 * `content` become `inline` sources; an entry strut could not resolve
 * (`error`) is dropped from the refs and named in the content. An `app`
 * (strut CALLBACKS.md §4) — a WORKSPACE app by name, what the `builder`
 * hands over, or a job's app in its directory (strut plans/apps.md §6) —
 * becomes an `app` ref keyed by its document's link, which `StrutAppFrame`
 * renders and relays. An entry
 * from ANOTHER strut — a build the turn ran on a peer (`builder` with
 * `peer`, strut plans/builder-job.md §3) — comes tagged `{ path, peer, job }`
 * and unresolved (strut CALLBACKS.md §4): it becomes a `graph` source on the
 * swarm hive registered as that peer (`peerSwarmsFor`: the slug of a
 * workspace in the row's org), keyed `/jobs/<job, percent-encoded>/files/
 * <path>` there, so the reader reads it from THAT swarm with its own key.
 * The append has `canvas-strut-fanout.ts`'s discipline — `FOR UPDATE`,
 * ownership re-checked against hive's rows (never the payload), idempotent
 * by row id `job-<StrutRun.id>` — and never throws for a missing target.
 * `error` / `cancelled` / LOST rows append a row saying so.
 *
 * Beside the job's own refs, the row of a successful turn that touched the
 * knowledge graph carries hive's own card for it: a `run_graph` ref — what
 * the turn read and wrote there, call by call, read live from the run's
 * workspace (`/api/workspaces/<slug>/strut/runs/<id>/graph`). One per job
 * (`runGraphArtifactId`), so each turn's trace is a version of the same
 * card. Counting it reads the run's log beside the artifact list, best
 * effort and bounded: no trace is ever a reason to retry, and the job's
 * refs alone are indexed for events and named to the wake — the trace is
 * not something the job reported.
 *
 * Beside both, the job's CLAIMS card (strut plans/job-claims.md §7): what
 * the work must deliver and whether it does, as of this turn — the ledger
 * read off the row's swarm (`GET {lab}/jobs/<job>/claims`, enriched from the
 * listing) by `readTurnClaimsCard` (`strut-jobs/claims.ts`). One per job
 * (`claims-<job>`), every turn a version, bounded like the trace and never
 * a reason to fail or retry: a swarm without claims, or a job that claims
 * nothing, adds no card. Hive's card, not the job's: not indexed, not named
 * to the wake.
 *
 * A turn that launched a `brainstorm` workflow ran it as a run of its own:
 * its `brainstorm-tree` graph artifact is collected from that run
 * (`readBrainstormArtifacts`) and joins the job's refs unless the agent
 * already reported one with that id. Best effort and bounded, like the trace.
 *
 * The row is the record, not the reply the user reads: the chat shows it
 * collapsed (`JobTurnCard`), since a job's text is written in detail (a
 * code change lists files, functions and line numbers). Once the row has
 * landed — exactly once, on `appended` — the handler wakes the canvas
 * agent (`invokeCanvasAgentOnJobTurn`, `canvas-strut-autoturn.ts`) to
 * summarize it, relay the job's question, or continue the job; the wake
 * runs in `after()` so the callback answers at once, and is gated there
 * (owner opt-in, master kill switch, loop breaker). Stored rows also reach
 * the model as text on the next human message. A turn of a job strut's
 * ORCHESTRATOR started (`via: "orchestrator"` on the input — the webhook
 * adopted its first turn, `api/strut-runs/webhook`, and every later turn
 * carries the mark) wakes the ORCHESTRATOR instead
 * (`invokeOrchestratorOnJobTurn`, `strut-orchestrator-wake.ts`): hive's
 * canvas agent is not in that conversation, and the agent that asked for
 * the job is the one to summarize it. Same gates, same after-response
 * scheduling; the reply text rides on the wake since strut's agent cannot
 * read hive's rows.
 *
 * Retry contract (`completeStrutRun`): a transient failure reading the
 * artifacts list throws, so the webhook answers 5xx and strut re-posts;
 * a 404 (the run is gone from strut) delivers the text without artifacts.
 * The wake is never a reason to retry: it is scheduled after the append
 * and its failures are its own.
 */

import { after } from "next/server";
import { z } from "zod";
import { StrutRunStatus } from "@prisma/client";
import { parseArtifactContent, type ArtifactKind, type ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";
import {
  JOB_TURN_KIND,
  JOB_WORKFLOW,
  jobTitleOf,
  jobTurnInputSchema,
  isStrutPeerId,
  jobTurnViaOrchestrator,
  parseArtifactEvent,
  parseStrutArtifactKey,
  peerJobHome,
  type ArtifactEvent,
} from "@/lib/strut-jobs";
import {
  encodeStrutPath,
  isStrutAppName,
  isStrutAppPath,
  isStrutAppVersion,
  isStrutJobId,
  jobAppOfKey,
  STRUT_APP_DOCUMENT,
  workspaceAppDocumentKey,
  workspaceAppOfKey,
} from "@/lib/strut-apps";
import { getBaseUrl } from "@/lib/utils";
import { canvasJobStateOf, nudgeCanvasCardJob } from "@/services/canvas-jobs";
import { labForRow, type StrutRunHandlerContext, type StrutRunRow } from "@/services/strut-runs";
import { countStrutRunGraph } from "@/services/strut-runs/run-graph";
import { fetchStrutRunEvents } from "@/services/strut-runs/lab";
import { projectWithLaunches } from "@/lib/strut-run-graph/project";

export { JOB_TURN_KIND, JOB_WORKFLOW, jobTitleOf };

const LOG_TAG = "JOB_TURN";
const READ_TIMEOUT_MS = 10_000;
/** Cap on the agent's reply text stored on the row. */
const MAX_TEXT_CHARS = 20_000;
/** Cap on an error message shown in the row. */
const MAX_ERROR_CHARS = 1_000;
/** Inline content larger than this is not stored on a message. */
const MAX_INLINE_CHARS = 50_000;
/** What `parseArtifactRefs` will keep — the rest is dropped here, not repaired later. */
const MAX_ID_CHARS = 200;
const MAX_TITLE_CHARS = 300;
/** Cap on a peer's file path (the reader's own key cap). */
const MAX_KEY_CHARS = 1_024;
/**
 * How long a turn's delivery waits on its log for the trace card. Read beside
 * the artifact list, inside the 10 s strut gives a callback.
 */
const TRACE_READ_TIMEOUT_MS = 8_000;

/** The workflow's `output` (its `pack` step). Extra keys are tolerated. */
export const jobTurnOutputSchema = z
  .object({
    text: z.string().optional(),
    ask: z.object({ message: z.string() }).passthrough().optional(),
  })
  .passthrough();

/** One entry of strut's RESOLVED list. */
export interface StrutArtifact {
  id: string;
  kind: string;
  title: string;
  label?: string;
  summary?: string;
  url?: string;
  content?: unknown;
  error?: string;
  /** A file relative to the job's directory — on the PEER, for a tagged entry (strut resolves its own to `url`). */
  path?: string;
  /** Another strut's deliverable: the peer's id as the org strut names it — a workspace slug. */
  peer?: string;
  /** With `peer`: the job its files are under THERE (`peer/<job>`). */
  job?: string;
  /**
   * An APP (`kind: "app"`, strut CALLBACKS.md §4): a WORKSPACE app by name —
   * the builder's deliverable, its version resolved by strut (absent only on
   * a peer's entry, which strut leaves as it came) — or a JOB's app by the
   * job and the app's directory in it (strut plans/apps.md §6). `url` is its
   * document. `hash` is the build the document came from.
   */
  app?: { name: string; version?: string; hash?: string; builtAt?: string } | { job: string; path: string };
}

const KINDS: ReadonlySet<string> = new Set<ArtifactKind>([
  "markdown",
  "html",
  "image",
  "video",
  "audio",
  "pdf",
  "url",
  "diff",
  "pull_request",
  "code",
  "log",
  "json",
  "graph",
  "walkthrough",
  "captcha",
]);
/** Kinds whose content is an address, so an absolute `url` shows as given. */
const ADDRESS_KINDS: ReadonlySet<string> = new Set<ArtifactKind>(["image", "video", "audio", "pdf", "url"]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);

/**
 * An app deliverable's `app`: `{ name, version?, hash?, builtAt? }` for a
 * workspace app (a version strut did not spell as one, or a name hive would
 * not put in a URL, is no app), else `{ job, path }` for a job's (extra keys
 * dropped). Undefined for neither.
 */
function appOf(raw: unknown): StrutArtifact["app"] {
  if (!isRecord(raw)) return undefined;
  if (raw.name !== undefined) {
    if (!isStrutAppName(raw.name) || (raw.version !== undefined && !isStrutAppVersion(raw.version))) return undefined;
    return {
      name: raw.name,
      ...(raw.version !== undefined ? { version: raw.version } : {}),
      ...(str(raw.hash, 200) ? { hash: raw.hash as string } : {}),
      ...(str(raw.builtAt, 60) ? { builtAt: raw.builtAt as string } : {}),
    };
  }
  return isStrutJobId(raw.job) && isStrutAppPath(raw.path) ? { job: raw.job, path: raw.path } : undefined;
}

/** Strut's list as it comes: every entry that is whole, in order. */
export function parseStrutArtifacts(raw: unknown): StrutArtifact[] {
  if (!Array.isArray(raw)) return [];
  const out: StrutArtifact[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = str(entry.id, MAX_ID_CHARS);
    const title = str(entry.title, MAX_TITLE_CHARS);
    if (!id || !title) continue;
    out.push({
      id,
      kind: typeof entry.kind === "string" ? entry.kind : "url",
      title,
      label: str(entry.label, 60),
      summary: str(entry.summary, 600),
      url: typeof entry.url === "string" ? entry.url : undefined,
      content: entry.content,
      error: typeof entry.error === "string" ? entry.error : undefined,
      path: str(entry.path, MAX_KEY_CHARS),
      peer: isStrutPeerId(entry.peer) ? entry.peer : undefined,
      job: str(entry.job, MAX_ID_CHARS),
      app: appOf(entry.app),
    });
  }
  return out;
}

const isAbsolute = (url: string): boolean => /^https?:\/\//i.test(url);
/** A strut-relative link: what the reader route accepts (`/jobs/<job>/files/…`, `/artifacts/<runId>/…`). */
const isStrutKey = (url: string): boolean => parseStrutArtifactKey(url) !== null;

const parseJsonObject = (text: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
};

const PR_URL = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)(?:[/?#]|$)/i;
const PR_STATES: ReadonlySet<string> = new Set(["open", "draft", "merged", "closed"]);

/**
 * A pull request as a model reports it → the `pull_request` content, or null.
 * Lenient: the object, its JSON text, or the bare GitHub link; `repo` and
 * `number` read off the link when missing (and the link built from them);
 * a numeric string number; `state` defaults to `open` — a job reports the PR
 * it just opened, and the card's live read (`useArtifactContent`, through
 * api/orgs/[githubLogin]/strut/pull-request) corrects it from GitHub.
 */
export function pullRequestContent(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    const text = raw.trim();
    raw = text.startsWith("{") ? parseJsonObject(text) : { url: text };
  }
  if (!isRecord(raw)) return null;
  const given = typeof raw.url === "string" ? raw.url.trim() : "";
  const match = PR_URL.exec(given);
  const repo = typeof raw.repo === "string" && raw.repo.includes("/") ? raw.repo : match?.[1];
  const n = typeof raw.number === "string" ? Number(raw.number) : raw.number;
  const number = typeof n === "number" && Number.isInteger(n) && n > 0 ? n : match ? Number(match[2]) : undefined;
  if (!repo || !number) return null;
  const url = /^https?:\/\//i.test(given) ? given : `https://github.com/${repo}/pull/${number}`;
  const state = typeof raw.state === "string" && PR_STATES.has(raw.state.toLowerCase()) ? raw.state.toLowerCase() : "open";
  return { ...raw, url, repo, number, state };
}

/** The content an inline `content` value becomes, per kind — null when it is not something that kind can show. */
function inlineContent(kind: string, content: unknown): { kind: ArtifactKind; content: Record<string, unknown> } | null {
  if (kind === "pull_request") {
    if (typeof content === "string" && content.length > MAX_INLINE_CHARS) return null;
    const pr = pullRequestContent(content);
    return pr && { kind: "pull_request", content: pr };
  }
  if (kind === "graph" && typeof content === "string") {
    // A graph card's content (`{ workspace, focus, … }`) may arrive as JSON text.
    if (content.length > MAX_INLINE_CHARS) return null;
    const parsed = parseJsonObject(content);
    return parsed && { kind: "graph", content: parsed };
  }
  if (isRecord(content)) {
    // Already the kind's shape (a pull request, a diff's files): the ref's
    // parser at hydration keeps it or drops it.
    return KINDS.has(kind) ? { kind: kind as ArtifactKind, content } : null;
  }
  if (typeof content !== "string") {
    return kind === "json" && content !== undefined ? { kind: "json", content: { value: content } } : null;
  }
  if (content.length > MAX_INLINE_CHARS) return null;
  switch (kind) {
    case "markdown":
    case "log":
      return { kind, content: { text: content } };
    case "code":
      return { kind: "code", content: { code: content } };
    case "json": {
      try {
        return { kind: "json", content: { value: JSON.parse(content) } };
      } catch {
        return { kind: "json", content: { value: content } };
      }
    }
    // A unified diff as text: shown as code with diff highlighting (tom's
    // `diff` content is per-file `ActionResult`s, which a string is not).
    case "diff":
      return { kind: "code", content: { code: content, language: "diff" } };
    // A page's markup inline: hive's `html` content is a STORED page by
    // slug, so the markup is shown as code.
    case "html":
      return { kind: "code", content: { code: content, language: "html" } };
    case "url":
      return isAbsolute(content) ? { kind: "url", content: { url: content } } : null;
    default:
      return null;
  }
}

/** The brainstorm card's artifact id (declared again with the collector below). */
const TREE_ID = "brainstorm-tree";

/**
 * A brainstorm tree card an agent may have copied under any kind: the entry's
 * id is `brainstorm-tree`, or its inline content (a record or JSON-object
 * text) has a string `focus` and `layout: "tree"`. `content` is the object a
 * `graph` ref stores; `unsupported` when it cannot be one (no string
 * `workspace`). Null when the entry is not a tree card.
 */
function treeCardContent(entry: StrutArtifact): { content: Record<string, unknown> } | "unsupported" | null {
  let raw: unknown = entry.content;
  if (typeof raw === "string") raw = raw.length > MAX_INLINE_CHARS ? undefined : parseJsonObject(raw);
  if (!isRecord(raw)) return null;
  // A `json` card's own shape: the object under `value`.
  if (entry.kind === "json" && !("focus" in raw) && isRecord(raw.value)) raw = raw.value;
  const record = raw as Record<string, unknown>;
  const shaped = typeof record.focus === "string" && record.layout === "tree";
  if (entry.id !== TREE_ID && !shaped) return null;
  if (typeof record.workspace !== "string" || !parseArtifactContent("graph", record)) return "unsupported";
  return { content: record };
}

/** The file's name, for a `code` ref's highlighting. */
const basename = (key: string): string => key.split("?")[0].split("/").pop() ?? key;

/**
 * The kind a file served through the reader shows as. A page strut wrote
 * stays `html`: its viewer reads the bytes through the reader and renders
 * them in `HtmlArtifactFrame` — a sandboxed frame, scripts on, never a
 * navigation to the reader. A diff file or a pull request cannot be read
 * off bytes, so as code.
 */
const readerKind = (kind: string): ArtifactKind =>
  !KINDS.has(kind) || kind === "graph" ? "url" : kind === "diff" || kind === "pull_request" ? "code" : (kind as ArtifactKind);

/**
 * A peer's file as the reader names it on that peer's swarm:
 * `/jobs/<job, percent-encoded>/files/<path>` (`job` is the peer's own id
 * for the work, `peer/<job>` — hive adds no prefix), or a strut-relative
 * `url` naming a file of that same job. Null for anything else: a file
 * under a peer's RUN, or a job the peer did not take from the org strut,
 * which the reader has no row of hive's to vouch for.
 */
function peerFileKey(entry: StrutArtifact): string | null {
  if (!entry.job || !peerJobHome(entry.job)) return null;
  const key = entry.path !== undefined ? `/jobs/${encodeURIComponent(entry.job)}/files/${entry.path.replace(/^\/+/, "")}` : entry.url;
  if (!key) return null;
  const parsed = parseStrutArtifactKey(key);
  return parsed && "job" in parsed && parsed.job === entry.job ? key : null;
}

/**
 * Where a WORKSPACE app is (strut CALLBACKS.md §4, the builder's
 * deliverable): its swarm and its document's link
 * (`/apps/<name>/<vN>/files/dist/index.html`, `workspaceAppDocumentKey`) —
 * strut's `url` when it is that link, else built from `app: { name,
 * version }`. A peer's entry names the app on the PEER's swarm, unresolved:
 * its name and, when pinned, its version, read there when looked at. Null
 * when the entry names no workspace app, or a peer no swarm of the org is.
 */
function workspaceAppSource(entry: StrutArtifact, swarmId: string, peers: ReadonlyMap<string, string>): { swarmId: string; key: string } | null {
  if (!entry.app || !("name" in entry.app) || !isStrutAppName(entry.app.name)) return null;
  if (entry.peer) {
    const peerSwarmId = peers.get(entry.peer);
    return peerSwarmId ? { swarmId: peerSwarmId, key: workspaceAppDocumentKey(entry.app.name, entry.app.version) } : null;
  }
  const linked = entry.url ? workspaceAppOfKey(entry.url) : null;
  const key = linked && linked.app === entry.app.name ? entry.url! : workspaceAppDocumentKey(entry.app.name, entry.app.version);
  return { swarmId, key };
}

/**
 * Where a job's app is: the swarm and its document's link
 * (`/jobs/<job>/files/<path>/dist/index.html`) — strut's `url`, else built
 * from `app: { job, path }`; for a peer's entry, the peer's file of that job
 * on the peer's swarm (`peerFileKey`), its document inside it. Null when the
 * entry names no job's app hive can read.
 */
function jobAppSource(entry: StrutArtifact, swarmId: string, peers: ReadonlyMap<string, string>): { swarmId: string; key: string } | null {
  const documentOf = (key: string) => (key.endsWith(`/${STRUT_APP_DOCUMENT}`) ? key : `${key.replace(/\/+$/, "")}/${STRUT_APP_DOCUMENT}`);
  if (entry.peer) {
    const peerSwarmId = peers.get(entry.peer);
    const key = peerFileKey(entry);
    return peerSwarmId && key && jobAppOfKey(documentOf(key)) ? { swarmId: peerSwarmId, key: documentOf(key) } : null;
  }
  const key =
    entry.url && isStrutKey(entry.url)
      ? entry.url
      : entry.app && "job" in entry.app
        ? `/jobs/${encodeURIComponent(entry.app.job)}/files/${encodeStrutPath(entry.app.path)}/${STRUT_APP_DOCUMENT}`
        : null;
  return key && jobAppOfKey(key) ? { swarmId, key } : null;
}

/**
 * Strut's resolved entries → hive's refs. Pure. `dropped` names the entries
 * that became no ref — unresolved on strut's side, or a shape hive cannot
 * show — for the content to mention. `peers` is the swarm behind each peer
 * the entries name (`peerSwarmsFor`); a peer's file is read from that swarm.
 */
export function mapStrutArtifacts(
  entries: StrutArtifact[],
  swarmId: string,
  peers: ReadonlyMap<string, string> = new Map(),
): { refs: ArtifactRef[]; dropped: Array<{ title: string; reason: string }> } {
  const refs: ArtifactRef[] = [];
  const dropped: Array<{ title: string; reason: string }> = [];
  for (const entry of entries) {
    const base = { id: entry.id, title: entry.title, ...(entry.label ? { label: entry.label } : {}), ...(entry.summary ? { summary: entry.summary } : {}) };
    if (entry.error) {
      dropped.push({ title: entry.title, reason: entry.error });
      continue;
    }
    // An APP (strut CALLBACKS.md §4): live software, rendered through the
    // app frame, keyed by its document's link on the swarm that holds it —
    // a WORKSPACE app by name (the builder's deliverable) or a JOB's app in
    // its directory (strut plans/apps.md §6); the peer's swarm, for a tagged
    // entry. An `app` on no swarm hive can name (a run's, a peer the org
    // has no swarm for) shows as the link it is, below.
    if (entry.kind === "app") {
      const app = workspaceAppSource(entry, swarmId, peers) ?? jobAppSource(entry, swarmId, peers);
      if (app) {
        refs.push({ ...base, kind: "app", source: { type: "graph", ...app } });
        continue;
      }
      if (entry.peer && entry.app && "name" in entry.app) {
        dropped.push({ title: entry.title, reason: `on @${entry.peer}, which is no swarm of this org` });
        continue;
      }
    }
    // Another strut's deliverable (strut CALLBACKS.md §4): a `path`, or a
    // strut-relative `url`, is a file on the swarm hive registered as that
    // peer, read there with its own key through the same reader — never
    // resolved against this row's swarm. An absolute `url` and inline
    // `content` are what they are anywhere (below).
    if (entry.peer && (entry.path !== undefined || (entry.url !== undefined && !isAbsolute(entry.url)))) {
      const key = peerFileKey(entry);
      const peerSwarmId = peers.get(entry.peer);
      if (key && peerSwarmId) refs.push({ ...base, kind: readerKind(entry.kind), source: { type: "graph", swarmId: peerSwarmId, key } });
      else dropped.push({ title: entry.title, reason: `on @${entry.peer}, ${key ? "which is no swarm of this org" : "not a file hive can name there"}` });
      continue;
    }
    // A tree card is a `graph` whatever kind the agent gave it. A url keeps
    // its own handling, unless the card is the brainstorm's.
    const hasUrl = typeof entry.url === "string" && entry.url.length > 0;
    const tree = entry.content !== undefined && (entry.id === TREE_ID || !hasUrl) ? treeCardContent(entry) : null;
    if (tree) {
      if (tree === "unsupported") dropped.push({ title: entry.title, reason: "unsupported content" });
      else refs.push({ ...base, kind: "graph", source: { type: "inline", content: tree.content } });
      continue;
    }
    if (typeof entry.url === "string" && entry.url.length > 0) {
      if (isStrutKey(entry.url)) {
        // Served through the reader route from the swarm (`readerKind`).
        refs.push({ ...base, kind: readerKind(entry.kind), source: { type: "graph", swarmId, key: entry.url } });
        continue;
      }
      const pr = entry.kind === "pull_request" ? pullRequestContent(entry.url) : null;
      if (pr) {
        refs.push({ ...base, kind: "pull_request", source: { type: "inline", content: pr } });
        continue;
      }
      if (isAbsolute(entry.url)) {
        const kind: ArtifactKind = ADDRESS_KINDS.has(entry.kind) ? (entry.kind as ArtifactKind) : "url";
        refs.push({ ...base, kind, source: { type: "inline", content: { url: entry.url } } });
        continue;
      }
      dropped.push({ title: entry.title, reason: "bad url" });
      continue;
    }
    if (entry.content !== undefined) {
      const inline = inlineContent(entry.kind, entry.content);
      if (inline) {
        const content = inline.kind === "code" && !("filename" in inline.content) && entry.url ? { ...inline.content, filename: basename(entry.url) } : inline.content;
        refs.push({ ...base, kind: inline.kind, source: { type: "inline", content } });
      } else dropped.push({ title: entry.title, reason: "unsupported content" });
      continue;
    }
    dropped.push({ title: entry.title, reason: "nothing to show" });
  }
  return { refs, dropped };
}

// ─── The row ──────────────────────────────────────────────────────────────

/** How the turn ended, as the row's `source.status` says it. */
export type JobTurnOutcome = "success" | "error" | "cancelled" | "lost";

export interface JobTurnReply {
  outcome: JobTurnOutcome;
  /** The agent's reply, or what went wrong. */
  text: string;
  ask?: string;
  /** Strut's error message for a failed turn (already capped). */
  error?: string;
}

const cap = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s);

/** What a settled row says — pure, so every branch is testable. */
export function replyForRow(row: StrutRunRow): JobTurnReply {
  switch (row.status) {
    case StrutRunStatus.CANCELLED:
      return { outcome: "cancelled", text: "The turn was stopped." };
    case StrutRunStatus.LOST:
      return {
        outcome: "lost",
        text: "Strut lost track of this turn (it restarted before recording it). Send the message again.",
      };
    case StrutRunStatus.ERROR: {
      const error = cap(row.error || "The run failed.", MAX_ERROR_CHARS);
      const text = error.startsWith("job_busy:")
        ? "A previous turn of this job was still running, so this one could not start. Send the message again once it has finished."
        : `The turn did not complete: ${error}`;
      return { outcome: "error", text, error };
    }
    case StrutRunStatus.PENDING:
      // Not settled — nothing to say yet. (Never reached through completeStrutRun.)
      return { outcome: "error", text: "" };
    case StrutRunStatus.SUCCESS:
      break;
  }
  const parsed = jobTurnOutputSchema.safeParse(row.output);
  if (!parsed.success) {
    return { outcome: "error", text: "The turn ended, but its result was not in the shape a job turn answers in.", error: "unexpected output" };
  }
  const text = parsed.data.text?.trim() ? cap(parsed.data.text.trim(), MAX_TEXT_CHARS) : "_(no reply text)_";
  const ask = parsed.data.ask?.message?.trim() || undefined;
  return { outcome: "success", text, ...(ask ? { ask } : {}) };
}

/** The strut a turn's reply says its work ran on (a peer build's `peer`); undefined for one that ran here. */
export function replyPeerOf(row: Pick<StrutRunRow, "output">): string | undefined {
  const output = row.output;
  const peer = output && typeof output === "object" && !Array.isArray(output) ? (output as Record<string, unknown>).peer : undefined;
  return isStrutPeerId(peer) ? peer : undefined;
}

/** Row id — also the idempotency key. */
export const jobRowId = (row: Pick<StrutRunRow, "id">): string => `job-${row.id}`;

export function renderJobContent(args: {
  jobId: string;
  title: string;
  reply: JobTurnReply;
  dropped: Array<{ title: string; reason: string }>;
}): string {
  const { jobId, title, reply, dropped } = args;
  const parts = [`**Job · ${jobId} · ${title}**`, reply.text];
  if (reply.ask) parts.push(`**Question for you:** ${reply.ask}`);
  if (dropped.length > 0) {
    parts.push(dropped.map((d) => `_Unavailable: ${d.title} (${d.reason})_`).join("\n"));
  }
  return parts.join("\n\n");
}

/** The job's reply: one row per turn. */
export type JobRowSource = {
  kind: "job";
  jobId: string;
  strutRunId: string;
  workflow: string;
  status: JobTurnOutcome;
  title?: string;
  ask?: string;
  /**
   * The strut the turn's work ran on when it is not the row's — a workflow
   * build on another workspace's strut (`builder` with `peer`, strut
   * plans/builder-job.md §3): that workspace's slug, as the reply's own
   * `peer` names it. The card shows it as `@<slug>`.
   */
  peer?: string;
};

/**
 * The origin of a turn no person asked for — an event about an artifact
 * the job reported (strut plans/job-artifact-events.md §3): written by the
 * launch (`services/strut-jobs.ts`) where a person's words would be, with
 * the `[artifact-event]` text as its content. `getPendingJobTurnsFromMessages`
 * hangs the working card on it; the job row that follows settles it.
 */
export type JobEventRowSource = {
  kind: "job_event";
  jobId: string;
  title?: string;
  /** The launch's `StrutRun` id — the job row that settles it is `job-<runId>`. */
  runId: string;
};

/**
 * A new version of the job's claims card made from the card — a Verify, an
 * answer, a new claim (`services/strut-jobs/claims.ts`): no turn, no agent.
 */
export type JobClaimsRowSource = {
  kind: "job_claims";
  jobId: string;
  title?: string;
};

type JobMessageRow = {
  id: string;
  role: "assistant";
  content: string;
  timestamp: string;
  source: JobRowSource | JobEventRowSource | JobClaimsRowSource;
  artifacts?: ArtifactRef[];
};

// ─── Reading strut ────────────────────────────────────────────────────────

export type ArtifactsRead =
  | { ok: true; artifacts: StrutArtifact[] }
  /** The run is gone from strut (404): deliver without artifacts. */
  | { ok: false; permanent: true; reason: string }
  /** Transient (unreachable, 5xx): throw so strut re-posts. */
  | { ok: false; permanent: false; reason: string };

/** `GET {lab}/workflows/<workflow>/runs/<runId>/artifacts` on the ROW's swarm (`job`, `builder`). Never throws. */
export async function readRunArtifacts(row: StrutRunRow): Promise<ArtifactsRead> {
  if (!row.strutRunId) return { ok: false, permanent: true, reason: "no strut run id" };
  const lab = await labForRow(row);
  if (!lab) return { ok: false, permanent: true, reason: "swarm credentials unavailable" };
  try {
    const res = await fetch(
      `${lab.labBase}/workflows/${encodeURIComponent(row.workflow)}/runs/${encodeURIComponent(row.strutRunId)}/artifacts`,
      { headers: { "x-api-token": lab.swarmApiKey }, cache: "no-store", signal: AbortSignal.timeout(READ_TIMEOUT_MS) },
    );
    if (res.status === 404) return { ok: false, permanent: true, reason: "run not found on strut" };
    if (!res.ok) return { ok: false, permanent: false, reason: `HTTP ${res.status}` };
    const body = (await res.json()) as { artifacts?: unknown };
    return { ok: true, artifacts: parseStrutArtifacts(body.artifacts) };
  } catch (err) {
    return { ok: false, permanent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The swarm behind each peer the entries name: the workspace hive registered
 * as that peer on the org strut — a workspace of the row's org, by slug
 * (`strut-peers.ts`) — and its swarm. A slug that names none is left out,
 * so its entries are named, not read. Throws on a database failure.
 */
export async function peerSwarmsFor(row: Pick<StrutRunRow, "workspaceId">, entries: StrutArtifact[]): Promise<Map<string, string>> {
  const slugs = [...new Set(entries.flatMap((e) => (e.peer ? [e.peer] : [])))];
  if (slugs.length === 0) return new Map();
  const home = await db.workspace.findUnique({ where: { id: row.workspaceId }, select: { sourceControlOrgId: true } });
  if (!home?.sourceControlOrgId) return new Map();
  const workspaces = await db.workspace.findMany({
    where: { slug: { in: slugs }, sourceControlOrgId: home.sourceControlOrgId, deleted: false },
    select: { slug: true, swarm: { select: { id: true } } },
  });
  return new Map(workspaces.flatMap((w): Array<[string, string]> => (w.swarm ? [[w.slug, w.swarm.id]] : [])));
}

// ─── The brainstorm card ──────────────────────────────────────────────────

/** The workflow whose run a job turn launches for a brainstorm, and the artifact it reports. */
const BRAINSTORM_WORKFLOW = "brainstorm";
export const BRAINSTORM_ARTIFACT_ID = TREE_ID;

/** What reading the brainstorm run gave: its cards, how many brainstorm runs the turn launched, and why none (or some). */
export interface BrainstormRead {
  refs: ArtifactRef[];
  launches: number;
  reason: "collected" | "no brainstorm run launched" | "run had no brainstorm-tree graph artifact" | `read failed: ${string}`;
}

/**
 * The `brainstorm-tree` card of the brainstorm run this turn launched (the
 * LAST local `brainstorm` child, from the turn's events), mapped to refs on
 * the ROW's swarm like the job's own. No refs when there is none. Never throws.
 */
export async function readBrainstormArtifacts(row: StrutRunRow): Promise<BrainstormRead> {
  let launchCount = 0;
  try {
    const events = await fetchStrutRunEvents(row, TRACE_READ_TIMEOUT_MS);
    if (!events) return { refs: [], launches: 0, reason: "read failed: no events" };
    const { calls, launches } = projectWithLaunches(events);
    const found = calls
      .filter((c) => c.child?.workflow === BRAINSTORM_WORKFLOW && !c.child.peer)
      .map((c) => launches.get(c.path))
      .filter((l): l is NonNullable<typeof l> => !!l && l.workflow === BRAINSTORM_WORKFLOW && !l.peer);
    launchCount = found.length;
    const launch = found.pop();
    if (!launch) return { refs: [], launches: 0, reason: "no brainstorm run launched" };
    const lab = await labForRow(row);
    if (!lab) return { refs: [], launches: launchCount, reason: "read failed: no lab" };
    logger.info("Job turn reading brainstorm run", LOG_TAG, { runId: row.id, childRunId: launch.runId });
    const res = await fetch(
      `${lab.labBase}/workflows/${BRAINSTORM_WORKFLOW}/runs/${encodeURIComponent(launch.runId)}/artifacts`,
      { headers: { "x-api-token": lab.swarmApiKey }, cache: "no-store", signal: AbortSignal.timeout(TRACE_READ_TIMEOUT_MS) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { artifacts?: unknown };
    const tree = parseStrutArtifacts(body.artifacts).filter((a) => a.id === BRAINSTORM_ARTIFACT_ID && a.kind === "graph");
    const refs = mapStrutArtifacts(tree, row.swarmId).refs.filter((r) => r.kind === "graph");
    return refs.length > 0
      ? { refs, launches: launchCount, reason: "collected" }
      : { refs, launches: launchCount, reason: "run had no brainstorm-tree graph artifact" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn("Job turn brainstorm artifacts unavailable — delivering without them", LOG_TAG, { runId: row.id, error });
    return { refs: [], launches: launchCount, reason: `read failed: ${error}` };
  }
}

// ─── The trace card ───────────────────────────────────────────────────────

/** The trace card's id: one per job, so each turn's trace is a version of it (`artifactIdentity`). */
export const runGraphArtifactId = (jobId: string): string => `run-graph-${jobId}`;

/** A turn's trace as a ref — hive's card, not one the job reported. Pure. */
export function runGraphArtifact(args: {
  jobId: string;
  title: string;
  /** The run's workspace, by slug. */
  workspace: string;
  /** The turn's `StrutRun` id. */
  run: string;
  calls: number;
  nodes: number;
}): ArtifactRef {
  const { jobId, title, workspace, run, calls, nodes } = args;
  return {
    id: runGraphArtifactId(jobId),
    kind: "run_graph",
    title,
    source: { type: "inline", content: { workspace, run, calls, nodes } },
  };
}

/**
 * The turn's trace card, or null: a turn that touched no node, a log not
 * read in time, a workspace that is gone. Never throws.
 */
async function readTurnTrace(row: StrutRunRow, jobId: string): Promise<ArtifactRef | null> {
  try {
    const counts = await countStrutRunGraph(row, TRACE_READ_TIMEOUT_MS);
    if (!counts) return null;
    const workspace = await db.workspace.findUnique({ where: { id: row.workspaceId }, select: { slug: true } });
    if (!workspace) return null;
    return runGraphArtifact({ jobId, title: jobTitleOf(row), workspace: workspace.slug, run: row.id, ...counts });
  } catch (err) {
    logger.warn("Job turn trace unavailable — delivering without it", LOG_TAG, {
      runId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Delivery ─────────────────────────────────────────────────────────────

export type JobFanOutResult = "appended" | "duplicate" | "skipped";

/**
 * Append the turn's row to the conversation. The target comes from the
 * ROW (`conversationId`, `userId`, the workspace's org) and is re-checked
 * against hive's own rows the way the dispatch admitted it
 * (`resolveOrgConversationRowId`: the workspace's org, owned by the user or
 * shared). Idempotent by row id. Throws only on a database failure.
 */
export async function appendJobRow(
  row: Pick<StrutRunRow, "id" | "workspaceId" | "userId" | "conversationId">,
  message: Omit<JobMessageRow, "id" | "role" | "timestamp"> & { source: JobRowSource },
): Promise<JobFanOutResult> {
  return appendConversationRow(row, jobRowId(row), message);
}

/** Row id of a turn's origin row — keyed on the launch's `StrutRun` id, like the job row. */
export const jobEventRowId = (row: Pick<StrutRunRow, "id">): string => `job-event-${row.id}`;

/** The origin row of an event turn (`JobEventRowSource`), with the job row's discipline. */
export async function appendJobEventRow(
  row: Pick<StrutRunRow, "id" | "workspaceId" | "userId" | "conversationId">,
  message: { content: string; source: JobEventRowSource },
): Promise<JobFanOutResult> {
  return appendConversationRow(row, jobEventRowId(row), message);
}

/**
 * A new version of the job's claims card, made from the card (`job_claims`),
 * into the job's conversation with the job row's discipline. Each action is
 * its own row.
 */
export async function appendJobClaimsRow(
  row: Pick<StrutRunRow, "workspaceId" | "userId" | "conversationId">,
  message: { content: string; source: JobClaimsRowSource; artifacts: ArtifactRef[] },
): Promise<JobFanOutResult> {
  return appendConversationRow(row, `job-claims-${message.source.jobId}-${Date.now()}`, message);
}

async function appendConversationRow(
  row: Pick<StrutRunRow, "workspaceId" | "userId" | "conversationId">,
  id: string,
  message: Omit<JobMessageRow, "id" | "role" | "timestamp">,
): Promise<JobFanOutResult> {
  const { conversationId } = row;
  if (!conversationId) return "skipped";
  let result = "skipped" as JobFanOutResult;

  await db.$transaction(async (tx) => {
    const workspace = await tx.workspace.findUnique({ where: { id: row.workspaceId }, select: { sourceControlOrgId: true } });
    const conversation = await tx.sharedConversation.findUnique({
      where: { id: conversationId },
      select: { userId: true, sourceControlOrgId: true, isShared: true },
    });
    if (!workspace?.sourceControlOrgId || !conversation) return;
    if (conversation.sourceControlOrgId !== workspace.sourceControlOrgId || (conversation.userId !== row.userId && !conversation.isShared)) {
      logger.warn("Job turn: conversation ownership mismatch — bail", LOG_TAG, { rowId: id, conversationId });
      return;
    }

    const locked = await tx.$queryRaw<{ messages: unknown }[]>`
      SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
    `;
    if (locked.length === 0) return;
    const existing = Array.isArray(locked[0].messages) ? (locked[0].messages as Array<{ id?: string }>) : [];
    if (existing.some((m) => m?.id === id)) {
      result = "duplicate";
      return;
    }

    const newRow: JobMessageRow = { id, role: "assistant", timestamp: new Date().toISOString(), ...message };
    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: { messages: [...existing, newRow] as unknown as never, lastMessageAt: new Date() },
    });
    result = "appended";
  });

  if (result === "appended") notifyCanvasConversationUpdated(conversationId, "job");
  return result;
}

// ─── The wake ─────────────────────────────────────────────────────────────

/** What the wake needs from the delivered row — built here so the test can see it whole. */
export interface JobWake {
  conversationId: string;
  wakeId: string;
  jobId: string;
  title: string;
  outcome: JobTurnOutcome;
  ask?: string;
  artifacts: Array<{ title: string; kind: string; label?: string }>;
  publicBaseUrl: string;
  /** The turn was started by an event about an artifact, not by a person: the wake says so and offers no Continue. */
  event?: ArtifactEvent;
}

/**
 * Wake the canvas agent on the row that just landed, after the response:
 * the turn is a full LLM turn and must not hold strut's callback (or make
 * it retry). Outside a request (no `after`), it runs detached. Never
 * throws — the row is delivered either way.
 */
function scheduleJobWake(row: Pick<StrutRunRow, "id" | "workspaceId">, wake: JobWake): void {
  afterResponse("Job turn wake", row, async () => {
    const workspace = await db.workspace.findUnique({ where: { id: row.workspaceId }, select: { slug: true } });
    if (!workspace) return;
    const { invokeCanvasAgentOnJobTurn } = await import("@/services/canvas-strut-autoturn");
    await invokeCanvasAgentOnJobTurn({ ...wake, workspaceSlug: workspace.slug });
  });
}

/**
 * The wake of a job the orchestrator started: strut's orchestrator, on the
 * same conversation, with the job's reply text inline (it cannot read
 * hive's rows). Same scheduling as `scheduleJobWake`.
 */
function scheduleOrchestratorWake(row: Pick<StrutRunRow, "id" | "workspaceId">, wake: JobWake & { text: string }): void {
  afterResponse("Orchestrator wake", row, async () => {
    const workspace = await db.workspace.findUnique({ where: { id: row.workspaceId }, select: { slug: true } });
    if (!workspace) return;
    const { invokeOrchestratorOnJobTurn } = await import("@/services/strut-orchestrator-wake");
    await invokeOrchestratorOnJobTurn({ ...wake, workspaceSlug: workspace.slug });
  });
}

/** Run after the response (`after`), or detached outside a request (the reconcile path). Never throws. */
function afterResponse(what: string, row: Pick<StrutRunRow, "id">, fn: () => Promise<void>): void {
  const run = async () => {
    try {
      await fn();
    } catch (err) {
      logger.warn(`${what} failed (non-fatal)`, LOG_TAG, { runId: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

/** The `StrutRunHandler` for `job_turn`. Throws to be retried. */
export async function handleJobTurnSettled(row: StrutRunRow, ctx?: StrutRunHandlerContext): Promise<void> {
  const jobId = row.jobId;
  if (!jobId) {
    logger.error("Settled job turn has no job id", LOG_TAG, { runId: row.id });
    return;
  }
  const reply = replyForRow(row);
  if (row.status === StrutRunStatus.PENDING) return;

  let refs: ArtifactRef[] = [];
  let dropped: Array<{ title: string; reason: string }> = [];
  let trace: ArtifactRef | null = null;
  let claimsCard: ArtifactRef | null = null;
  let collected: ArtifactRef[] = [];
  let brainstormLog: { found: number; launches: number; replaced: string | null; reason: string } | null = null;
  if (reply.outcome === "success") {
    const [read, turnTrace, brainstorm, claims] = await Promise.all([
      readRunArtifacts(row),
      readTurnTrace(row, jobId),
      readBrainstormArtifacts(row),
      import("@/services/strut-jobs/claims").then((m) => m.readTurnClaimsCard(row, jobId, TRACE_READ_TIMEOUT_MS)).catch(() => null),
    ]);
    trace = turnTrace;
    claimsCard = claims;
    if (read.ok) {
      ({ refs, dropped } = mapStrutArtifacts(read.artifacts, row.swarmId, await peerSwarmsFor(row, read.artifacts)));
    } else if (read.permanent) {
      logger.warn("Job turn artifacts unavailable — delivering the text alone", LOG_TAG, { runId: row.id, reason: read.reason });
      dropped = [{ title: "the turn's artifacts", reason: read.reason }];
    } else {
      // Strut re-posts the callback on a 5xx; the next attempt reads again.
      throw new Error(`job turn artifacts unavailable: ${read.reason}`);
    }
    // The run's card wins: the agent's copy of the id (whatever kind it
    // gave it) is replaced in place, else the run's card is appended.
    collected = brainstorm.refs;
    brainstormLog = { found: brainstorm.refs.length, launches: brainstorm.launches, replaced: null, reason: brainstorm.reason };
    const card = brainstorm.refs.find((b) => b.id === BRAINSTORM_ARTIFACT_ID);
    if (card) {
      const at = refs.findIndex((r) => r.id === BRAINSTORM_ARTIFACT_ID);
      if (at >= 0) {
        brainstormLog.replaced = refs[at].id;
        brainstormLog.reason = "replaced agent copy";
        refs = refs.filter((r) => r.id !== BRAINSTORM_ARTIFACT_ID);
        refs.splice(at, 0, card);
      } else refs = [...refs, card];
    }
  }

  // The index an event about one of these is looked up in: every ref with
  // a URL, under the launch's workspace (strut plans/job-artifact-events.md
  // §3). A failure throws like the read does: strut re-posts.
  if (refs.length > 0) {
    const { indexJobArtifacts } = await import("@/services/strut-jobs/artifact-events");
    await indexJobArtifacts(row, jobId, refs);
  }

  // A turn an event started: its line rides on the wake, and one strut
  // refused as `job_busy:` gives its event back to the queue below.
  const launched = jobTurnInputSchema.safeParse(row.input);
  const event = parseArtifactEvent(launched.success ? launched.data.prompt : undefined);

  const title = jobTitleOf(row);
  const peer = replyPeerOf(row);
  // The job's own refs, then hive's cards: its claims, its trace.
  const cards = [...refs, ...(claimsCard ? [claimsCard] : []), ...(trace ? [trace] : [])];
  const result = await appendJobRow(row, {
    content: renderJobContent({ jobId, title, reply, dropped }),
    source: {
      kind: "job",
      jobId,
      strutRunId: row.strutRunId ?? "",
      workflow: row.workflow,
      status: reply.outcome,
      title,
      ...(reply.ask ? { ask: reply.ask } : {}),
      ...(peer ? { peer } : {}),
    },
    ...(cards.length > 0 ? { artifacts: cards } : {}),
  });
  logger.info("Job turn delivered", LOG_TAG, {
    runId: row.id,
    jobId,
    status: reply.outcome,
    artifacts: cards.map((c) => ({ id: c.id, kind: c.kind })),
    artifactCount: cards.length,
    collected: collected.map((c) => c.id),
    ...(brainstormLog ? { brainstorm: brainstormLog } : {}),
    trace: trace !== null,
    claims: claimsCard !== null,
    dropped: dropped.length,
    result,
  });

  // A job on an infinite-canvas card: every open canvas of the initiative
  // sees it settle and reads the card's tree and artifacts again.
  await nudgeCanvasCardJob(row, canvasJobStateOf(row.status));

  // The row landed (once): an agent's turn is the reply the user reads —
  // hive's canvas agent, or, for a job the orchestrator started inside
  // strut, the orchestrator itself (that conversation runs on strut's
  // engine, so no hive agent is woken into it).
  if (result === "appended" && row.conversationId) {
    const wake: JobWake = {
      conversationId: row.conversationId,
      wakeId: jobRowId(row),
      jobId,
      title,
      outcome: reply.outcome,
      ...(reply.ask ? { ask: reply.ask } : {}),
      artifacts: refs.map((r) => ({ title: r.title, kind: r.kind, ...(r.label ? { label: r.label } : {}) })),
      publicBaseUrl: ctx?.publicBaseUrl ?? getBaseUrl(null),
      ...(event ? { event } : {}),
    };
    if (jobTurnViaOrchestrator(row)) scheduleOrchestratorWake(row, { ...wake, text: reply.text });
    else scheduleJobWake(row, wake);
  }

  // Events that arrived while this turn ran go now, as the next turn, one
  // line each (strut plans/job-artifact-events.md §3) — after the row, so
  // the conversation reads in order; after the response, like the wake. A
  // turn strut refused as `job_busy:` first gives its own event back.
  if (result === "appended" && row.conversationId) {
    const publicBaseUrl = ctx?.publicBaseUrl ?? getBaseUrl(null);
    afterResponse("Pending artifact events", row, async () => {
      const events = await import("@/services/strut-jobs/artifact-events");
      if (event && launched.success && reply.error?.startsWith("job_busy:")) await events.requeueArtifactEvent(jobId, launched.data.prompt);
      await events.launchPendingArtifactEvents(jobId, publicBaseUrl);
    });

    // The pull requests this turn reported may have run their checks while
    // it did: the first fix is hive's, once every check is in (strut
    // plans/job-artifact-events.md §5; `check-failures.ts` sends it once
    // per ref, as the job's owner) — after the row and the events above,
    // which a busy job queues it behind.
    const pullRequests = refs.flatMap((ref) =>
      ref.kind === "pull_request" && ref.source.type === "inline" && typeof ref.source.content.url === "string" ? [ref.source.content.url] : [],
    );
    if (pullRequests.length > 0) {
      afterResponse("Check failures", row, async () => {
        const { deliverCheckFailure } = await import("@/services/strut-jobs/check-failures");
        for (const url of pullRequests) await deliverCheckFailure({ workspaceId: row.workspaceId, url, publicBaseUrl });
      });
    }
  }

  // The Stop button: this run is no longer something to stop.
  if (row.conversationId) {
    try {
      const { clearActiveRun, notifyRunActive } = await import("@/services/canvas-active-runs-hooks");
      const { wasLast } = await clearActiveRun(row.conversationId, row.id);
      if (wasLast) await notifyRunActive(row.conversationId, false);
    } catch (err) {
      logger.warn("clearActiveRun failed after a job turn (non-fatal)", LOG_TAG, {
        runId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
