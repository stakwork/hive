/**
 * Pusher Mock State Manager
 * 
 * Provides in-memory event storage and subscription management for mocking Pusher operations
 * during local development and testing. Follows singleton pattern consistent with other mock
 * state managers in the codebase.
 * 
 * Features:
 * - Channel-based event storage with TTL
 * - Subscriber management for polling-based delivery
 * - Event history tracking
 * - Automatic cleanup of expired events
 * - Debug endpoint support
 */

export interface PusherEvent {
  channel: string;
  event: string;
  data: any;
  timestamp: Date;
  id: string;
}

interface Subscriber {
  subscriberId: string;
  channel: string;
  lastPollTimestamp: Date;
}

interface EventDeliveryRecord {
  eventId: string;
  subscriberId: string;
  deliveredAt: Date;
}

export class PusherMockState {
  private static instance: PusherMockState;
  
  // Events by channel
  private events: Map<string, PusherEvent[]> = new Map();
  
  // Active subscribers
  private subscribers: Map<string, Subscriber> = new Map();
  
  // Delivery tracking to prevent duplicate delivery
  private deliveries: Map<string, Set<string>> = new Map(); // eventId -> Set<subscriberId>
  
  // Configuration
  private readonly EVENT_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
  private cleanupTimer: NodeJS.Timeout | null = null;

  private constructor() {
    // Start automatic cleanup
    this.startCleanup();
  }

  static getInstance(): PusherMockState {
    if (!PusherMockState.instance) {
      PusherMockState.instance = new PusherMockState();
    }
    return PusherMockState.instance;
  }

  /**
   * Trigger an event on a channel
   * Stores the event for polling subscribers
   */
  trigger(channel: string, event: string, data: any): string {
    const pusherEvent: PusherEvent = {
      channel,
      event,
      data,
      timestamp: new Date(),
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    };

    if (!this.events.has(channel)) {
      this.events.set(channel, []);
    }

    this.events.get(channel)!.push(pusherEvent);
    
    return pusherEvent.id;
  }

  /**
   * Subscribe to a channel
   * Registers a subscriber for event polling
   */
  subscribe(channel: string, subscriberId: string): void {
    this.subscribers.set(subscriberId, {
      subscriberId,
      channel,
      lastPollTimestamp: new Date(),
    });
  }

  /**
   * Unsubscribe from a channel
   * Removes subscriber registration
   */
  unsubscribe(subscriberId: string): boolean {
    return this.subscribers.delete(subscriberId);
  }

  /**
   * Poll for new events on a channel
   * Returns events that haven't been delivered to this subscriber
   */
  poll(channel: string, subscriberId: string, since?: Date): PusherEvent[] {
    const subscriber = this.subscribers.get(subscriberId);
    
    if (!subscriber || subscriber.channel !== channel) {
      return [];
    }

    // Update last poll timestamp
    subscriber.lastPollTimestamp = new Date();

    const channelEvents = this.events.get(channel) || [];
    const sinceTimestamp = since || new Date(0);

    // Filter events that are new and not yet delivered to this subscriber
    const newEvents = channelEvents.filter(event => {
      // Check if event is after the since timestamp
      if (event.timestamp <= sinceTimestamp) {
        return false;
      }

      // Check if already delivered to this subscriber
      const deliveredTo = this.deliveries.get(event.id);
      if (deliveredTo && deliveredTo.has(subscriberId)) {
        return false;
      }

      return true;
    });

    // Mark events as delivered
    newEvents.forEach(event => {
      if (!this.deliveries.has(event.id)) {
        this.deliveries.set(event.id, new Set());
      }
      this.deliveries.get(event.id)!.add(subscriberId);
    });

    return newEvents;
  }

  /**
   * Get all events for a channel (for debugging)
   */
  getChannelEvents(channel: string): PusherEvent[] {
    return this.events.get(channel) || [];
  }

  /**
   * Get all active subscribers (for debugging)
   */
  getSubscribers(): Subscriber[] {
    return Array.from(this.subscribers.values());
  }

  /**
   * Get subscriber info
   */
  getSubscriber(subscriberId: string): Subscriber | undefined {
    return this.subscribers.get(subscriberId);
  }

  /**
   * Check if a subscriber exists
   */
  hasSubscriber(subscriberId: string): boolean {
    return this.subscribers.has(subscriberId);
  }

  /**
   * Get debug information about mock state
   */
  getDebugInfo(): {
    channels: string[];
    totalEvents: number;
    eventsByChannel: Record<string, number>;
    subscribers: number;
    subscribersByChannel: Record<string, number>;
  } {
    const eventsByChannel: Record<string, number> = {};
    let totalEvents = 0;

    this.events.forEach((events, channel) => {
      eventsByChannel[channel] = events.length;
      totalEvents += events.length;
    });

    const subscribersByChannel: Record<string, number> = {};
    this.subscribers.forEach(sub => {
      subscribersByChannel[sub.channel] = (subscribersByChannel[sub.channel] || 0) + 1;
    });

    return {
      channels: Array.from(this.events.keys()),
      totalEvents,
      eventsByChannel,
      subscribers: this.subscribers.size,
      subscribersByChannel,
    };
  }

  /**
   * Reset all state (for test isolation)
   */
  reset(): void {
    this.events.clear();
    this.subscribers.clear();
    this.deliveries.clear();
  }

  /**
   * Cleanup expired events and inactive subscribers
   */
  private cleanup(): void {
    const now = new Date();
    const expirationTime = new Date(now.getTime() - this.EVENT_TTL_MS);

    // Clean up expired events
    this.events.forEach((events, channel) => {
      const validEvents = events.filter(event => event.timestamp > expirationTime);
      
      if (validEvents.length === 0) {
        this.events.delete(channel);
      } else if (validEvents.length !== events.length) {
        this.events.set(channel, validEvents);
      }
    });

    // Clean up delivery records for removed events
    const validEventIds = new Set<string>();
    this.events.forEach(events => {
      events.forEach(event => validEventIds.add(event.id));
    });

    const deliveryKeys = Array.from(this.deliveries.keys());
    deliveryKeys.forEach(eventId => {
      if (!validEventIds.has(eventId)) {
        this.deliveries.delete(eventId);
      }
    });

    // Clean up inactive subscribers (no poll in last 10 minutes)
    const inactiveThreshold = new Date(now.getTime() - 10 * 60 * 1000);
    const subscriberIds = Array.from(this.subscribers.keys());
    
    subscriberIds.forEach(id => {
      const subscriber = this.subscribers.get(id);
      if (subscriber && subscriber.lastPollTimestamp < inactiveThreshold) {
        this.subscribers.delete(id);
      }
    });
  }

  /**
   * Start automatic cleanup timer
   */
  private startCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL_MS);

    // Prevent timer from blocking process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop cleanup timer (for testing)
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

// Export singleton instance
export const pusherMockState = PusherMockState.getInstance();
