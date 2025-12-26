/**
 * Pusher Mock Wrapper
 *
 * Provides MockPusherServer and MockPusherClient classes that match real Pusher interfaces.
 * Uses in-memory state manager and polling-based delivery to simulate real-time messaging
 * without external dependencies.
 *
 * Key features:
 * - Server-side trigger() broadcasts events to all channel subscribers
 * - Client-side subscribe() returns channel with bind/unbind methods
 * - Polling-based delivery simulates real-time updates (<200ms latency)
 * - Message history management (last 100 messages per channel)
 * - Full compatibility with existing Pusher usage patterns
 */

import { pusherMockState } from "./pusher-state";

export interface PusherLike {
  trigger(channel: string, event: string, data: unknown): Promise<unknown>;
}

export interface ChannelLike {
  bind(eventName: string, callback: (data: unknown) => void): this;
  unbind(eventName?: string, callback?: (data: unknown) => void): this;
}

export interface PusherClientLike {
  subscribe(channelName: string): ChannelLike;
  unsubscribe(channelName: string): void;
  disconnect(): void;
  connection: {
    bind(event: string, callback: () => void): void;
    state: string;
  };
}

/**
 * Mock Pusher Server
 * Simulates server-side Pusher instance for triggering events
 */
export class MockPusherServer implements PusherLike {
  constructor(
    private config: {
      appId: string;
      key: string;
      secret: string;
      cluster: string;
      useTLS: boolean;
    },
  ) {}

  /**
   * Trigger an event on a channel
   * Broadcasts to all subscribers of the channel
   */
  async trigger(channel: string, event: string, data: unknown): Promise<void> {
    // Simulate network delay (50ms average)
    await new Promise((resolve) => setTimeout(resolve, 50));

    pusherMockState.trigger(channel, event, data);
  }

  /**
   * Trigger multiple events on multiple channels (batch)
   */
  async triggerBatch(batch: Array<{ channel: string; name: string; data: unknown }>): Promise<void> {
    await Promise.all(batch.map((item) => this.trigger(item.channel, item.name, item.data)));
  }
}

/**
 * Mock Pusher Channel
 * Simulates client-side channel with event binding
 */
export class MockChannel implements ChannelLike {
  private connectionId: string;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastPollTimestamp = 0;
  private readonly POLL_INTERVAL_MS = 100; // 100ms polling for <200ms latency

  constructor(
    public name: string,
    connectionId: string,
  ) {
    this.connectionId = connectionId;
    this.lastPollTimestamp = Date.now();
  }

  /**
   * Bind event callback
   * Starts polling for new messages if not already polling
   */
  bind(eventName: string, callback: (data: unknown) => void): this {
    pusherMockState.bind(this.connectionId, this.name, eventName, callback);

    // Start polling if not already running
    if (!this.pollingInterval) {
      this.startPolling();
    }

    return this;
  }

  /**
   * Unbind event callback
   * Stops polling if no more callbacks
   */
  unbind(eventName?: string, callback?: (data: unknown) => void): this {
    if (eventName) {
      pusherMockState.unbind(this.connectionId, this.name, eventName, callback);
    } else {
      // Unbind all events for this channel
      const subscription = pusherMockState.getSubscriptionState(this.connectionId);
      if (subscription) {
        subscription.eventCallbacks.forEach((callbacks, key) => {
          if (key.startsWith(`${this.name}:`)) {
            const event = key.split(":")[1];
            pusherMockState.unbind(this.connectionId, this.name, event);
          }
        });
      }
    }

    // Stop polling if no more callbacks
    const subscription = pusherMockState.getSubscriptionState(this.connectionId);
    const hasCallbacks = subscription?.eventCallbacks.size ?? 0 > 0;
    if (!hasCallbacks && this.pollingInterval) {
      this.stopPolling();
    }

    return this;
  }

  /**
   * Unbind all event callbacks (alias for unbind with no args)
   */
  unbind_all(): this {
    return this.unbind();
  }

  /**
   * Start polling for new messages
   */
  private startPolling(): void {
    this.pollingInterval = setInterval(() => {
      const newMessages = pusherMockState.getMessagesSince(this.name, this.lastPollTimestamp);
      this.lastPollTimestamp = Date.now();

      // No need to manually execute callbacks - state manager already did during trigger()
      // This polling just maintains the connection
    }, this.POLL_INTERVAL_MS);
  }

  /**
   * Stop polling for messages
   */
  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Cleanup when channel is unsubscribed
   */
  cleanup(): void {
    this.stopPolling();
  }
}

/**
 * Mock Pusher Client
 * Simulates client-side Pusher instance for subscribing to channels
 */
export class MockPusherClient implements PusherClientLike {
  private connectionId: string;
  private channels: Map<string, MockChannel> = new Map();
  private _connectionState = "connected";

  constructor(
    private key: string,
    private config: { cluster: string },
  ) {
    this.connectionId = pusherMockState.generateConnectionId();
    
    // Create connection object with correct context binding
    const self = this;
    this.connection = {
      bind: (event: string, callback: () => void) => {
        // Simulate immediate connection
        if (event === "connected") {
          setTimeout(callback, 0);
        }
      },
      get state(): string {
        return self._connectionState;
      },
    };
  }

  /**
   * Connection state management
   */
  connection: {
    bind: (event: string, callback: () => void) => void;
    state: string;
  };

  /**
   * Subscribe to a channel
   * Returns channel instance for event binding
   */
  subscribe(channelName: string): MockChannel {
    // Return existing channel if already subscribed
    if (this.channels.has(channelName)) {
      return this.channels.get(channelName)!;
    }

    // Create new channel subscription
    pusherMockState.subscribe(this.connectionId, channelName);

    const channel = new MockChannel(channelName, this.connectionId);
    this.channels.set(channelName, channel);

    return channel;
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channelName: string): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      channel.cleanup();
      this.channels.delete(channelName);
      pusherMockState.unsubscribe(this.connectionId, channelName);
    }
  }

  /**
   * Global bind for all channels (optional compatibility method)
   * Note: Typically bind is called on individual channels
   */
  bind(eventName: string, callback: (data: unknown) => void): this {
    // Bind to all existing channels
    this.channels.forEach((channel) => {
      channel.bind(eventName, callback);
    });
    return this;
  }

  /**
   * Global unbind for all channels (optional compatibility method)
   */
  unbind(eventName?: string, callback?: (data: unknown) => void): this {
    // Unbind from all existing channels
    this.channels.forEach((channel) => {
      channel.unbind(eventName, callback);
    });
    return this;
  }

  /**
   * Disconnect client
   * Cleanup all subscriptions
   */
  disconnect(): void {
    this.channels.forEach((channel) => channel.cleanup());
    this.channels.clear();
    pusherMockState.disconnect(this.connectionId);
    this._connectionState = "disconnected";
  }
}
