/**
 * Pusher Mock State Manager
 *
 * Provides in-memory event bus for mocking Pusher real-time messaging during local development and testing.
 * Follows singleton pattern consistent with other mock state managers in the codebase.
 *
 * Features:
 * - In-memory channel event storage with 60-second TTL
 * - Automatic cleanup every 10 seconds
 * - Subscriber management with callback invocation
 * - Channel and event isolation
 * - Polling support for SSR scenarios
 * - Reset capability for test isolation
 *
 * Supports all Pusher channels and events:
 * - Channels: task-{taskId}, workspace-{workspaceSlug}
 * - Events: NEW_MESSAGE, TASK_TITLE_UPDATE, WORKSPACE_TASK_TITLE_UPDATE,
 *   STAKWORK_RUN_UPDATE, RECOMMENDATIONS_UPDATED, and others
 */

interface ChannelEvent {
  event: string;
  data: any;
  timestamp: number;
}

interface Subscriber {
  callback: (data: any) => void;
  eventType?: string; // If specified, only receive this event type
}

interface ChannelSubscribers {
  subscribers: Subscriber[];
  events: ChannelEvent[];
}

interface MockChannel {
  channelName: string;
  bind: (eventName: string, callback: (data: any) => void) => void;
  unbind: (eventName: string, callback?: (data: any) => void) => void;
  unbind_all: () => void;
}

export class MockPusherState {
  private static instance: MockPusherState;
  private channels: Map<string, ChannelSubscribers> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly EVENT_TTL_MS = 60000; // 60 seconds
  private readonly CLEANUP_INTERVAL_MS = 10000; // 10 seconds

  private constructor() {
    // Private constructor for singleton pattern
    this.startCleanup();
  }

  static getInstance(): MockPusherState {
    if (!MockPusherState.instance) {
      MockPusherState.instance = new MockPusherState();
    }
    return MockPusherState.instance;
  }

  /**
   * Trigger an event on a channel (server-side operation)
   * Stores event in memory and invokes all matching subscribers
   */
  trigger(channel: string, event: string, data: any): void {
    const now = Date.now();
    const channelData = this.getOrCreateChannel(channel);

    // Store event with timestamp
    const channelEvent: ChannelEvent = {
      event,
      data,
      timestamp: now,
    };
    channelData.events.push(channelEvent);

    // Invoke all subscribers for this channel and event
    this.notifySubscribers(channel, event, data);
  }

  /**
   * Subscribe to a channel (client-side operation)
   * Returns a mock channel object compatible with Pusher-JS API
   */
  subscribe(channelName: string): MockChannel {
    const channelData = this.getOrCreateChannel(channelName);

    // Create mock channel object with Pusher-JS compatible interface
    const mockChannel: MockChannel = {
      channelName,
      bind: (eventName: string, callback: (data: any) => void) => {
        this.addSubscriber(channelName, callback, eventName);
      },
      unbind: (eventName: string, callback?: (data: any) => void) => {
        this.removeSubscriber(channelName, callback, eventName);
      },
      unbind_all: () => {
        this.removeAllSubscribers(channelName);
      },
    };

    // Simulate async subscription success
    setTimeout(() => {
      this.notifySubscribers(channelName, "pusher:subscription_succeeded", {});
    }, 10);

    return mockChannel;
  }

  /**
   * Unsubscribe from a channel (client-side operation)
   */
  unsubscribe(channelName: string): void {
    this.removeAllSubscribers(channelName);
  }

  /**
   * Add a subscriber to a channel
   */
  private addSubscriber(
    channel: string,
    callback: (data: any) => void,
    eventType?: string
  ): void {
    const channelData = this.getOrCreateChannel(channel);
    channelData.subscribers.push({
      callback,
      eventType,
    });
  }

  /**
   * Remove a subscriber from a channel
   */
  private removeSubscriber(
    channel: string,
    callback?: (data: any) => void,
    eventType?: string
  ): void {
    const channelData = this.channels.get(channel);
    if (!channelData) return;

    if (callback) {
      // Remove specific callback
      channelData.subscribers = channelData.subscribers.filter(
        (sub) =>
          sub.callback !== callback ||
          (eventType && sub.eventType !== eventType)
      );
    } else if (eventType) {
      // Remove all callbacks for specific event type
      channelData.subscribers = channelData.subscribers.filter(
        (sub) => sub.eventType !== eventType
      );
    }
  }

  /**
   * Remove all subscribers from a channel
   */
  private removeAllSubscribers(channel: string): void {
    const channelData = this.channels.get(channel);
    if (!channelData) return;

    channelData.subscribers = [];
  }

  /**
   * Notify all subscribers of an event
   */
  private notifySubscribers(channel: string, event: string, data: any): void {
    const channelData = this.channels.get(channel);
    if (!channelData) return;

    // Invoke callbacks for subscribers matching this event type (or all events if not specified)
    channelData.subscribers.forEach((subscriber) => {
      if (!subscriber.eventType || subscriber.eventType === event) {
        try {
          subscriber.callback(data);
        } catch (error) {
          console.error(
            `Error in Pusher mock subscriber callback for ${channel}/${event}:`,
            error
          );
        }
      }
    });
  }

  /**
   * Poll for events on specific channels (SSR support)
   * Returns events since the specified timestamp
   */
  poll(channels: string[], since?: number): Record<string, ChannelEvent[]> {
    const result: Record<string, ChannelEvent[]> = {};
    const cutoff = since || 0;

    channels.forEach((channel) => {
      const channelData = this.channels.get(channel);
      if (channelData) {
        result[channel] = channelData.events.filter(
          (event) => event.timestamp > cutoff
        );
      } else {
        result[channel] = [];
      }
    });

    return result;
  }

  /**
   * Get or create channel data structure
   */
  private getOrCreateChannel(channel: string): ChannelSubscribers {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, {
        subscribers: [],
        events: [],
      });
    }
    return this.channels.get(channel)!;
  }

  /**
   * Start automatic cleanup interval
   */
  private startCleanup(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL_MS);

    // Ensure cleanup runs on process exit
    if (typeof process !== "undefined") {
      process.on("exit", () => this.stopCleanup());
    }
  }

  /**
   * Stop automatic cleanup interval
   */
  private stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Remove expired events (older than TTL)
   */
  cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.EVENT_TTL_MS;

    this.channels.forEach((channelData) => {
      channelData.events = channelData.events.filter(
        (event) => event.timestamp > cutoff
      );
    });

    // Remove empty channels (no subscribers and no events)
    const channelsToRemove: string[] = [];
    this.channels.forEach((channelData, channel) => {
      if (
        channelData.subscribers.length === 0 &&
        channelData.events.length === 0
      ) {
        channelsToRemove.push(channel);
      }
    });
    channelsToRemove.forEach((channel) => this.channels.delete(channel));
  }

  /**
   * Reset all state (for test isolation)
   */
  reset(): void {
    this.stopCleanup();
    this.channels.clear();
    this.startCleanup();
  }

  /**
   * Get statistics for debugging and testing
   */
  getStats(): {
    channelCount: number;
    totalEventCount: number;
    totalSubscriberCount: number;
    channels: Record<
      string,
      { eventCount: number; subscriberCount: number }
    >;
  } {
    const channels: Record<
      string,
      { eventCount: number; subscriberCount: number }
    > = {};
    let totalEventCount = 0;
    let totalSubscriberCount = 0;

    this.channels.forEach((channelData, channelName) => {
      channels[channelName] = {
        eventCount: channelData.events.length,
        subscriberCount: channelData.subscribers.length,
      };
      totalEventCount += channelData.events.length;
      totalSubscriberCount += channelData.subscribers.length;
    });

    return {
      channelCount: this.channels.size,
      totalEventCount,
      totalSubscriberCount,
      channels,
    };
  }

  /**
   * Check if a channel has active subscribers
   */
  hasSubscribers(channel: string): boolean {
    const channelData = this.channels.get(channel);
    return channelData ? channelData.subscribers.length > 0 : false;
  }

  /**
   * Get events for a specific channel (for testing/debugging)
   */
  getChannelEvents(channel: string): ChannelEvent[] {
    const channelData = this.channels.get(channel);
    return channelData ? [...channelData.events] : [];
  }
}

// Export singleton instance
export const mockPusherState = MockPusherState.getInstance();
