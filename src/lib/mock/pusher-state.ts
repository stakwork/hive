/**
 * Pusher Mock State Manager
 *
 * Manages in-memory state for Pusher mock including:
 * - Channels and their subscribers
 * - Event callbacks per channel
 * - Message history (last 100 messages per channel)
 * - Connection tracking
 *
 * Used by MockPusherServer and MockPusherClient to simulate real-time messaging
 * without external dependencies during development and testing.
 */

export interface PusherMessage {
  channel: string;
  event: string;
  data: unknown;
  timestamp: number;
}

export interface ChannelState {
  subscribers: Set<string>;
  eventCallbacks: Map<string, Set<(data: unknown) => void>>;
  messageHistory: PusherMessage[];
}

export interface SubscriptionState {
  channels: Set<string>;
  eventCallbacks: Map<string, Set<(data: unknown) => void>>;
}

class PusherMockStateManager {
  private channels: Map<string, ChannelState> = new Map();
  private subscriptions: Map<string, SubscriptionState> = new Map();
  private connectionIdCounter = 0;
  private readonly MESSAGE_HISTORY_LIMIT = 100;

  /**
   * Generate unique connection ID for each client
   */
  generateConnectionId(): string {
    return `mock-connection-${++this.connectionIdCounter}`;
  }

  /**
   * Get or create channel state
   */
  private getOrCreateChannel(channelName: string): ChannelState {
    if (!this.channels.has(channelName)) {
      this.channels.set(channelName, {
        subscribers: new Set(),
        eventCallbacks: new Map(),
        messageHistory: [],
      });
    }
    return this.channels.get(channelName)!;
  }

  /**
   * Get or create subscription state for connection
   */
  private getOrCreateSubscription(connectionId: string): SubscriptionState {
    if (!this.subscriptions.has(connectionId)) {
      this.subscriptions.set(connectionId, {
        channels: new Set(),
        eventCallbacks: new Map(),
      });
    }
    return this.subscriptions.get(connectionId)!;
  }

  /**
   * Subscribe a connection to a channel
   */
  subscribe(connectionId: string, channelName: string): void {
    const channel = this.getOrCreateChannel(channelName);
    const subscription = this.getOrCreateSubscription(connectionId);

    channel.subscribers.add(connectionId);
    subscription.channels.add(channelName);
  }

  /**
   * Unsubscribe a connection from a channel
   */
  unsubscribe(connectionId: string, channelName: string): void {
    const channel = this.channels.get(channelName);
    const subscription = this.subscriptions.get(connectionId);

    if (subscription) {
      subscription.channels.delete(channelName);
      // Remove event callbacks for this channel from subscription
      const callbacksToRemove: string[] = [];
      subscription.eventCallbacks.forEach((callbacks, key) => {
        if (key.startsWith(`${channelName}:`)) {
          // Also remove these callbacks from the channel
          if (channel) {
            const eventName = key.split(":")[1];
            const channelCallbacks = channel.eventCallbacks.get(eventName);
            if (channelCallbacks) {
              callbacks.forEach((cb) => channelCallbacks.delete(cb));
            }
          }
          callbacksToRemove.push(key);
        }
      });
      callbacksToRemove.forEach((key) => subscription.eventCallbacks.delete(key));
    }

    if (channel) {
      channel.subscribers.delete(connectionId);
      // Clean up channel if no subscribers
      if (channel.subscribers.size === 0) {
        this.channels.delete(channelName);
      }
    }
  }

  /**
   * Bind event callback for a connection on a channel
   */
  bind(
    connectionId: string,
    channelName: string,
    eventName: string,
    callback: (data: unknown) => void,
  ): void {
    const channel = this.getOrCreateChannel(channelName);
    const subscription = this.getOrCreateSubscription(connectionId);

    const eventKey = `${channelName}:${eventName}`;

    // Store callback in channel state
    if (!channel.eventCallbacks.has(eventName)) {
      channel.eventCallbacks.set(eventName, new Set());
    }
    channel.eventCallbacks.get(eventName)!.add(callback);

    // Store callback in subscription state
    if (!subscription.eventCallbacks.has(eventKey)) {
      subscription.eventCallbacks.set(eventKey, new Set());
    }
    subscription.eventCallbacks.get(eventKey)!.add(callback);
  }

  /**
   * Unbind event callback for a connection on a channel
   */
  unbind(
    connectionId: string,
    channelName: string,
    eventName: string,
    callback?: (data: unknown) => void,
  ): void {
    const channel = this.channels.get(channelName);
    const subscription = this.subscriptions.get(connectionId);

    if (!channel || !subscription) return;

    const eventKey = `${channelName}:${eventName}`;

    if (callback) {
      // Remove specific callback
      channel.eventCallbacks.get(eventName)?.delete(callback);
      subscription.eventCallbacks.get(eventKey)?.delete(callback);
    } else {
      // Remove all callbacks for this event
      channel.eventCallbacks.delete(eventName);
      subscription.eventCallbacks.delete(eventKey);
    }
  }

  /**
   * Trigger an event on a channel (server-side)
   * Stores message in history and notifies all subscribers
   */
  trigger(channelName: string, eventName: string, data: unknown): void {
    const channel = this.getOrCreateChannel(channelName);

    const message: PusherMessage = {
      channel: channelName,
      event: eventName,
      data,
      timestamp: Date.now(),
    };

    // Add to message history (maintain limit)
    channel.messageHistory.push(message);
    if (channel.messageHistory.length > this.MESSAGE_HISTORY_LIMIT) {
      channel.messageHistory.shift();
    }

    // Execute callbacks for this event
    const callbacks = channel.eventCallbacks.get(eventName);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error executing Pusher callback for ${channelName}:${eventName}`, error);
        }
      });
    }
  }

  /**
   * Get recent messages for a channel since timestamp
   */
  getMessagesSince(channelName: string, since: number): PusherMessage[] {
    const channel = this.channels.get(channelName);
    if (!channel) return [];

    return channel.messageHistory.filter((msg) => msg.timestamp > since);
  }

  /**
   * Get all messages for a channel
   */
  getChannelMessages(channelName: string): PusherMessage[] {
    const channel = this.channels.get(channelName);
    return channel ? [...channel.messageHistory] : [];
  }

  /**
   * Get channel state
   */
  getChannelState(channelName: string): ChannelState | undefined {
    return this.channels.get(channelName);
  }

  /**
   * Get subscription state for connection
   */
  getSubscriptionState(connectionId: string): SubscriptionState | undefined {
    return this.subscriptions.get(connectionId);
  }

  /**
   * Get all active channels
   */
  getActiveChannels(): string[] {
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
   * Disconnect a connection (remove all subscriptions)
   */
  disconnect(connectionId: string): void {
    const subscription = this.subscriptions.get(connectionId);
    if (!subscription) return;

    // Unsubscribe from all channels
    subscription.channels.forEach((channelName) => {
      this.unsubscribe(connectionId, channelName);
    });

    // Remove subscription
    this.subscriptions.delete(connectionId);
  }

  /**
   * Reset all state (for testing)
   */
  reset(): void {
    this.channels.clear();
    this.subscriptions.clear();
    this.connectionIdCounter = 0;
  }

  /**
   * Get current state snapshot (for debugging)
   */
  getState() {
    return {
      channels: Array.from(this.channels.entries()).map(([name, state]) => ({
        name,
        subscriberCount: state.subscribers.size,
        messageCount: state.messageHistory.length,
        events: Array.from(state.eventCallbacks.keys()),
      })),
      subscriptions: Array.from(this.subscriptions.entries()).map(([id, state]) => ({
        connectionId: id,
        channelCount: state.channels.size,
        channels: Array.from(state.channels),
      })),
    };
  }
}

// Export singleton instance
export const pusherMockState = new PusherMockStateManager();
