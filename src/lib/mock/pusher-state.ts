/**
 * Pusher Mock State Manager
 * 
 * Provides in-memory state management for mocking Pusher real-time messaging during local development and testing.
 * Follows singleton pattern consistent with other mock state managers in the codebase.
 * 
 * Features:
 * - In-memory channel and connection management
 * - Event broadcasting across all subscribed clients
 * - Event handler binding/unbinding
 * - Cross-tab synchronization via shared singleton state
 * - Reset capability for test isolation
 */

type EventHandler = (data: any) => void;

interface ChannelSubscription {
  channelName: string;
  handlers: Map<string, Set<EventHandler>>;
}

interface Connection {
  id: string;
  channels: Set<string>;
}

export class PusherMockState {
  private static instance: PusherMockState;
  private channels: Map<string, ChannelSubscription> = new Map();
  private connections: Map<string, Connection> = new Map();
  private nextConnectionId = 1;

  private constructor() {
    // Private constructor for singleton pattern
  }

  static getInstance(): PusherMockState {
    if (!PusherMockState.instance) {
      PusherMockState.instance = new PusherMockState();
    }
    return PusherMockState.instance;
  }

  /**
   * Create a new connection and return its ID
   */
  createConnection(): string {
    const id = `mock-connection-${this.nextConnectionId++}`;
    this.connections.set(id, {
      id,
      channels: new Set(),
    });
    return id;
  }

  /**
   * Remove a connection and unsubscribe from all channels
   */
  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      // Unsubscribe from all channels
      for (const channelName of connection.channels) {
        this.unsubscribe(connectionId, channelName);
      }
      this.connections.delete(connectionId);
    }
  }

  /**
   * Subscribe a connection to a channel
   */
  subscribe(connectionId: string, channelName: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    // Add channel to connection
    connection.channels.add(channelName);

    // Create channel if it doesn't exist
    if (!this.channels.has(channelName)) {
      this.channels.set(channelName, {
        channelName,
        handlers: new Map(),
      });
    }
  }

  /**
   * Unsubscribe a connection from a channel
   */
  unsubscribe(connectionId: string, channelName: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.channels.delete(channelName);
      
      // Clean up channel if no connections remain
      const hasSubscribers = Array.from(this.connections.values()).some(
        conn => conn.channels.has(channelName)
      );
      
      if (!hasSubscribers) {
        this.channels.delete(channelName);
      }
    }
  }

  /**
   * Bind an event handler to a channel
   * Handlers are stored globally per channel, not per connection
   */
  bind(channelName: string, eventName: string, handler: EventHandler): void {
    const channel = this.channels.get(channelName);
    if (!channel) {
      // Create channel if it doesn't exist
      this.channels.set(channelName, {
        channelName,
        handlers: new Map(),
      });
    }

    const subscription = this.channels.get(channelName)!;
    if (!subscription.handlers.has(eventName)) {
      subscription.handlers.set(eventName, new Set());
    }
    subscription.handlers.get(eventName)!.add(handler);
  }

  /**
   * Unbind an event handler from a channel
   */
  unbind(channelName: string, eventName: string, handler: EventHandler): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      const handlers = channel.handlers.get(eventName);
      if (handlers) {
        handlers.delete(handler);
        
        // Clean up empty handler sets
        if (handlers.size === 0) {
          channel.handlers.delete(eventName);
        }
      }
    }
  }

  /**
   * Unbind all handlers for a specific event on a channel
   */
  unbindAll(channelName: string, eventName?: string): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      if (eventName) {
        // Unbind specific event
        channel.handlers.delete(eventName);
      } else {
        // Unbind all events
        channel.handlers.clear();
      }
    }
  }

  /**
   * Trigger an event on a channel (broadcast to all subscribers)
   * This simulates server-side Pusher.trigger()
   */
  trigger(channelName: string, eventName: string, data: any): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      const handlers = channel.handlers.get(eventName);
      if (handlers) {
        // Call all registered handlers
        handlers.forEach(handler => {
          try {
            // Use setTimeout to simulate async delivery
            setTimeout(() => handler(data), 0);
          } catch (error) {
            console.error(`Error in Pusher mock event handler for ${eventName}:`, error);
          }
        });
      }
    }
  }

  /**
   * Check if a channel has any subscribers
   */
  hasSubscribers(channelName: string): boolean {
    return Array.from(this.connections.values()).some(
      conn => conn.channels.has(channelName)
    );
  }

  /**
   * Get the number of subscribers for a channel
   */
  getSubscriberCount(channelName: string): number {
    return Array.from(this.connections.values()).filter(
      conn => conn.channels.has(channelName)
    ).length;
  }

  /**
   * Get all active channel names
   */
  getActiveChannels(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Get statistics about the mock state
   */
  getStats(): {
    connectionCount: number;
    channelCount: number;
    totalHandlers: number;
  } {
    let totalHandlers = 0;
    for (const channel of this.channels.values()) {
      for (const handlers of channel.handlers.values()) {
        totalHandlers += handlers.size;
      }
    }

    return {
      connectionCount: this.connections.size,
      channelCount: this.channels.size,
      totalHandlers,
    };
  }

  /**
   * Reset all state (for test isolation)
   */
  reset(): void {
    this.channels.clear();
    this.connections.clear();
    this.nextConnectionId = 1;
  }
}

// Export singleton instance
export const pusherMockState = PusherMockState.getInstance();
