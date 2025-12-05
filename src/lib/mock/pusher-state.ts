import { EventEmitter } from "events";

/**
 * Mock Pusher State Manager
 * 
 * Provides in-memory pub/sub for Pusher events during development/testing.
 * Uses EventEmitter to bridge server-side triggers to client-side subscriptions
 * within the same Node.js process.
 * 
 * Key features:
 * - Channel + event scoped subscriptions (channel:event)
 * - Event history for debugging
 * - Console logging for development visibility
 * - reset() method for test isolation
 */

interface ChannelEventHistory {
  channel: string;
  event: string;
  data: unknown;
  timestamp: Date;
}

class MockPusherStateManager extends EventEmitter {
  private eventHistory: ChannelEventHistory[] = [];
  private readonly maxHistorySize = 100;

  /**
   * Trigger an event on a channel (server-side)
   * Broadcasts to all subscribers listening on channel:event
   */
  async trigger(
    channel: string | string[],
    event: string,
    data: unknown
  ): Promise<void> {
    const channels = Array.isArray(channel) ? channel : [channel];

    for (const ch of channels) {
      // Store in history
      this.eventHistory.push({
        channel: ch,
        event,
        data,
        timestamp: new Date(),
      });

      // Trim history if needed
      if (this.eventHistory.length > this.maxHistorySize) {
        this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
      }

      // Emit to subscribers using channel:event pattern
      const eventKey = `${ch}:${event}`;
      this.emit(eventKey, data);

      console.log(
        `[MockPusher] Triggered "${event}" on "${ch}":`,
        JSON.stringify(data).substring(0, 100)
      );
    }

    // Simulate minimal async behavior
    return Promise.resolve();
  }

  /**
   * Trigger multiple events in batch (server-side)
   */
  async triggerBatch(
    batch: Array<{ channel: string; name: string; data: unknown }>
  ): Promise<void> {
    for (const { channel, name, data } of batch) {
      await this.trigger(channel, name, data);
    }
  }

  /**
   * Subscribe to channel events (client-side)
   * Returns unsubscribe function
   */
  subscribe(
    channel: string,
    event: string,
    callback: (data: unknown) => void
  ): () => void {
    const eventKey = `${channel}:${event}`;
    this.on(eventKey, callback);

    console.log(
      `[MockPusher] Subscribed to "${event}" on "${channel}"`
    );

    // Return unsubscribe function
    return () => {
      this.off(eventKey, callback);
      console.log(
        `[MockPusher] Unsubscribed from "${event}" on "${channel}"`
      );
    };
  }

  /**
   * Get event history for debugging
   * Optionally filter by channel
   */
  getEventHistory(channel?: string): ChannelEventHistory[] {
    if (channel) {
      return this.eventHistory.filter((h) => h.channel === channel);
    }
    return [...this.eventHistory];
  }

  /**
   * Clear event history only (keep listeners intact)
   * Useful when you want to clear history between tests but keep subscriptions
   */
  clearHistory(): void {
    this.eventHistory = [];
    console.log("[MockPusher] Event history cleared (listeners intact)");
  }

  /**
   * Clear event history and remove all listeners
   * Essential for test isolation
   */
  reset(): void {
    this.eventHistory = [];
    this.removeAllListeners();
    console.log("[MockPusher] State reset - all listeners removed");
  }

  /**
   * Get count of listeners for a channel:event
   * Useful for debugging subscription leaks
   */
  getListenerCount(channel: string, event: string): number {
    const eventKey = `${channel}:${event}`;
    return this.listenerCount(eventKey);
  }
}

// Export singleton instance
export const mockPusherState = new MockPusherStateManager();
