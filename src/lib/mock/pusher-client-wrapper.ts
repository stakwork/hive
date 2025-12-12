/**
 * PusherClientMock - Mock implementation of client-side Pusher
 *
 * Implements the same interface as pusher-js library's PusherClient class.
 * Routes subscribe() calls to PusherMockState for in-memory event handling.
 *
 * Compatible with existing client-side Pusher usage:
 * - const pusher = getPusherClient()
 * - const channel = pusher.subscribe('channel-name')
 * - channel.bind('event-name', callback)
 * - channel.unbind('event-name', callback)
 * - pusher.unsubscribe('channel-name')
 */

import { pusherMockState, EventCallback } from "./pusher-state";

export interface PusherClientConfig {
  cluster?: string;
  authEndpoint?: string;
  auth?: {
    headers?: Record<string, string>;
  };
}

/**
 * MockChannel - Represents a subscribed channel
 */
export class MockChannel {
  public name: string;

  constructor(channelName: string) {
    this.name = channelName;
  }

  /**
   * Bind an event listener to this channel
   */
  bind(event: string, callback: EventCallback): this {
    pusherMockState.bind(this.name, event, callback);
    return this;
  }

  /**
   * Unbind an event listener from this channel
   */
  unbind(event?: string, callback?: EventCallback): this {
    if (!event) {
      // Unbind all events
      pusherMockState.unbindAll(this.name);
    } else {
      pusherMockState.unbind(this.name, event, callback);
    }
    return this;
  }

  /**
   * Unbind all event listeners from this channel
   */
  unbind_all(): this {
    pusherMockState.unbindAll(this.name);
    return this;
  }
}

/**
 * MockConnection - Represents the WebSocket connection state
 */
export class MockConnection {
  public state = "connected";

  bind(event: string, callback: (data?: any) => void): void {
    if (event === "connected") {
      // Simulate immediate connection
      setTimeout(() => {
        callback();
      }, 0);
    }
  }

  unbind(event: string, callback?: (data?: any) => void): void {
    // No-op for mock
  }
}

/**
 * PusherClientMock - Main client instance
 */
export class PusherClientMock {
  private key: string;
  private config: PusherClientConfig;
  private channels: Map<string, MockChannel> = new Map();
  public connection: MockConnection;

  constructor(key: string, config: PusherClientConfig = {}) {
    this.key = key;
    this.config = config;
    this.connection = new MockConnection();

    console.log("[Pusher Mock Client] Initialized with mock mode");

    // Simulate connection
    pusherMockState.setConnected(true);
  }

  /**
   * Subscribe to a channel
   */
  subscribe(channelName: string): MockChannel {
    // Return existing channel if already subscribed
    if (this.channels.has(channelName)) {
      console.log(
        `[Pusher Mock Client] Already subscribed to channel: ${channelName}`
      );
      return this.channels.get(channelName)!;
    }

    // Create new channel subscription
    pusherMockState.subscribe(channelName);
    const channel = new MockChannel(channelName);
    this.channels.set(channelName, channel);

    return channel;
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channelName: string): void {
    if (this.channels.has(channelName)) {
      pusherMockState.unsubscribe(channelName);
      this.channels.delete(channelName);
    }
  }

  /**
   * Get a previously subscribed channel
   */
  channel(channelName: string): MockChannel | undefined {
    return this.channels.get(channelName);
  }

  /**
   * Get all subscribed channels
   */
  allChannels(): MockChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Bind a global event listener (connection events, etc.)
   */
  bind(event: string, callback: (data?: any) => void): void {
    if (event === "connected") {
      // Simulate immediate connection
      setTimeout(() => {
        callback();
      }, 0);
    }
  }

  /**
   * Unbind a global event listener
   */
  unbind(event?: string, callback?: (data?: any) => void): void {
    // No-op for mock
  }

  /**
   * Disconnect from Pusher
   */
  disconnect(): void {
    console.log("[Pusher Mock Client] Disconnecting");
    this.channels.clear();
    pusherMockState.setConnected(false);
  }

  /**
   * Get connection state
   */
  get connected(): boolean {
    return pusherMockState.isConnected();
  }

  /**
   * Get connection ID
   */
  get connection_id(): string | null {
    return pusherMockState.getConnectionId();
  }
}
