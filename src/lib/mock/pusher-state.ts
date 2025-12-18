/**
 * Mock Pusher State Manager
 *
 * Provides in-memory state management for Pusher pub/sub simulation during local development and testing.
 * Implements subscription tracking, event broadcasting, and connection lifecycle management.
 *
 * Usage:
 *   import { mockPusherState } from '@/lib/mock/pusher-state';
 *
 *   // Subscribe to channel
 *   mockPusherState.subscribe('workspace-123', 'new-message', callback);
 *
 *   // Trigger event
 *   mockPusherState.trigger('workspace-123', 'new-message', { text: 'Hello' });
 *
 *   // Unsubscribe
 *   mockPusherState.unsubscribe('workspace-123', callback);
 *
 *   // Reset state (for testing)
 *   mockPusherState.reset();
 */

type EventCallback = (data: unknown) => void;

interface ChannelSubscription {
  channelName: string;
  eventName: string;
  callback: EventCallback;
}

interface MockConnectionState {
  connected: boolean;
  connectionCount: number;
  lastConnectedAt?: Date;
  lastDisconnectedAt?: Date;
}

export class MockPusherStateManager {
  private static instance: MockPusherStateManager;

  // Map of channelName -> Map of eventName -> Set of callbacks
  private subscriptions: Map<string, Map<string, Set<EventCallback>>> = new Map();

  // Connection state tracking
  private connectionState: MockConnectionState = {
    connected: false,
    connectionCount: 0,
  };

  // Event history for debugging (optional)
  private eventHistory: Array<{
    channelName: string;
    eventName: string;
    data: unknown;
    timestamp: Date;
  }> = [];

  private constructor() {
    // Private constructor for singleton
  }

  public static getInstance(): MockPusherStateManager {
    if (!MockPusherStateManager.instance) {
      MockPusherStateManager.instance = new MockPusherStateManager();
    }
    return MockPusherStateManager.instance;
  }

  /**
   * Subscribe to a channel event
   * @param channelName - Channel name (e.g., 'workspace-123', 'task-456')
   * @param eventName - Event name (e.g., 'new-message', 'workflow-status-update')
   * @param callback - Callback function to invoke when event is triggered
   */
  public subscribe(channelName: string, eventName: string, callback: EventCallback): void {
    if (!this.subscriptions.has(channelName)) {
      this.subscriptions.set(channelName, new Map());
    }

    const channelEvents = this.subscriptions.get(channelName)!;

    if (!channelEvents.has(eventName)) {
      channelEvents.set(eventName, new Set());
    }

    channelEvents.get(eventName)!.add(callback);
  }

  /**
   * Unsubscribe from a channel event
   * @param channelName - Channel name
   * @param callback - Callback function to remove (if null, removes all callbacks for channel)
   */
  public unsubscribe(channelName: string, callback?: EventCallback): void {
    if (!this.subscriptions.has(channelName)) {
      return;
    }

    if (!callback) {
      // Remove entire channel
      this.subscriptions.delete(channelName);
      return;
    }

    // Remove specific callback from all events in channel
    const channelEvents = this.subscriptions.get(channelName)!;

    for (const [eventName, callbacks] of channelEvents.entries()) {
      callbacks.delete(callback);

      // Clean up empty event sets
      if (callbacks.size === 0) {
        channelEvents.delete(eventName);
      }
    }

    // Clean up empty channels
    if (channelEvents.size === 0) {
      this.subscriptions.delete(channelName);
    }
  }

  /**
   * Trigger an event on a channel, broadcasting to all subscribed callbacks
   * @param channelName - Channel name
   * @param eventName - Event name
   * @param data - Event data payload
   * @returns Number of callbacks invoked
   */
  public trigger(channelName: string, eventName: string, data: unknown): number {
    // Record event in history
    this.eventHistory.push({
      channelName,
      eventName,
      data,
      timestamp: new Date(),
    });

    // Keep history limited to prevent memory leaks
    if (this.eventHistory.length > 1000) {
      this.eventHistory.shift();
    }

    if (!this.subscriptions.has(channelName)) {
      return 0;
    }

    const channelEvents = this.subscriptions.get(channelName)!;

    if (!channelEvents.has(eventName)) {
      return 0;
    }

    const callbacks = channelEvents.get(eventName)!;

    // Invoke all callbacks synchronously (simulating real-time broadcast)
    let invoked = 0;
    for (const callback of callbacks) {
      try {
        callback(data);
        invoked++;
      } catch (error) {
        console.error(`[MockPusher] Error invoking callback for ${channelName}:${eventName}:`, error);
      }
    }

    return invoked;
  }

  /**
   * Simulate connection establishment
   */
  public connect(): void {
    if (!this.connectionState.connected) {
      this.connectionState.connected = true;
      this.connectionState.connectionCount++;
      this.connectionState.lastConnectedAt = new Date();
    }
  }

  /**
   * Simulate connection termination
   */
  public disconnect(): void {
    if (this.connectionState.connected) {
      this.connectionState.connected = false;
      this.connectionState.lastDisconnectedAt = new Date();
    }
  }

  /**
   * Get current connection state
   */
  public getConnectionState(): MockConnectionState {
    return { ...this.connectionState };
  }

  /**
   * Get all active subscriptions (for debugging/testing)
   */
  public getSubscriptions(): Array<{
    channelName: string;
    eventName: string;
    callbackCount: number;
  }> {
    const result: Array<{
      channelName: string;
      eventName: string;
      callbackCount: number;
    }> = [];

    for (const [channelName, channelEvents] of this.subscriptions.entries()) {
      for (const [eventName, callbacks] of channelEvents.entries()) {
        result.push({
          channelName,
          eventName,
          callbackCount: callbacks.size,
        });
      }
    }

    return result;
  }

  /**
   * Get event history (for debugging/testing)
   */
  public getEventHistory(limit = 100): Array<{
    channelName: string;
    eventName: string;
    data: unknown;
    timestamp: Date;
  }> {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Get subscription count for a specific channel
   */
  public getChannelSubscriptionCount(channelName: string): number {
    if (!this.subscriptions.has(channelName)) {
      return 0;
    }

    const channelEvents = this.subscriptions.get(channelName)!;
    let count = 0;

    for (const callbacks of channelEvents.values()) {
      count += callbacks.size;
    }

    return count;
  }

  /**
   * Reset all state (for testing)
   */
  public reset(): void {
    this.subscriptions.clear();
    this.connectionState = {
      connected: false,
      connectionCount: 0,
    };
    this.eventHistory = [];
  }
}

// Export singleton instance
export const mockPusherState = MockPusherStateManager.getInstance();
