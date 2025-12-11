/**
 * Pusher Mock State Manager
 * 
 * Provides in-memory state management for mock Pusher real-time messaging.
 * Maintains channel subscriptions, event bindings, and message history.
 */

interface MockEvent {
  event: string;
  data: any;
  timestamp: Date;
}

interface MockSubscriber {
  id: string;
  callbacks: Map<string, Set<Function>>;
}

interface MockChannel {
  name: string;
  subscribers: Map<string, MockSubscriber>;
  eventHistory: MockEvent[];
}

class PusherMockState {
  private channels: Map<string, MockChannel> = new Map();
  private maxHistoryPerChannel = 100;

  /**
   * Trigger an event on a channel
   * Delivers event synchronously to all subscribers
   */
  trigger(channelName: string, event: string, data: any): void {
    // Get or create channel
    if (!this.channels.has(channelName)) {
      this.channels.set(channelName, {
        name: channelName,
        subscribers: new Map(),
        eventHistory: [],
      });
    }

    const channel = this.channels.get(channelName)!;

    // Store event in history
    channel.eventHistory.push({
      event,
      data,
      timestamp: new Date(),
    });

    // Trim history if needed
    if (channel.eventHistory.length > this.maxHistoryPerChannel) {
      channel.eventHistory.shift();
    }

    // Deliver to all subscribers synchronously
    channel.subscribers.forEach((subscriber) => {
      const callbacks = subscriber.callbacks.get(event);
      if (callbacks) {
        callbacks.forEach((callback) => {
          try {
            callback(data);
          } catch (error) {
            console.error(
              `Error in Pusher mock callback for event ${event}:`,
              error
            );
          }
        });
      }
    });
  }

  /**
   * Subscribe to a channel
   * Returns channel name for reference
   */
  subscribe(channelName: string, subscriberId: string): string {
    // Get or create channel
    if (!this.channels.has(channelName)) {
      this.channels.set(channelName, {
        name: channelName,
        subscribers: new Map(),
        eventHistory: [],
      });
    }

    const channel = this.channels.get(channelName)!;

    // Get or create subscriber
    if (!channel.subscribers.has(subscriberId)) {
      channel.subscribers.set(subscriberId, {
        id: subscriberId,
        callbacks: new Map(),
      });
    }

    return channelName;
  }

  /**
   * Bind a callback to an event for a subscriber
   */
  bind(subscriberId: string, channelName: string, event: string, callback: Function): void {
    const channel = this.channels.get(channelName);
    if (!channel) {
      console.warn(`Channel ${channelName} not found when binding event ${event}`);
      return;
    }

    const subscriber = channel.subscribers.get(subscriberId);
    if (!subscriber) {
      console.warn(
        `Subscriber ${subscriberId} not found in channel ${channelName}`
      );
      return;
    }

    // Get or create event callback set
    if (!subscriber.callbacks.has(event)) {
      subscriber.callbacks.set(event, new Set());
    }

    subscriber.callbacks.get(event)!.add(callback);
  }

  /**
   * Unbind a specific callback or all callbacks for an event
   */
  unbind(
    subscriberId: string,
    channelName: string,
    event: string,
    callback?: Function
  ): void {
    const channel = this.channels.get(channelName);
    if (!channel) return;

    const subscriber = channel.subscribers.get(subscriberId);
    if (!subscriber) return;

    if (callback) {
      // Remove specific callback
      subscriber.callbacks.get(event)?.delete(callback);
    } else {
      // Remove all callbacks for event
      subscriber.callbacks.delete(event);
    }
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(subscriberId: string, channelName: string): void {
    const channel = this.channels.get(channelName);
    if (!channel) return;

    channel.subscribers.delete(subscriberId);

    // Clean up empty channels
    if (channel.subscribers.size === 0) {
      this.channels.delete(channelName);
    }
  }

  /**
   * Get event history for a channel
   */
  getChannelHistory(channelName: string, limit?: number): MockEvent[] {
    const channel = this.channels.get(channelName);
    if (!channel) return [];

    const history = channel.eventHistory;
    if (limit && limit > 0) {
      return history.slice(-limit);
    }
    return [...history];
  }

  /**
   * Get all channels
   */
  getChannels(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Get subscriber count for a channel
   */
  getSubscriberCount(channelName: string): number {
    const channel = this.channels.get(channelName);
    return channel ? channel.subscribers.size : 0;
  }

  /**
   * Reset all state (for testing)
   */
  reset(): void {
    this.channels.clear();
  }

  /**
   * Get debug information
   */
  getDebugInfo(): {
    channels: number;
    totalSubscribers: number;
    totalEvents: number;
  } {
    let totalSubscribers = 0;
    let totalEvents = 0;

    this.channels.forEach((channel) => {
      totalSubscribers += channel.subscribers.size;
      totalEvents += channel.eventHistory.length;
    });

    return {
      channels: this.channels.size,
      totalSubscribers,
      totalEvents,
    };
  }
}

// Singleton instance
export const pusherMockState = new PusherMockState();
