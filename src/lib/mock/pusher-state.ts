/**
 * PusherMockState - In-memory state manager for Pusher mock implementation
 *
 * Manages channels, subscriptions, and event broadcasting without requiring
 * external Pusher service. Acts as an in-memory event bus for real-time
 * communication across multiple browser tabs/clients.
 *
 * Features:
 * - Channel subscription/unsubscription
 * - Event binding with multiple listeners per event
 * - Synchronous event broadcasting (simulates WebSocket behavior)
 * - Test isolation via reset() method
 * - Automatic cleanup of empty channels
 */

export type EventCallback = (data: any) => void;

export interface ChannelSubscription {
  channelName: string;
  eventHandlers: Map<string, Set<EventCallback>>;
}

export class PusherMockState {
  private static instance: PusherMockState;

  // Map of channel names to their subscribers
  private channels: Map<string, ChannelSubscription> = new Map();

  // Global connection state
  private connected = false;
  private connectionId: string | null = null;

  private constructor() {
    // Private constructor for singleton
    this.connectionId = this.generateConnectionId();
  }

  static getInstance(): PusherMockState {
    if (!PusherMockState.instance) {
      PusherMockState.instance = new PusherMockState();
    }
    return PusherMockState.instance;
  }

  /**
   * Subscribe to a channel
   * Auto-creates channel if it doesn't exist
   */
  subscribe(channelName: string): ChannelSubscription {
    if (!this.channels.has(channelName)) {
      console.log(`[Pusher Mock] Creating channel: ${channelName}`);
      this.channels.set(channelName, {
        channelName,
        eventHandlers: new Map(),
      });
    }

    const subscription = this.channels.get(channelName)!;
    console.log(
      `[Pusher Mock] Subscribed to channel: ${channelName} (${this.channels.size} total channels)`
    );

    // Trigger subscription_succeeded event
    this.triggerSubscriptionSuccess(channelName);

    return subscription;
  }

  /**
   * Unsubscribe from a channel
   * Removes channel if no more event handlers exist
   */
  unsubscribe(channelName: string): void {
    const subscription = this.channels.get(channelName);
    if (subscription) {
      console.log(`[Pusher Mock] Unsubscribing from channel: ${channelName}`);

      // Clear all event handlers for this channel
      subscription.eventHandlers.clear();

      // Remove channel from map
      this.channels.delete(channelName);

      console.log(
        `[Pusher Mock] Channel removed: ${channelName} (${this.channels.size} remaining)`
      );
    }
  }

  /**
   * Bind an event listener to a channel
   */
  bind(channelName: string, event: string, callback: EventCallback): void {
    const subscription = this.channels.get(channelName);
    if (!subscription) {
      console.warn(
        `[Pusher Mock] Cannot bind to unsubscribed channel: ${channelName}`
      );
      return;
    }

    if (!subscription.eventHandlers.has(event)) {
      subscription.eventHandlers.set(event, new Set());
    }

    subscription.eventHandlers.get(event)!.add(callback);
    console.log(
      `[Pusher Mock] Bound event "${event}" on channel "${channelName}" (${subscription.eventHandlers.get(event)!.size} listeners)`
    );
  }

  /**
   * Unbind an event listener from a channel
   */
  unbind(
    channelName: string,
    event: string,
    callback?: EventCallback
  ): void {
    const subscription = this.channels.get(channelName);
    if (!subscription) {
      return;
    }

    const handlers = subscription.eventHandlers.get(event);
    if (!handlers) {
      return;
    }

    if (callback) {
      // Remove specific callback
      handlers.delete(callback);
      console.log(
        `[Pusher Mock] Unbound specific callback for "${event}" on channel "${channelName}"`
      );
    } else {
      // Remove all callbacks for this event
      handlers.clear();
      console.log(
        `[Pusher Mock] Unbound all callbacks for "${event}" on channel "${channelName}"`
      );
    }

    // Clean up empty event handler sets
    if (handlers.size === 0) {
      subscription.eventHandlers.delete(event);
    }
  }

  /**
   * Unbind all events from a channel
   */
  unbindAll(channelName: string): void {
    const subscription = this.channels.get(channelName);
    if (subscription) {
      subscription.eventHandlers.clear();
      console.log(
        `[Pusher Mock] Unbound all events from channel: ${channelName}`
      );
    }
  }

  /**
   * Trigger an event on a channel (server-side broadcast)
   * Synchronously notifies all subscribed clients
   */
  async trigger(
    channel: string,
    event: string,
    data: any
  ): Promise<{ channels: Record<string, {}> }> {
    console.log(
      `[Pusher Mock] Triggering event "${event}" on channel "${channel}"`
    );

    const subscription = this.channels.get(channel);

    if (!subscription) {
      console.log(
        `[Pusher Mock] No subscribers for channel "${channel}" - event not delivered`
      );
      return { channels: { [channel]: {} } };
    }

    const handlers = subscription.eventHandlers.get(event);
    if (!handlers || handlers.size === 0) {
      console.log(
        `[Pusher Mock] No handlers for event "${event}" on channel "${channel}"`
      );
      return { channels: { [channel]: {} } };
    }

    // Notify all subscribers synchronously (simulates WebSocket delivery)
    console.log(
      `[Pusher Mock] Notifying ${handlers.size} listeners for "${event}" on "${channel}"`
    );

    handlers.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error(
          `[Pusher Mock] Error in event handler for "${event}":`,
          error
        );
      }
    });

    return { channels: { [channel]: {} } };
  }

  /**
   * Trigger multiple events in batch (server-side broadcast)
   */
  async triggerBatch(
    batch: Array<{ channel: string; name: string; data: any }>
  ): Promise<{ batch: Array<{}> }> {
    console.log(`[Pusher Mock] Triggering batch of ${batch.length} events`);

    const results = await Promise.all(
      batch.map((event) => this.trigger(event.channel, event.name, event.data))
    );

    return { batch: results.map(() => ({})) };
  }

  /**
   * Trigger internal subscription_succeeded event
   */
  private triggerSubscriptionSuccess(channelName: string): void {
    // Simulate the pusher:subscription_succeeded internal event
    setTimeout(() => {
      const subscription = this.channels.get(channelName);
      if (subscription) {
        const handlers = subscription.eventHandlers.get(
          "pusher:subscription_succeeded"
        );
        if (handlers) {
          handlers.forEach((callback) => {
            try {
              callback({});
            } catch (error) {
              console.error(
                "[Pusher Mock] Error in subscription_succeeded handler:",
                error
              );
            }
          });
        }
      }
    }, 0);
  }

  /**
   * Get connection state
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Set connection state
   */
  setConnected(connected: boolean): void {
    this.connected = connected;
    console.log(`[Pusher Mock] Connection state: ${connected}`);
  }

  /**
   * Get connection ID
   */
  getConnectionId(): string | null {
    return this.connectionId;
  }

  /**
   * Generate a mock connection ID
   */
  private generateConnectionId(): string {
    return `mock-connection-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get all active channels (for debugging)
   */
  getActiveChannels(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Get channel subscription count (for debugging)
   */
  getChannelListenerCount(channelName: string, event: string): number {
    const subscription = this.channels.get(channelName);
    if (!subscription) return 0;

    const handlers = subscription.eventHandlers.get(event);
    return handlers ? handlers.size : 0;
  }

  /**
   * Reset all state (for test isolation)
   */
  reset(): void {
    console.log("[Pusher Mock] Resetting all state");
    this.channels.clear();
    this.connected = false;
    this.connectionId = this.generateConnectionId();
  }
}

// Export singleton instance
export const pusherMockState = PusherMockState.getInstance();
