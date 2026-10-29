import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loadUserChatAgentModel } from "@/lib/ai/resolve-model";
import { LockAcquireTimeoutError, withLock } from "@/lib/locks/redis-lock";
import { ORCHESTRATOR_BUSY_NOTE } from "@/lib/strut-orchestrator";
import { authorizeJamieRequest, SPHINX_PUBKEY_RE } from "@/lib/tribes/jamie";
import { queueTribeNotice, TRIBE_ACCESS_LOST_NOTICE, tribeName } from "@/lib/tribes/tribeLinks";
import { getBaseUrl } from "@/lib/utils";
import type { StoredAttachment } from "@/services/canvas-turn-persistence";
import { persistCanvasUserMessage } from "@/services/org-canvas-conversation";
import { getS3Service } from "@/services/s3";
import { launchOrchestratorTurn, orchestratorHasLiveTurn } from "@/services/strut-orchestrator";
import { validateWorkspaceAccess } from "@/services/workspace";

/**
 * POST /api/tribes/messages — Jamie, a member of a linked Sphinx tribe
 * (stakwork/sphinx `wasm/daemon`), hands Hive a message that mentions it
 * (`docs/plans/jamie-in-tribes.md`, "A mention"). Machine-to-machine:
 * Jamie's token (`lib/tribes/jamie.ts`).
 *
 * The call turn route's flow (`/api/calls/turn`) on the tribe's link: the
 * message is saved on the tribe's conversation as `"<alias>: <text>"` — the
 * first turn creates it — with the room before it (`recent`) as a text
 * attachment, and one orchestrator turn is launched as the person who
 * linked the tribe, with the tribe line on its context. The mention's id is
 * recorded against the turn, so the reply, which Jamie reads from
 * `/api/tribes/outbox`, threads under it.
 *
 * Answers, as the daemon reads them:
 *   202 { turn }       taken
 *   200 { duplicate }  a mention already taken (a retry whose answer was lost)
 *   409 { busy }       a turn of the tribe is still live; Jamie offers it again
 *   403                the linker can no longer use the workspace (a notice goes to the tribe)
 *   404                the tribe is not linked (any more)
 *   400                not a mention
 *   502                strut refused the launch; Jamie retries
 */
export const maxDuration = 60;

const MAX_ID_CHARS = 200;
const MAX_ALIAS_CHARS = 200;
const MAX_TEXT_CHARS = 20_000;
/** The daemon sends 30 lines and 8 KB at most; this is the room for a wider one. */
const MAX_RECENT_LINES = 200;
const MAX_RECENT_BYTES = 64 * 1024;

interface RecentLine {
  alias: string;
  time: string;
  text: string;
}

interface Mention {
  id: string;
  tribe: { pubkey: string; name: string | null };
  alias: string;
  owner: boolean;
  text: string;
  recent: RecentLine[];
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
  if (b.recent !== undefined && b.recent !== null && !Array.isArray(b.recent)) return "recent must be a list";
  const recent: RecentLine[] = [];
  for (const line of Array.isArray(b.recent) ? b.recent.slice(-MAX_RECENT_LINES) : []) {
    const l = line as Record<string, unknown> | null;
    if (typeof l?.text !== "string" || !l.text.trim()) continue;
    recent.push({ alias: oneLine(l.alias, MAX_ALIAS_CHARS) || "?", time: oneLine(l.time, 64), text: l.text.trim() });
  }
  return {
    id,
    tribe: { pubkey, name: tribeName(tribe?.name) },
    // A tribe tells members apart by alias, and may have none for one.
    alias: oneLine(b.alias, MAX_ALIAS_CHARS) || "A member",
    owner: b.owner === true,
    text,
    recent,
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

type Link = NonNullable<Awaited<ReturnType<typeof loadLink>>>;

const loadLink = (pubkey: string) =>
  db.tribeLink.findUnique({
    where: { tribePubkey: pubkey },
    select: { id: true, tribePubkey: true, name: true, orgId: true, workspaceSlug: true, userId: true, conversationId: true },
  });

async function takeTurn(request: NextRequest, link: Link, mention: Mention): Promise<NextResponse> {
  const { userId, workspaceSlug, orgId } = link;

  const seen = await db.tribeMention.findUnique({
    where: { tribeLinkId_mentionId: { tribeLinkId: link.id, mentionId: mention.id } },
    select: { runId: true },
  });
  if (seen) return NextResponse.json({ duplicate: true, turn: seen.runId });

  // Turns run as the person who linked the tribe, so they must still be
  // able to use its workspace — a link outlives a membership change.
  const access = await validateWorkspaceAccess(workspaceSlug, userId);
  if (!access.hasAccess || !access.canRead || !access.workspace) {
    await queueTribeNotice(link.tribePubkey, TRIBE_ACCESS_LOST_NOTICE, mention.id);
    return NextResponse.json({ error: "The person who linked this tribe can no longer use its workspace." }, { status: 403 });
  }

  // Refused before anything is written: a message strut never gets would
  // sit in the conversation unanswered.
  if (link.conversationId && (await orchestratorHasLiveTurn(link.conversationId))) {
    return NextResponse.json({ busy: ORCHESTRATOR_BUSY_NOTE }, { status: 409 });
  }

  const name = mention.tribe.name ?? link.name;
  if (mention.tribe.name && mention.tribe.name !== link.name) {
    await db.tribeLink.update({ where: { id: link.id }, data: { name: mention.tribe.name } });
  }

  const attachments = mention.recent.length > 0 ? [await storeRecent(access.workspace.id, mention.recent)] : [];
  const message = `${mention.alias}: ${mention.text}`;
  const conversationId = await persistCanvasUserMessage({
    orgId,
    userId,
    existingRowId: link.conversationId,
    turnId: randomUUID(),
    content: message,
    attachments,
    workspaceSlugs: [workspaceSlug],
  });
  if (!link.conversationId) {
    await db.tribeLink.update({ where: { id: link.id }, data: { conversationId, cursor: null, readAt: null } });
  }

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
      await db.tribeMention.create({ data: { tribeLinkId: link.id, mentionId: mention.id, runId: launched.runId } });
      console.log("[tribes/messages] launched", { conversationId, turn: launched.runId });
      return NextResponse.json({ turn: launched.runId }, { status: 202 });
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
  if (!(await loadLink(mention.tribe.pubkey))) {
    return NextResponse.json({ error: "This tribe is not linked to an org." }, { status: 404 });
  }

  // One turn of a tribe at a time, from the dedupe to the launch: two first
  // turns at once would otherwise each create a conversation.
  try {
    return await withLock(
      `tribe-turn:${mention.tribe.pubkey}`,
      async () => {
        // Another turn may have created the conversation, or the owner unlinked, since.
        const link = await loadLink(mention.tribe.pubkey);
        if (!link) return NextResponse.json({ error: "This tribe is not linked to an org." }, { status: 404 });
        return takeTurn(request, link, mention);
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
