import { NextRequest, NextResponse } from "next/server";
import { carriesVoiceAgentKey, readCallToken } from "@/lib/calls/callAgent";

// Machine-to-machine — no session. Jamie (sphinx-voice) trades the callKey
// it got in its LiveKit dispatch metadata for the Hive token behind it
// (`lib/calls/callAgent.ts`). The callKey alone is not enough: the caller
// must also present the voice agent's own key, so a callKey that leaks
// (a room admin can list a room's dispatches) cannot be traded by anyone
// else. POST, so the callKey stays out of URLs and request logs. Not
// GETDEL: Jamie re-exchanges when it rejoins during the same call.
export async function POST(request: NextRequest) {
  if (!process.env.VOICE_AGENT_API_KEY) {
    console.error("[exchange-token] VOICE_AGENT_API_KEY is not configured");
    return NextResponse.json({ error: "Call token exchange is not configured" }, { status: 503 });
  }
  if (!carriesVoiceAgentKey(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { callKey?: unknown } | null;
  const callKey = typeof body?.callKey === "string" ? body.callKey.trim() : "";
  if (!callKey) {
    return NextResponse.json({ error: "callKey is required" }, { status: 400 });
  }

  const hiveToken = await readCallToken(callKey);
  if (!hiveToken) {
    console.warn("[exchange-token] callKey not found or expired");
    return NextResponse.json({ error: "Token not found or expired" }, { status: 401 });
  }

  return NextResponse.json({ hiveToken }, { status: 200 });
}
