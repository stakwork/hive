/**
 * Pusher Client Mock Wrapper
 * 
 * Mimics the pusher-js package client interface for local development and testing.
 * Routes subscriptions and events through PusherMockState for synchronous in-memory delivery.
 */

import { pusherMockState } from "./pusher-state";

/**
 * Mock Channel implementation
 * Mimics pusher-js Channel interface
 */
class MockChannel {
  private channelName: string;
  private bound = false;

  constructor(channelName: string) {
    this.channelName = channelName;
  }

  /**
   * Bind an event handler to this channel
   */
  bind(eventName: string, callback: (data: any) => void): this {
    pusherMockState.bind(this.channelName, eventName, callback);
    this.bound = true;
    return this;
  }

  /**
   * Unbind an event handler from this channel
   */
  unbind(eventName?: string, callback?: (data: any) => void): this {
    if (eventName) {
      pusherMockState.unbind(this.channelName, eventName, callback);
    } else {
      pusherMockState.unbindAll(this.channelName);
    }
    return this;
  }

  /**
   * Unbind all event handlers from this channel
   */
  unbind_all(): this {
    pusherMockState.unbindAll(this.channelName);
    return this;
  }
}

/**
 * Mock implementation of Pusher client
 * Implements the minimal interface needed by the application
 */
export class PusherClientMock {
  private channels: Map<string, MockChannel> = new Map();
  private connectionState: string = "connected";
  public connection: {
    state: string;
    bind: (event: string, callback: (data?: any) => void) => void;
    unbind: (event?: string, callback?: (data?: any) => void) => void;
  };

  constructor(appKey: string, options?: any) {
    // Accept config for compatibility but don't use it
    
    // Mock connection object
    this.connection = {
      state: "connected",
      bind: (event: string, callback: (data?: any) => void) => {
        // Immediately trigger connected state
        if (event === "connected") {
          setTimeout(() => callback(), 0);
        }
      },
      unbind: (event?: string, callback?: (data?: any) => void) => {
        // No-op for mock
      },
    };
  }

  /**
   * Subscribe to a channel
   * @param channelName Channel name
   */
  subscribe(channelName: string): MockChannel {
    if (!this.channels.has(channelName)) {
      pusherMockState.subscribe(channelName);
      const channel = new MockChannel(channelName);
      this.channels.set(channelName, channel);
    }
    return this.channels.get(channelName)!;
  }

  /**
   * Unsubscribe from a channel
   * @param channelName Channel name
   */
  unsubscribe(channelName: string): void {
    if (this.channels.has(channelName)) {
      pusherMockState.unsubscribe(channelName);
      this.channels.delete(channelName);
    }
  }

  /**
   * Get a channel (without subscribing if not already subscribed)
   * @param channelName Channel name
   */
  channel(channelName: string): MockChannel | null {
    return this.channels.get(channelName) || null;
  }

  /**
   * Get all active channels
   */
  allChannels(): MockChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Bind to global events
   */
  bind(eventName: string, callback: (data?: any) => void): void {
    // Global events not implemented for mock
    // Most apps don't use this feature
  }

  /**
   * Unbind from global events
   */
  unbind(eventName?: string, callback?: (data?: any) => void): void {
    // Global events not implemented for mock
  }

  /**
   * Disconnect the client
   */
  disconnect(): void {
    this.connectionState = "disconnected";
    this.connection.state = "disconnected";
    // Clear all subscriptions
    this.channels.forEach((_, channelName) => {
      pusherMockState.unsubscribe(channelName);
    });
    this.channels.clear();
  }

  /**
   * Connect the client
   */
  connect(): void {
    this.connectionState = "connected";
    this.connection.state = "connected";
  }
}
