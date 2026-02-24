import Pusher from "pusher";
import PusherClient from "pusher-js";

// Server-side Pusher instance for triggering events
export const pusherServer = new Pusher({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.PUSHER_CLUSTER!,
  useTLS: true,
});

// Client-side Pusher instance - lazy initialization to avoid build-time errors
let _pusherClient: PusherClient | null = null;

export const getPusherClient = (): PusherClient => {
  if (!_pusherClient) {
    if (!process.env.NEXT_PUBLIC_PUSHER_KEY || !process.env.NEXT_PUBLIC_PUSHER_CLUSTER) {
      throw new Error("Pusher environment variables are not configured");
    }

    _pusherClient = new PusherClient(process.env.NEXT_PUBLIC_PUSHER_KEY, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
    });
  }
  return _pusherClient;
};

// Channel naming helpers
export const getTaskChannelName = (taskId: string) => `task-${taskId}`;
export const getWorkspaceChannelName = (workspaceSlug: string) => `workspace-${workspaceSlug}`;
export const getFeatureChannelName = (featureId: string) => `feature-${featureId}`;
export const getWhiteboardChannelName = (whiteboardId: string) => `whiteboard-${whiteboardId}`;

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
  PR_STATUS_CHANGE: "pr-status-change",
  BOUNTY_STATUS_CHANGE: "bounty-status-change",
  DEPLOYMENT_STATUS_CHANGE: "deployment-status-change",
  // Whiteboard collaboration events
  WHITEBOARD_ELEMENTS_UPDATE: "whiteboard-elements-update",
  WHITEBOARD_CURSOR_UPDATE: "whiteboard-cursor-update",
  WHITEBOARD_USER_JOIN: "whiteboard-user-join",
  WHITEBOARD_USER_LEAVE: "whiteboard-user-leave",
  WHITEBOARD_CHAT_MESSAGE: "whiteboard-chat-message",
  FEATURE_UPDATED: "feature-updated",
} as const;
