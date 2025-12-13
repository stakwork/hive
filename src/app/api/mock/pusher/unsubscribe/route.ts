/**
 * Mock Pusher Unsubscribe Endpoint
 * 
 * Removes a client subscription from a channel.
 * Stops event delivery for this subscriber.
 * 
 * Only active when USE_MOCKS=true
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/env';
import { pusherMockState } from '@/lib/mock/pusher-state';

const USE_MOCKS = config.USE_MOCKS;

export async function POST(request: NextRequest) {
  // Mock gating - return 404 if mocks are disabled
  if (!USE_MOCKS) {
    return NextResponse.json(
      { error: 'Mock endpoints are disabled' },
      { status: 404 }
    );
  }

  try {
    const body = await request.json();
    const { subscriberId } = body;

    if (!subscriberId) {
      return NextResponse.json(
        { error: 'Missing required parameter: subscriberId' },
        { status: 400 }
      );
    }

    // Unsubscribe
    const success = pusherMockState.unsubscribe(subscriberId);

    return NextResponse.json({
      success,
      subscriberId,
    });
  } catch (error) {
    console.error('Mock Pusher unsubscribe error:', error);
    return NextResponse.json(
      { error: 'Failed to unsubscribe' },
      { status: 500 }
    );
  }
}
