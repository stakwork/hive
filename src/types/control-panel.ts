/**
 * Wire-format types for the org page's chat list (the default org view).
 *
 * A row is one of the user's Jamie (org-canvas) chats, ordered by the
 * newest activity from anyone. Under it, the jobs the chat started; beside
 * it, the pull requests those jobs reported. Produced by
 * `src/services/orgs/control-panel.ts`; consumed by the chat list column.
 */
import type { PullRequestState } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";

/** A strut job a chat started (`start_job`) — its turns land in the chat. */
export interface ControlPanelJob {
  id: string;
  title: string;
  /** A turn is in flight. */
  working: boolean;
  /** ISO. The job's latest turn, launched or settled. */
  lastActivityAt: string;
}

/** A pull request a chat's job reported, as its newest card has it. */
export interface ControlPanelPullRequest {
  /** The card's `artifactIdentity` — what opens it on the artifact panel. */
  identity: string;
  title: string;
  url: string;
  /** `owner/name`. */
  repo: string;
  number: number;
  state: PullRequestState;
  /** The job that reported it, when a job's row carried it. */
  jobId?: string;
}

export interface ControlPanelItem {
  /** `SharedConversation.id`, or the store's local id until the chat's first turn is saved. */
  id: string;
  title: string;
  /** ISO. Most recent activity by anyone on the chat or its jobs. */
  lastActivityAt: string;
  /** Jamie, or one of the chat's jobs, is working right now. */
  working: boolean;
  /** When the owner archived this chat (null / omitted = active). */
  archivedAt?: string | null;
  /** Newest first. */
  jobs: ControlPanelJob[];
  /** Newest first. */
  pullRequests: ControlPanelPullRequest[];
}

export interface ControlPanelResponse {
  items: ControlPanelItem[];
  /** Archived chats. Empty when none. */
  archivedItems: ControlPanelItem[];
  /** How many chats are listed, and how many the user has in this org. */
  chats: { shown: number; total: number };
}
