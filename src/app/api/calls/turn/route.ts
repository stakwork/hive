import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loadUserChatAgentModel } from "@/lib/ai/resolve-model";
import type { CallRequestSource } from "@/lib/calls/callMessages";
import { peekCallRecord, setCallConversation, type CallRecord } from "@/lib/calls/callRecord";
import { authorizeCallRequest } from "@/lib/calls/callRequest";
import { LockAcquireTimeoutError, withLock } from "@/lib/locks/redis-lock";
import { ORCHESTRATOR_BUSY_NOTE } from "@/lib/strut-orchestrator";
import { getBaseUrl } from "@/lib/utils";
import type { StoredAttachment } from "@/services/canvas-turn-persistence";
import { persistCanvasUserMessage } from "@/services/org-canvas-conversation";
import { getS3Service } from "@/services/s3";
import { launchOrchestratorTurn, orchestratorHasLiveTurn } from "@/services/strut-orchestrator";
import { validateWorkspaceAccess } from "@/services/workspace";

/**
 * POST /api/calls/turn — Jamie on a voice call (sphinx-voice) hands what it
 * heard to strut's orchestrator, the way the chat does
 * (`docs/jamie-engine.md`). Machine-to-machine: the voice agent's key and
 * the call's callKey (`lib/calls/callRequest.ts`).
 *
 * The message is saved on the call's conversation as `"<speaker>: <text>"`
 * — the first turn creates it and records it on the call — with the
 * transcript excerpt, when there is one, as an ordinary chat attachment,
 * and who asked and how on the row (`CallRequestSource`), for the replay
 * to someone who joins (`/api/calls/messages?requests=1`).
 * Then one orchestrator turn is launched as the person who started the
 * call, with the call line on its context. The answer is at once: the reply
 * lands as rows, which voice reads from `/api/calls/messages`.
 */
export const maxDuration = 60;

const MAX_SPEAKER_CHARS = 200;
const MAX_TEXT_CHARS = 20_000;
const MAX_FILENAME_CHARS = 200;
/** An excerpt is minutes of talk; strut's own cap on a file is 10 MB. */
const MAX_TRANSCRIPT_BYTES = 1024 * 1024;

interface TurnBody {
  speaker: string;
  text: string;
  source: "voice" | "chat";
  transcript?: { name: string; text: string };
}

/** The body, or what is wrong with it. */
function parseTurnBody(raw: unknown): TurnBody | string {
  if (!raw || typeof raw !== "object") return "body must be a JSON object";
  const b = raw as Record<string, unknown>;
  // A name is shown before the message on one line: no line breaks in it.
  const speaker = typeof b.speaker === "string" ? b.speaker.replace(/\s+/g, " ").trim() : "";
  if (!speaker || speaker.length > MAX_SPEAKER_CHARS) return "speaker is required";
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return "text is required";
  if (text.length > MAX_TEXT_CHARS) return `text is over ${MAX_TEXT_CHARS} characters`;
  if (b.source !== "voice" && b.source !== "chat") return 'source must be "voice" or "chat"';
  if (b.transcript === undefined || b.transcript === null) return { speaker, text, source: b.source };
  const t = b.transcript as Record<string, unknown>;
  const name = typeof t?.name === "string" ? t.name.trim() : "";
  if (!name || name.length > MAX_FILENAME_CHARS || /[/\\]/.test(name)) return "transcript.name must be a file name";
  if (typeof t.text !== "string" || !t.text.trim()) return "transcript.text is required";
  if (Buffer.byteLength(t.text, "utf8") > MAX_TRANSCRIPT_BYTES) return "transcript.text is over 1 MB";
  return { speaker, text, source: b.source, transcript: { name, text: t.text } };
}

/**
 * The excerpt as a chat attachment: a text file under the workspace's
 * canvas uploads, the key a chat upload gets, so the user row shows it and
 * `strutAttachments` reads it as the call's creator (`canReadKey`).
 */
async function storeTranscript(workspaceId: string, transcript: { name: string; text: string }): Promise<StoredAttachment> {
  const s3 = getS3Service();
  const path = s3.generateCanvasUploadPath(workspaceId, transcript.name);
  const bytes = Buffer.from(transcript.text, "utf8");
  await s3.putObject(path, bytes, "text/plain; charset=utf-8");
  return { path, filename: transcript.name, mimeType: "text/plain", size: bytes.length };
}

async function takeTurn(
  request: NextRequest,
  callKey: string,
  record: CallRecord,
  orgId: string,
  body: TurnBody,
): Promise<NextResponse> {
  const { userId, workspaceSlug } = record;

  // Turns run as the person who started the call, so they must still be
  // able to use its workspace — a call outlives a membership change.
  const access = await validateWorkspaceAccess(workspaceSlug, userId);
  if (!access.hasAccess || !access.canRead || !access.workspace) {
    return NextResponse.json({ error: "The person who started this call can no longer use its workspace." }, { status: 403 });
  }

  // Refused before anything is written: a message strut never gets would
  // sit in the conversation unanswered.
  if (record.conversationId && (await orchestratorHasLiveTurn(record.conversationId))) {
    return NextResponse.json({ busy: ORCHESTRATOR_BUSY_NOTE }, { status: 409 });
  }

  const attachments = body.transcript ? [await storeTranscript(access.workspace.id, body.transcript)] : [];
  const message = `${body.speaker}: ${body.text}`;
  const source: CallRequestSource = { kind: "call_request", speaker: body.speaker, via: body.source };
  const conversationId = await persistCanvasUserMessage({
    orgId,
    userId,
    existingRowId: record.conversationId,
    turnId: randomUUID(),
    content: message,
    attachments,
    source,
    workspaceSlugs: [workspaceSlug],
  });
  if (!record.conversationId) await setCallConversation(callKey, record, conversationId);

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
    call: true,
  });
  switch (launched.status) {
    case "started":
      console.log("[calls/turn] launched", { conversationId, turn: launched.runId, source: body.source });
      return NextResponse.json({ turn: launched.runId }, { status: 202 });
    case "busy":
      return NextResponse.json({ busy: launched.note }, { status: 409 });
    case "error":
      return NextResponse.json({ error: `The message could not be sent to strut: ${launched.error}` }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeCallRequest(request, "calls/turn");
  if (auth instanceof NextResponse) return auth;
  const { callKey } = auth;

  const body = parseTurnBody(await request.json().catch(() => null));
  if (typeof body === "string") return NextResponse.json({ error: body }, { status: 400 });

  // The orchestrator's conversation and its strut both belong to an org.
  const orgId = auth.record.orgId;
  if (!orgId) {
    return NextResponse.json(
      { error: "This call's workspace is not linked to a GitHub org, so Jamie cannot act on it." },
      { status: 400 },
    );
  }

  // One turn of a call at a time, from the busy check to the launch: two
  // first turns at once would otherwise each create a conversation.
  try {
    return await withLock(
      `call-turn:${callKey}`,
      async () => {
        // Another turn may have created the conversation since the gate read the record.
        const record = (await peekCallRecord(callKey)) ?? auth.record;
        return takeTurn(request, callKey, record, orgId, body);
      },
      { ttlMs: 60_000, acquireTimeoutMs: 0 },
    );
  } catch (err) {
    if (err instanceof LockAcquireTimeoutError) {
      return NextResponse.json({ busy: ORCHESTRATOR_BUSY_NOTE }, { status: 409 });
    }
    console.error("[calls/turn] failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
