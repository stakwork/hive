import Pusher from "pusher";
import PusherClient from "pusher-js";
import { getPusherConfig, getPusherPublicConfig } from "@/config/env";
import { mockPusherState } from "@/lib/mock/pusher-state";

const USE_MOCKS = process.env.USE_MOCKS === "true";

/**
 * Mock Pusher Server Implementation
 * Simulates Pusher server-side API for triggering events
 */
class MockPusherServer {
  private config: ReturnType<typeof getPusherConfig>;

  constructor(config: ReturnType<typeof getPusherConfig>) {
    this.config = config;
  }

  async trigger(
    channels: string | string[],
    event: string,
    data: unknown
  ): Promise<void> {
    const channelArray = Array.isArray(channels) ? channels : [channels];
    
    for (const channel of channelArray) {
      mockPusherState.trigger(channel, event, data);
    }
  }

  // Add other Pusher methods as needed for compatibility
  getConfig() {
    return this.config;
  }
}

/**
 * Mock Pusher Client Implementation
 * Simulates pusher-js client API for subscriptions and event binding
 */
class MockPusherClient {
  private config: ReturnType<typeof getPusherPublicConfig>;
  private channels: Map<string, MockChannel> = new Map();

  constructor(key: string, options: { cluster: string }) {
    this.config = { key, cluster: options.cluster };
    mockPusherState.connect();
  }

  subscribe(channelName: string): MockChannel {
    if (!this.channels.has(channelName)) {
      this.channels.set(channelName, new MockChannel(channelName));
    }
    return this.channels.get(channelName)!;
  }

  unsubscribe(channelName: string): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      channel.unbindAll();
      this.channels.delete(channelName);
    }
    mockPusherState.unsubscribe(channelName);
  }

  bind(eventName: string, callback: (data: unknown) => void): void {
    // Global event binding (not channel-specific)
    // For simplicity, we'll skip this in mock
    console.warn("[MockPusher] Global bind not implemented in mock");
  }

  unbind(eventName?: string): void {
    // Global event unbinding
    console.warn("[MockPusher] Global unbind not implemented in mock");
  }

  disconnect(): void {
    for (const channel of this.channels.values()) {
      channel.unbindAll();
    }
    this.channels.clear();
    mockPusherState.disconnect();
  }

  getConfig() {
    return this.config;
  }
}

/**
 * Mock Channel Implementation
 * Simulates pusher-js Channel API
 */
class MockChannel {
  private channelName: string;
  private callbacks: Map<string, Set<(data: unknown) => void>> = new Map();

  constructor(channelName: string) {
    this.channelName = channelName;
  }

  bind(eventName: string, callback: (data: unknown) => void): this {
    if (!this.callbacks.has(eventName)) {
      this.callbacks.set(eventName, new Set());
    }
    this.callbacks.get(eventName)!.add(callback);
    mockPusherState.subscribe(this.channelName, eventName, callback);
    return this;
  }

  unbind(eventName?: string, callback?: (data: unknown) => void): this {
    if (!eventName) {
      // Unbind all events
      this.unbindAll();
      return this;
    }

    if (!callback) {
      // Unbind all callbacks for this event
      const callbacks = this.callbacks.get(eventName);
      if (callbacks) {
        for (const cb of callbacks) {
          mockPusherState.unsubscribe(this.channelName, cb);
        }
        this.callbacks.delete(eventName);
      }
    } else {
      // Unbind specific callback
      const callbacks = this.callbacks.get(eventName);
      if (callbacks) {
        callbacks.delete(callback);
        mockPusherState.unsubscribe(this.channelName, callback);
        if (callbacks.size === 0) {
          this.callbacks.delete(eventName);
        }
      }
    }

    return this;
  }

  unbindAll(): void {
    for (const callbacks of this.callbacks.values()) {
      for (const callback of callbacks) {
        mockPusherState.unsubscribe(this.channelName, callback);
      }
    }
    this.callbacks.clear();
  }
}

// Server-side Pusher instance for triggering events
export const pusherServer = USE_MOCKS
  ? (new MockPusherServer(getPusherConfig()) as unknown as Pusher)
  : new Pusher(getPusherConfig());

// Client-side Pusher instance - lazy initialization to avoid build-time errors
let _pusherClient: PusherClient | MockPusherClient | null = null;

export const getPusherClient = (): PusherClient => {
  if (!_pusherClient) {
    const config = getPusherPublicConfig();
    
    if (!config.key || !config.cluster) {
      throw new Error("Pusher environment variables are not configured");
    }

    _pusherClient = USE_MOCKS
      ? (new MockPusherClient(config.key, { cluster: config.cluster }) as unknown as PusherClient)
      : new PusherClient(config.key, { cluster: config.cluster });
  }
  return _pusherClient as PusherClient;
};

// Channel naming helpers
export const getTaskChannelName = (taskId: string) => `task-${taskId}`;
export const getWorkspaceChannelName = (workspaceSlug: string) => `workspace-${workspaceSlug}`;

// Event names
export const PUSHER_EVENTS = {
  NEW_MESSAGE: "new-message",
  CONNECTION_COUNT: "connection-count",
  WORKFLOW_STATUS_UPDATE: "workflow-status-update",
  RECOMMENDATIONS_UPDATED: "recommendations-updated",
  TASK_TITLE_UPDATE: "task-title-update",
  WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
  STAKWORK_RUN_UPDATE: "stakwork-run-update",
  STAKWORK_RUN_DECISION: "stakwork-run-decision",
  HIGHLIGHT_NODES: "highlight-nodes",
  FOLLOW_UP_QUESTIONS: "follow-up-questions",
} as const;