import Pusher from "pusher";
import PusherClient from "pusher-js";
import { PusherServerMock } from "@/lib/mock/pusher-server-wrapper";
import { PusherClientMock } from "@/lib/mock/pusher-client-wrapper";

// Check if mocks are enabled
const USE_MOCKS = process.env.USE_MOCKS === "true";

// Server-side Pusher instance for triggering events
export const pusherServer = USE_MOCKS
  ? (new PusherServerMock() as any as Pusher)
  : new Pusher({
      appId: process.env.PUSHER_APP_ID!,
      key: process.env.PUSHER_KEY!,
      secret: process.env.PUSHER_SECRET!,
      cluster: process.env.PUSHER_CLUSTER!,
      useTLS: true,
    });

// Client-side Pusher instance - lazy initialization to avoid build-time errors
let _pusherClient: PusherClient | PusherClientMock | null = null;

export const getPusherClient = (): PusherClient | PusherClientMock => {
  if (!_pusherClient) {
    if (USE_MOCKS) {
      // Return mock client in mock mode
      _pusherClient = new PusherClientMock("mock-key", { cluster: "mock" }) as any as PusherClient;
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
