/**
 * PusherServerMock - Mock implementation of server-side Pusher
 *
 * Implements the same interface as the real Pusher library's server class.
 * Routes trigger() calls to the PusherMockState for in-memory event broadcasting.
 *
 * Compatible with existing server-side Pusher usage:
 * - pusherServer.trigger(channel, event, data)
 * - pusherServer.triggerBatch([{ channel, name, data }])
 */

import { pusherMockState } from "./pusher-state";

export interface TriggerResponse {
  channels: Record<string, {}>;
}

export interface BatchResponse {
  batch: Array<{}>;
}

export interface Event {
  channel: string;
  name: string;
  data: any;
  socketId?: string;
}

export interface PusherServerConfig {
  appId?: string;
  key?: string;
  secret?: string;
  cluster?: string;
  useTLS?: boolean;
}

export class PusherServerMock {
  private config: PusherServerConfig;

  constructor(config: PusherServerConfig = {}) {
    this.config = config;
    console.log("[Pusher Mock Server] Initialized with mock mode");
  }

  /**
   * Trigger an event on one or more channels
   *
   * @param channels - Single channel name or array of channel names
   * @param event - Event name to trigger
   * @param data - Data payload to send with event
   * @param params - Additional parameters (socketId, etc.)
   * @returns Promise resolving to trigger response
   */
  async trigger(
    channels: string | string[],
    event: string,
    data: any,
    params?: { socketId?: string }
  ): Promise<TriggerResponse> {
    const channelArray = Array.isArray(channels) ? channels : [channels];

    console.log(
      `[Pusher Mock Server] trigger() called for event "${event}" on ${channelArray.length} channel(s)`
    );

    // Trigger event on each channel
    const results = await Promise.all(
      channelArray.map((channel) => pusherMockState.trigger(channel, event, data))
    );

    // Combine results into single response
    const combinedResponse: TriggerResponse = {
      channels: {},
    };

    channelArray.forEach((channel, index) => {
      combinedResponse.channels[channel] = {};
    });

    return combinedResponse;
  }

  /**
   * Trigger multiple events in a single batch
   *
   * @param batch - Array of events to trigger
   * @returns Promise resolving to batch response
   */
  async triggerBatch(batch: Event[]): Promise<BatchResponse> {
    console.log(
      `[Pusher Mock Server] triggerBatch() called with ${batch.length} events`
    );

    return pusherMockState.triggerBatch(
      batch.map((event) => ({
        channel: event.channel,
        name: event.name,
        data: event.data,
      }))
    );
  }

  /**
   * Get mock configuration
   */
  getConfig(): PusherServerConfig {
    return this.config;
  }
}
