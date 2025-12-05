import Pusher from "pusher";
import PusherClient from "pusher-js";
import { mockPusherState } from "@/lib/mock/pusher-state";

// Check if we should use mocks
const USE_MOCKS = process.env.USE_MOCKS === "true";

/**
 * Mock Pusher Server
 * Mimics Pusher npm package API for server-side broadcasting
 */
class MockPusherServer {
  async trigger(
    channel: string | string[],
    event: string,
    data: unknown,
    socketId?: string
  ): Promise<void> {
    return mockPusherState.trigger(channel, event, data);
  }

  async triggerBatch(
    batch: Array<{ channel: string; name: string; data: unknown }>
  ): Promise<void> {
    return mockPusherState.triggerBatch(batch);
  }
}

/**
 * Mock Pusher Client
 * Mimics pusher-js API for client-side subscriptions
 */
class MockPusherClient {
  private connectionId: string;
  private channels: Map<string, MockChannel> = new Map();

  constructor(key: string, options?: { cluster: string }) {
    this.connectionId = `mock-conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log("[MockPusher] Client initialized:", this.connectionId);
  }

  subscribe(channelName: string): MockChannel {
    if (!this.channels.has(channelName)) {
      const channel = new MockChannel(channelName, this.connectionId);
      this.channels.set(channelName, channel);
    }
    return this.channels.get(channelName)!;
  }

  unsubscribe(channelName: string): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      channel.unsubscribe();
      this.channels.delete(channelName);
    }
  }

  disconnect(): void {
    this.channels.forEach((channel) => channel.unsubscribe());
    this.channels.clear();
  }
}

/**
 * Mock Channel
 * Mimics pusher-js Channel API for event binding
 */
class MockChannel {
  private eventHandlers: Map<string, Set<(data: unknown) => void>> = new Map();
  private unsubscribers: Map<string, () => void> = new Map();

  constructor(
    private channelName: string,
    private connectionId: string
  ) {}

  bind(event: string, callback: (data: unknown) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());

      // Subscribe to mock state manager
      const unsubscribe = mockPusherState.subscribe(
        this.channelName,
        event,
        (data: unknown) => {
          const handlers = this.eventHandlers.get(event);
          if (handlers) {
            handlers.forEach((handler) => handler(data));
          }
        }
      );

      this.unsubscribers.set(event, unsubscribe);
    }

    this.eventHandlers.get(event)!.add(callback);
  }

  unbind(event?: string, callback?: (data: unknown) => void): void {
    if (!event) {
      // Unbind all events
      this.eventHandlers.clear();
      this.unsubscribers.forEach((unsub) => unsub());
      this.unsubscribers.clear();
      return;
    }

    if (!callback) {
      // Unbind all callbacks for event
      this.eventHandlers.delete(event);
      const unsubscribe = this.unsubscribers.get(event);
      if (unsubscribe) {
        unsubscribe();
        this.unsubscribers.delete(event);
      }
      return;
    }

    // Unbind specific callback
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(callback);
      if (handlers.size === 0) {
        this.eventHandlers.delete(event);
        const unsubscribe = this.unsubscribers.get(event);
        if (unsubscribe) {
          unsubscribe();
          this.unsubscribers.delete(event);
        }
      }
    }
  }

  unbind_all(): void {
    this.unbind();
  }

  unsubscribe(): void {
    this.unbind_all();
  }
}

// Server-side Pusher instance - use mock in mock mode
export const pusherServer = USE_MOCKS
  ? (new MockPusherServer() as unknown as Pusher)
  : new Pusher({
      appId: process.env.PUSHER_APP_ID!,
      key: process.env.PUSHER_KEY!,
      secret: process.env.PUSHER_SECRET!,
      cluster: process.env.PUSHER_CLUSTER!,
      useTLS: true,
    });

// Client-side Pusher instance - lazy initialization to avoid build-time errors
let _pusherClient: PusherClient | MockPusherClient | null = null;

export const getPusherClient = (): PusherClient => {
  if (!_pusherClient) {
    if (USE_MOCKS) {
      _pusherClient = new MockPusherClient(
        "mock-key",
        { cluster: "mock-cluster" }
      ) as unknown as PusherClient;
    } else {
      if (
        !process.env.NEXT_PUBLIC_PUSHER_KEY ||
        !process.env.NEXT_PUBLIC_PUSHER_CLUSTER
      ) {
        throw new Error("Pusher environment variables are not configured");
      }

      _pusherClient = new PusherClient(process.env.NEXT_PUBLIC_PUSHER_KEY, {
        cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
      });
    }
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
} as const;
