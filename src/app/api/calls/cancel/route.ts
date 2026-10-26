import { StrutRunStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizeCallRequest } from "@/lib/calls/callRequest";
import { ORCHESTRATOR_TURN_KIND } from "@/lib/strut-orchestrator";
import { cancelPendingStrutRunsForConversation } from "@/services/strut-runs";

/**
 * POST /api/calls/cancel — "Jamie, stop": stop the turn the call's
 * conversation has in flight. Machine-to-machine, gated like
 * `/api/calls/turn`.
 *
 * The composer Stop's own cancel (`/api/ask/abort`, per turn): the strut
 * runs of the call's creator on the conversation since the live turn
 * started — the turn itself, never a job an earlier turn started, which
 * keeps running. Strut's callback then settles the turn as stopped, and its
 * row says so.
 */
export async function POST(request: NextRequest) {
  const auth = await authorizeCallRequest(request, "calls/cancel");
  if (auth instanceof NextResponse) return auth;
  const { conversationId, userId } = auth.record;
  if (!conversationId) return NextResponse.json({ cancelled: false });

  const live = await db.strutRun.findFirst({
    where: { conversationId, kind: ORCHESTRATOR_TURN_KIND, status: StrutRunStatus.PENDING },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (!live) return NextResponse.json({ cancelled: false });

  const { cancelled } = await cancelPendingStrutRunsForConversation(conversationId, { userId, since: live.createdAt });
  return NextResponse.json({ cancelled: cancelled > 0 });
}
