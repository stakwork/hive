/**
 * Mock Pusher Subscribe Endpoint
 * 
 * Registers a client subscription to a channel.
 * Allows clients to start polling for events.
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
    const { channel, subscriberId } = body;

    if (!channel || !subscriberId) {
      return NextResponse.json(
        { error: 'Missing required parameters: channel, subscriberId' },
        { status: 400 }
      );
    }

    // Register subscription
    pusherMockState.subscribe(channel, subscriberId);

    return NextResponse.json({
      success: true,
      channel,
      subscriberId,
    });
  } catch (error) {
    console.error('Mock Pusher subscribe error:', error);
    return NextResponse.json(
      { error: 'Failed to subscribe' },
      { status: 500 }
    );
  }
}
