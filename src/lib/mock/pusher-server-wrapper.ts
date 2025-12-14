/**
 * Pusher Server Mock Wrapper
 * 
 * Mimics the pusher npm package server interface for local development and testing.
 * Routes events through PusherMockState for synchronous in-memory delivery.
 */

import { pusherMockState } from "./pusher-state";

/**
 * Mock implementation of Pusher server
 * Implements the minimal interface needed by the application
 */
export class PusherServerMock {
  constructor(config?: any) {
    // Accept config for compatibility but don't use it
  }

  /**
   * Trigger an event on a channel
   * @param channel Channel name
   * @param event Event name
   * @param data Event payload
   */
  async trigger(
    channel: string | string[],
    event: string,
    data: any
  ): Promise<any> {
    // Handle both single channel and array of channels
    const channels = Array.isArray(channel) ? channel : [channel];

    // Trigger on all channels
    channels.forEach((ch) => {
      pusherMockState.trigger(ch, event, data);
    });

    // Return mock response matching Pusher API
    return {
      channels: channels.reduce((acc, ch) => {
        acc[ch] = {};
        return acc;
      }, {} as Record<string, any>),
    };
  }

  /**
   * Trigger batch events
   * @param batch Array of event objects
   */
  async triggerBatch(batch: Array<{ channel: string; name: string; data: any }>): Promise<any> {
    batch.forEach(({ channel, name, data }) => {
      pusherMockState.trigger(channel, name, data);
    });

    return {
      batch: batch.map(({ channel }) => ({ channel, success: true })),
    };
  }

  /**
   * Get info about channels (not implemented - returns empty)
   */
  async get(options: any): Promise<any> {
    return {
      channels: {},
    };
  }
}
