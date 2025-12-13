/**
 * Mock Pusher Debug Endpoint
 * 
 * Returns current mock state for debugging and testing.
 * Shows channels, events, and subscribers.
 * 
 * Only active when USE_MOCKS=true
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/env';
import { pusherMockState } from '@/lib/mock/pusher-state';

const USE_MOCKS = config.USE_MOCKS;

export async function GET(request: NextRequest) {
  // Mock gating - return 404 if mocks are disabled
  if (!USE_MOCKS) {
    return NextResponse.json(
      { error: 'Mock endpoints are disabled' },
      { status: 404 }
    );
  }

  try {
    const debugInfo = pusherMockState.getDebugInfo();
    const subscribers = pusherMockState.getSubscribers();

    return NextResponse.json({
      ...debugInfo,
      subscriberDetails: subscribers.map(s => ({
        subscriberId: s.subscriberId,
        channel: s.channel,
        lastPollTimestamp: s.lastPollTimestamp.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Mock Pusher debug error:', error);
    return NextResponse.json(
      { error: 'Failed to get debug info' },
      { status: 500 }
    );
  }
}
