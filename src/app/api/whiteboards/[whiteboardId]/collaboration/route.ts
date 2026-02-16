import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { pusherServer, getWhiteboardChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { CollaborationEventPayload } from "@/types/whiteboard-collaboration";

interface ElementsBroadcastPayload {
  type: "elements";
  elements: unknown[];
  appState: Record<string, unknown>;
  senderId: string;
}

type RequestPayload = CollaborationEventPayload | ElementsBroadcastPayload;

/**
 * POST /api/whiteboards/[whiteboardId]/collaboration
 * Handle ephemeral collaboration events (cursor updates, join/leave, element broadcasts)
 * These are broadcast via Pusher but not persisted to the database.
 *
 * Skips database access check for speed - auth middleware verifies the user is authenticated,
 * and whiteboard access is implicitly trusted for ephemeral real-time events.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ whiteboardId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { whiteboardId } = await params;
    const body = (await request.json()) as RequestPayload;

    const channelName = getWhiteboardChannelName(whiteboardId);

    switch (body.type) {
      case "elements": {
        const payload = {
          senderId: body.senderId,
          elements: body.elements,
          appState: body.appState || {},
          version: 0,
        };

        // Check payload size before sending to avoid Pusher 413 errors (10KB limit)
        const payloadSize = new TextEncoder().encode(JSON.stringify(payload)).length;
        if (payloadSize > 10240) {
          // Payload too large for real-time broadcast - skip silently.
          // The debounced DB save will persist the data, and other clients
          // will receive updates on their next fetch or smaller delta updates.
          return NextResponse.json({ success: true, skipped: true, reason: "payload_too_large" });
        }

        await pusherServer.trigger(channelName, PUSHER_EVENTS.WHITEBOARD_ELEMENTS_UPDATE, payload);
        break;
      }

      case "cursor":
        if (body.cursor) {
          await pusherServer.trigger(channelName, PUSHER_EVENTS.WHITEBOARD_CURSOR_UPDATE, {
            senderId: body.senderId || `${userOrResponse.id}-${Date.now()}`,
            cursor: body.cursor,
            color: body.color || "#666666",
            username: userOrResponse.name,
          });
        }
        break;

      case "join":
        if (body.user) {
          await pusherServer.trigger(channelName, PUSHER_EVENTS.WHITEBOARD_USER_JOIN, {
            user: {
              ...body.user,
              odinguserId: userOrResponse.id,
              name: userOrResponse.name || body.user.name,
              image: body.user.image,
            },
          });
        }
        break;

      case "leave":
        await pusherServer.trigger(channelName, PUSHER_EVENTS.WHITEBOARD_USER_LEAVE, {
          userId: userOrResponse.id,
        });
        break;

      default:
        return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error handling collaboration event:", error);
    return NextResponse.json(
      { error: "Failed to handle collaboration event" },
      { status: 500 }
    );
  }
}
