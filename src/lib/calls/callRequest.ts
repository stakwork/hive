import { NextRequest, NextResponse } from "next/server";
import { carriesVoiceAgentKey } from "@/lib/calls/callAgent";
import { loadCallRecord, type CallRecord } from "@/lib/calls/callRecord";

/**
 * The gate of the call endpoints (`/api/calls/turn`, `messages`, `cancel`):
 * the voice agent's own key (`Authorization: Bearer <VOICE_AGENT_API_KEY>`)
 * AND a callKey naming a live call record (`X-Call-Key`). Either alone is
 * worth nothing: the agent key acts on no call, and a callKey a room admin
 * read off a dispatch has no key beside it. The callKey is a header, never
 * part of a URL, so it stays out of request logs. A request that passes
 * refreshes the record's lifetime.
 */
export async function authorizeCallRequest(
  request: NextRequest,
  tag: string,
): Promise<{ callKey: string; record: CallRecord } | NextResponse> {
  if (!process.env.VOICE_AGENT_API_KEY) {
    console.error(`[${tag}] VOICE_AGENT_API_KEY is not configured`);
    return NextResponse.json({ error: "Call endpoints are not configured" }, { status: 503 });
  }
  if (!carriesVoiceAgentKey(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const callKey = request.headers.get("x-call-key")?.trim() ?? "";
  const record = callKey ? await loadCallRecord(callKey) : null;
  if (!record) {
    return NextResponse.json({ error: "call not found or expired" }, { status: 404 });
  }
  return { callKey, record };
}
