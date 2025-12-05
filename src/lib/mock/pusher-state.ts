/**
 * Mock Pusher State Manager
 * 
 * Provides in-memory state management for mock Pusher implementation.
 * Follows the singleton pattern used by other mock state managers in the codebase.
 * 
 * Key features:
 * - Channel subscription tracking
 * - Event queuing and delivery
 * - Connection management
 * - Event history for debugging
 */

export interface PusherEvent {
  id: string;
  event: string;
  data: unknown;
  timestamp: Date;
  channel: string;
}

export interface PusherChannel {
  name: string;
  subscribers: Set<string>; // Connection IDs
  messageHistory: PusherEvent[];
  createdAt: Date;
}

export interface PusherConnection {
  id: string;
  socketId: string;
  channels: Set<string>;
  createdAt: Date;
  lastActivityAt: Date;
}

class MockPusherStateManager {
  private static instance: MockPusherStateManager;
  private channels: Map<string, PusherChannel> = new Map();
  private connections: Map<string, PusherConnection> = new Map();
  private eventIdCounter = 0;

  private constructor() {
    // Private constructor for singleton pattern
  }

  static getInstance(): MockPusherStateManager {
    if (!MockPusherStateManager.instance) {
      MockPusherStateManager.instance = new MockPusherStateManager();
    }
    return MockPusherStateManager.instance;
  }

  /**
   * Reset all state - used for test isolation
   */
  reset(): void {
    this.channels.clear();
    this.connections.clear();
    this.eventIdCounter = 0;
  }

  /**
   * Create a new connection
   */
  createConnection(): PusherConnection {
    const connection: PusherConnection = {
      id: `conn_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      socketId: `${Math.random().toString(36).substring(2, 11)}.${Math.random().toString(36).substring(2, 11)}`,
      channels: new Set(),
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };
    this.connections.set(connection.id, connection);
    return connection;
  }

  /**
   * Remove a connection and clean up subscriptions
   */
  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      // Unsubscribe from all channels
      connection.channels.forEach(channelName => {
        this.unsubscribe(connectionId, channelName);
      });
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

    // Get or create channel
    if (!this.channels.has(channelName)) {
      this.channels.set(channelName, {
        name: channelName,
        subscribers: new Set(),
        messageHistory: [],
        createdAt: new Date(),
      });
    }

    const channel = this.channels.get(channelName)!;
    channel.subscribers.add(connectionId);
    connection.channels.add(channelName);
    connection.lastActivityAt = new Date();
  }

  /**
   * Unsubscribe a connection from a channel
   */
  unsubscribe(connectionId: string, channelName: string): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      channel.subscribers.delete(connectionId);
      // Clean up empty channels
      if (channel.subscribers.size === 0 && channel.messageHistory.length === 0) {
        this.channels.delete(channelName);
      }
    }

    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.channels.delete(channelName);
      connection.lastActivityAt = new Date();
    }
  }

  /**
   * Trigger an event on a channel (simulates pusherServer.trigger)
   */
  trigger(channelName: string, event: string, data: unknown): PusherEvent {
    // Get or create channel
    if (!this.channels.has(channelName)) {
      this.channels.set(channelName, {
        name: channelName,
        subscribers: new Set(),
        messageHistory: [],
        createdAt: new Date(),
      });
    }

    const channel = this.channels.get(channelName)!;
    
    const pusherEvent: PusherEvent = {
      id: `evt_${++this.eventIdCounter}`,
      event,
      data,
      timestamp: new Date(),
      channel: channelName,
    };

    // Store in history
    channel.messageHistory.push(pusherEvent);
    
    // Keep only last 100 messages per channel
    if (channel.messageHistory.length > 100) {
      channel.messageHistory.shift();
    }

    return pusherEvent;
  }

  /**
   * Get events from a channel since a given event ID or timestamp
   */
  getEvents(
    channelName: string,
    options: { sinceEventId?: string; sinceTimestamp?: Date } = {}
  ): PusherEvent[] {
    const channel = this.channels.get(channelName);
    if (!channel) {
      return [];
    }

    let events = channel.messageHistory;

    // Filter by event ID if provided
    if (options.sinceEventId) {
      const sinceId = parseInt(options.sinceEventId.replace('evt_', ''), 10);
      events = events.filter(e => {
        const eventId = parseInt(e.id.replace('evt_', ''), 10);
        return eventId > sinceId;
      });
    }

    // Filter by timestamp if provided
    if (options.sinceTimestamp) {
      events = events.filter(e => e.timestamp > options.sinceTimestamp!);
    }

    return events;
  }

  /**
   * Get channel info
   */
  getChannel(channelName: string): PusherChannel | undefined {
    return this.channels.get(channelName);
  }

  /**
   * Get connection info
   */
  getConnection(connectionId: string): PusherConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Get all channels (for debugging)
   */
  getAllChannels(): PusherChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Get all connections (for debugging)
   */
  getAllConnections(): PusherConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get subscriber count for a channel
   */
  getSubscriberCount(channelName: string): number {
    const channel = this.channels.get(channelName);
    return channel ? channel.subscribers.size : 0;
  }
}

// Export singleton instance
export const mockPusherState = MockPusherStateManager.getInstance();
