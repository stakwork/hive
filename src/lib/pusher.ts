import Pusher from "pusher";
import PusherClient from "pusher-js";
import { getPusherConfig, getPusherClientConfig, config } from "@/config/env";
import { MockPusherClient } from "@/lib/mock/pusher-client-wrapper";

const USE_MOCKS = config.USE_MOCKS;
const MOCK_BASE = config.MOCK_BASE;

// Server-side Pusher instance for triggering events
const pusherConfig = getPusherConfig();
const _realPusherServer = new Pusher(pusherConfig);

/**
 * Server-side Pusher wrapper that routes to mock endpoint when USE_MOCKS=true
 */
export const pusherServer = {
  trigger: async (
    channel: string,
    event: string,
    data: any,
    params?: Pusher.TriggerParams
  ) => {
    if (USE_MOCKS) {
      // Route to mock endpoint
      const mockUrl = `${MOCK_BASE}/api/mock/pusher/trigger`;
      
      try {
        const response = await fetch(mockUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel, event, data }),
        });

        if (!response.ok) {
          throw new Error(`Mock Pusher trigger failed: ${response.statusText}`);
        }

        return response.json();
      } catch (error) {
        console.error('Mock Pusher trigger error:', error);
        throw error;
      }
    } else {
      // Use real Pusher
      return _realPusherServer.trigger(channel, event, data, params);
    }
  },

  // Pass through other methods to real Pusher (not commonly used)
  triggerBatch: _realPusherServer.triggerBatch.bind(_realPusherServer),
  authenticate: _realPusherServer.authenticate.bind(_realPusherServer),
  authorizeChannel: _realPusherServer.authorizeChannel.bind(_realPusherServer),
  webhook: _realPusherServer.webhook.bind(_realPusherServer),
  get: _realPusherServer.get.bind(_realPusherServer),
  post: _realPusherServer.post.bind(_realPusherServer),
};

// Client-side Pusher instance - lazy initialization to avoid build-time errors
let _pusherClient: PusherClient | MockPusherClient | null = null;

export const getPusherClient = (): PusherClient | MockPusherClient => {
  if (!_pusherClient) {
    const clientConfig = getPusherClientConfig();

    if (USE_MOCKS) {
      // Return mock client for local development
      _pusherClient = new MockPusherClient(clientConfig.key, {
        cluster: clientConfig.cluster,
        pollingInterval: 1000, // Poll every 1 second
      });
    } else {
      // Return real Pusher client
      if (!clientConfig.key || !clientConfig.cluster) {
        throw new Error("Pusher environment variables are not configured");
      }

      _pusherClient = new PusherClient(clientConfig.key, {
        cluster: clientConfig.cluster,
      });
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
} as const;
