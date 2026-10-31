import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loadUserChatAgentModel } from "@/lib/ai/resolve-model";
import { LockAcquireTimeoutError, withLock } from "@/lib/locks/redis-lock";
import { notifyInitiativeUpdated } from "@/lib/pusher";
import { ORCHESTRATOR_BUSY_NOTE } from "@/lib/strut-orchestrator";
import { authorizeJamieRequest, jamieAccount, SPHINX_PUBKEY_RE } from "@/lib/tribes/jamie";
import {
  decisionOfText,
  hasDecisionRow,
  lastOpenProposal,
  proposalOfRow,
  type PostedProposal,
} from "@/lib/tribes/tribeDecisions";
import {
  queueTribeNotice,
  queueTribeReply,
  TRIBE_ACCESS_LOST_NOTICE,
  TRIBE_DECIDED_IN_HIVE,
  TRIBE_OWNER_DECIDES,
  tribeName,
} from "@/lib/tribes/tribeLinks";
import { parseTribeMessageId } from "@/lib/tribes/tribeOutbox";
import { getBaseUrl } from "@/lib/utils";
import type { StoredAttachment } from "@/services/canvas-turn-persistence";
import { persistCanvasUserMessage } from "@/services/org-canvas-conversation";
import { getS3Service } from "@/services/s3";
import { launchOrchestratorTurn, orchestratorHasLiveTurn } from "@/services/strut-orchestrator";
import {
  appendProposalResultRow,
  decideStrutProposal,
  renderProposalResult,
  resolveProposalTurn,
  StrutProposalError,
  type DecideOutcome,
  type ProposalTurnRow,
} from "@/services/strut-proposals";
import { validateWorkspaceAccess } from "@/services/workspace";

/**
 * POST /api/tribes/messages — Jamie, a member of a linked Sphinx tribe
 * (stakwork/sphinx `wasm/daemon`), hands Hive a message that is to it: one
 * that mentions it, or a reply to one of its posts
 * (`docs/plans/jamie-in-tribes.md`, "A mention"). Machine-to-machine:
 * Jamie's token (`lib/tribes/jamie.ts`).
 *
 * The call turn route's flow (`/api/calls/turn`) on one of the tribe's
 * conversations: the message is saved as `"<alias>: <text>"` with the room
 * before it (`recent`) as a text attachment, and one orchestrator turn is
 * launched as the person who linked the tribe, with the tribe line on its
 * context. The mention's id is recorded against the turn, so the reply,
 * which Jamie reads from `/api/tribes/outbox`, threads under it.
 *
 * Which conversation (`TribeThread`), and so which orchestrator session: a
 * reply to one of Jamie's posts (`@jamie` or not), or a mention posted in a
 * thread one went into, carries that post's `thread`, and continues that
 * conversation. Anything else in Jamie's threads stays with the members:
 * Jamie hands on mentions and replies to its posts, nothing more. A mention
 * with no `thread`, or one that is not this tribe's, starts a new conversation, and
 * its `thread` comes back on every post from it. A retry of a mention lands on the
 * conversation it started.
 *
 * A burst: while a conversation is busy, Jamie holds the new mentions in
 * its thread, then offers them as one — the newest as the mention, and the
 * ones that waited before it as `earlier`, oldest first. They are one turn:
 * one user row, each line `"<alias>: <text>"` in order, the newest last.
 * Every id in it is recorded as taken, so a retry of any of them is a
 * duplicate; one already taken is left out. The reply threads under the
 * newest.
 *
 * Files: a photo or a document posted with the mention (or just before it
 * by the same member) comes as `attachments`, as base64 — an image shrunk by
 * the daemon to what a vision model reads, a PDF, a text file or a Word
 * document as it is; small enough for the request to stay inside the
 * platform's body limit — or with `error` saying why it could not be opened.
 * Each file is stored under the workspace's canvas uploads like `recent` and
 * goes on the user row and the launch, so the agent sees it (strut puts an
 * image or a PDF on its prompt as a file part, text and Word inline); an
 * unopened one is said after the message, so the agent knows a file was
 * sent.
 *
 * A decision: a reply to Jamie's proposal post that is only the card's
 * button word, or a plain accept / reject (`decideByReply`), decides the
 * proposal when the tribe's owner wrote it, and runs no turn; anyone else
 * is told only the owner can.
 *
 * Answers, as the daemon reads them:
 *   202 { turn, thread }  taken
 *   200 { decided }    a reply that decided a proposal (its status now)
 *   200 { refused }    a decision that was not this sender's to make, or strut refused (a reply says so)
 *   200 { duplicate }  a mention already taken (a retry whose answer was lost)
 *   409 { busy }       a turn of that conversation is still live; Jamie offers it again
 *   403                the linker can no longer use the workspace (a notice goes to the tribe)
 *   404                the tribe is not linked (any more)
 *   400                not a mention
 *   502                strut refused the launch; Jamie retries
 */
export const maxDuration = 60;

const MAX_ID_CHARS = 200;
const MAX_ALIAS_CHARS = 200;
const MAX_TEXT_CHARS = 20_000;
/** The most messages a burst folds in before the newest (`earlier`). */
const MAX_EARLIER = 20;
/** The daemon sends 30 lines and 8 KB at most; this is the room for a wider one. */
const MAX_RECENT_LINES = 200;
const MAX_RECENT_BYTES = 64 * 1024;
/** A mention's files: the daemon shrinks an image for a vision model and sends at most four. */
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
/** Together, decoded: the request must stay under the platform's body limit (4.5 MB on Vercel). */
const MAX_ATTACHMENTS_TOTAL_BYTES = 3 * 1024 * 1024;
const MAX_ATTACHMENT_NAME_CHARS = 200;
const MAX_ATTACHMENT_ERROR_CHARS = 300;
/** What strut puts on a prompt as an image (its `attachments.ts`); `image/jpg` is read as JPEG. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
/** What strut shows or inlines besides: a PDF (a file part), Word (its text), and text of any kind. */
const DOCUMENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/json",
  "application/yaml",
  "application/x-yaml",
  "application/xml",
]);
const takesType = (t: string) => IMAGE_TYPES.has(t) || DOCUMENT_TYPES.has(t) || t.startsWith("text/");

interface RecentLine {
  alias: string;
  time: string;
  text: string;
}

/** A file the mention carried, decoded. */
interface MentionImage {
  name: string;
  mediaType: string;
  bytes: Buffer;
}

/** A file the daemon could not open: named after the message, so the agent knows it was sent. */
interface UnopenedFile {
  name: string;
  reason: string;
}

/** A message that waited while its conversation was busy: folded into the newest one's turn. */
interface Earlier {
  id: string;
  alias: string;
  text: string;
}

interface Mention {
  id: string;
  /** The conversation it replies in: a post's `thread`, as Jamie holds it. */
  thread: string | null;
  /** The post it replies to, by the id Hive handed it out under (`<thread>:<row id>`), when the daemon says. */
  replyTo: string | null;
  tribe: { pubkey: string; name: string | null };
  alias: string;
  owner: boolean;
  text: string;
  /** The burst's earlier messages, oldest first; empty for a message alone. */
  earlier: Earlier[];
  recent: RecentLine[];
  images: MentionImage[];
  unopened: UnopenedFile[];
}

/** A name shown before a message on one line. */
const oneLine = (raw: unknown, max: number): string =>
  typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** The body, or what is wrong with it. */
function parseMention(raw: unknown): Mention | string {
  if (!raw || typeof raw !== "object") return "body must be a JSON object";
  const b = raw as Record<string, unknown>;
  const id = typeof b.id === "string" ? b.id.trim() : "";
  if (!id || id.length > MAX_ID_CHARS) return "id is required";
  const tribe = b.tribe as Record<string, unknown> | null | undefined;
  const pubkey = typeof tribe?.pubkey === "string" ? tribe.pubkey.trim().toLowerCase() : "";
  if (!SPHINX_PUBKEY_RE.test(pubkey)) return "tribe.pubkey must be a tribe's pubkey";
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return "text is required";
  if (text.length > MAX_TEXT_CHARS) return `text is over ${MAX_TEXT_CHARS} characters`;
  if (b.earlier !== undefined && b.earlier !== null && !Array.isArray(b.earlier)) return "earlier must be a list";
  const rawEarlier = Array.isArray(b.earlier) ? b.earlier : [];
  if (rawEarlier.length > MAX_EARLIER) return `earlier is over ${MAX_EARLIER} messages`;
  const earlier: Earlier[] = [];
  for (const [i, raw] of rawEarlier.entries()) {
    const e = raw as Record<string, unknown> | null;
    const eid = typeof e?.id === "string" ? e.id.trim() : "";
    if (!eid || eid.length > MAX_ID_CHARS) return `earlier[${i}].id is required`;
    const etext = typeof e?.text === "string" ? e.text.trim() : "";
    if (!etext) return `earlier[${i}].text is required`;
    if (eid === id || earlier.some((x) => x.id === eid)) continue;
    earlier.push({ id: eid, alias: oneLine(e?.alias, MAX_ALIAS_CHARS) || "A member", text: etext });
  }
  if (earlier.reduce((n, e) => n + e.text.length, text.length) > MAX_TEXT_CHARS) {
    return `text and earlier are over ${MAX_TEXT_CHARS} characters`;
  }
  if (b.recent !== undefined && b.recent !== null && !Array.isArray(b.recent)) return "recent must be a list";
  const recent: RecentLine[] = [];
  for (const line of Array.isArray(b.recent) ? b.recent.slice(-MAX_RECENT_LINES) : []) {
    const l = line as Record<string, unknown> | null;
    if (typeof l?.text !== "string" || !l.text.trim()) continue;
    recent.push({ alias: oneLine(l.alias, MAX_ALIAS_CHARS) || "?", time: oneLine(l.time, 64), text: l.text.trim() });
  }
  if (b.attachments !== undefined && b.attachments !== null && !Array.isArray(b.attachments)) return "attachments must be a list";
  const rawAttachments = Array.isArray(b.attachments) ? b.attachments : [];
  if (rawAttachments.length > MAX_ATTACHMENTS) return `attachments is over ${MAX_ATTACHMENTS} files`;
  const images: MentionImage[] = [];
  const unopened: UnopenedFile[] = [];
  let imageBytes = 0;
  for (const [i, raw] of rawAttachments.entries()) {
    const a = raw as Record<string, unknown> | null;
    const name = oneLine(a?.name, MAX_ATTACHMENT_NAME_CHARS).split(/[\\/]/).pop() ?? "";
    if (!name) return `attachments[${i}].name is required`;
    const given = typeof a?.mediaType === "string" ? a.mediaType.trim().toLowerCase() : "";
    const mediaType = given === "image/jpg" ? "image/jpeg" : given;
    if (typeof a?.error === "string" && a.error.trim()) {
      unopened.push({ name, reason: oneLine(a.error, MAX_ATTACHMENT_ERROR_CHARS) });
      continue;
    }
    if (typeof a?.data !== "string" || !a.data) return `attachments[${i}] needs data (base64) or error`;
    if (!takesType(mediaType)) return `attachments[${i}].mediaType must be an image's (png, jpeg, gif, webp) or a document's (pdf, text, Word)`;
    const data = a.data.replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return `attachments[${i}].data is not base64`;
    const bytes = Buffer.from(data, "base64");
    if (!bytes.length) return `attachments[${i}].data is empty`;
    if (bytes.length > MAX_ATTACHMENT_BYTES) return `attachments[${i}] is over ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`;
    imageBytes += bytes.length;
    if (imageBytes > MAX_ATTACHMENTS_TOTAL_BYTES) return `attachments are over ${MAX_ATTACHMENTS_TOTAL_BYTES / 1024 / 1024} MB together`;
    images.push({ name, mediaType, bytes });
  }
  const thread = typeof b.thread === "string" ? b.thread.trim() : "";
  const replyTo = typeof b.replyTo === "string" ? b.replyTo.trim() : "";
  return {
    id,
    // One Hive never handed out is a thread it does not know: a new conversation.
    thread: thread && thread.length <= MAX_ID_CHARS ? thread : null,
    replyTo: replyTo && replyTo.length <= 2 * MAX_ID_CHARS ? replyTo : null,
    tribe: { pubkey, name: tribeName(tribe?.name) },
    // A tribe tells members apart by alias, and may have none for one.
    alias: oneLine(b.alias, MAX_ALIAS_CHARS) || "A member",
    owner: b.owner === true,
    text,
    earlier,
    recent,
    images,
    unopened,
  };
}

/** The room before the mention as a text file, the newest lines that fit. */
function recentText(lines: RecentLine[]): string {
  const out: string[] = [];
  let bytes = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = `${lines[i].time ? `[${lines[i].time}] ` : ""}${lines[i].alias}: ${lines[i].text}`;
    bytes += Buffer.byteLength(line, "utf8") + 1;
    if (bytes > MAX_RECENT_BYTES) break;
    out.unshift(line);
  }
  return out.join("\n") + "\n";
}

/**
 * The room as a chat attachment: a text file under the workspace's canvas
 * uploads, as a call stores its transcript excerpt (`/api/calls/turn`), so
 * the user row shows it and `strutAttachments` reads it as the linker.
 */
async function storeRecent(workspaceId: string, lines: RecentLine[]): Promise<StoredAttachment> {
  const s3 = getS3Service();
  const filename = "tribe-recent.txt";
  const path = s3.generateCanvasUploadPath(workspaceId, filename);
  const bytes = Buffer.from(recentText(lines), "utf8");
  await s3.putObject(path, bytes, "text/plain; charset=utf-8");
  return { path, filename, mimeType: "text/plain", size: bytes.length };
}

/** The mention's files, stored where `recent` is, each as it came. */
async function storeImages(workspaceId: string, images: MentionImage[]): Promise<StoredAttachment[]> {
  const s3 = getS3Service();
  return Promise.all(
    images.map(async (image) => {
      const path = s3.generateCanvasUploadPath(workspaceId, image.name);
      await s3.putObject(path, image.bytes, image.mediaType);
      return { path, filename: image.name, mimeType: image.mediaType, size: image.bytes.length };
    }),
  );
}

/** What the agent is told about a file the daemon could not open; "" when none. */
function unopenedNote(alias: string, unopened: UnopenedFile[]): string {
  if (!unopened.length) return "";
  return `\n(${alias} sent ${unopened.map((u) => `${u.name}, which could not be opened: ${u.reason}`).join("; ")}.)`;
}

type Link = NonNullable<Awaited<ReturnType<typeof loadLink>>>;
type Thread = { id: string; conversationId: string };

const loadLink = (pubkey: string) =>
  db.tribeLink.findUnique({
    where: { tribePubkey: pubkey },
    select: { id: true, tribePubkey: true, name: true, orgId: true, workspaceSlug: true, userId: true },
  });

/** The conversation the message replies in, when its `thread` (else its post's) is one of this tribe's. */
const repliedThread = (link: Pick<Link, "id">, mention: Mention): Promise<Thread | null> => {
  const id = mention.thread ?? (mention.replyTo ? parseTribeMessageId(mention.replyTo)?.threadId : undefined);
  return id
    ? db.tribeThread.findFirst({ where: { id, tribeLinkId: link.id }, select: { id: true, conversationId: true } })
    : Promise.resolve(null);
};

const conversationRows = async (conversationId: string): Promise<unknown[]> => {
  const conversation = await db.sharedConversation.findUnique({
    where: { id: conversationId },
    select: { messages: true },
  });
  return Array.isArray(conversation?.messages) ? (conversation.messages as unknown[]) : [];
};

/**
 * The proposal a reply is about: the post `replyTo` names, when it is a
 * proposal's in this conversation; with no `replyTo` (the daemon sends the
 * conversation alone), the one proposal its newest turn left open. A
 * `replyTo` that is not an id Hive handed out is as none.
 */
function repliedProposal(rows: unknown[], thread: Thread, mention: Mention): PostedProposal | null {
  const post = mention.replyTo ? parseTribeMessageId(mention.replyTo) : null;
  if (!post) return lastOpenProposal(rows);
  return post.threadId === thread.id ? proposalOfRow(rows, post.rowId) : null;
}

/**
 * A reply to Jamie's proposal post that decides it
 * (`docs/plans/jamie-in-tribes.md`, "A proposal"), or null for any other
 * message, which takes a turn. Its words must be the card's own button
 * word or a plain accept / reject, and nothing else (`decisionOfText`);
 * a burst (`earlier`) is never one.
 *
 * The tribe's OWNER decides, as the person who linked the tribe, whom
 * every tribe turn runs as — on the turn's strut, as the card in Hive
 * does (`decideStrutProposal`), and only a turn that ran as them. The
 * decision row it writes is what tells the tribe the outcome (the
 * outbox posts it). Anyone else, or a proposal of someone else's turn,
 * gets a reply saying so, and no turn runs. A linker who can no longer
 * read the turn is the turn's to say (null).
 *
 * Taken once: the reply's id is recorded (`TribeMention`, folded under the
 * proposing turn) before strut is asked, so Jamie's retry is a duplicate;
 * a decide strut could not answer drops the record again and answers 502,
 * so Jamie retries. Already decided (409): the outcome, from strut's
 * record, unless the conversation has it.
 */
async function decideByReply(link: Link, mention: Mention): Promise<NextResponse | null> {
  if (mention.earlier.length > 0) return null;
  const thread = await repliedThread(link, mention);
  if (!thread) return null;
  const proposal = repliedProposal(await conversationRows(thread.conversationId), thread, mention);
  if (!proposal) return null;
  const action = decisionOfText(mention.text, { actions: proposal.actions, alias: jamieAccount()?.alias });
  if (!action) return null;

  const key = { tribeLinkId_mentionId: { tribeLinkId: link.id, mentionId: mention.id } };
  const taken = await db.tribeMention.findUnique({ where: key, select: { runId: true } });
  if (taken) return NextResponse.json({ duplicate: true, turn: taken.runId });
  const take = () =>
    db.tribeMention.create({
      data: { tribeLinkId: link.id, mentionId: mention.id, runId: proposal.runId, folded: true },
    });
  // A line under the reply, and the reply taken, together; `say`, once it is taken.
  const refuse = async (text: string) => {
    await db.$transaction([take(), queueTribeReply(link.tribePubkey, text, mention.id)]);
    return NextResponse.json({ refused: text });
  };
  const say = async (text: string, answer: Record<string, unknown> = { refused: text }) => {
    await queueTribeReply(link.tribePubkey, text, mention.id);
    return NextResponse.json(answer);
  };
  if (!mention.owner) return refuse(TRIBE_OWNER_DECIDES);

  const org = await db.sourceControlOrg.findUnique({ where: { id: link.orgId }, select: { githubLogin: true } });
  if (!org) return null;
  let row: ProposalTurnRow;
  try {
    row = await resolveProposalTurn({ githubLogin: org.githubLogin, userId: link.userId, runId: proposal.runId });
  } catch (err) {
    if (err instanceof StrutProposalError) return null;
    throw err;
  }
  if (row.userId !== link.userId) return refuse(TRIBE_DECIDED_IN_HIVE);

  await take();
  let outcome: DecideOutcome;
  try {
    outcome = await decideStrutProposal(row, proposal.proposalId, { action }, link.userId);
  } catch (err) {
    await db.tribeMention.delete({ where: key }).catch(() => undefined);
    if (err instanceof StrutProposalError) return NextResponse.json({ error: err.message }, { status: 502 });
    throw err;
  }
  console.log("[tribes/messages] decided", { proposal: proposal.proposalId, action, status: outcome.status });
  switch (outcome.status) {
    case 200:
      await appendProposalResultRow(row, outcome.proposal);
      // An accepted step wrote the graph: open canvases on that workspace read its plans again.
      if (action === "accept" && outcome.proposal.workspaceSlug) {
        notifyInitiativeUpdated(org.githubLogin, { workspaceSlug: outcome.proposal.workspaceSlug });
      }
      return NextResponse.json({ decided: outcome.proposal.status });
    case 409: {
      const record = outcome.proposal;
      // Still pending: strut's own words say what it waits for.
      if (!record || record.status === "pending") return say(outcome.error);
      // The conversation has the outcome (the tribe was told it): said again under this reply.
      if (hasDecisionRow(await conversationRows(thread.conversationId), record.id, record.status)) {
        const line = renderProposalResult(record.title, record.status, record.result?.error);
        return say(`Already decided. ${line}`, { decided: record.status });
      }
      await appendProposalResultRow(row, record);
      return NextResponse.json({ decided: record.status });
    }
    default:
      return say(`I couldn't decide that one: ${outcome.error}`);
  }
}

async function takeTurn(request: NextRequest, link: Link, mention: Mention): Promise<NextResponse> {
  const { userId, workspaceSlug, orgId } = link;

  const ids = [mention.id, ...mention.earlier.map((e) => e.id)];
  const taken = await db.tribeMention.findMany({
    where: { tribeLinkId: link.id, mentionId: { in: ids } },
    select: { mentionId: true, runId: true },
  });
  const seen = taken.find((t) => t.mentionId === mention.id);
  if (seen) return NextResponse.json({ duplicate: true, turn: seen.runId });
  // A message of the burst a turn already took is not said again.
  const earlier = mention.earlier.filter((e) => !taken.some((t) => t.mentionId === e.id));

  // Turns run as the person who linked the tribe, so they must still be
  // able to use its workspace — a link outlives a membership change.
  const access = await validateWorkspaceAccess(workspaceSlug, userId);
  if (!access.hasAccess || !access.canRead || !access.workspace) {
    await queueTribeNotice(link.tribePubkey, TRIBE_ACCESS_LOST_NOTICE, mention.id);
    return NextResponse.json({ error: "The person who linked this tribe can no longer use its workspace." }, { status: 403 });
  }

  // The conversation it replies in; else the one this mention (or one of
  // its burst) started on an earlier try (strut refused the launch); else a
  // new one, below.
  const thread =
    (await repliedThread(link, mention)) ??
    (await db.tribeThread.findFirst({
      where: { tribeLinkId: link.id, mentionId: { in: ids } },
      select: { id: true, conversationId: true },
    }));

  // Refused before anything is written: a message strut never gets would
  // sit in the conversation unanswered.
  if (thread && (await orchestratorHasLiveTurn(thread.conversationId))) {
    return NextResponse.json({ busy: ORCHESTRATOR_BUSY_NOTE }, { status: 409 });
  }

  const name = mention.tribe.name ?? link.name;
  if (mention.tribe.name && mention.tribe.name !== link.name) {
    await db.tribeLink.update({ where: { id: link.id }, data: { name: mention.tribe.name } });
  }

  const attachments = [
    ...(await storeImages(access.workspace.id, mention.images)),
    ...(mention.recent.length > 0 ? [await storeRecent(access.workspace.id, mention.recent)] : []),
  ];
  const message = [...earlier, mention].map((m) => `${m.alias}: ${m.text}`).join("\n") + unopenedNote(mention.alias, mention.unopened);
  const conversationId = await persistCanvasUserMessage({
    orgId,
    userId,
    existingRowId: thread?.conversationId ?? null,
    turnId: randomUUID(),
    content: message,
    attachments,
    workspaceSlugs: [workspaceSlug],
  });
  const threadId =
    thread?.id ??
    (await db.tribeThread.create({ data: { tribeLinkId: link.id, conversationId, mentionId: mention.id }, select: { id: true } })).id;

  const [user, model] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    loadUserChatAgentModel(userId),
  ]);
  const launched = await launchOrchestratorTurn({
    userId,
    orgId,
    conversationId,
    message,
    attachments,
    publicBaseUrl: getBaseUrl(request.headers.get("host")),
    timeZone: user?.timezone ?? undefined,
    ...(model ? { model } : {}),
    tribe: { name, alias: mention.alias, ...(mention.owner ? { owner: true } : {}) },
  });
  switch (launched.status) {
    case "started":
      await db.tribeMention.createMany({
        data: [
          { tribeLinkId: link.id, mentionId: mention.id, runId: launched.runId },
          ...earlier.map((e) => ({ tribeLinkId: link.id, mentionId: e.id, runId: launched.runId, folded: true })),
        ],
        skipDuplicates: true,
      });
      console.log("[tribes/messages] launched", { conversationId, thread: threadId, turn: launched.runId });
      return NextResponse.json({ turn: launched.runId, thread: threadId }, { status: 202 });
    case "busy":
      return NextResponse.json({ busy: launched.note }, { status: 409 });
    case "error":
      return NextResponse.json({ error: `The message could not be sent to strut: ${launched.error}` }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const refused = authorizeJamieRequest(request, "tribes/messages");
  if (refused) return refused;

  const mention = parseMention(await request.json().catch(() => null));
  if (typeof mention === "string") return NextResponse.json({ error: mention }, { status: 400 });

  // Unlinked tribes are refused for good: Jamie drops the mention.
  const linked = await loadLink(mention.tribe.pubkey);
  if (!linked) {
    return NextResponse.json({ error: "This tribe is not linked to an org." }, { status: 404 });
  }

  // From the dedupe to the launch, one turn at a time per conversation a
  // reply continues, and per tribe for mentions that start one: a retry
  // racing its first try would otherwise launch twice, or start a second
  // conversation. Turns of different conversations run side by side.
  const replied = await repliedThread(linked, mention);
  try {
    return await withLock(
      `tribe-turn:${mention.tribe.pubkey}:${replied ? replied.id : "new"}`,
      async () => {
        // The owner may have unlinked since.
        const link = await loadLink(mention.tribe.pubkey);
        if (!link) return NextResponse.json({ error: "This tribe is not linked to an org." }, { status: 404 });
        return (await decideByReply(link, mention)) ?? takeTurn(request, link, mention);
      },
      { ttlMs: 60_000, acquireTimeoutMs: 0 },
    );
  } catch (err) {
    if (err instanceof LockAcquireTimeoutError) {
      return NextResponse.json({ busy: ORCHESTRATOR_BUSY_NOTE }, { status: 409 });
    }
    console.error("[tribes/messages] failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
