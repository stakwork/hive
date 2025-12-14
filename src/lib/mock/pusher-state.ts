/**
 * Pusher Mock State Manager
 * 
 * Provides in-memory state management for mocking Pusher real-time messaging operations
 * during local development and testing. Follows singleton pattern consistent with other
 * mock state managers in the codebase.
 * 
 * Features:
 * - In-memory channel and subscription management
 * - Event history tracking for debugging
 * - Synchronous event delivery (simulates real-time without network)
 * - Reset capability for test isolation
 */

interface EventHandler {
  event: string;
  callback: (data: any) => void;
}

interface ChannelSubscription {
  channelName: string;
  handlers: EventHandler[];
}

interface EventRecord {
  channelName: string;
  eventName: string;
  data: any;
  timestamp: Date;
}

export class PusherMockState {
  private static instance: PusherMockState;
  private subscriptions: Map<string, ChannelSubscription> = new Map();
  private eventHistory: EventRecord[] = [];
  private maxHistorySize = 1000; // Prevent unbounded growth

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
   * Trigger an event on a channel
   * Synchronously delivers to all subscribed handlers
   */
  trigger(channelName: string, eventName: string, data: any): void {
    // Record event in history
    this.recordEvent(channelName, eventName, data);

    // Deliver to all subscribers
    const subscription = this.subscriptions.get(channelName);
    if (subscription) {
      subscription.handlers.forEach((handler) => {
        if (handler.event === eventName) {
          try {
            handler.callback(data);
          } catch (error) {
            console.error(`Error in Pusher mock handler for ${eventName}:`, error);
          }
        }
      });
    }
  }

  /**
   * Subscribe to a channel
   * Creates the channel if it doesn't exist
   */
  subscribe(channelName: string): void {
    if (!this.subscriptions.has(channelName)) {
      this.subscriptions.set(channelName, {
        channelName,
        handlers: [],
      });
    }
  }

  /**
   * Unsubscribe from a channel
   * Removes all handlers for the channel
   */
  unsubscribe(channelName: string): void {
    this.subscriptions.delete(channelName);
  }

  /**
   * Bind an event handler to a channel
   */
  bind(channelName: string, eventName: string, callback: (data: any) => void): void {
    const subscription = this.subscriptions.get(channelName);
    if (subscription) {
      subscription.handlers.push({ event: eventName, callback });
    }
  }

  /**
   * Unbind a specific event handler from a channel
   */
  unbind(channelName: string, eventName: string, callback?: (data: any) => void): void {
    const subscription = this.subscriptions.get(channelName);
    if (subscription) {
      if (callback) {
        // Remove specific handler
        subscription.handlers = subscription.handlers.filter(
          (h) => !(h.event === eventName && h.callback === callback)
        );
      } else {
        // Remove all handlers for this event
        subscription.handlers = subscription.handlers.filter((h) => h.event !== eventName);
      }
    }
  }

  /**
   * Unbind all handlers from a channel
   */
  unbindAll(channelName: string): void {
    const subscription = this.subscriptions.get(channelName);
    if (subscription) {
      subscription.handlers = [];
    }
  }

  /**
   * Get event history for a channel
   * @param channelName Optional channel filter
   * @param limit Maximum number of events to return
   */
  getEventHistory(channelName?: string, limit = 100): EventRecord[] {
    let history = [...this.eventHistory];
    
    if (channelName) {
      history = history.filter((record) => record.channelName === channelName);
    }
    
    // Return most recent events first
    return history
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get current subscriptions
   */
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Get handler count for a channel
   */
  getHandlerCount(channelName: string): number {
    const subscription = this.subscriptions.get(channelName);
    return subscription ? subscription.handlers.length : 0;
  }

  /**
   * Reset all state (for test isolation)
   */
  reset(): void {
    this.subscriptions.clear();
    this.eventHistory = [];
  }

  /**
   * Get statistics about current state
   */
  getStats(): {
    channelCount: number;
    totalHandlers: number;
    eventHistorySize: number;
  } {
    let totalHandlers = 0;
    for (const subscription of this.subscriptions.values()) {
      totalHandlers += subscription.handlers.length;
    }

    return {
      channelCount: this.subscriptions.size,
      totalHandlers,
      eventHistorySize: this.eventHistory.length,
    };
  }

  /**
   * Record an event in history
   */
  private recordEvent(channelName: string, eventName: string, data: any): void {
    this.eventHistory.push({
      channelName,
      eventName,
      data,
      timestamp: new Date(),
    });

    // Trim history if it exceeds max size
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }
}

// Export singleton instance
export const pusherMockState = PusherMockState.getInstance();
