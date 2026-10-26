import { AccessToken } from "livekit-server-sdk";
import jwt from "jsonwebtoken";
import { NextRequest, NextResponse } from "next/server";
import { dispatchCallAgent, dropCallToken, storeCallToken } from "@/lib/calls/callAgent";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccess } from "@/services/workspace";

export async function POST(req: NextRequest) {
  const context = getMiddlewareContext(req);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { slug } = await req.json();
  if (!slug || typeof slug !== "string") {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  // IDOR hardening: the JWT minted below grants MCP access to the workspace
  // keyed by `slug` (see `src/lib/mcp/handler.ts` `verifyJwt`). Require the
  // caller to be a member of that workspace before signing — otherwise any
  // signed-in user can drive MCP against any workspace they can name.
  const access = await validateWorkspaceAccess(slug, userOrResponse.id);
  if (!access.hasAccess || !access.canRead) {
    return NextResponse.json(
      { error: "Workspace not found or access denied" },
      { status: 404 },
    );
  }

  const roomName = `hive-${slug}-${Date.now()}`;
  const participantIdentity = userOrResponse.id;
  const participantName = context.user?.name || "User";

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity: participantIdentity,
      name: participantName,
      ttl: "24h",
    },
  );

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  // Mint a short-lived JWT for the agent to authenticate with the Hive MCP API
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return NextResponse.json({ error: "JWT secret not configured" }, { status: 500 });
  }
  // Embed the acting user so `verifyJwt` can re-check workspace membership
  // at use time (memberships can be revoked between mint and use).
  const hiveToken = jwt.sign(
    { slug, userId: userOrResponse.id },
    jwtSecret,
    { expiresIn: "4h" },
  );

  // Hand the token to Jamie, never to the room: participant metadata is
  // readable by every participant. It is stored behind an opaque callKey
  // that rides in Jamie's dispatch metadata (`lib/calls/callAgent.ts`).
  let callKey: string;
  try {
    callKey = await storeCallToken(hiveToken);
  } catch (err) {
    console.error("[livekit-token] Redis write failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  try {
    await dispatchCallAgent(roomName, callKey);
  } catch (err) {
    console.error("[livekit-token] Jamie dispatch failed:", err);
    await dropCallToken(callKey).catch(() => undefined);
    return NextResponse.json({ error: "Could not start the voice agent" }, { status: 502 });
  }

  const token = await at.toJwt();
  return NextResponse.json({ token, roomName });
}
