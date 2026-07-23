import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { signRelayToken } from "@/lib/relay-token";
import { getRelayUrl } from "@/lib/utils/swarm";

const TOKEN_TTL_SECONDS = 300;

/**
 * GET /api/orgs/[githubLogin]/canvas/relay-token
 *
 * Issues a short-lived JWT the browser passes in the socket.io handshake
 * to the per-swarm relay. Capability-scoped to exactly this org's canvas
 * via the `resource` claim (`canvas:<githubLogin>`), so the relay only
 * lets the socket join that one room. Signed HS256 with the org's home
 * swarm's `swarmApiKey` (org -> defaultWorkspace -> swarm).
 *
 * Returns { token, url, expiresInSeconds }.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ githubLogin: string }> },
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { githubLogin } = await params;

    const isMember = await validateUserBelongsToOrg(githubLogin, userOrResponse.id);
    if (!isMember) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    const org = await db.sourceControlOrg.findUnique({
      where: { githubLogin },
      select: { defaultWorkspaceId: true },
    });
    if (!org?.defaultWorkspaceId) {
      return NextResponse.json(
        { error: "Relay unavailable", reason: "NO_DEFAULT_WORKSPACE" },
        { status: 503 },
      );
    }

    const swarmAccess = await getSwarmAccessByWorkspaceId(org.defaultWorkspaceId);
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
        resource: `canvas:${githubLogin}`,
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
    console.error("Error issuing canvas relay token:", error);
    return NextResponse.json(
      { error: "Failed to issue relay token" },
      { status: 500 },
    );
  }
}
