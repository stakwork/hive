/**
 * Pusher Client Mock Wrapper
 * 
 * Mimics the Pusher.js client API but uses HTTP polling instead of WebSockets.
 * Provides a drop-in replacement for PusherClient when USE_MOCKS=true.
 * 
 * Features:
 * - Polling-based event delivery
 * - Event binding and callback management
 * - Subscribe/unsubscribe lifecycle
 * - Compatible with existing Pusher.js usage patterns
 */

import type { Channel as PusherChannel } from "pusher-js";

interface EventCallback {
  (data: any): void;
}

class MockChannel implements Partial<PusherChannel> {
  public name: string;
  private subscriberId: string;
  private callbacks: Map<string, Set<EventCallback>> = new Map();
  private isSubscribed: boolean = false;
  private pollingTimer: NodeJS.Timeout | null = null;
  private lastPollTime: Date = new Date(0);
  private baseUrl: string;
  private pollingInterval: number;

  constructor(channelName: string, subscriberId: string, baseUrl: string, pollingInterval: number = 1000) {
    this.name = channelName;
    this.subscriberId = subscriberId;
    this.baseUrl = baseUrl;
    this.pollingInterval = pollingInterval;
  }

  /**
   * Bind an event callback
   */
  bind(event: string, callback: EventCallback): this {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, new Set());
    }
    this.callbacks.get(event)!.add(callback);
    return this;
  }

  /**
   * Unbind a specific callback or all callbacks for an event
   */
  unbind(event?: string, callback?: EventCallback): this {
    if (!event) {
      // Unbind all events
      this.callbacks.clear();
    } else if (!callback) {
      // Unbind all callbacks for this event
      this.callbacks.delete(event);
    } else {
      // Unbind specific callback
      const eventCallbacks = this.callbacks.get(event);
      if (eventCallbacks) {
        eventCallbacks.delete(callback);
        if (eventCallbacks.size === 0) {
          this.callbacks.delete(event);
        }
      }
    }
    return this;
  }

  /**
   * Unbind all events and callbacks
   */
  unbind_all(): void {
    this.callbacks.clear();
  }

  /**
   * Start subscription and polling
   */
  async subscribe(): Promise<void> {
    if (this.isSubscribed) return;

    try {
      // Register subscription with mock server
      const response = await fetch(`${this.baseUrl}/api/mock/pusher/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: this.name,
          subscriberId: this.subscriberId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Subscription failed: ${response.statusText}`);
      }

      this.isSubscribed = true;
      this.lastPollTime = new Date();

      // Trigger subscription_succeeded event
      this.triggerEvent('pusher:subscription_succeeded', {});

      // Start polling
      this.startPolling();
    } catch (error) {
      console.error('Mock Pusher subscription error:', error);
      this.triggerEvent('pusher:subscription_error', error);
      throw error;
    }
  }

  /**
   * Stop subscription and polling
   */
  async unsubscribe(): Promise<void> {
    if (!this.isSubscribed) return;

    this.stopPolling();

    try {
      await fetch(`${this.baseUrl}/api/mock/pusher/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriberId: this.subscriberId,
        }),
      });
    } catch (error) {
      console.error('Mock Pusher unsubscribe error:', error);
    }

    this.isSubscribed = false;
  }

  /**
   * Start polling for events
   */
  private startPolling(): void {
    if (this.pollingTimer) return;

    this.pollingTimer = setInterval(async () => {
      await this.poll();
    }, this.pollingInterval);

    // Prevent timer from blocking process exit
    if (this.pollingTimer.unref) {
      this.pollingTimer.unref();
    }
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  /**
   * Poll for new events
   */
  private async poll(): Promise<void> {
    if (!this.isSubscribed) return;

    try {
      const response = await fetch(
        `${this.baseUrl}/api/mock/pusher/poll?` +
        new URLSearchParams({
          channel: this.name,
          subscriberId: this.subscriberId,
          since: this.lastPollTime.toISOString(),
        }),
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        console.error('Mock Pusher poll error:', response.statusText);
        return;
      }

      const data = await response.json();
      const events = data.events || [];

      // Process each event
      events.forEach((event: any) => {
        this.triggerEvent(event.event, event.data);
        
        // Update last poll time to the latest event timestamp
        const eventTime = new Date(event.timestamp);
        if (eventTime > this.lastPollTime) {
          this.lastPollTime = eventTime;
        }
      });
    } catch (error) {
      console.error('Mock Pusher poll error:', error);
    }
  }

  /**
   * Trigger an event to all registered callbacks
   */
  private triggerEvent(event: string, data: any): void {
    const callbacks = this.callbacks.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in Pusher event callback for ${event}:`, error);
        }
      });
    }
  }
}

/**
 * Mock Pusher Client
 * Mimics the PusherClient API but uses HTTP polling
 */
export class MockPusherClient {
  private channels: Map<string, MockChannel> = new Map();
  private baseUrl: string;
  private pollingInterval: number;
  private subscriberId: string;

  constructor(key: string, options?: { cluster?: string; pollingInterval?: number }) {
    this.baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    this.pollingInterval = options?.pollingInterval || 1000; // Default 1 second polling
    this.subscriberId = `mock_${key}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Subscribe to a channel
   */
  subscribe(channelName: string): MockChannel {
    // Return existing channel if already subscribed
    if (this.channels.has(channelName)) {
      return this.channels.get(channelName)!;
    }

    // Create new channel and start subscription
    const channel = new MockChannel(channelName, this.subscriberId, this.baseUrl, this.pollingInterval);
    this.channels.set(channelName, channel);

    // Start subscription asynchronously
    channel.subscribe().catch(error => {
      console.error(`Failed to subscribe to channel ${channelName}:`, error);
    });

    return channel;
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channelName: string): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      channel.unsubscribe().catch(error => {
        console.error(`Failed to unsubscribe from channel ${channelName}:`, error);
      });
      this.channels.delete(channelName);
    }
  }

  /**
   * Get an already subscribed channel
   */
  channel(channelName: string): MockChannel | undefined {
    return this.channels.get(channelName);
  }

  /**
   * Disconnect all channels
   */
  disconnect(): void {
    this.channels.forEach((channel, channelName) => {
      this.unsubscribe(channelName);
    });
  }

  /**
   * Get all subscribed channels
   */
  allChannels(): MockChannel[] {
    return Array.from(this.channels.values());
  }
}
