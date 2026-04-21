import { AccessToken } from "livekit-server-sdk";
import jwt from "jsonwebtoken";
import { NextRequest, NextResponse } from "next/server";
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

  // Pass MCP server config via participant metadata so the agent can make
  // authenticated MCP calls on behalf of this user's workspace.
  at.metadata = JSON.stringify({
    mcpServers: [
      {
        name: "hive",
        url: process.env.HIVE_MCP_URL || "https://hive.sphinx.chat/mcp",
        token: hiveToken,
      },
    ],
  });

  const token = await at.toJwt();
  return NextResponse.json({ token, roomName });
}
