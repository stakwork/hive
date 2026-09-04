/**
 * Wire-format types for the org Control panel (`/org/[githubLogin]?view=control-panel`).
 *
 * A control panel item is a Jamie (org-canvas) chat or a plan (Feature)
 * spawned from one, ordered by the newest activity from anyone, so
 * whatever is moving floats to the top. Produced by
 * `src/services/orgs/control-panel.ts`; consumed by the control panel
 * column on the client.
 */

export type ControlPanelItemKind = "chat" | "plan";

/**
 * Derived thread state. The four attention states reuse the attention
 * feed's vocabulary (`src/services/attention/typeMeta.ts`) so the control panel,
 * the Live Now panel and the canvas badges agree on colour and glyph.
 */
export type ControlPanelItemState = "running" | "halted" | "question" | "awaiting-reply" | "review" | "done" | "none";

export interface ControlPanelItem {
  /** Stable key, `${kind}:${id}`. */
  key: string;
  kind: ControlPanelItemKind;
  id: string;
  title: string;
  /** Null for org-canvas chats (they are org-scoped, not workspace-scoped). */
  workspaceSlug: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  /** ISO. Most recent activity by anyone on the thread. */
  lastActivityAt: string;
  /** One line describing what happened after the user's last touch, or the thread's status. */
  sinceYou: string;
  state: ControlPanelItemState;
  /** True when activity landed after the user last looked. */
  unread: boolean;
  /** Plans only: the Jamie chat this plan was spawned from, when any. */
  parentChatId?: string | null;
}

export interface ControlPanelResponse {
  items: ControlPanelItem[];
  /** Chats are the spine: how many are listed, and how many the user has in this org. */
  chats: { shown: number; total: number };
}
