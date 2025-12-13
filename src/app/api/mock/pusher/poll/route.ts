/**
 * Mock Pusher Poll Endpoint
 * 
 * Polls for new events on a channel.
 * Returns events that haven't been delivered to this subscriber.
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
    const searchParams = request.nextUrl.searchParams;
    const channel = searchParams.get('channel');
    const subscriberId = searchParams.get('subscriberId');
    const sinceParam = searchParams.get('since');

    if (!channel || !subscriberId) {
      return NextResponse.json(
        { error: 'Missing required parameters: channel, subscriberId' },
        { status: 400 }
      );
    }

    // Parse since timestamp
    const since = sinceParam ? new Date(sinceParam) : undefined;

    // Poll for new events
    const events = pusherMockState.poll(channel, subscriberId, since);

    return NextResponse.json({
      events: events.map(e => ({
        id: e.id,
        channel: e.channel,
        event: e.event,
        data: e.data,
        timestamp: e.timestamp.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Mock Pusher poll error:', error);
    return NextResponse.json(
      { error: 'Failed to poll events' },
      { status: 500 }
    );
  }
}
