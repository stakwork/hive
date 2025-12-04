import { config } from "@/config/env";

// Type imports
import type Pusher from "pusher";
import type PusherClient from "pusher-js";

// Server instance - conditionally use mock or real Pusher
let pusherServerInstance: Pusher | any;

if (config.USE_MOCKS) {
  // Use mock Pusher in development/testing
  try {
    const { MockPusherServer } = require("./pusher-mock");
    pusherServerInstance = new MockPusherServer();
  } catch (error) {
    console.warn("Failed to load pusher-mock, falling back to real Pusher:", error);
    const PusherModule = require("pusher");
    const PusherClass = PusherModule.default || PusherModule;
    pusherServerInstance = new PusherClass({
      appId: process.env.PUSHER_APP_ID || "mock-app-id",
      key: process.env.PUSHER_KEY || "mock-key",
      secret: process.env.PUSHER_SECRET || "mock-secret",
      cluster: process.env.PUSHER_CLUSTER || "mt1",
      useTLS: true,
    });
  }
} else {
  // Use real Pusher in production
  const PusherModule = require("pusher");
  const PusherClass = PusherModule.default || PusherModule;
  pusherServerInstance = new PusherClass({
    appId: process.env.PUSHER_APP_ID!,
    key: process.env.PUSHER_KEY!,
    secret: process.env.PUSHER_SECRET!,
    cluster: process.env.PUSHER_CLUSTER!,
    useTLS: true,
  });
}

export const pusherServer = pusherServerInstance;

// Client-side Pusher instance - lazy initialization to avoid build-time errors
let _pusherClient: PusherClient | any = null;

export const getPusherClient = (): PusherClient | any => {
  if (!_pusherClient) {
    if (config.USE_MOCKS) {
      // Use mock Pusher client
      const { MockPusherClient } = require("./pusher-mock");
      _pusherClient = new MockPusherClient(
        config.PUSHER_KEY!,
        { cluster: config.PUSHER_CLUSTER! }
      );
    } else {
      // Use real Pusher client
      const PusherClientModule = require("pusher-js");
      const PusherClientClass = PusherClientModule.default || PusherClientModule;
      
      if (
        !process.env.NEXT_PUBLIC_PUSHER_KEY ||
        !process.env.NEXT_PUBLIC_PUSHER_CLUSTER
      ) {
        throw new Error("Pusher environment variables are not configured");
      }

      _pusherClient = new PusherClientClass(process.env.NEXT_PUBLIC_PUSHER_KEY, {
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
