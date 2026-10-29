/**
 * What Jamie said on a call's conversation, as voice reads it
 * (`GET /api/calls/messages`): the conversation's rows after a cursor,
 * narrowed to what a person on the call should hear or see.
 *
 *   - an orchestrator reply (`source.kind: "orchestrator"`), including the
 *     reply to a job's wake turn → `reply`, or `error` for a turn that
 *     failed, was stopped or was lost;
 *   - a proposal the turn made (`source.kind: "proposal"`) → `proposal`.
 *
 * A reply also carries the row's `strut` (strut's own entries and the
 * workspace they are relative to), untouched, when it has one.
 *
 * A job's wake reply also carries that job's deliverables, read from the job
 * row its launch marker names (`wakeId`): the wake turn's own run holds none
 * of the job's work. The job row's cards but Hive's own (its claims and its
 * trace) are added to `artifacts`, its strut entries to `strut`.
 *
 * Everything else is left out: user rows, launch markers (the chat's
 * working card), job rows (a job's card; its wake reply is what is said,
 * with the job's deliverables), proposal decisions, and silent replies. Fields come from the row's
 * `source`, never its rendered text: `ask` is the question verbatim.
 *
 * The cursor is the timestamp of the last row delivered, not an index: a
 * row's place in the array is not stable to a reader that skips rows, and
 * the rows one turn lands (its reply and its proposals) share a stamp, so
 * they are delivered together.
 */

import {
  artifactIdentity,
  parseArtifactRefs,
  type ArtifactRef,
} from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { orchestratorAskLine, parseStrutArtifactEnvelope, type StrutArtifactEnvelope } from "@/lib/strut-orchestrator";

export type CallMessageKind = "reply" | "proposal" | "error";

export interface CallMessage {
  id: string;
  kind: CallMessageKind;
  text: string;
  /** The agent stopped for a decision: its question, verbatim. */
  ask?: string;
  /** A proposal's title. */
  title?: string;
  artifacts?: Array<{ title: string; url: string }>;
  /**
   * strut's own entries for the reply and the workspace they are relative
   * to, as the row keeps them: for a reader that opens them on that
   * workspace's strut (Peel). `artifacts` above is the same list as links.
   */
  strut?: StrutArtifactEnvelope;
}

export interface CallMessagesPage {
  cursor: string | null;
  messages: CallMessage[];
}

type Row = {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  timestamp?: unknown;
  artifacts?: unknown;
  strut?: unknown;
  source?: { kind?: unknown; status?: unknown; ask?: unknown; title?: unknown } | null;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A job row's cards that are hive's view of the work, not what it made: never handed on as deliverables. */
const HIVE_JOB_CARDS = new Set(["claims", "run_graph"]);

type SourceShape = { kind?: unknown; runId?: unknown; wakeId?: unknown } | null | undefined;
const sourceOf = (row: unknown): SourceShape =>
  row && typeof row === "object" ? ((row as { source?: SourceShape }).source ?? null) : null;

/** For each wake turn (its run id), the id of the job row it woke on: its launch marker's `wakeId`. */
export function wakeJobRows(rows: unknown[]): Map<string, string> {
  const wakes = new Map<string, string>();
  for (const row of rows) {
    const source = sourceOf(row);
    if (source?.kind === "orchestrator_launch" && typeof source.runId === "string" && typeof source.wakeId === "string" && source.wakeId.startsWith("job-")) {
      wakes.set(source.runId, source.wakeId);
    }
  }
  return wakes;
}

/**
 * A wake reply with its job's deliverables added: the job row's cards but
 * hive's own after the reply's own (each link once), and its strut entries
 * after the reply's own when both name one workspace (else the reply's
 * alone). A row that is not a job's adds nothing.
 */
export function withJobDeliverables(
  message: CallMessage,
  jobRow: unknown,
  artifactUrl: (ref: ArtifactRef) => string,
): CallMessage {
  if (message.kind === "proposal" || sourceOf(jobRow)?.kind !== "job") return message;
  const row = jobRow as { artifacts?: unknown; strut?: unknown };
  const artifacts = [...(message.artifacts ?? [])];
  const seen = new Set(artifacts.map((a) => a.url));
  for (const ref of parseArtifactRefs(row.artifacts) ?? []) {
    if (HIVE_JOB_CARDS.has(ref.kind)) continue;
    const url = artifactUrl(ref);
    if (seen.has(url)) continue;
    seen.add(url);
    artifacts.push({ title: ref.title, url });
  }

  const job = parseStrutArtifactEnvelope(row.strut);
  let strut = message.strut;
  if (job && !strut) strut = job;
  else if (job && strut && job.workspace === strut.workspace) {
    const kept = new Set(strut.artifacts.map((e) => JSON.stringify(e)));
    strut = { workspace: strut.workspace, artifacts: [...strut.artifacts, ...job.artifacts.filter((e) => !kept.has(JSON.stringify(e)))] };
  }
  return { ...message, ...(artifacts.length > 0 ? { artifacts } : {}), ...(strut ? { strut } : {}) };
}

/** The reply's own words: the rendered question taken back out (`renderOrchestratorContent`). */
function replyText(content: string, ask: string | undefined): string {
  if (!ask) return content.trim();
  const line = orchestratorAskLine(ask);
  const paragraph = `\n\n${line}`;
  return (content.includes(paragraph) ? content.replace(paragraph, "") : content.replace(line, "")).trim();
}

/** The row as voice reads it, or null for a row that is not said on the call. */
export function callMessageOf(row: Row, artifactUrl: (ref: ArtifactRef) => string): CallMessage | null {
  if (row.role !== "assistant" || typeof row.id !== "string") return null;
  const source = row.source ?? {};
  const content = str(row.content);
  if (source.kind === "proposal") {
    return { id: row.id, kind: "proposal", text: content.trim(), title: str(source.title) };
  }
  if (source.kind !== "orchestrator" || source.status === "silent") return null;
  const ask = source.status === "success" && typeof source.ask === "string" && source.ask ? source.ask : undefined;
  const refs = parseArtifactRefs(row.artifacts) ?? [];
  const strut = parseStrutArtifactEnvelope(row.strut);
  return {
    id: row.id,
    kind: source.status === "success" ? "reply" : "error",
    text: replyText(content, ask),
    ...(ask ? { ask } : {}),
    ...(refs.length > 0 ? { artifacts: refs.map((ref) => ({ title: ref.title, url: artifactUrl(ref) })) } : {}),
    ...(strut ? { strut } : {}),
  };
}

/**
 * The messages that landed after `since` (null: from the start), oldest
 * first, and the cursor to ask from next — `since` itself when nothing new
 * landed.
 */
export function callMessagesSince(
  rows: unknown[],
  since: string | null,
  artifactUrl: (ref: ArtifactRef) => string,
): CallMessagesPage {
  const after = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
  let cursor = since;
  const messages: CallMessage[] = [];
  const wakes = wakeJobRows(rows);
  const byId = new Map<string, unknown>();
  for (const raw of rows) {
    const id = raw && typeof raw === "object" ? (raw as Row).id : undefined;
    if (typeof id === "string") byId.set(id, raw);
  }
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Row;
    const at = Date.parse(str(row.timestamp));
    if (!(at > after)) continue;
    const said = callMessageOf(row, artifactUrl);
    if (!said) continue;
    const runId = sourceOf(row)?.runId;
    const jobRow = typeof runId === "string" ? wakes.get(runId) : undefined;
    const message = jobRow ? withJobDeliverables(said, byId.get(jobRow), artifactUrl) : said;
    messages.push(message);
    cursor = str(row.timestamp);
  }
  return { cursor, messages };
}

/**
 * Where a person on the call opens an artifact: its own address when it has
 * one (a pull request, a page, a pod), made absolute; else the call's
 * conversation in Hive with the artifact open (`artifactShareUrl`'s link),
 * which checks the reader's membership like any page.
 */
export function callArtifactUrl(ref: ArtifactRef, links: { base: string; conversationUrl: string }): string {
  const own = ref.source.type === "inline" ? ref.source.content.url : undefined;
  if (typeof own === "string" && own) {
    try {
      return new URL(own, links.base).toString();
    } catch {
      // Not an address after all: open it in the conversation instead.
    }
  }
  const url = new URL(links.conversationUrl);
  url.searchParams.set("artifact", artifactIdentity(ref));
  return url.toString();
}
