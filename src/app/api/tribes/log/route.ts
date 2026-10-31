import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { authorizeJamieRequest } from "@/lib/tribes/jamie";
import {
  batchAliases,
  batchFile,
  MAX_BATCH_BYTES,
  parseBatch,
  TRIBE_LOG_FILE,
  tribeMessagesWorkflowName,
} from "@/lib/tribes/tribeLog";
import { getBaseUrl } from "@/lib/utils";
import { StrutDispatchError, dispatchStrutRun } from "@/services/strut-runs";
import { validateWorkspaceAccess } from "@/services/workspace";

/**
 * POST /api/tribes/log — Jamie, a member of a linked Sphinx tribe
 * (stakwork/sphinx `wasm/daemon`, with `DAEMON_LOG=on`), hands Hive what was
 * said there, a batch at a time (`docs/plans/jamie-in-tribes.md`, "The
 * log"): every message from the link on, members' and Jamie's own, oldest
 * first. Hive hands each batch to a strut workflow on the org's strut
 * (`TRIBE_MESSAGES_STRUT_WORKFLOW_NAME`) as a run attachment, launched as the
 * person who linked the tribe — the call transcript's flow
 * (`/api/calls/transcript`). Hive keeps no copy of the text. With the env
 * unset the answer is `{ status: "off" }` and nothing happens.
 *
 * Machine-to-machine: Jamie's token (`lib/tribes/jamie.ts`).
 *
 * Body:
 *   { batch, tribe: { pubkey, name? }, messages: [{ id, time, alias?, owner?,
 *     mine?, text, replyTo?, thread?, deleted? }] }
 * `batch` is the daemon's id for it: a retry carries the same one and gets
 * the first answer. A message's `id` is the one members hold, so the
 * workflow can key what it keeps by it. A line with `deleted: true` (and no
 * text) says a message an earlier batch carried was deleted since: what the
 * workflow kept under that `id` goes.
 *
 * Answers, as the daemon reads them (2xx: done; 429, 5xx: retry; other 4xx: drop):
 *   202 { run }           launched
 *   200 { run }           a retry of a batch already launched
 *   200 { status: "off" } the env is unset
 *   400                   not a batch
 *   403                   the linker can no longer use the workspace
 *   404                   the tribe is not linked (any more)
 *   422                   no strut for the org, or it has no such workflow
 *   502                   strut refused or could not be reached
 *   503                   this batch is being sent right now
 */
export const maxDuration = 60;

/**
 * How long an attempt holds its batch as "pending": longer than
 * `maxDuration`, so a launch that died mid-way frees the batch for the
 * daemon's retry.
 */
const PENDING_TTL_SECONDS = 120;
/** How long a launched batch's answer is kept for a retry. */
const DONE_TTL_SECONDS = 24 * 3600;

export async function POST(request: NextRequest) {
  const refused = authorizeJamieRequest(request, "tribes/log");
  if (refused) return refused;

  const workflow = tribeMessagesWorkflowName();
  if (!workflow) return NextResponse.json({ status: "off" });

  const body = parseBatch(await request.json().catch(() => null));
  if (typeof body === "string") return NextResponse.json({ error: body }, { status: 400 });
  const file = batchFile(body.messages);
  if (Buffer.byteLength(file, "utf8") > MAX_BATCH_BYTES) {
    return NextResponse.json({ error: "messages are over 4 MB" }, { status: 400 });
  }

  // Unlinked tribes are refused for good: Jamie drops the batch.
  const link = await db.tribeLink.findUnique({
    where: { tribePubkey: body.tribe.pubkey },
    select: { name: true, tribeHost: true, workspaceSlug: true, userId: true },
  });
  if (!link) return NextResponse.json({ error: "This tribe is not linked to an org." }, { status: 404 });

  // Runs launch as the person who linked the tribe, so they must still be
  // able to use its workspace — a link outlives a membership change.
  const access = await validateWorkspaceAccess(link.workspaceSlug, link.userId);
  if (!access.hasAccess || !access.canRead || !access.workspace) {
    return NextResponse.json(
      { error: "The person who linked this tribe can no longer use its workspace." },
      { status: 403 },
    );
  }

  const key = `tribe-log:${body.tribe.pubkey}:${body.batch}`;
  try {
    const claimed = await redis.set(key, "pending", "EX", PENDING_TTL_SECONDS, "NX");
    if (claimed === null) {
      const existing = await redis.get(key);
      if (!existing || existing === "pending") {
        return NextResponse.json({ error: "This batch is already being sent; retry shortly." }, { status: 503 });
      }
      return NextResponse.json(JSON.parse(existing));
    }
  } catch (err) {
    console.error("[tribes/log] idempotency failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const { messages } = body;
  try {
    const launched = await dispatchStrutRun({
      workspaceId: access.workspace.id,
      userId: link.userId,
      kind: "tribe_messages",
      workflow,
      purpose: "tribe_messages",
      input: {
        tribe: { pubkey: body.tribe.pubkey, name: body.tribe.name ?? link.name, host: link.tribeHost },
        workspace: link.workspaceSlug,
        from: messages[0].time,
        to: messages[messages.length - 1].time,
        messages: messages.length,
        aliases: batchAliases(messages),
        file: TRIBE_LOG_FILE,
      },
      attachments: [
        { name: TRIBE_LOG_FILE, mediaType: "application/x-ndjson", data: Buffer.from(file, "utf8").toString("base64") },
      ],
      publicBaseUrl: getBaseUrl(request.headers.get("host")),
    });
    const response = { run: launched.runId };
    await redis
      .set(key, JSON.stringify(response), "EX", DONE_TTL_SECONDS)
      .catch((e) => console.error("[tribes/log] could not record the response:", e));
    console.log("[tribes/log] launched", { run: launched.runId, tribe: body.tribe.pubkey, messages: messages.length });
    return NextResponse.json(response, { status: 202 });
  } catch (err) {
    await redis.del(key).catch(() => undefined);
    if (err instanceof StrutDispatchError) {
      const status = err.code === "no_target" || err.code === "workflow_missing" ? 422 : 502;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[tribes/log] failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
