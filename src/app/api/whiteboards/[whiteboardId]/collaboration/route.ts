import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { checkWhiteboardAccessCached } from "@/lib/helpers/whiteboard-access";
import { pusherServer, getWhiteboardChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import {
  getActivePresence,
  recordHeartbeat,
  recordLeave,
} from "@/lib/whiteboard/presence-store";
import type { CollaborationEventPayload } from "@/types/whiteboard-collaboration";

interface ElementsBroadcastPayload {
  type: "elements";
  elements: unknown[];
  appState: Record<string, unknown>;
  senderId: string;
}

type RequestPayload = CollaborationEventPayload | ElementsBroadcastPayload;

/** Pusher message bodies are capped at 10KB. */
const PUSHER_MAX_PAYLOAD_BYTES = 10_240;

/**
 * POST /api/whiteboards/[whiteboardId]/collaboration
 * Handle ephemeral collaboration events (cursor updates, join/leave, element broadcasts).
 * These are broadcast via Pusher but not persisted to the database.
 *
 * Authorization: requires authenticated user AND workspace membership for the
 * target whiteboard. The membership check is cached in-memory (60s TTL) so the
 * cursor-update hot path is not bottlenecked on Postgres.
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

    const access = await checkWhiteboardAccessCached(whiteboardId, userOrResponse.id);
    if (access === "not-found") {
      return NextResponse.json({ error: "Whiteboard not found" }, { status: 404 });
    }
    if (access === "forbidden") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const body = (await request.json()) as RequestPayload;

    const channelName = getWhiteboardChannelName(whiteboardId);

    switch (body.type) {
      case "elements": {
        recordHeartbeat(whiteboardId, {
          userId: userOrResponse.id,
          name: userOrResponse.name ?? null,
          image: null,
        });
        const payload = {
          senderId: body.senderId,
          elements: body.elements,
          appState: body.appState || {},
          version: 0,
        };

        // Pusher rejects messages over ~10KB. Surface this to the client so it
        // can fall back to the debounced DB save path (and warn the user that
        // their last change won't appear instantly for collaborators).
        const payloadSize = new TextEncoder().encode(JSON.stringify(payload)).length;
        if (payloadSize > PUSHER_MAX_PAYLOAD_BYTES) {
          return NextResponse.json(
            {
              error: "Payload too large for real-time broadcast",
              skipped: true,
              reason: "payload_too_large",
              maxBytes: PUSHER_MAX_PAYLOAD_BYTES,
              payloadBytes: payloadSize,
            },
            { status: 413 },
          );
        }

        await pusherServer.trigger(channelName, PUSHER_EVENTS.WHITEBOARD_ELEMENTS_UPDATE, payload);
        break;
      }

      case "cursor":
        if (body.cursor) {
          recordHeartbeat(whiteboardId, {
            userId: userOrResponse.id,
            name: userOrResponse.name ?? null,
            image: null,
            color: body.color,
          });
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
          recordHeartbeat(whiteboardId, {
            userId: userOrResponse.id,
            name: userOrResponse.name ?? body.user.name ?? null,
            image: body.user.image ?? null,
            color: body.user.color,
            joinedAt: body.user.joinedAt,
          });
          await pusherServer.trigger(channelName, PUSHER_EVENTS.WHITEBOARD_USER_JOIN, {
            user: {
              ...body.user,
              odinguserId: userOrResponse.id,
              name: userOrResponse.name || body.user.name,
              image: body.user.image,
            },
            ...(body.rebroadcast && { rebroadcast: true }),
          });
        }
        break;

      case "leave":
        recordLeave(whiteboardId, userOrResponse.id);
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

/**
 * GET /api/whiteboards/[whiteboardId]/collaboration
 * Returns the currently-active collaborators for a whiteboard, excluding the
 * caller. Used by clients on mount to populate their collaborator list
 * reliably, instead of relying on best-effort presence rebroadcasts. Only
 * returns presence for users seen by *this* server instance — see the note in
 * `presence-store.ts` for the multi-instance caveat.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ whiteboardId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { whiteboardId } = await params;

    const access = await checkWhiteboardAccessCached(whiteboardId, userOrResponse.id);
    if (access === "not-found") {
      return NextResponse.json({ error: "Whiteboard not found" }, { status: 404 });
    }
    if (access === "forbidden") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const collaborators = getActivePresence(whiteboardId, userOrResponse.id).map((entry) => ({
      odinguserId: entry.userId,
      name: entry.name ?? "Anonymous",
      image: entry.image,
      color: entry.color,
      joinedAt: entry.joinedAt,
    }));

    return NextResponse.json({ success: true, collaborators });
  } catch (error) {
    console.error("Error fetching whiteboard presence:", error);
    return NextResponse.json(
      { error: "Failed to fetch whiteboard presence" },
      { status: 500 }
    );
  }
}
