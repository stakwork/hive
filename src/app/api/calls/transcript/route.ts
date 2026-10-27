import { NextRequest, NextResponse } from "next/server";
import { callTranscriptWorkflowName } from "@/lib/calls/callAgent";
import { callRecordTtl } from "@/lib/calls/callRecord";
import { authorizeCallRequest } from "@/lib/calls/callRequest";
import { redis } from "@/lib/redis";
import { getBaseUrl } from "@/lib/utils";
import { validateWorkspaceAccess } from "@/services/workspace";
import { StrutDispatchError, dispatchStrutRun } from "@/services/strut-runs";

/**
 * POST /api/calls/transcript — when a call ends, the voice agent sends its
 * transcript (NDJSON, one utterance per line) and hive hands it to a strut
 * workflow (`CALL_TRANSCRIPT_STRUT_WORKFLOW_NAME`) as a run attachment.
 * Hive keeps no copy of the text. With the env unset, or a call with no
 * org, the answer is `{ status: "off" }` and nothing happens.
 *
 * Idempotent per (callKey, LiveKit job id): a retry gets the first answer.
 */
export const maxDuration = 60;

const MAX_NAME_CHARS = 200;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;

interface TranscriptBody {
  id: string;
  startedAt: string;
  endedAt: string;
  name: string;
  text: string;
  lines: number;
  speakers: string[];
}

const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** The body, or what is wrong with it. */
function parseBody(raw: unknown): TranscriptBody | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "body must be a JSON object";
  const b = raw as Record<string, unknown>;
  if (typeof b.id !== "string" || !b.id.trim()) return "id is required";
  if (!isIso(b.startedAt)) return "startedAt must be an ISO date";
  if (!isIso(b.endedAt)) return "endedAt must be an ISO date";
  const name = b.name;
  if (
    typeof name !== "string" ||
    !name ||
    name.length > MAX_NAME_CHARS ||
    /[/\\]/.test(name) ||
    name === "." ||
    name === ".."
  ) {
    return "name must be a file name";
  }
  const text = b.text;
  if (typeof text !== "string" || !text.trim()) return "text is required";
  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) return "text is over 4 MB";

  let lines = 0;
  const speakers: string[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      return `text line ${i + 1} is not JSON`;
    }
    if (!o || typeof o !== "object" || Array.isArray(o)) return `text line ${i + 1} is not an object`;
    const l = o as Record<string, unknown>;
    if (typeof l.n !== "number") return `text line ${i + 1}: n must be a number`;
    for (const f of ["at", "speaker", "source", "text"]) {
      if (typeof l[f] !== "string") return `text line ${i + 1}: ${f} must be a string`;
    }
    lines++;
    if (!speakers.includes(l.speaker as string)) speakers.push(l.speaker as string);
  }
  return { id: b.id, startedAt: b.startedAt, endedAt: b.endedAt, name, text, lines, speakers };
}

export async function POST(request: NextRequest) {
  const auth = await authorizeCallRequest(request, "calls/transcript");
  if (auth instanceof NextResponse) return auth;
  const { callKey, record } = auth;

  const workflow = callTranscriptWorkflowName();
  if (!workflow || !record.orgId) return NextResponse.json({ status: "off" });

  const body = parseBody(await request.json().catch(() => null));
  if (typeof body === "string") return NextResponse.json({ error: body }, { status: 400 });

  const access = await validateWorkspaceAccess(record.workspaceSlug, record.userId);
  if (!access.hasAccess || !access.canRead || !access.workspace) {
    return NextResponse.json({ error: "The person who started this call can no longer use its workspace." }, { status: 403 });
  }

  const key = `call-transcript:${callKey}:${body.id}`;
  const ttl = Math.max(1, callRecordTtl(record));
  try {
    const claimed = await redis.set(key, "pending", "EX", ttl, "NX");
    if (claimed === null) {
      const existing = await redis.get(key);
      if (!existing || existing === "pending") {
        return NextResponse.json({ error: "This transcript is already being sent; retry shortly." }, { status: 503 });
      }
      return NextResponse.json(JSON.parse(existing));
    }
  } catch (err) {
    console.error("[calls/transcript] idempotency failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  try {
    const launched = await dispatchStrutRun({
      workspaceId: access.workspace.id,
      userId: record.userId,
      kind: "call_transcript",
      workflow,
      purpose: "call_transcript",
      input: {
        room: record.roomName,
        workspace: record.workspaceSlug,
        conversation: record.conversationId ?? null,
        startedAt: body.startedAt,
        endedAt: body.endedAt,
        lines: body.lines,
        speakers: body.speakers,
        file: body.name,
      },
      attachments: [
        { name: body.name, mediaType: "application/x-ndjson", data: Buffer.from(body.text, "utf8").toString("base64") },
      ],
      publicBaseUrl: getBaseUrl(request.headers.get("host")),
    });
    const response = { run: launched.runId };
    await redis.set(key, JSON.stringify(response), "EX", ttl).catch((e) =>
      console.error("[calls/transcript] could not record the response:", e),
    );
    console.log("[calls/transcript] launched", { run: launched.runId, lines: body.lines });
    return NextResponse.json(response, { status: 202 });
  } catch (err) {
    await redis.del(key).catch(() => undefined);
    if (err instanceof StrutDispatchError) {
      const status = err.code === "no_target" || err.code === "workflow_missing" ? 422 : 502;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[calls/transcript] failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
