import { AccessToken } from "livekit-server-sdk";
import jwt from "jsonwebtoken";
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";

export async function POST(req: NextRequest) {
  const context = getMiddlewareContext(req);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { slug } = await req.json();
  if (!slug || typeof slug !== "string") {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
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
  const hiveToken = jwt.sign({ slug }, jwtSecret, { expiresIn: "4h" });

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
