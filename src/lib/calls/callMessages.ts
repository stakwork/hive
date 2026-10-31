/**
 * What Jamie said on a call's conversation, as voice reads it
 * (`GET /api/calls/messages`): the conversation's rows after a cursor,
 * narrowed to what a person on the call should hear or see.
 *
 *   - an orchestrator reply (`source.kind: "orchestrator"`), including the
 *     reply to a job's wake turn → `reply`, or `error` for a turn that
 *     failed, was stopped or was lost;
 *   - a proposal the turn made (`source.kind: "proposal"`) → `proposal`,
 *     with the proposal in `strut.proposals` (its card as strut made it)
 *     when the row names its workspace;
 *   - asked for (`decisions`, a tribe's outbox), a person's decision on one
 *     (`source.kind: "proposal_result"`) → `decision`: the outcome line,
 *     and the proposal's new status in `strut.proposals`. A decision row
 *     from before rows named their step is left out.
 *
 * A reply also carries the row's `strut` (strut's own entries and the
 * workspace they are relative to), untouched, when it has one.
 *
 * A job's wake reply also carries that job's deliverables, read from the job
 * row its launch marker names (`wakeId`): the wake turn's own run holds none
 * of the job's work. The job row's cards but Hive's own (its claims and its
 * trace) are added to `artifacts`, its strut entries to `strut`.
 *
 * Asked for (`requests`, the replay to someone who joins), the requests
 * too: a user row a call's turn wrote (`source.kind: "call_request"`) →
 * `request`, with who said it, how (`voice` | `chat`) and when.
 *
 * Everything else is left out: other user rows, launch markers (the chat's
 * working card), job rows (a job's card; its wake reply is what is said,
 * with the job's deliverables), proposal decisions unless asked for, and
 * silent replies. Fields come from the row's
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
import {
  orchestratorAskLine,
  parseStrutArtifactEnvelope,
  parseStrutProposalStatus,
  type StrutArtifactEnvelope,
  type StrutProposalEntry,
} from "@/lib/strut-orchestrator";

export type CallMessageKind = "reply" | "proposal" | "decision" | "error" | "request";

export interface CallMessage {
  id: string;
  kind: CallMessageKind;
  text: string;
  /** The agent stopped for a decision: its question, verbatim. */
  ask?: string;
  /** A proposal's title, or a decided one's. */
  title?: string;
  artifacts?: Array<{ title: string; url: string }>;
  /**
   * strut's own entries for the reply and the workspace they are relative
   * to, as the row keeps them: for a reader that opens them on that
   * workspace's strut (Peel). `artifacts` above is the same list as links.
   */
  strut?: StrutArtifactEnvelope;
  /** A request's speaker, as the call shows them. */
  speaker?: string;
  /** How a request reached Jamie: said aloud, or typed in the call's chat. */
  via?: CallRequestVia;
  /** When a request was taken, ISO. */
  at?: string;
}

export type CallRequestVia = "voice" | "chat";

/** The marker on the user row a call's turn writes (`/api/calls/turn`): who asked, and how. */
export interface CallRequestSource {
  kind: "call_request";
  speaker: string;
  via: CallRequestVia;
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
  source?: {
    kind?: unknown;
    status?: unknown;
    ask?: unknown;
    title?: unknown;
    speaker?: unknown;
    via?: unknown;
    proposalId?: unknown;
    step?: unknown;
    url?: unknown;
    summary?: unknown;
    card?: unknown;
    rationale?: unknown;
    createdAt?: unknown;
    error?: unknown;
    workspace?: unknown;
  } | null;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A proposal row's proposal as an envelope carries it: everything strut
 * reported of it, its card as it came. Null without its workspace (a row
 * from before rows named it) or its id.
 */
function proposalEnvelope(source: NonNullable<Row["source"]>): StrutArtifactEnvelope | null {
  const workspace = str(source.workspace);
  const id = str(source.proposalId);
  if (!workspace || !id) return null;
  const optional = (key: "summary" | "rationale" | "createdAt") =>
    str(source[key]) ? { [key]: str(source[key]) } : {};
  const entry: StrutProposalEntry = {
    id,
    step: str(source.step),
    title: str(source.title),
    ...optional("summary"),
    ...(isObject(source.card) ? { card: source.card } : {}),
    status: parseStrutProposalStatus(source.status),
    url: str(source.url) || `/proposals/${id}`,
    ...optional("rationale"),
    ...optional("createdAt"),
  };
  return { workspace, artifacts: [], proposals: [entry] };
}

/** A decision row as a message: its outcome line, and the proposal's new status. Null for a row that names no step. */
function decisionOf(id: string, content: string, source: NonNullable<Row["source"]>): CallMessage | null {
  const step = str(source.step);
  const proposalId = str(source.proposalId);
  if (!step || !proposalId) return null;
  const workspace = str(source.workspace);
  const error = str(source.error);
  const entry: StrutProposalEntry = {
    id: proposalId,
    status: parseStrutProposalStatus(source.status),
    title: str(source.title),
    step,
    ...(error ? { error } : {}),
  };
  return {
    id,
    kind: "decision",
    text: content.trim(),
    title: str(source.title),
    ...(workspace ? { strut: { workspace, artifacts: [], proposals: [entry] } } : {}),
  };
}

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
  if (message.kind === "proposal" || message.kind === "decision" || sourceOf(jobRow)?.kind !== "job") return message;
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
    strut = { ...strut, artifacts: [...strut.artifacts, ...job.artifacts.filter((e) => !kept.has(JSON.stringify(e)))] };
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

/** The row as voice reads it, or null for a row that is not said on the call. `decisions`: a decision row too. */
export function callMessageOf(
  row: Row,
  artifactUrl: (ref: ArtifactRef) => string,
  opts: { decisions?: boolean } = {},
): CallMessage | null {
  if (row.role !== "assistant" || typeof row.id !== "string") return null;
  const source = row.source ?? {};
  const content = str(row.content);
  if (source.kind === "proposal") {
    const strut = proposalEnvelope(source);
    return {
      id: row.id,
      kind: "proposal",
      text: content.trim(),
      title: str(source.title),
      ...(strut ? { strut } : {}),
    };
  }
  if (source.kind === "proposal_result") return opts.decisions ? decisionOf(row.id, content, source) : null;
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

/** A request a call's turn wrote, as voice replays it; null for any other row. Its text without the `"<speaker>: "` the row is saved with. */
export function callRequestOf(row: Row): CallMessage | null {
  if (row.role !== "user" || typeof row.id !== "string") return null;
  const source = row.source ?? {};
  const speaker = str(source.speaker);
  if (source.kind !== "call_request" || !speaker || (source.via !== "voice" && source.via !== "chat")) return null;
  const content = str(row.content);
  const prefix = `${speaker}: `;
  return {
    id: row.id,
    kind: "request",
    text: (content.startsWith(prefix) ? content.slice(prefix.length) : content).trim(),
    speaker,
    via: source.via,
    at: str(row.timestamp),
  };
}

/**
 * The messages that landed after `since` (null: from the start), oldest
 * first, and the cursor to ask from next — `since` itself when nothing new
 * landed. `requests` adds the call's requests among them, `decisions` the
 * decisions on its proposals.
 */
export function callMessagesSince(
  rows: unknown[],
  since: string | null,
  artifactUrl: (ref: ArtifactRef) => string,
  opts: { requests?: boolean; decisions?: boolean } = {},
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
    const said = callMessageOf(row, artifactUrl, opts) ?? (opts.requests ? callRequestOf(row) : null);
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
