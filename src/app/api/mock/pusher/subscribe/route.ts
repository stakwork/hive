import { NextRequest, NextResponse } from "next/server";
import { mockPusherState } from "@/lib/mock/pusher-state";
import { logger } from "@/lib/logger";

/**
 * POST /api/mock/pusher/subscribe
 * 
 * Mock endpoint for Pusher channel subscription.
 * Returns subscription confirmation with ID.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { channel } = body;

    if (!channel) {
      return NextResponse.json(
        { error: "Missing required field: channel" },
        { status: 400 }
      );
    }

    const subscription = mockPusherState.subscribe(channel);

    logger.debug("[MockPusher API] Channel subscribed", "MockPusherAPI", {
      channel,
      subscriptionId: subscription.subscriptionId,
    });

    return NextResponse.json({
      success: true,
      subscription: {
        channel: subscription.channel,
        subscriptionId: subscription.subscriptionId,
        subscribedAt: subscription.subscribedAt,
      },
    });
  } catch (error) {
    logger.error("[MockPusher API] Subscribe error", "MockPusherAPI", { error });
    return NextResponse.json(
      { error: "Failed to subscribe to channel" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/mock/pusher/subscribe?subscriptionId={id}
 * 
 * Mock endpoint for Pusher channel unsubscription.
 */
export async function DELETE(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const subscriptionId = searchParams.get("subscriptionId");

    if (!subscriptionId) {
      return NextResponse.json(
        { error: "Missing required parameter: subscriptionId" },
        { status: 400 }
      );
    }

    mockPusherState.unsubscribe(subscriptionId);

    logger.debug("[MockPusher API] Channel unsubscribed", "MockPusherAPI", {
      subscriptionId,
    });

    return NextResponse.json({
      success: true,
      subscriptionId,
    });
  } catch (error) {
    logger.error("[MockPusher API] Unsubscribe error", "MockPusherAPI", { error });
    return NextResponse.json(
      { error: "Failed to unsubscribe from channel" },
      { status: 500 }
    );
  }
}
