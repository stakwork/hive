import Pusher from "pusher";
import PusherClient from "pusher-js";
import { optionalEnvVars } from "@/config/env";
import { MockPusherServer, MockPusherClient, type PusherLike, type PusherClientLike } from "./mock/pusher-wrapper";

const USE_MOCKS = optionalEnvVars.USE_MOCKS;

// Server-side Pusher instance for triggering events
export const pusherServer: PusherLike = USE_MOCKS
  ? new MockPusherServer({
      appId: optionalEnvVars.PUSHER_APP_ID!,
      key: optionalEnvVars.PUSHER_KEY!,
      secret: optionalEnvVars.PUSHER_SECRET!,
      cluster: optionalEnvVars.PUSHER_CLUSTER!,
      useTLS: true,
    })
  : new Pusher({
      appId: process.env.PUSHER_APP_ID!,
      key: process.env.PUSHER_KEY!,
      secret: process.env.PUSHER_SECRET!,
      cluster: process.env.PUSHER_CLUSTER!,
      useTLS: true,
    });

// Client-side Pusher instance - lazy initialization to avoid build-time errors
let _pusherClient: PusherClientLike | null = null;

export const getPusherClient = (): PusherClientLike => {
  if (!_pusherClient) {
    if (USE_MOCKS) {
      // Use mock client in mock mode
      _pusherClient = new MockPusherClient(optionalEnvVars.PUSHER_KEY!, {
        cluster: optionalEnvVars.PUSHER_CLUSTER!,
      });
    } else {
      // Use real Pusher client in production
      if (!process.env.NEXT_PUBLIC_PUSHER_KEY || !process.env.NEXT_PUBLIC_PUSHER_CLUSTER) {
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