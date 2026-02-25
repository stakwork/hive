import { NextRequest, NextResponse } from "next/server";
import { pusherServer, getFeatureChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import type { CollaboratorInfo } from "@/types/whiteboard-collaboration";

type PresencePayload =
  | { type: "join"; user: CollaboratorInfo; rebroadcast?: boolean }
  | { type: "leave" };

/**
 * POST /api/features/[featureId]/presence
 * Broadcast ephemeral presence events (join/leave) for plan collaboration.
 * No database writes - presence is managed in-memory on connected clients.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ featureId: string }> }
): Promise<NextResponse> {
  try {
    // Get middleware context and require auth
    const middlewareContext = getMiddlewareContext(request);
    const userOrResponse = await requireAuth(middlewareContext);
    
    if (userOrResponse instanceof NextResponse) {
      return userOrResponse;
    }

    const params = await context.params;
    const featureId = params.featureId;

    if (!featureId) {
      return NextResponse.json(
        { error: "Feature ID is required" },
        { status: 400 }
      );
    }

    const body = (await request.json()) as PresencePayload;

    const channelName = getFeatureChannelName(featureId);

    if (body.type === "join") {
      // Broadcast user join event
      await pusherServer.trigger(channelName, PUSHER_EVENTS.PLAN_USER_JOIN, {
        user: {
          ...body.user,
          odinguserId: userOrResponse.id,
          name: userOrResponse.name || body.user.name,
        },
        ...(body.rebroadcast === true ? { rebroadcast: true } : {}),
      });

      return NextResponse.json({ success: true });
    }

    if (body.type === "leave") {
      // Broadcast user leave event
      await pusherServer.trigger(channelName, PUSHER_EVENTS.PLAN_USER_LEAVE, {
        userId: userOrResponse.id,
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "Invalid presence type" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error handling plan presence:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
