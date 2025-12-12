/**
 * Mock Pusher Client (Browser)
 * 
 * Mimics the pusher-js API for browser usage without requiring real Pusher credentials.
 * Works with PusherMockState singleton to enable cross-tab synchronization.
 * 
 * Features:
 * - Connection lifecycle simulation (connecting → connected)
 * - Channel subscription/unsubscription
 * - Event binding/unbinding
 * - Automatic pusher:subscription_succeeded events
 * - Compatible with existing Pusher client code
 */

import { pusherMockState } from "./pusher-state";

type EventCallback = (data?: any) => void;

/**
 * Mock Channel class mimicking pusher-js Channel
 */
export class MockChannel {
  public name: string;
  private handlers: Map<string, Set<EventCallback>> = new Map();

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Bind an event handler to this channel
   */
  bind(eventName: string, callback: EventCallback): this {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, new Set());
    }
    this.handlers.get(eventName)!.add(callback);

    // Register with global state for cross-tab synchronization
    pusherMockState.bind(this.name, eventName, callback);

    return this;
  }

  /**
   * Unbind an event handler from this channel
   */
  unbind(eventName?: string, callback?: EventCallback): this {
    if (!eventName) {
      // Unbind all events
      this.handlers.forEach((callbacks, event) => {
        callbacks.forEach(cb => {
          pusherMockState.unbind(this.name, event, cb);
        });
      });
      this.handlers.clear();
    } else if (!callback) {
      // Unbind all handlers for this event
      const callbacks = this.handlers.get(eventName);
      if (callbacks) {
        callbacks.forEach(cb => {
          pusherMockState.unbind(this.name, eventName, cb);
        });
        this.handlers.delete(eventName);
      }
    } else {
      // Unbind specific handler
      const callbacks = this.handlers.get(eventName);
      if (callbacks) {
        callbacks.delete(callback);
        pusherMockState.unbind(this.name, eventName, callback);
        
        if (callbacks.size === 0) {
          this.handlers.delete(eventName);
        }
      }
    }

    return this;
  }

  /**
   * Trigger an event on this channel (for testing)
   */
  trigger(eventName: string, data?: any): void {
    pusherMockState.trigger(this.name, eventName, data);
  }
}

/**
 * Mock Pusher Client class mimicking pusher-js Pusher
 */
export class MockPusherClient {
  private connectionId: string;
  private channels: Map<string, MockChannel> = new Map();
  private connectionState: "initialized" | "connecting" | "connected" | "disconnected" = "initialized";
  private connectionCallbacks: Map<string, Set<EventCallback>> = new Map();

  constructor(
    public key: string,
    public config: { cluster: string }
  ) {
    // Create connection in mock state
    this.connectionId = pusherMockState.createConnection();
    
    // Simulate connection process
    this.connect();
  }

  /**
   * Get the connection object (for state change events)
   */
  get connection() {
    return {
      state: this.connectionState,
      bind: (eventName: string, callback: EventCallback) => {
        if (!this.connectionCallbacks.has(eventName)) {
          this.connectionCallbacks.set(eventName, new Set());
        }
        this.connectionCallbacks.get(eventName)!.add(callback);
      },
      unbind: (eventName?: string, callback?: EventCallback) => {
        if (!eventName) {
          this.connectionCallbacks.clear();
        } else if (!callback) {
          this.connectionCallbacks.delete(eventName);
        } else {
          const callbacks = this.connectionCallbacks.get(eventName);
          if (callbacks) {
            callbacks.delete(callback);
          }
        }
      },
    };
  }

  /**
   * Simulate connection process
   */
  private connect(): void {
    this.connectionState = "connecting";
    this.emitConnectionEvent("state_change", {
      previous: "initialized",
      current: "connecting",
    });

    // Simulate connection delay
    setTimeout(() => {
      this.connectionState = "connected";
      this.emitConnectionEvent("state_change", {
        previous: "connecting",
        current: "connected",
      });
      this.emitConnectionEvent("connected");
    }, 10);
  }

  /**
   * Emit connection events
   */
  private emitConnectionEvent(eventName: string, data?: any): void {
    const callbacks = this.connectionCallbacks.get(eventName);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in connection event handler for ${eventName}:`, error);
        }
      });
    }
  }

  /**
   * Subscribe to a channel
   */
  subscribe(channelName: string): MockChannel {
    // Return existing channel if already subscribed
    if (this.channels.has(channelName)) {
      return this.channels.get(channelName)!;
    }

    // Create new channel
    const channel = new MockChannel(channelName);
    this.channels.set(channelName, channel);

    // Subscribe in mock state
    pusherMockState.subscribe(this.connectionId, channelName);

    // Emit subscription_succeeded event after a short delay
    setTimeout(() => {
      pusherMockState.trigger(channelName, "pusher:subscription_succeeded", {});
    }, 10);

    return channel;
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channelName: string): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      // Unbind all handlers
      channel.unbind();
      
      // Unsubscribe from mock state
      pusherMockState.unsubscribe(this.connectionId, channelName);
      
      // Remove from local channels
      this.channels.delete(channelName);
    }
  }

  /**
   * Get a channel by name (returns existing or creates new)
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
   * Disconnect from Pusher
   */
  disconnect(): void {
    if (this.connectionState !== "disconnected") {
      const previousState = this.connectionState;
      this.connectionState = "disconnected";
      
      this.emitConnectionEvent("state_change", {
        previous: previousState,
        current: "disconnected",
      });
      this.emitConnectionEvent("disconnected");

      // Unsubscribe from all channels
      const channelNames = Array.from(this.channels.keys());
      channelNames.forEach(name => this.unsubscribe(name));

      // Remove connection from mock state
      pusherMockState.removeConnection(this.connectionId);
    }
  }

  /**
   * Bind a global event handler (across all channels)
   */
  bind(eventName: string, callback: EventCallback): void {
    // For global events, we'd need to bind to all existing and future channels
    // This is a simplified implementation
    console.warn("MockPusherClient.bind() is not fully implemented for global events");
  }

  /**
   * Unbind a global event handler
   */
  unbind(eventName?: string, callback?: EventCallback): void {
    // Simplified implementation
    console.warn("MockPusherClient.unbind() is not fully implemented for global events");
  }
}
