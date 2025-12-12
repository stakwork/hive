import Pusher from "pusher";
import PusherClient from "pusher-js";
import { config } from "@/config/env";
import {
  PusherServerMock,
  type TriggerResponse,
  type BatchResponse,
  type Event,
} from "./mock/pusher-server-wrapper";
import {
  PusherClientMock,
  type MockChannel,
} from "./mock/pusher-client-wrapper";

const USE_MOCKS = config.USE_MOCKS;

const {
  PUSHER_APP_ID,
  PUSHER_KEY,
  PUSHER_SECRET,
  PUSHER_CLUSTER,
  NEXT_PUBLIC_PUSHER_KEY,
  NEXT_PUBLIC_PUSHER_CLUSTER,
} = process.env;

// Validate environment variables only when not using mocks
if (!USE_MOCKS) {
  if (
    !PUSHER_APP_ID ||
    !PUSHER_KEY ||
    !PUSHER_SECRET ||
    !PUSHER_CLUSTER ||
    !NEXT_PUBLIC_PUSHER_KEY ||
    !NEXT_PUBLIC_PUSHER_CLUSTER
  ) {
    throw new Error("Missing required Pusher environment variables");
  }
}

// Initialize server-side Pusher instance
let pusherServerInstance: Pusher | PusherServerMock;

if (USE_MOCKS) {
  console.log("[Pusher] Initializing mock server");
  pusherServerInstance = new PusherServerMock({
    appId: "mock-app-id",
    key: "mock-key",
    secret: "mock-secret",
    cluster: "mock-cluster",
  });
} else {
  pusherServerInstance = new Pusher({
    appId: PUSHER_APP_ID!,
    key: PUSHER_KEY!,
    secret: PUSHER_SECRET!,
    cluster: PUSHER_CLUSTER!,
    useTLS: true,
  });
}

// Server-side Pusher instance for triggering events
export const pusherServer = pusherServerInstance;

// Client-side Pusher instance - lazy initialization to avoid build-time errors
let _pusherClient: PusherClient | PusherClientMock | null = null;

export const getPusherClient = (): PusherClient | PusherClientMock => {
  if (!_pusherClient) {
    if (USE_MOCKS) {
      console.log("[Pusher] Initializing mock client");
      _pusherClient = new PusherClientMock("mock-key", {
        cluster: "mock-cluster",
      });
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
} as const;

// Export types for convenience
export type { TriggerResponse, BatchResponse, Event, MockChannel };
