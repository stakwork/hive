import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { pusherServer, PUSHER_EVENTS } from "@/lib/pusher";
import {
  recordHeartbeat,
  recordLeave,
  getActivePresence,
} from "@/lib/canvas/presence-store";
import { logger } from "@/lib/logger";
import { getCanvasPresenceChannelName } from "@/lib/canvas/presence-channel";

type RequestPayload =
  | { type: "join"; canvasRef: string; user: { id: string; name: string; color: string; image?: string | null } }
  | { type: "leave"; canvasRef: string }
  | { type: "cursor"; canvasRef: string; senderId: string; cursor: { x: number; y: number }; color: string }
  | { type: "selection"; canvasRef: string; senderId: string; selectedNodeId: string | null };

/**
 * GET /api/orgs/[githubLogin]/canvas/collaboration?canvasRef=<ref>
 *
 * Returns the currently-active collaborators for the given canvas room,
 * excluding the caller. Used by clients to seed presence on join.
 *
 * Authorization: requires authenticated user AND org membership (IDOR guard).
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
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const canvasRef = request.nextUrl.searchParams.get("canvasRef") ?? "";
    const roomKey = `${githubLogin}:${canvasRef || "root"}`;

    const entries = getActivePresence(roomKey, userOrResponse.id);

    return NextResponse.json({
      collaborators: entries.map((e) => ({
        userId: e.userId,
        name: e.name ?? "",
        color: e.color ?? "#999",
        image: e.image ?? null,
      })),
    });
  } catch (error) {
    logger.error("Error fetching canvas presence", "canvas/collaboration", { error });
    return NextResponse.json(
      { error: "Failed to fetch presence" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/orgs/[githubLogin]/canvas/collaboration
 *
 * Handles ephemeral canvas presence events (join, leave, cursor, selection).
 * Events are broadcast via Pusher but never persisted to the database.
 *
 * Authorization: requires authenticated user AND org membership.
 */
export async function POST(
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
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const body = (await request.json()) as RequestPayload;
    const { canvasRef } = body;
    const roomKey = `${githubLogin}:${canvasRef || "root"}`;
    const channelName = getCanvasPresenceChannelName(githubLogin, canvasRef);

    switch (body.type) {
      case "join": {
        const { user } = body;
        recordHeartbeat(roomKey, {
          userId: userOrResponse.id,
          name: userOrResponse.name ?? user.name ?? null,
          color: user.color,
          image: user.image ?? null,
        });
        await pusherServer.trigger(channelName, PUSHER_EVENTS.CANVAS_USER_JOIN, {
          user: {
            id: userOrResponse.id,
            name: userOrResponse.name || user.name,
            color: user.color,
            image: user.image ?? null,
          },
        });
        logger.info(
          `[canvas/presence] ${userOrResponse.name ?? userOrResponse.id} joined canvas ${githubLogin}:${canvasRef || "root"}`,
        );
        break;
      }

      case "leave": {
        recordLeave(roomKey, userOrResponse.id);
        await pusherServer.trigger(channelName, PUSHER_EVENTS.CANVAS_USER_LEAVE, {
          userId: userOrResponse.id,
        });
        logger.info(
          `[canvas/presence] ${userOrResponse.id} left canvas ${githubLogin}:${canvasRef || "root"}`,
        );
        break;
      }

      case "cursor": {
        recordHeartbeat(roomKey, {
          userId: userOrResponse.id,
          name: userOrResponse.name ?? null,
          color: body.color,
        });
        await pusherServer.trigger(channelName, PUSHER_EVENTS.CANVAS_CURSOR_UPDATE, {
          senderId: userOrResponse.id,
          cursor: body.cursor,
          color: body.color,
        });
        // High-frequency — no logging
        break;
      }

      case "selection": {
        await pusherServer.trigger(channelName, PUSHER_EVENTS.CANVAS_SELECTION_UPDATE, {
          senderId: userOrResponse.id,
          selectedNodeId: body.selectedNodeId,
        });
        // No logging
        break;
      }

      default:
        return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Error handling canvas collaboration event", "canvas/collaboration", { error });
    return NextResponse.json(
      { error: "Failed to handle collaboration event" },
      { status: 500 },
    );
  }
}
