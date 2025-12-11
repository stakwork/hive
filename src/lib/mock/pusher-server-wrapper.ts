/**
 * Pusher Server Mock Wrapper
 * 
 * Provides a mock implementation of the Pusher server-side API
 * Routes all events to the in-memory mock state manager
 */

import { pusherMockState } from "./pusher-state";

export class PusherServerMock {
  /**
   * Trigger an event on one or more channels
   * Matches the Pusher server API signature
   */
  async trigger(
    channels: string | string[],
    event: string,
    data: any,
    socketId?: string
  ): Promise<{ status: number; body: Record<string, any> }> {
    // Normalize to array
    const channelList = Array.isArray(channels) ? channels : [channels];

    // Trigger on each channel via state manager
    channelList.forEach((channel) => {
      pusherMockState.trigger(channel, event, data);
    });

    // Log in development mode
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[Pusher Mock] Triggered event "${event}" on channels:`,
        channelList
      );
    }

    // Return success response matching Pusher API
    return {
      status: 200,
      body: {},
    };
  }

  /**
   * Trigger batch events (stub - not commonly used)
   */
  async triggerBatch(
    batch: Array<{
      channel: string;
      name: string;
      data: any;
      socketId?: string;
    }>
  ): Promise<{ status: number; body: Record<string, any> }> {
    // Process each batch item
    for (const item of batch) {
      pusherMockState.trigger(item.channel, item.name, item.data);
    }

    return {
      status: 200,
      body: {},
    };
  }

  /**
   * Get channel info (stub)
   */
  async get(options?: {
    path: string;
    params?: Record<string, any>;
  }): Promise<{ status: number; body: Record<string, any> }> {
    // Basic implementation for testing
    if (options?.path?.includes("/channels")) {
      const channels = pusherMockState.getChannels();
      return {
        status: 200,
        body: {
          channels: channels.reduce(
            (acc, channel) => {
              acc[channel] = {};
              return acc;
            },
            {} as Record<string, any>
          ),
        },
      };
    }

    return {
      status: 200,
      body: {},
    };
  }

  /**
   * Webhook authentication (stub)
   */
  webhook(request: { headers: Record<string, string>; rawBody: string }): {
    valid: boolean;
  } {
    // Mock always validates successfully
    return { valid: true };
  }
}
