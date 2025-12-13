import Pusher from "pusher";
import PusherClient from "pusher-js";
import { optionalEnvVars } from "@/config/env";
import {
  getPusherAppId,
  getPusherKey,
  getPusherSecret,
  getPusherCluster,
  getPublicPusherKey,
  getPublicPusherCluster,
} from "@/config/env";
import { MockPusherServer } from "./mock/pusher-server";
import { MockPusherClient } from "./mock/pusher-client";

const USE_MOCKS = optionalEnvVars.USE_MOCKS;

// Server-side Pusher instance for triggering events
export const pusherServer: Pusher | MockPusherServer = USE_MOCKS
  ? new MockPusherServer({
      appId: getPusherAppId(),
      key: getPusherKey(),
      secret: getPusherSecret(),
      cluster: getPusherCluster(),
      useTLS: true,
    })
  : new Pusher({
      appId: getPusherAppId(),
      key: getPusherKey(),
      secret: getPusherSecret(),
      cluster: getPusherCluster(),
      useTLS: true,
    });

// Client-side Pusher instance - lazy initialization to avoid build-time errors
let _pusherClient: PusherClient | MockPusherClient | null = null;

export const getPusherClient = (): PusherClient | MockPusherClient => {
  if (!_pusherClient) {
    const key = getPublicPusherKey();
    const cluster = getPublicPusherCluster();

    _pusherClient = USE_MOCKS
      ? new MockPusherClient(key, { cluster })
      : new PusherClient(key, { cluster });
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
