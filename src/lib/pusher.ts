import Pusher from "pusher";
import PusherClient from "pusher-js";
import { PUSHER_CONFIG, USE_MOCKS, MOCK_BASE } from "@/config/env";
import { logger } from "./logger";

/**
 * Mock Pusher Server
 * Routes trigger calls to mock API endpoint
 */
class MockPusherServer {
  async trigger(
    channels: string | string[],
    event: string,
    data: unknown
  ): Promise<void> {
    try {
      const response = await fetch(`${MOCK_BASE}/api/mock/pusher/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels, event, data }),
      });

      if (!response.ok) {
        throw new Error(`Mock Pusher trigger failed: ${response.statusText}`);
      }

      logger.debug("[MockPusher] Server trigger successful", "server", {
        channels: Array.isArray(channels) ? channels : [channels],
        event,
      });
    } catch (error) {
      logger.error("[MockPusher] Server trigger error", "server", { error });
      throw error;
    }
  }
}

/**
 * Mock Pusher Channel
 * No-op implementation for client-side channel operations
 * Actual events delivered via HTTP polling in usePusherConnection
 */
class MockPusherChannel {
  constructor(public channelName: string) {}

  bind(eventName: string, callback: Function, context?: any): this {
    // No-op: Events delivered via polling in usePusherConnection
    logger.debug("[MockPusher] Channel bind (no-op)", "channel", {
      channel: this.channelName,
      event: eventName,
    });
    return this;
  }

  unbind(eventName?: string, callback?: Function, context?: any): this {
    // No-op
    logger.debug("[MockPusher] Channel unbind (no-op)", "channel", {
      channel: this.channelName,
      event: eventName,
    });
    return this;
  }

  unbind_all(): this {
    logger.debug("[MockPusher] Channel unbind_all (no-op)", "channel", {
      channel: this.channelName,
    });
    return this;
  }

  bind_global(callback: Function): this {
    // No-op: Global event binding
    logger.debug("[MockPusher] Channel bind_global (no-op)", "channel", {
      channel: this.channelName,
    });
    return this;
  }

  unbind_global(callback?: Function): this {
    // No-op: Global event unbinding
    logger.debug("[MockPusher] Channel unbind_global (no-op)", "channel", {
      channel: this.channelName,
    });
    return this;
  }
}

/**
 * Mock Pusher Client
 * Routes operations to mock API endpoints
 */
class MockPusherClient {
  private channels: Map<string, MockPusherChannel> = new Map();
  public connection = {
    state: "connected",
    socket_id: "mock-socket-id",
  };

  subscribe(channelName: string): MockPusherChannel {
    if (!this.channels.has(channelName)) {
      const channel = new MockPusherChannel(channelName);
      this.channels.set(channelName, channel);

      // Notify mock API of subscription
      fetch(`${MOCK_BASE}/api/mock/pusher/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channelName }),
      }).catch((error) => {
        logger.error("[MockPusher] Subscribe API error", "client", { error });
      });

      logger.debug("[MockPusher] Client subscribed", "client", { channel: channelName });
    }

    return this.channels.get(channelName)!;
  }

  unsubscribe(channelName: string): void {
    this.channels.delete(channelName);
    logger.debug("[MockPusher] Client unsubscribed", "client", { channel: channelName });
  }

  disconnect(): void {
    this.channels.clear();
    logger.debug("[MockPusher] Client disconnected", "client");
  }

  bind(eventName: string, callback: (data: unknown) => void): void {
    // Global event binding (no-op in mock)
    logger.debug("[MockPusher] Global bind (no-op)", "client", { event: eventName });
  }

  unbind(eventName?: string): void {
    logger.debug("[MockPusher] Global unbind (no-op)", "client", { event: eventName });
  }
}

// Server-side Pusher instance for triggering events
export const pusherServer: Pusher | MockPusherServer = USE_MOCKS
  ? new MockPusherServer()
  : new Pusher({
      appId: PUSHER_CONFIG.appId,
      key: PUSHER_CONFIG.key,
      secret: PUSHER_CONFIG.secret,
      cluster: PUSHER_CONFIG.cluster,
      useTLS: true,
    });

// Client-side Pusher instance - lazy initialization to avoid build-time errors
let _pusherClient: PusherClient | MockPusherClient | null = null;

export const getPusherClient = (): PusherClient | MockPusherClient => {
  if (!_pusherClient) {
    if (USE_MOCKS) {
      _pusherClient = new MockPusherClient();
      logger.debug("[MockPusher] Client initialized (mock mode)", "init");
    } else {
      if (!PUSHER_CONFIG.publicKey || !PUSHER_CONFIG.publicCluster) {
        throw new Error("Pusher environment variables are not configured");
      }

      _pusherClient = new PusherClient(PUSHER_CONFIG.publicKey, {
        cluster: PUSHER_CONFIG.publicCluster,
      });
      logger.debug("[Pusher] Client initialized (real mode)", "init");
    }
  }
  return _pusherClient;
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
  PROVENANCE_DATA: "provenance-data",
} as const;
