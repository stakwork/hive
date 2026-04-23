import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { checkWhiteboardAccessCached } from "@/lib/helpers/whiteboard-access";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { signRelayToken } from "@/lib/relay-token";
import { getRelayUrl } from "@/lib/utils/swarm";

const TOKEN_TTL_SECONDS = 300;

/**
 * GET /api/whiteboards/[whiteboardId]/relay-token
 *
 * Issues a short-lived JWT the browser passes in the socket.io handshake to
 * the per-swarm relay at `:3333`. Signed HS256 with the swarm's
 * `swarmApiKey`, so cross-swarm forgery is rejected at the verifier.
 *
 * Returns { token, url, expiresInSeconds }. The token is capability-scoped to
 * exactly one whiteboard via the `resource` claim.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ whiteboardId: string }> },
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { whiteboardId } = await params;

    const access = await checkWhiteboardAccessCached(
      whiteboardId,
      userOrResponse.id,
    );
    if (access === "not-found") {
      return NextResponse.json(
        { error: "Whiteboard not found" },
        { status: 404 },
      );
    }
    if (access === "forbidden") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const whiteboard = await db.whiteboard.findUnique({
      where: { id: whiteboardId },
      select: { workspaceId: true },
    });
    if (!whiteboard) {
      return NextResponse.json(
        { error: "Whiteboard not found" },
        { status: 404 },
      );
    }

    const swarmAccess = await getSwarmAccessByWorkspaceId(
      whiteboard.workspaceId,
    );
    if (!swarmAccess.success) {
      return NextResponse.json(
        { error: "Relay unavailable", reason: swarmAccess.error.type },
        { status: 503 },
      );
    }
    if (!swarmAccess.data.swarmApiKey) {
      return NextResponse.json(
        { error: "Relay unavailable", reason: "SWARM_API_KEY_MISSING" },
        { status: 503 },
      );
    }
    if (!swarmAccess.data.swarmName) {
      return NextResponse.json(
        { error: "Relay unavailable", reason: "SWARM_NAME_MISSING" },
        { status: 503 },
      );
    }

    const token = signRelayToken(
      {
        userId: userOrResponse.id,
        name: userOrResponse.name,
        image: null,
        resource: `whiteboard:${whiteboardId}`,
      },
      swarmAccess.data.swarmApiKey,
      TOKEN_TTL_SECONDS,
    );

    return NextResponse.json({
      token,
      url: getRelayUrl(swarmAccess.data.swarmName, swarmAccess.data.swarmUrl),
      expiresInSeconds: TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    console.error("Error issuing relay token:", error);
    return NextResponse.json(
      { error: "Failed to issue relay token" },
      { status: 500 },
    );
  }
}
