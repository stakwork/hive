/**
 * Mock Pusher SDK Implementation
 * 
 * Provides mock implementations of Pusher server and client that mimic
 * the real Pusher SDK API surface. Uses HTTP polling instead of WebSockets.
 * 
 * Server-side: Routes trigger() calls to mock API endpoints
 * Client-side: Polls mock API for events instead of WebSocket subscriptions
 */

import { mockPusherState } from "./mock/pusher-state";

/**
 * Mock Pusher Server
 * Mimics the server-side Pusher SDK API
 */
export class MockPusherServer {
  /**
   * Trigger an event on one or more channels
   */
  async trigger(
    channels: string | string[],
    event: string,
    data: unknown
  ): Promise<{ success: boolean }> {
    const channelList = Array.isArray(channels) ? channels : [channels];
    
    for (const channel of channelList) {
      mockPusherState.trigger(channel, event, data);
      
      // Log for debugging in development
      if (process.env.NODE_ENV === "development") {
        console.log(`[Mock Pusher] Triggered ${event} on ${channel}:`, data);
      }
    }
    
    return { success: true };
  }
}

/**
 * Mock Pusher Client
 * Mimics the client-side Pusher SDK API with HTTP polling
 */
export class MockPusherClient {
  private connectionId: string | null = null;
  private socketId: string | null = null;
  private channels: Map<string, MockChannel> = new Map();
  private pollInterval: NodeJS.Timeout | null = null;
  private connected = false;

  constructor(
    private key: string,
    private options: { cluster: string }
  ) {
    // Auto-connect on instantiation
    this.connect();
  }

  /**
   * Establish mock connection
   */
  private async connect(): Promise<void> {
    try {
      const connection = mockPusherState.createConnection();
      this.connectionId = connection.id;
      this.socketId = connection.socketId;
      this.connected = true;
      
      // Start polling for events
      this.startPolling();
      
      if (process.env.NODE_ENV === "development") {
        console.log("[Mock Pusher Client] Connected:", connection.socketId);
      }
    } catch (error) {
      console.error("[Mock Pusher Client] Connection error:", error);
    }
  }

  /**
   * Start polling for events on subscribed channels
   */
  private startPolling(): void {
    if (this.pollInterval) return;
    
    // Poll every 500ms for new events
    this.pollInterval = setInterval(() => {
      this.channels.forEach((channel) => {
        channel.poll();
      });
    }, 500);
  }

  /**
   * Subscribe to a channel
   */
  subscribe(channelName: string): MockChannel {
    if (!this.channels.has(channelName)) {
      const channel = new MockChannel(
        channelName,
        this.connectionId!,
        this.socketId!
      );
      this.channels.set(channelName, channel);
      
      // Register subscription in state manager
      if (this.connectionId) {
        mockPusherState.subscribe(this.connectionId, channelName);
      }
    }
    return this.channels.get(channelName)!;
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channelName: string): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      channel.unsubscribe();
      this.channels.delete(channelName);
      
      if (this.connectionId) {
        mockPusherState.unsubscribe(this.connectionId, channelName);
      }
    }
  }

  /**
   * Disconnect and clean up
   */
  disconnect(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    
    this.channels.forEach(channel => channel.unsubscribe());
    this.channels.clear();
    
    if (this.connectionId) {
      mockPusherState.removeConnection(this.connectionId);
    }
    
    this.connected = false;
  }
}

/**
 * Mock Channel
 * Mimics a Pusher channel subscription with event handlers
 */
class MockChannel {
  private eventHandlers: Map<string, Set<(data: unknown) => void>> = new Map();
  private lastEventId: string | null = null;
  private subscribed = true;

  constructor(
    private name: string,
    private connectionId: string,
    private socketId: string
  ) {}

  /**
   * Poll for new events
   */
  async poll(): Promise<void> {
    if (!this.subscribed) return;

    try {
      const events = mockPusherState.getEvents(this.name, {
        sinceEventId: this.lastEventId || undefined,
      });
      
      events.forEach(event => {
        const handlers = this.eventHandlers.get(event.event);
        if (handlers) {
          handlers.forEach(handler => {
            try {
              handler(event.data);
            } catch (error) {
              console.error(`[Mock Pusher] Error in event handler:`, error);
            }
          });
        }
        this.lastEventId = event.id;
      });
    } catch (error) {
      console.error(`[Mock Pusher] Poll error for ${this.name}:`, error);
    }
  }

  /**
   * Bind an event handler
   */
  bind(event: string, callback: (data: unknown) => void): this {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(callback);
    return this;
  }

  /**
   * Unbind an event handler
   */
  unbind(event?: string, callback?: (data: unknown) => void): this {
    if (!event) {
      // Unbind all events
      this.eventHandlers.clear();
    } else if (callback) {
      // Unbind specific callback
      const handlers = this.eventHandlers.get(event);
      if (handlers) {
        handlers.delete(callback);
      }
    } else {
      // Unbind all callbacks for event
      this.eventHandlers.delete(event);
    }
    return this;
  }

  /**
   * Unsubscribe from channel
   */
  unsubscribe(): void {
    this.subscribed = false;
    this.eventHandlers.clear();
  }
}
