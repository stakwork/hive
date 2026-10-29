/**
 * Jamie's outbox (`GET /api/tribes/outbox`, `POST /api/tribes/outbox/ack`):
 * what the Sphinx account has to do in its tribes — post a reply, join a
 * tribe, leave one — handed out until it acks it
 * (`docs/plans/jamie-in-tribes.md`, "The reply").
 *
 * Two sources, in this order:
 *   - the queued entries (`TribeOutboxEntry`): joins, leaves and notices,
 *     oldest first; an ack marks one done;
 *   - each linked tribe's conversation, read with `callMessagesSince` (the
 *     reader voice uses) after the link's cursor: Jamie's replies, errors
 *     and proposals, as one post each. Its id is `<link id>:<row id>`, so an
 *     ack names the link whose cursor it moves.
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
 * A job's wake reply also carries that job's deliverables: the reader skips
 * the job row (a job's card), and the wake turn's own run holds none of the
 * job's work. So the job row's cards (all but hive's own, its claims and its
 * trace) become link lines, and its `strut` entries the post's metadata.
 *
 * A conversation is read only once its `updatedAt` passes the link's
 * `readAt`: the stamp of a read that left nothing after the cursor.
 */

import { parseArtifactRefs, type ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { callArtifactUrl, callMessagesSince, type CallMessage } from "@/lib/calls/callMessages";
import { db } from "@/lib/db";
import { parseStrutArtifactEnvelope, type StrutArtifactEnvelope } from "@/lib/strut-orchestrator";

export interface TribeOutboxPost {
  id: string;
  /** The tribe's pubkey. */
  tribe: string;
  text: string;
  /** The message id to thread under. */
  replyTo?: string;
  /** The message's own metadata field: strut's entries, for Peel to open against the viewer's own pairing. */
  metadata?: { strut: StrutArtifactEnvelope };
}

export type TribeOutboxItem = TribeOutboxPost | { id: string; join: string } | { id: string; leave: string };

/**
 * Past this, a reply is cut and points at the conversation in Hive: every
 * ~325 bytes is another chunk, and every chunk costs Jamie a sat.
 */
export const MAX_TRIBE_TEXT_CHARS = 4_000;
/** Queued entries handed out per poll. */
const MAX_QUEUED_PER_POLL = 100;
/** How far a wake's reply is followed back to the mention that started the job. */
const MAX_THREAD_DEPTH = 10;
/** A job row's cards that are hive's view of the work, not what it made: never posted as deliverables. */
const HIVE_JOB_CARDS = new Set(["claims", "run_graph"]);

export const tribeMessageId = (linkId: string, rowId: string): string => `${linkId}:${rowId}`;

/** The link and row a post's id names; null for a queued entry's id (a cuid has no colon). */
export function parseTribeMessageId(id: string): { linkId: string; rowId: string } | null {
  const at = id.indexOf(":");
  if (at <= 0 || at === id.length - 1) return null;
  return { linkId: id.slice(0, at), rowId: id.slice(at + 1) };
}

/** What Jamie posts for a message: its words, the agent's question, then the deliverables as links. */
export function tribeText(message: CallMessage, opts: { approver: string; conversationUrl: string }): string {
  if (message.kind === "proposal") return `Waiting for ${opts.approver} to approve: ${message.title || message.text}`;
  let body = [message.text, message.ask ?? ""].filter(Boolean).join("\n\n");
  if (body.length > MAX_TRIBE_TEXT_CHARS) {
    body = `${body.slice(0, MAX_TRIBE_TEXT_CHARS).trimEnd()}… The rest is in Hive: ${opts.conversationUrl}`;
  }
  const links = (message.artifacts ?? []).map((a) => `${a.title}: ${a.url}`).join("\n");
  return [body, links].filter(Boolean).join("\n\n");
}

type Source = { kind?: unknown; runId?: unknown; wakeId?: unknown; jobs?: unknown } | null | undefined;

const sourceOf = (row: unknown): Source =>
  row && typeof row === "object" ? ((row as { source?: Source }).source ?? null) : null;

/** For each wake turn, the job row it woke on (its launch marker's `wakeId` is that row's id). */
function wakeRows(rows: unknown[]): Map<string, string> {
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
 * hive's own as link lines after the reply's own (one per link), and its
 * strut entries after the reply's own when both name one workspace (else
 * the reply's alone). A row that is not a job's adds nothing.
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

/**
 * For a turn, the turns its reply may thread under, nearest first: the turn
 * itself, then — for a job's wake — the turn whose reply started the job,
 * and so on back. The first with a mention wins.
 */
export function threadChain(rows: unknown[]): (runId: string) => string[] {
  const wakeOf = new Map([...wakeRows(rows)].map(([wake, jobRow]) => [wake, jobRow.slice("job-".length)])); // wake turn → the job turn it woke on
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

interface LinkForOutbox {
  id: string;
  tribePubkey: string;
  conversationId: string | null;
  cursor: string | null;
  readAt: Date | null;
  org: { githubLogin: string };
  user: { name: string | null };
}

/** What a link has not had acked yet, oldest first. */
export async function pendingTribeMessages(
  link: LinkForOutbox,
  rows: unknown[],
  base: string,
): Promise<PendingTribeMessage[]> {
  if (!link.conversationId) return [];
  const conversationUrl = `${base}/org/${encodeURIComponent(link.org.githubLogin)}?chat=${encodeURIComponent(link.conversationId)}`;
  const artifactUrl = (ref: ArtifactRef) => callArtifactUrl(ref, { base, conversationUrl });
  const { messages } = callMessagesSince(rows, link.cursor, artifactUrl);
  if (messages.length === 0) return [];

  const byId = new Map<string, unknown>();
  for (const row of rows) {
    const id = row && typeof row === "object" ? (row as { id?: unknown }).id : undefined;
    if (typeof id === "string") byId.set(id, row);
  }
  const chainOf = threadChain(rows);
  const wakes = wakeRows(rows);
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
        where: { tribeLinkId: link.id, runId: { in: [...runs] } },
        select: { runId: true, mentionId: true },
      })
    : [];
  const mentionOf = new Map(mentions.map((m) => [m.runId, m.mentionId]));

  const approver = link.user.name?.trim() || "the person who linked this tribe";
  return messages.map((said) => {
    const runId = runOf(said);
    const jobRow = runId ? wakes.get(runId) : undefined;
    const message = jobRow ? withJobDeliverables(said, byId.get(jobRow), artifactUrl) : said;
    const replyTo = runId ? chainOf(runId).map((r) => mentionOf.get(r)).find(Boolean) : undefined;
    const text = tribeText(message, { approver, conversationUrl });
    const id = tribeMessageId(link.id, message.id);
    const at = String((byId.get(message.id) as { timestamp?: unknown }).timestamp);
    if (!text.trim()) return { id, at, post: null };
    return {
      id,
      at,
      post: {
        id,
        tribe: link.tribePubkey,
        text,
        ...(replyTo ? { replyTo } : {}),
        ...(message.strut ? { metadata: { strut: message.strut } } : {}),
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

const LINK_SELECT = {
  id: true,
  tribePubkey: true,
  conversationId: true,
  cursor: true,
  readAt: true,
  org: { select: { githubLogin: true } },
  user: { select: { name: true } },
} as const;

/**
 * The link's pending messages after moving its cursor past `done` ones
 * (and past the ones with nothing to post), saving the move. A cursor
 * another request moved meanwhile is left as it is.
 */
async function settleLink(
  link: LinkForOutbox,
  base: string,
  done: (id: string) => boolean,
): Promise<PendingTribeMessage[]> {
  if (!link.conversationId) return [];
  const conversation = await db.sharedConversation.findUnique({
    where: { id: link.conversationId },
    select: { messages: true, updatedAt: true },
  });
  if (!conversation) return [];
  const rows = Array.isArray(conversation.messages) ? (conversation.messages as unknown[]) : [];
  const pending = await pendingTribeMessages(link, rows, base);
  const moved = advanceTribeCursor(pending, (m) => m.post === null || done(m.id), link.cursor);
  const readAt = moved.drained ? conversation.updatedAt : link.readAt;
  if (moved.cursor !== link.cursor || readAt?.getTime() !== link.readAt?.getTime()) {
    await db.tribeLink.updateMany({ where: { id: link.id, cursor: link.cursor }, data: { cursor: moved.cursor, readAt } });
  }
  return moved.drained ? [] : pending.filter((m) => m.post && !done(m.id));
}

/** Everything Jamie has to do now: the queued entries, then each tribe's new messages. */
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
    else if (entry.kind === "notice" && entry.text) {
      items.push({ id: entry.id, tribe: entry.tribePubkey, text: entry.text, ...(entry.replyTo ? { replyTo: entry.replyTo } : {}) });
    }
  }

  const links = await db.tribeLink.findMany({
    where: { conversationId: { not: null } },
    select: { ...LINK_SELECT, conversation: { select: { updatedAt: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const link of links) {
    const updatedAt = link.conversation?.updatedAt;
    if (!updatedAt || (link.readAt && updatedAt <= link.readAt)) continue;
    const pending = await settleLink(link, base, () => false);
    for (const m of pending) if (m.post) items.push(m.post);
  }
  return items;
}

/** Mark what Jamie did: the queued entries it names, and each tribe's cursor past its posts. */
export async function ackTribeOutbox(ids: string[], base: string): Promise<void> {
  const queued: string[] = [];
  const posts = new Map<string, Set<string>>(); // link id → acked post ids
  for (const id of ids) {
    const parsed = parseTribeMessageId(id);
    if (!parsed) queued.push(id);
    else posts.set(parsed.linkId, (posts.get(parsed.linkId) ?? new Set()).add(id));
  }
  if (queued.length) {
    await db.tribeOutboxEntry.updateMany({ where: { id: { in: queued }, ackedAt: null }, data: { ackedAt: new Date() } });
  }
  for (const [linkId, acked] of posts) {
    const link = await db.tribeLink.findUnique({ where: { id: linkId }, select: LINK_SELECT });
    if (link) await settleLink(link, base, (id) => acked.has(id));
  }
}
