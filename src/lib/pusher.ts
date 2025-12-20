import Pusher from "pusher";
import PusherClient from "pusher-js";
import { mockPusherState } from "./mock/pusher-state";

// Detect mock mode
const USE_MOCKS = process.env.USE_MOCKS === "true";

// Server-side Pusher instance for triggering events
// In mock mode, wrap trigger calls to use in-memory event bus
const createPusherServer = (): Pusher => {
  if (USE_MOCKS) {
    // Return mock server with trigger method that uses MockPusherState
    return {
      trigger: (channel: string, event: string, data: any) => {
        mockPusherState.trigger(channel, event, data);
        return Promise.resolve();
      },
    } as unknown as Pusher;
  }

  return new Pusher({
    appId: process.env.PUSHER_APP_ID!,
    key: process.env.PUSHER_KEY!,
    secret: process.env.PUSHER_SECRET!,
    cluster: process.env.PUSHER_CLUSTER!,
    useTLS: true,
  });
};

export const pusherServer = createPusherServer();

// Client-side Pusher instance - lazy initialization to avoid build-time errors
let _pusherClient: PusherClient | null = null;

export const getPusherClient = (): PusherClient => {
  if (!_pusherClient) {
    if (USE_MOCKS) {
      // Return mock client that uses MockPusherState
      _pusherClient = {
        subscribe: (channelName: string) => {
          return mockPusherState.subscribe(channelName) as any;
        },
        unsubscribe: (channelName: string) => {
          mockPusherState.unsubscribe(channelName);
        },
      } as unknown as PusherClient;
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
} as const;
