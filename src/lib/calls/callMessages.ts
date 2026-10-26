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
 * Everything else is left out: user rows, launch markers (the chat's
 * working card), job rows (a job's card; its wake reply is what is said),
 * proposal decisions, and silent replies. Fields come from the row's
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
import { orchestratorAskLine } from "@/lib/strut-orchestrator";

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
  source?: { kind?: unknown; status?: unknown; ask?: unknown; title?: unknown } | null;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

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
  return {
    id: row.id,
    kind: source.status === "success" ? "reply" : "error",
    text: replyText(content, ask),
    ...(ask ? { ask } : {}),
    ...(refs.length > 0 ? { artifacts: refs.map((ref) => ({ title: ref.title, url: artifactUrl(ref) })) } : {}),
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
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Row;
    const at = Date.parse(str(row.timestamp));
    if (!(at > after)) continue;
    const message = callMessageOf(row, artifactUrl);
    if (!message) continue;
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
