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
export const getOrgChannelName = (githubLogin: string) => `org-${githubLogin}`;
// Per-canvas-conversation channel. The org canvas chat subscribes to this
// for its active `SharedConversation` so server-side appends (planner
// fan-out, autonomous canvas-agent turns, planner-form answers) push to an
// open browser live, with no polling.
export const getCanvasConversationChannelName = (conversationId: string) =>
  `canvas-conversation-${conversationId}`;
// Per-user channel for profile activity nudges
export const getUserChannelName = (userId: string) => `user-${userId}`;

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
  FEATURE_TITLE_UPDATE: "feature-title-update",
  // Whiteboard collaboration events
  WHITEBOARD_ELEMENTS_UPDATE: "whiteboard-elements-update",
  WHITEBOARD_CURSOR_UPDATE: "whiteboard-cursor-update",
  WHITEBOARD_USER_JOIN: "whiteboard-user-join",
  WHITEBOARD_USER_LEAVE: "whiteboard-user-leave",
  // Sent when an element broadcast exceeds Pusher's 10KB cap. Receivers
  // fetch the latest whiteboard from the DB and merge it into their canvas.
  WHITEBOARD_REFETCH: "whiteboard-refetch",
  WHITEBOARD_CHAT_MESSAGE: "whiteboard-chat-message",
  FEATURE_UPDATED: "feature-updated",
  // Plan presence events
  PLAN_USER_JOIN: "plan-user-join",
  PLAN_USER_LEAVE: "plan-user-leave",
  // Plan typing indicator events
  PLAN_TYPING_START: "plan-typing-start",
  PLAN_TYPING_STOP: "plan-typing-stop",
  // Connection events
  CONNECTION_UPDATED: "connection-updated",
  // Research events (agent-authored research docs attached to the org).
  // Fires on `save_research` (create) and `update_research` (content fill).
  // The right-panel viewer subscribes to stream content in without a
  // full canvas refetch.
  RESEARCH_UPDATED: "research-updated",
  // Canvas events (system-canvas document on the org)
  CANVAS_UPDATED: "canvas-updated",
  // Canvas presence events (ephemeral — not persisted)
  CANVAS_CURSOR_UPDATE: "canvas-cursor-update",
  CANVAS_USER_JOIN: "canvas-user-join",
  CANVAS_USER_LEAVE: "canvas-user-leave",
  CANVAS_SELECTION_UPDATE: "canvas-selection-update",
  // Agent log upserted for a feature — triggers live Logs tab updates in plan view
  AGENT_LOG_UPDATED: "agent-log-updated",
  // A canvas conversation's `messages` JSON changed server-side (planner
  // fan-out, autonomous canvas-agent turn, or a planner-form answer). The
  // payload is a lightweight nudge `{ conversationId, reason }`; the client
  // refetches the conversation and merges in the new rows (avoids Pusher's
  // 10KB-per-message cap and keeps a single source of truth).
  CANVAS_CONVERSATION_UPDATED: "canvas-conversation-updated",
  // Per-user profile activity feed nudge
  ACTIVITY_UPDATED: "activity-updated",
  // Workflow version summary ready (AI-generated summary delivered via webhook)
  WORKFLOW_SUMMARY_READY: "workflow-summary-ready",
  // Prompt eval run completed — carries pass/fail badge data for version rows
  PROMPT_EVAL_RESULT: "prompt-eval-result",
  // Agent trace visualization ready (Arize Phoenix trace URL available)
  AGENT_TRACE_READY: "agent-trace-ready",
  // Error issue created or updated (new occurrence ingested via /api/webhook/errors)
  ERROR_ISSUE_UPDATED: "error-issue-updated",
} as const;

/**
 * Reason a canvas conversation changed — purely informational, lets the
 * client log / debug which server path fired the nudge.
 */
export type CanvasConversationUpdateReason =
  | "planner"
  | "autoturn"
  | "form-answer"
  | "research"
  // A human appended a message to a shared conversation. Fires from the
  // autosave PUT so other people sitting on the same shared room refetch
  // and see the new turn live.
  | "user-message"
  // A user-driven canvas-agent turn was persisted server-side (the
  // `/api/ask/quick` org path, in `after()`). The authoring tab filters
  // its own turn out of the merge by id prefix; other viewers / a
  // reopened tab live-sync it in.
  | "user-turn"
  // A feature's planner workflow reached a new (often terminal) status
  // AFTER its message already fanned out — the stakwork webhook updated
  // the latest planner row's `source.workflowStatus` in place (same id).
  // The client reconciles existing planner rows' `source` from the
  // server copy so the `SubAgentRunCard` pill re-derives live.
  | "workflow-status"
  // A deferred check was cancelled by the user via the DeferredCheckCard.
  | "deferred-check-cancelled"
  // A deferred check was fired by the cron dispatcher and the result
  // has been appended to the conversation.
  | "deferred-check-fired"
  // A recurring automation fired: the cron created a fresh org-canvas
  // conversation and appended the agent's response to it.
  | "automation"
  // A graph-walk sub-agent completed and fanned its synthesized answer
  // back into the conversation as an assistant bubble.
  | "graph_walk";

/**
 * Fire-and-forget broadcast that a canvas conversation's `messages` JSON
 * changed. Server-side append sites call this AFTER their write commits so
 * an open browser refetches and shows the new rows immediately. Never
 * throws — a Pusher outage must not break the underlying write.
 */
export function notifyCanvasConversationUpdated(
  conversationId: string,
  reason: CanvasConversationUpdateReason,
): void {
  // Wrapped in try/catch because `pusherServer.trigger` can throw
  // *synchronously* (not just reject) — e.g. when the PUSHER_* env vars are
  // unset the HMAC signing throws before a promise is ever returned (the case
  // on CI, where leaking that throw would 500 the underlying write). The
  // `.catch` only covers async rejections, so we need both.
  try {
    void pusherServer
      .trigger(
        getCanvasConversationChannelName(conversationId),
        PUSHER_EVENTS.CANVAS_CONVERSATION_UPDATED,
        { conversationId, reason, at: Date.now() },
      )
      .catch((err) => {
        console.error(
          "[pusher] notifyCanvasConversationUpdated failed (non-fatal):",
          err,
        );
      });
  } catch (err) {
    console.error(
      "[pusher] notifyCanvasConversationUpdated threw (non-fatal):",
      err,
    );
  }
}

/**
 * Fire-and-forget broadcast that the user's profile activity feed has new
 * items. Creation endpoints call this AFTER their write commits so an open
 * /profile page refetches without a manual refresh. Never throws — a Pusher
 * outage must not break the underlying creation request.
 */
export function notifyActivityUpdated(userId: string): void {
  try {
    void pusherServer
      .trigger(getUserChannelName(userId), PUSHER_EVENTS.ACTIVITY_UPDATED, {
        userId,
        at: Date.now(),
      })
      .catch((err) => {
        console.error("[pusher] notifyActivityUpdated failed (non-fatal):", err);
      });
  } catch (err) {
    console.error("[pusher] notifyActivityUpdated threw (non-fatal):", err);
  }
}
