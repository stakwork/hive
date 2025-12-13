/**
 * Mock Pusher Trigger Endpoint
 * 
 * Simulates Pusher's server-side trigger API.
 * Stores events in mock state for client polling.
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
    const { channel, event, data } = body;

    if (!channel || !event) {
      return NextResponse.json(
        { error: 'Missing required parameters: channel, event' },
        { status: 400 }
      );
    }

    // Trigger event in mock state
    const eventId = pusherMockState.trigger(channel, event, data);

    // Return success response matching Pusher API format
    return NextResponse.json({
      event_ids: {
        [channel]: eventId,
      },
    });
  } catch (error) {
    console.error('Mock Pusher trigger error:', error);
    return NextResponse.json(
      { error: 'Failed to trigger event' },
      { status: 500 }
    );
  }
}
