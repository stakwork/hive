import { config, optionalEnvVars } from "@/config/env";
import { db } from "@/lib/db";
import { mintOrgToken } from "@/lib/mcp/orgTokenMint";
import { callRoomName, dispatchCallAgent, dropCallToken, storeCallToken } from "@/lib/calls/callAgent";
import { dropCallRecord, storeCallRecord } from "@/lib/calls/callRecord";
import jwt from "jsonwebtoken";

export type StartCallResult =
  | { url: string }
  | { status: number; error: string; reason?: string };

/**
 * Start a Jamie call in a workspace on behalf of a user: checks access and
 * swarm, mints the call's Hive token, stores it and the call record behind an
 * opaque callKey, and dispatches Jamie into the room. Shared by the session
 * route (generate-link) and the strut device route.
 *
 * Scope "org" (default) mints an org token for the workspace's
 * SourceControlOrg; "workspace" signs a single-workspace JWT. Both carry
 * `userId` so membership is re-checked at use time.
 */
export async function startCall({
  userId,
  slug,
  scope = "org",
}: {
  userId: string;
  slug: string;
  scope?: "org" | "workspace";
}): Promise<StartCallResult> {
  // Get workspace with swarm info
  const workspace = await db.workspace.findFirst({
    where: {
      slug,
      deleted: false,
    },
    include: {
      swarm: {
        select: {
          name: true,
          status: true,
        },
      },
      members: {
        where: {
          userId: userId,
          leftAt: null,
        },
      },
    },
  });

  if (!workspace) {
    return { status: 404, error: "Workspace not found" };
  }

  // Check user has access (owner or member)
  if (workspace.ownerId !== userId && workspace.members.length === 0) {
    return { status: 403, error: "Access denied" };
  }

  // Validate swarm exists and is active
  if (!workspace.swarm || workspace.swarm.status !== "ACTIVE") {
    return { status: 400, error: "Swarm not configured or not active" };
  }

  if (!workspace.swarm.name || workspace.swarm.name.trim() === "") {
    return { status: 400, error: "Swarm name not found" };
  }

  // Get LiveKit base URL from environment
  const liveKitBaseUrl = optionalEnvVars.LIVEKIT_CALL_BASE_URL;
  if (!liveKitBaseUrl) {
    return { status: 500, error: "LiveKit call service not configured", reason: "livekit_unconfigured" };
  }

  // Mint a short-lived JWT for the agent to authenticate with the Hive API.
  //
  // Default scope is "org": the token is keyed to the workspace's
  // SourceControlOrg so the call agent can drive the org-wide `org_agent`
  // tool across every workspace in the org. Pass `?scope=workspace` to fall
  // back to a single-workspace token (the legacy swarm-tool surface).
  //
  // Both shapes carry `userId` so `verifyJwt`/`verifyOrgJwt` can re-check
  // membership at use time (memberships can be revoked between mint and use).
  let hiveToken: string;
  if (scope === "workspace") {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return { status: 500, error: "JWT secret not configured" };
    }
    hiveToken = jwt.sign(
      { slug, userId: userId },
      jwtSecret,
      { expiresIn: "4h" },
    );
  } else {
    if (!workspace.sourceControlOrgId) {
      return { status: 400, error: "Workspace is not linked to a source-control org" };
    }

    const outcome = await mintOrgToken({
      orgId: workspace.sourceControlOrgId,
      userId: userId,
      requestedPermissions: ["read", "write"],
      purpose: "call-link",
    });

    if (!outcome.ok) {
      switch (outcome.error) {
        case "JWT_SECRET_MISSING":
          return { status: 500, error: "JWT secret not configured" };
        case "ORG_MEMBERSHIP_REQUIRED":
          return { status: 403, error: "Access denied" };
        case "INVALID_PERMISSIONS":
          return { status: 400, error: "Invalid permission value" };
        default:
          return { status: 500, error: "Failed to mint org token" };
      }
    }

    hiveToken = outcome.token;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const callUrl = `${liveKitBaseUrl}${workspace.swarm.name}.sphinx.chat-.${timestamp}`;

  // The token never goes in the URL: the link is pasted to whoever is
  // invited. It is stored behind an opaque callKey, and Jamie is
  // dispatched into the link's room with that key in its dispatch
  // metadata (`lib/calls/callAgent.ts`). The same key names the call's
  // record, which the call endpoints act on (`lib/calls/callRecord.ts`):
  // its turns run as this user. Mock mode has no LiveKit to dispatch to.
  if (!config.USE_MOCKS) {
    const roomName = callRoomName(callUrl);
    let callKey: string;
    try {
      callKey = await storeCallToken(hiveToken);
      await storeCallRecord(callKey, {
        userId: userId,
        orgId: workspace.sourceControlOrgId ?? null,
        workspaceSlug: slug,
        roomName,
      });
    } catch (err) {
      console.error("[startCall] Redis write failed:", err);
      return { status: 500, error: "Internal server error" };
    }
    try {
      await dispatchCallAgent(roomName, callKey);
    } catch (err) {
      console.error("[startCall] Jamie dispatch failed:", err);
      await Promise.all([dropCallToken(callKey), dropCallRecord(callKey)]).catch(() => undefined);
      return { status: 502, error: "Could not start Jamie for the call" };
    }
  }

  return { url: callUrl };
}
