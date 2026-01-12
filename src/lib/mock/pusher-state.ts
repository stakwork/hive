import { EventEmitter } from "events";
import { logger } from "../logger";

/**
 * Represents a single Pusher event in the mock state
 */
export interface MockPusherEvent {
  id: string;
  channel: string;
  eventName: string;
  data: unknown;
  timestamp: number;
}

/**
 * Subscription tracking for mock channels
 */
interface ChannelSubscription {
  channel: string;
  subscriptionId: string;
  subscribedAt: number;
}

/**
 * Mock Pusher State Manager
 * 
 * Singleton service managing in-memory Pusher event storage for mock mode.
 * Stores events per channel with automatic cleanup and deduplication support.
 */
class MockPusherStateManager extends EventEmitter {
  private static instance: MockPusherStateManager | null = null;
  private eventQueues: Map<string, MockPusherEvent[]> = new Map();
  private subscriptions: Map<string, ChannelSubscription> = new Map();
  private eventIdCounter = 0;
  private readonly MAX_EVENTS_PER_CHANNEL = 100;
  private readonly EVENT_RETENTION_MS = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    super();
    this.setMaxListeners(100); // Allow many subscribers
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): MockPusherStateManager {
    if (!MockPusherStateManager.instance) {
      MockPusherStateManager.instance = new MockPusherStateManager();
    }
    return MockPusherStateManager.instance;
  }

  /**
   * Trigger a Pusher event (server-side)
   */
  public trigger(
    channels: string | string[],
    eventName: string,
    data: unknown
  ): void {
    const channelArray = Array.isArray(channels) ? channels : [channels];

    channelArray.forEach((channel) => {
      const event: MockPusherEvent = {
        id: this.generateEventId(),
        channel,
        eventName,
        data,
        timestamp: Date.now(),
      };

      this.storeEvent(channel, event);
      this.emit("event", { channel, event });

      logger.debug("[MockPusher] Event triggered", "MockPusher", {
        channel,
        eventName,
        eventId: event.id,
      });
    });
  }

  /**
   * Get events for a specific channel since a given event ID
   */
  public getEvents(channel: string, sinceEventId?: string): MockPusherEvent[] {
    const queue = this.eventQueues.get(channel) || [];

    if (!sinceEventId) {
      return [...queue];
    }

    // Find index of last seen event and return everything after it
    const lastSeenIndex = queue.findIndex((event) => event.id === sinceEventId);
    if (lastSeenIndex === -1) {
      // Event ID not found - return all events (client may have missed some)
      return [...queue];
    }

    return queue.slice(lastSeenIndex + 1);
  }

  /**
   * Subscribe to a channel
   */
  public subscribe(channel: string): ChannelSubscription {
    const subscription: ChannelSubscription = {
      channel,
      subscriptionId: this.generateSubscriptionId(),
      subscribedAt: Date.now(),
    };

    this.subscriptions.set(subscription.subscriptionId, subscription);

    logger.debug("[MockPusher] Channel subscribed", "MockPusher", {
      channel,
      subscriptionId: subscription.subscriptionId,
    });

    return subscription;
  }

  /**
   * Unsubscribe from a channel
   */
  public unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      this.subscriptions.delete(subscriptionId);
      logger.debug("[MockPusher] Channel unsubscribed", "MockPusher", {
        channel: subscription.channel,
        subscriptionId,
      });
    }
  }

  /**
   * Get all active subscriptions
   */
  public getSubscriptions(): ChannelSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Check if a channel has active subscriptions
   */
  public hasSubscription(channel: string): boolean {
    return Array.from(this.subscriptions.values()).some(
      (sub) => sub.channel === channel
    );
  }

  /**
   * Reset all state (for testing)
   */
  public reset(): void {
    this.eventQueues.clear();
    this.subscriptions.clear();
    this.eventIdCounter = 0;
    this.removeAllListeners();
    logger.debug("[MockPusher] State reset", "MockPusher");
  }

  /**
   * Clean up old events from all channels
   */
  public cleanupOldEvents(): void {
    const cutoffTime = Date.now() - this.EVENT_RETENTION_MS;
    let totalCleaned = 0;

    this.eventQueues.forEach((queue, channel) => {
      const initialLength = queue.length;
      const cleaned = queue.filter((event) => event.timestamp >= cutoffTime);
      this.eventQueues.set(channel, cleaned);
      totalCleaned += initialLength - cleaned.length;
    });

    if (totalCleaned > 0) {
      logger.debug("[MockPusher] Cleaned up old events", "MockPusher", {
        count: totalCleaned,
      });
    }
  }

  /**
   * Get statistics about current state
   */
  public getStats(): {
    totalEvents: number;
    channelCount: number;
    subscriptionCount: number;
    eventsByChannel: Record<string, number>;
  } {
    const eventsByChannel: Record<string, number> = {};
    let totalEvents = 0;

    this.eventQueues.forEach((queue, channel) => {
      eventsByChannel[channel] = queue.length;
      totalEvents += queue.length;
    });

    return {
      totalEvents,
      channelCount: this.eventQueues.size,
      subscriptionCount: this.subscriptions.size,
      eventsByChannel,
    };
  }

  /**
   * Store event in channel queue with size limits
   */
  private storeEvent(channel: string, event: MockPusherEvent): void {
    if (!this.eventQueues.has(channel)) {
      this.eventQueues.set(channel, []);
    }

    const queue = this.eventQueues.get(channel)!;
    queue.push(event);

    // Enforce max events per channel (FIFO)
    if (queue.length > this.MAX_EVENTS_PER_CHANNEL) {
      queue.shift(); // Remove oldest event
    }
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    this.eventIdCounter++;
    return `evt_${Date.now()}_${this.eventIdCounter}`;
  }

  /**
   * Generate unique subscription ID
   */
  private generateSubscriptionId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}

/**
 * Singleton instance export
 */
export const mockPusherState = MockPusherStateManager.getInstance();
