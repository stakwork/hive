/**
 * Jamie's outbox (`GET /api/tribes/outbox`, `POST /api/tribes/outbox/ack`):
 * what the Sphinx account has to do in its tribes — post a reply, join a
 * tribe, leave one — handed out until it acks it
 * (`docs/plans/jamie-in-tribes.md`, "The reply").
 *
 * Two sources, in this order:
 *   - the queued entries (`TribeOutboxEntry`): joins, leaves, notices and
 *     replies to one member's message, oldest first; an ack marks one done;
 *   - each conversation of a linked tribe (`TribeThread`), read with
 *     `callMessagesSince` (the reader voice uses) after the thread's cursor:
 *     Jamie's replies, errors, proposals and the decisions on them, as one
 *     post each. Its id is `<thread id>:<row id>`, so an ack names the
 *     thread whose cursor it moves, and its `thread` is the thread's id,
 *     which Jamie sends back on a message that replies to the post.
 *
 * Delivery is at least once. The cursor moves only past a run of rows that
 * are all acked, a turn's rows (they share a stamp) together; an entry
 * acked out of order is handed out again, and Jamie, which keeps the ids it
 * posted, acks it again without posting it twice.
 *
 * A reply threads under the mention that started its turn
 * (`TribeMention`); a job's wake reply under the mention of the turn that
 * started the job, read from the conversation's own rows (the wake's launch
 * marker names the job row, the launching turn's reply lists the job).
 *
 * A job's wake reply carries that job's deliverables (the reader adds them
 * from the job row): its strut entries as the post's metadata, and a link
 * line for each deliverable with an address of its own (a pull request). A
 * deliverable that would only open the conversation in Hive gets no line:
 * that link opens for org members alone, and in Peel the metadata draws it
 * as a card they open in place — the line was the same thing twice, as a
 * long URL under a short reply.
 *
 * A proposal is one line, "Waiting for <person> to approve: <title>" —
 * the person its turn ran as (`StrutRun.userId`): the member who asked,
 * when the tribe named them, else the linker — with a stub of the proposal
 * in the metadata's `strut.proposals`: Peel reads the card from the record
 * on the org's strut with the member's own token. A decision on it — that
 * person's (or the owner's) reply to the post (`/api/tribes/messages`), or
 * a click in Hive — is posted too, as its outcome line
 * ("Applied: <title>") with the new status in `strut.proposals`; it threads
 * where the proposal did.
 *
 * Nothing large rides in a Sphinx message: a post's metadata is references
 * only (`tribeEnvelope`, strut's `plans/proposal-links.md` §2). The
 * conversation row keeps the whole entry, card and content included, for
 * the canvas and for matching the owner's reply.
 *
 * A conversation is read only once its `updatedAt` passes the thread's
 * `readAt`: the stamp of a read that left nothing after the cursor.
 */

import type { ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { callArtifactUrl, callMessagesSince, wakeJobRows, type CallMessage } from "@/lib/calls/callMessages";
import { db } from "@/lib/db";
import type { StrutArtifactEnvelope, StrutProposalEntry } from "@/lib/strut-orchestrator";
import { tribePersonName } from "@/lib/tribes/tribeLinks";

export interface TribeOutboxPost {
  id: string;
  /** The tribe's pubkey. */
  tribe: string;
  /**
   * The conversation it came from (its `TribeThread`): a reply to it, or a
   * mention posted in its thread, continues that conversation. None on a notice, which is no
   * conversation's.
   */
  thread?: string;
  text: string;
  /** The message id to thread under. */
  replyTo?: string;
  /**
   * The message's own metadata field: strut's entries as references, for
   * Peel to open against the viewer's own pairing — deliverables
   * (`artifacts`), and a proposal or a decision on one (`proposals`).
   */
  metadata?: { strut: StrutArtifactEnvelope };
}

export type TribeOutboxItem = TribeOutboxPost | { id: string; join: string } | { id: string; leave: string };

/**
 * Past this, a reply is cut and points at the conversation in Hive: every
 * ~325 bytes is another chunk, and every chunk costs Jamie a sat.
 */
export const MAX_TRIBE_TEXT_CHARS = 4_000;
/**
 * The most a post's metadata may be, in UTF-8 bytes of its JSON as the
 * daemon sends it: every ~325 bytes is another chunk at a sat each, and the
 * daemon is to refuse metadata over this cap as the enforcement (strut's
 * `plans/proposal-links.md` §2), so Hive must never send more.
 */
export const MAX_TRIBE_METADATA_BYTES = 2 * 1024;
/** A decision's error, as a tribe reads it: one line. */
const MAX_TRIBE_ERROR_CHARS = 200;
/** Queued entries handed out per poll. */
const MAX_QUEUED_PER_POLL = 100;
/** How far a wake's reply is followed back to the mention that started the job. */
const MAX_THREAD_DEPTH = 10;

export const tribeMessageId = (threadId: string, rowId: string): string => `${threadId}:${rowId}`;

/** The thread and row a post's id names; null for a queued entry's id (a cuid has no colon). */
export function parseTribeMessageId(id: string): { threadId: string; rowId: string } | null {
  const at = id.indexOf(":");
  if (at <= 0 || at === id.length - 1) return null;
  return { threadId: id.slice(0, at), rowId: id.slice(at + 1) };
}

/**
 * A link that opens the post's conversation in Hive — `callArtifactUrl`'s
 * form for a deliverable with no address of its own (`?chat=…&artifact=…`):
 * the same origin and path, the same `chat`. Not a link, or another page:
 * false.
 */
export function opensInConversation(url: string, conversationUrl: string): boolean {
  try {
    const link = new URL(url);
    const conversation = new URL(conversationUrl);
    return (
      link.origin === conversation.origin &&
      link.pathname === conversation.pathname &&
      link.searchParams.get("chat") === conversation.searchParams.get("chat")
    );
  } catch {
    return false;
  }
}

/**
 * What Jamie posts for a message: its words, the agent's question, then a
 * link for each deliverable with an address of its own. One that would only
 * open the conversation in Hive is left out — it is the card the post's
 * metadata draws in Peel (a cut reply still points at the conversation: the
 * rest of its words are nowhere else).
 */
export function tribeText(message: CallMessage, opts: { approver: string; conversationUrl: string }): string {
  if (message.kind === "proposal") return `Waiting for ${opts.approver} to approve: ${message.title || message.text}`;
  if (message.kind === "decision") return message.text;
  let body = [message.text, message.ask ?? ""].filter(Boolean).join("\n\n");
  if (body.length > MAX_TRIBE_TEXT_CHARS) {
    body = `${body.slice(0, MAX_TRIBE_TEXT_CHARS).trimEnd()}… The rest is in Hive: ${opts.conversationUrl}`;
  }
  const links = (message.artifacts ?? [])
    .filter((a) => !opensInConversation(a.url, opts.conversationUrl))
    .map((a) => `${a.title}: ${a.url}`)
    .join("\n");
  return [body, links].filter(Boolean).join("\n\n");
}

const nonEmpty = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The keys of `entry` that are non-empty strings, and only those. */
function stringsOf(entry: Record<string, unknown>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = nonEmpty(entry[key]);
    if (value) out[key] = value;
  }
  return out;
}

/**
 * A deliverable as a reference: its name (`id`, `kind`, `title`) and its
 * address — an app (the object as it is), else a `url`, else a `path` — and,
 * on a peer's entry, the tags Peel opens a peer's file by (`peer`, `via`,
 * `job`, `path`). Never its `content`, `summary`, `label` or anything else.
 * Null for one with no address.
 */
function deliverableReference(entry: unknown): Record<string, unknown> | null {
  if (!isRecord(entry)) return null;
  const url = nonEmpty(entry.url);
  const path = nonEmpty(entry.path);
  const address = isRecord(entry.app) ? { app: entry.app } : url ? { url } : path ? { path } : null;
  if (!address) return null;
  return {
    ...stringsOf(entry, ["id", "kind", "title"]),
    ...address,
    ...(nonEmpty(entry.peer) ? stringsOf(entry, ["peer", "via", "job", "path"]) : {}),
  };
}

/** The first line of `text` with its spaces collapsed, cut to `MAX_TRIBE_ERROR_CHARS`. */
function oneLine(text: string): string {
  const line = (text.split("\n").find((l) => l.trim()) ?? "").replace(/\s+/g, " ").trim();
  return line.length > MAX_TRIBE_ERROR_CHARS ? `${line.slice(0, MAX_TRIBE_ERROR_CHARS - 1).trimEnd()}…` : line;
}

/**
 * A proposal as a reference: `{ id, step, title, status, url }`, the card
 * read from the record at `url`; a decision on one (no `url`, an outcome)
 * `{ id, step, title, status, error? }`, the error one line. Never the card,
 * summary, rationale or when it was made. Null for one with no id.
 */
function proposalReference(entry: StrutProposalEntry): StrutProposalEntry | null {
  if (!isRecord(entry) || !nonEmpty(entry.id)) return null;
  const ref: StrutProposalEntry = {
    id: entry.id,
    step: nonEmpty(entry.step) ?? "",
    title: nonEmpty(entry.title) ?? "",
    status: entry.status,
  };
  const url = nonEmpty(entry.url);
  if (url) return { ...ref, url };
  const error = nonEmpty(entry.error);
  return error ? { ...ref, error: oneLine(error) } : ref;
}

const utf8 = new TextEncoder();
const metadataBytes = (strut: StrutArtifactEnvelope): number => utf8.encode(JSON.stringify({ strut })).length;

/**
 * A message's strut entries as its tribe post carries them: the workspace
 * and references only (`deliverableReference`, `proposalReference`), under
 * `MAX_TRIBE_METADATA_BYTES` — the proposals first (the post's point), then
 * the deliverables in order, and everything after the first that does not
 * fit left out (the text's links and the conversation in Hive stand for
 * them). Null when nothing is left: the post then has no metadata.
 */
export function tribeEnvelope(strut: StrutArtifactEnvelope): StrutArtifactEnvelope | null {
  const entries: Array<["proposals", StrutProposalEntry] | ["artifacts", Record<string, unknown>]> = [];
  for (const entry of strut.proposals ?? []) {
    const ref = proposalReference(entry);
    if (ref) entries.push(["proposals", ref]);
  }
  for (const entry of Array.isArray(strut.artifacts) ? strut.artifacts : []) {
    const ref = deliverableReference(entry);
    if (ref) entries.push(["artifacts", ref]);
  }
  let kept: StrutArtifactEnvelope = { workspace: strut.workspace, artifacts: [] };
  for (const [key, ref] of entries) {
    const next: StrutArtifactEnvelope =
      key === "proposals"
        ? { ...kept, proposals: [...(kept.proposals ?? []), ref] }
        : { ...kept, artifacts: [...kept.artifacts, ref] };
    if (metadataBytes(next) > MAX_TRIBE_METADATA_BYTES) break;
    kept = next;
  }
  return kept.artifacts.length > 0 || (kept.proposals?.length ?? 0) > 0 ? kept : null;
}

type Source = { kind?: unknown; runId?: unknown; wakeId?: unknown; jobs?: unknown } | null | undefined;

const sourceOf = (row: unknown): Source =>
  row && typeof row === "object" ? ((row as { source?: Source }).source ?? null) : null;

/**
 * For a turn, the turns its reply may thread under, nearest first: the turn
 * itself, then — for a job's wake — the turn whose reply started the job,
 * and so on back. The first with a mention wins.
 */
export function threadChain(rows: unknown[]): (runId: string) => string[] {
  const wakeOf = new Map([...wakeJobRows(rows)].map(([wake, jobRow]) => [wake, jobRow.slice("job-".length)])); // wake turn → the job turn it woke on
  const launcherOf = new Map<string, string>(); // job turn → the turn that started it
  for (const row of rows) {
    const source = sourceOf(row);
    if (!source || typeof source.runId !== "string") continue;
    if (source.kind === "orchestrator" && Array.isArray(source.jobs)) {
      for (const job of source.jobs) {
        const jobRun = (job as { runId?: unknown } | null)?.runId;
        if (typeof jobRun === "string") launcherOf.set(jobRun, source.runId);
      }
    }
  }
  return (runId) => {
    const chain = [runId];
    let at = runId;
    while (chain.length < MAX_THREAD_DEPTH) {
      const job = wakeOf.get(at);
      const launcher = job ? launcherOf.get(job) : undefined;
      if (!launcher || chain.includes(launcher)) break;
      chain.push(launcher);
      at = launcher;
    }
    return chain;
  };
}

export interface PendingTribeMessage {
  /** The post's outbox id. */
  id: string;
  /** The row's stamp: the cursor moves to it. */
  at: string;
  /** Null for a message with nothing to post (an empty reply): passed over, never handed out. */
  post: TribeOutboxPost | null;
}

interface ThreadForOutbox {
  id: string;
  conversationId: string;
  cursor: string | null;
  readAt: Date | null;
  link: {
    id: string;
    tribePubkey: string;
    /** The linker. */
    userId: string;
    org: { githubLogin: string };
    user: { name: string | null; sphinxAlias?: string | null };
  };
}

/**
 * Who a proposal's post says it waits for, by its turn: the person the turn
 * ran as — the linker, or a member the tribe named (`/api/tribes/messages`).
 */
async function approversOf(link: ThreadForOutbox["link"], runIds: string[]): Promise<(runId: string | null) => string> {
  const linker = tribePersonName(link.user) ?? "the person who linked this tribe";
  if (runIds.length === 0) return () => linker;
  const runs = await db.strutRun.findMany({ where: { id: { in: runIds } }, select: { id: true, userId: true } });
  const userOf = new Map(runs.filter((r) => r.userId !== link.userId).map((r) => [r.id, r.userId]));
  const users = userOf.size
    ? await db.user.findMany({
        where: { id: { in: [...new Set(userOf.values())] } },
        select: { id: true, name: true, sphinxAlias: true },
      })
    : [];
  const nameOf = new Map(users.map((u) => [u.id, tribePersonName(u)]));
  return (runId) => {
    const userId = runId ? userOf.get(runId) : undefined;
    return userId ? (nameOf.get(userId) ?? "the person who asked") : linker;
  };
}

/** What a thread has not had acked yet, oldest first. */
export async function pendingTribeMessages(
  thread: ThreadForOutbox,
  rows: unknown[],
  base: string,
): Promise<PendingTribeMessage[]> {
  const { link } = thread;
  const conversationUrl = `${base}/org/${encodeURIComponent(link.org.githubLogin)}?chat=${encodeURIComponent(thread.conversationId)}`;
  const artifactUrl = (ref: ArtifactRef) => callArtifactUrl(ref, { base, conversationUrl });
  const { messages } = callMessagesSince(rows, thread.cursor, artifactUrl, { decisions: true });
  if (messages.length === 0) return [];

  const byId = new Map<string, unknown>();
  for (const row of rows) {
    const id = row && typeof row === "object" ? (row as { id?: unknown }).id : undefined;
    if (typeof id === "string") byId.set(id, row);
  }
  const chainOf = threadChain(rows);
  const runOf = (message: CallMessage): string | null => {
    const runId = sourceOf(byId.get(message.id))?.runId;
    return typeof runId === "string" ? runId : null;
  };
  const runs = new Set(messages.flatMap((m) => {
    const runId = runOf(m);
    return runId ? chainOf(runId) : [];
  }));
  const mentions = runs.size
    ? await db.tribeMention.findMany({
        // A burst's earlier messages share its turn: the reply threads under the newest.
        where: { tribeLinkId: link.id, runId: { in: [...runs] }, folded: false },
        select: { runId: true, mentionId: true },
      })
    : [];
  const mentionOf = new Map(mentions.map((m) => [m.runId, m.mentionId]));

  const approverOf = await approversOf(
    link,
    [...new Set(messages.filter((m) => m.kind === "proposal").map(runOf).filter((r): r is string => r !== null))],
  );
  return messages.map((message) => {
    const runId = runOf(message);
    const replyTo = runId ? chainOf(runId).map((r) => mentionOf.get(r)).find(Boolean) : undefined;
    const text = tribeText(message, { approver: approverOf(runId), conversationUrl });
    const id = tribeMessageId(thread.id, message.id);
    const at = String((byId.get(message.id) as { timestamp?: unknown }).timestamp);
    if (!text.trim()) return { id, at, post: null };
    const strut = message.strut ? tribeEnvelope(message.strut) : null;
    return {
      id,
      at,
      post: {
        id,
        tribe: link.tribePubkey,
        thread: thread.id,
        text,
        ...(replyTo ? { replyTo } : {}),
        ...(strut ? { metadata: { strut } } : {}),
      },
    };
  });
}

/**
 * Where the cursor moves: past each leading run of rows with one stamp
 * whose messages are all done, stopping at the first that is not.
 * `drained`: nothing is left after it.
 */
export function advanceTribeCursor(
  pending: PendingTribeMessage[],
  done: (message: PendingTribeMessage) => boolean,
  cursor: string | null,
): { cursor: string | null; drained: boolean } {
  let i = 0;
  while (i < pending.length) {
    let j = i;
    while (j < pending.length && pending[j].at === pending[i].at) j++;
    if (!pending.slice(i, j).every(done)) return { cursor, drained: false };
    cursor = pending[i].at;
    i = j;
  }
  return { cursor, drained: true };
}

const THREAD_SELECT = {
  id: true,
  conversationId: true,
  cursor: true,
  readAt: true,
  link: {
    select: {
      id: true,
      tribePubkey: true,
      userId: true,
      org: { select: { githubLogin: true } },
      user: { select: { name: true, sphinxAlias: true } },
    },
  },
} as const;

/**
 * The thread's pending messages after moving its cursor past `done` ones
 * (and past the ones with nothing to post), saving the move. A cursor
 * another request moved meanwhile is left as it is.
 */
async function settleThread(
  thread: ThreadForOutbox,
  base: string,
  done: (id: string) => boolean,
): Promise<PendingTribeMessage[]> {
  const conversation = await db.sharedConversation.findUnique({
    where: { id: thread.conversationId },
    select: { messages: true, updatedAt: true },
  });
  if (!conversation) return [];
  const rows = Array.isArray(conversation.messages) ? (conversation.messages as unknown[]) : [];
  const pending = await pendingTribeMessages(thread, rows, base);
  const moved = advanceTribeCursor(pending, (m) => m.post === null || done(m.id), thread.cursor);
  const readAt = moved.drained ? conversation.updatedAt : thread.readAt;
  if (moved.cursor !== thread.cursor || readAt?.getTime() !== thread.readAt?.getTime()) {
    await db.tribeThread.updateMany({ where: { id: thread.id, cursor: thread.cursor }, data: { cursor: moved.cursor, readAt } });
  }
  return moved.drained ? [] : pending.filter((m) => m.post && !done(m.id));
}

/**
 * The threads whose conversation moved since their last read, oldest
 * first: a tribe keeps every conversation it started, so the ones nothing
 * happened in are left in the database.
 */
async function movedThreads(): Promise<ThreadForOutbox[]> {
  const moved = await db.$queryRaw<{ id: string }[]>`
    SELECT t.id FROM tribe_threads t
    JOIN shared_conversations c ON c.id = t.conversation_id
    WHERE t.read_at IS NULL OR c.updated_at > t.read_at
  `;
  if (moved.length === 0) return [];
  return db.tribeThread.findMany({
    where: { id: { in: moved.map((t) => t.id) } },
    select: THREAD_SELECT,
    orderBy: { createdAt: "asc" },
  });
}

/** Everything Jamie has to do now: the queued entries, then each conversation's new messages. */
export async function readTribeOutbox(base: string): Promise<TribeOutboxItem[]> {
  const entries = await db.tribeOutboxEntry.findMany({
    where: { ackedAt: null },
    orderBy: { createdAt: "asc" },
    take: MAX_QUEUED_PER_POLL,
  });
  const items: TribeOutboxItem[] = [];
  for (const entry of entries) {
    if (entry.kind === "join" && entry.link) items.push({ id: entry.id, join: entry.link });
    else if (entry.kind === "leave") items.push({ id: entry.id, leave: entry.tribePubkey });
    else if ((entry.kind === "notice" || entry.kind === "reply") && entry.text) {
      items.push({ id: entry.id, tribe: entry.tribePubkey, text: entry.text, ...(entry.replyTo ? { replyTo: entry.replyTo } : {}) });
    }
  }

  for (const thread of await movedThreads()) {
    const pending = await settleThread(thread, base, () => false);
    for (const m of pending) if (m.post) items.push(m.post);
  }
  return items;
}

/** Mark what Jamie did: the queued entries it names, and each thread's cursor past its posts. */
export async function ackTribeOutbox(ids: string[], base: string): Promise<void> {
  const queued: string[] = [];
  const posts = new Map<string, Set<string>>(); // thread id → acked post ids
  for (const id of ids) {
    const parsed = parseTribeMessageId(id);
    if (!parsed) queued.push(id);
    else posts.set(parsed.threadId, (posts.get(parsed.threadId) ?? new Set()).add(id));
  }
  if (queued.length) {
    await db.tribeOutboxEntry.updateMany({ where: { id: { in: queued }, ackedAt: null }, data: { ackedAt: new Date() } });
  }
  for (const [threadId, acked] of posts) {
    const thread = await db.tribeThread.findUnique({ where: { id: threadId }, select: THREAD_SELECT });
    if (thread) await settleThread(thread, base, (id) => acked.has(id));
  }
}
