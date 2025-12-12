/**
 * Pusher Client Mock Wrapper
 * 
 * Provides a mock implementation of the pusher-js client library
 * Mimics the Channel and Pusher client API
 */

import { pusherMockState } from "./pusher-state";

class MockChannelClient {
  private bindings: Map<string, Set<Function>> = new Map();

  constructor(
    private channelName: string,
    private subscriberId: string
  ) {}

  /**
   * Bind a callback to an event
   */
  bind(event: string, callback: Function): this {
    if (!this.bindings.has(event)) {
      this.bindings.set(event, new Set());
    }
    this.bindings.get(event)!.add(callback);

    // Register with state manager
    pusherMockState.bind(this.subscriberId, this.channelName, event, callback);

    return this;
  }

  /**
   * Unbind a callback or all callbacks for an event
   */
  unbind(event?: string, callback?: Function): this {
    if (!event) {
      // Unbind all events
      this.bindings.forEach((_, evt) => {
        pusherMockState.unbind(this.subscriberId, this.channelName, evt);
      });
      this.bindings.clear();
    } else if (callback) {
      // Unbind specific callback
      this.bindings.get(event)?.delete(callback);
      pusherMockState.unbind(
        this.subscriberId,
        this.channelName,
        event,
        callback
      );
    } else {
      // Unbind all callbacks for event
      this.bindings.delete(event);
      pusherMockState.unbind(this.subscriberId, this.channelName, event);
    }

    return this;
  }

  /**
   * Unbind all callbacks (alias for unbind with no args)
   */
  unbind_all(): this {
    return this.unbind();
  }
}

export class PusherClientMock {
  private subscriberId: string;
  private channels: Map<string, MockChannelClient> = new Map();

  constructor(key: string, options?: any) {
    // Generate unique subscriber ID
    this.subscriberId = `mock-client-${Date.now()}-${Math.random()
      .toString(36)
      .substring(7)}`;

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[Pusher Mock] Client initialized with ID: ${this.subscriberId}`
      );
    }
  }

  /**
   * Subscribe to a channel
   */
  subscribe(channelName: string): MockChannelClient {
    if (!this.channels.has(channelName)) {
      // Register with state manager
      pusherMockState.subscribe(channelName, this.subscriberId);

      // Create channel client
      const channel = new MockChannelClient(channelName, this.subscriberId);
      this.channels.set(channelName, channel);

      if (process.env.NODE_ENV === "development") {
        console.log(
          `[Pusher Mock] Subscribed to channel: ${channelName}`
        );
      }
    }

    return this.channels.get(channelName)!;
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channelName: string): void {
    if (this.channels.has(channelName)) {
      // Unregister from state manager
      pusherMockState.unsubscribe(this.subscriberId, channelName);
      this.channels.delete(channelName);

      if (process.env.NODE_ENV === "development") {
        console.log(
          `[Pusher Mock] Unsubscribed from channel: ${channelName}`
        );
      }
    }
  }

  /**
   * Get a channel by name (without subscribing)
   */
  channel(channelName: string): MockChannelClient | null {
    return this.channels.get(channelName) || null;
  }

  /**
   * Get all subscribed channels
   */
  allChannels(): MockChannelClient[] {
    return Array.from(this.channels.values());
  }

  /**
   * Disconnect from Pusher
   */
  disconnect(): void {
    // Unsubscribe from all channels
    Array.from(this.channels.keys()).forEach((channelName) => {
      this.unsubscribe(channelName);
    });

    if (process.env.NODE_ENV === "development") {
      console.log(`[Pusher Mock] Client disconnected: ${this.subscriberId}`);
    }
  }

  /**
   * Bind to connection state events (stub)
   */
  connection = {
    bind: (event: string, callback: Function) => {
      // Mock connection events
      if (event === "connected") {
        // Immediately trigger connected state
        setTimeout(() => callback(), 0);
      }
    },
    unbind: (event?: string, callback?: Function) => {
      // No-op for mock
    },
    state: "connected",
  };
}
