/**
 * Mock Pusher Server
 * 
 * Mimics the server-side Pusher API for triggering events without requiring real Pusher credentials.
 * Works with PusherMockState singleton to enable event broadcasting.
 * 
 * Features:
 * - Event triggering to single or multiple channels
 * - Compatible with existing server-side Pusher code
 * - Automatic broadcast to all subscribed clients via mock state
 */

import { pusherMockState } from "./pusher-state";

interface TriggerOptions {
  socket_id?: string;
  info?: string;
}

interface TriggerResponse {
  channels: Record<string, {}>;
}

/**
 * Mock Pusher Server class mimicking server-side Pusher
 */
export class MockPusherServer {
  constructor(
    public config: {
      appId: string;
      key: string;
      secret: string;
      cluster: string;
      useTLS: boolean;
    }
  ) {
    // Constructor matches real Pusher signature
  }

  /**
   * Trigger an event on one or more channels
   */
  async trigger(
    channels: string | string[],
    event: string,
    data: any,
    options?: TriggerOptions
  ): Promise<TriggerResponse> {
    const channelArray = Array.isArray(channels) ? channels : [channels];

    // Trigger event on each channel via mock state
    channelArray.forEach(channel => {
      pusherMockState.trigger(channel, event, data);
    });

    // Return response matching real Pusher API
    const response: TriggerResponse = {
      channels: {},
    };
    channelArray.forEach(channel => {
      response.channels[channel] = {};
    });

    return response;
  }

  /**
   * Trigger a batch of events (batch API)
   */
  async triggerBatch(
    batch: Array<{
      channel: string;
      name: string;
      data: any;
      socket_id?: string;
    }>
  ): Promise<TriggerResponse> {
    const channels: string[] = [];

    // Trigger each event in the batch
    batch.forEach(item => {
      pusherMockState.trigger(item.channel, item.name, item.data);
      if (!channels.includes(item.channel)) {
        channels.push(item.channel);
      }
    });

    // Return response matching real Pusher API
    const response: TriggerResponse = {
      channels: {},
    };
    channels.forEach(channel => {
      response.channels[channel] = {};
    });

    return response;
  }

  /**
   * Get channel info (simplified mock implementation)
   */
  async get(options: { path: string; params?: any }): Promise<any> {
    // Simplified implementation - return basic channel info
    if (options.path.startsWith("/channels")) {
      const channels = pusherMockState.getActiveChannels();
      return {
        channels: channels.reduce((acc, channel) => {
          acc[channel] = {
            user_count: pusherMockState.getSubscriberCount(channel),
          };
          return acc;
        }, {} as Record<string, { user_count: number }>),
      };
    }

    return {};
  }

  /**
   * Authenticate a private or presence channel (not implemented in mock)
   */
  authenticate(socketId: string, channel: string, data?: any): any {
    // Return mock auth signature
    return {
      auth: `mock-auth:${socketId}:${channel}`,
    };
  }

  /**
   * Authorize a presence channel (not implemented in mock)
   */
  authorizeChannel(socketId: string, channel: string, data?: any): any {
    // Return mock auth signature with presence data
    return {
      auth: `mock-auth:${socketId}:${channel}`,
      channel_data: JSON.stringify(data || {}),
    };
  }
}
