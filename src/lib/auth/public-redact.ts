/**
 * Redaction helpers for public-viewer API responses.
 *
 * When a route serves a workspace that is `isPublicViewable`, it MUST pass
 * any user-shaped payload through these helpers before returning it. This
 * ensures we never leak emails, GitHub tokens, credentials, or other PII
 * to unauthenticated viewers.
 *
 * Every helper is a pure transform. Pass the full object in; get the
 * sanitized public-safe shape out. Helpers are deliberately lossy — they
 * DROP sensitive fields rather than nulling them, so a downstream change
 * that adds a new sensitive field doesn't silently leak.
 */

// -----------------------------------------------------------------------------
// User
// -----------------------------------------------------------------------------

/**
 * Public-safe user shape. Includes `email: null` (rather than omitting it)
 * so the returned object is structurally compatible with the common
 * `{ id, name, email, image }` shape used across the codebase — this means
 * downstream types don't need to branch on whether a user was redacted.
 */
export interface PublicUser {
  id: string;
  name: string | null;
  email: null;
  image: string | null;
}

/** Strip email, tokens, and other PII from a user-shaped object. */
export function toPublicUser<T extends { id: string; name?: string | null; image?: string | null }>(
  user: T | null | undefined,
): PublicUser | null {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name ?? null,
    email: null,
    image: user.image ?? null,
  };
}

// -----------------------------------------------------------------------------
// Workspace member
// -----------------------------------------------------------------------------

export interface PublicWorkspaceMember {
  id: string;
  userId: string;
  role: string;
  joinedAt: string;
  user: PublicUser;
}

type MemberLike = {
  id: string;
  userId: string;
  role: string;
  joinedAt: string | Date;
  user: { id: string; name?: string | null; image?: string | null };
};

export function toPublicMember(member: MemberLike): PublicWorkspaceMember {
  return {
    id: member.id,
    userId: member.userId,
    role: member.role,
    joinedAt:
      member.joinedAt instanceof Date
        ? member.joinedAt.toISOString()
        : member.joinedAt,
    user: toPublicUser(member.user) as PublicUser,
  };
}

// -----------------------------------------------------------------------------
// Task
// -----------------------------------------------------------------------------

/**
 * Fields on Task that are NEVER safe to expose to public viewers.
 * Keep this list in sync with `prisma/schema.prisma` Task model — these
 * are the credential-bearing or infra-pointer columns. `stakworkProjectId`
 * and `podId` are nulled out at the call site (they're sometimes useful
 * shapes to keep present), the rest are dropped entirely.
 */
export const SENSITIVE_TASK_FIELDS = [
  "agentUrl",
  "agentPassword",
  "agentWebhookSecret",
  "stakworkProjectId",
  "podId",
] as const;

type TaskLike = Record<string, unknown> & {
  assignee?: { id: string; name?: string | null; image?: string | null; email?: string | null } | null;
  createdBy?: { id: string; name?: string | null; image?: string | null; email?: string | null } | null;
};

/**
 * Strip sensitive fields from a task object, replacing user refs with
 * redacted versions. Works on single tasks or arrays of tasks.
 */
export function toPublicTask<T extends TaskLike>(task: T): Omit<T, typeof SENSITIVE_TASK_FIELDS[number] | "assignee" | "createdBy"> & {
  assignee: PublicUser | null;
  createdBy: PublicUser | null;
} {
  const clone = { ...task };
  for (const field of SENSITIVE_TASK_FIELDS) {
    delete clone[field];
  }
  return {
    ...clone,
    assignee: toPublicUser(task.assignee ?? null),
    createdBy: toPublicUser(task.createdBy ?? null),
  } as Omit<T, typeof SENSITIVE_TASK_FIELDS[number] | "assignee" | "createdBy"> & {
    assignee: PublicUser | null;
    createdBy: PublicUser | null;
  };
}

export function toPublicTasks<T extends TaskLike>(tasks: T[]) {
  return tasks.map((t) => toPublicTask(t));
}

// -----------------------------------------------------------------------------
// Feature
// -----------------------------------------------------------------------------

export const SENSITIVE_FEATURE_FIELDS = ["stakworkProjectId"] as const;

type FeatureLike = Record<string, unknown> & {
  createdBy?: { id: string; name?: string | null; image?: string | null; email?: string | null } | null;
  assignee?: { id: string; name?: string | null; image?: string | null; email?: string | null } | null;
};

export function toPublicFeature<T extends FeatureLike>(feature: T) {
  const clone = { ...feature };
  for (const field of SENSITIVE_FEATURE_FIELDS) {
    delete clone[field];
  }
  return {
    ...clone,
    createdBy: toPublicUser(feature.createdBy ?? null),
    assignee: toPublicUser(feature.assignee ?? null),
  };
}

export function toPublicFeatures<T extends FeatureLike>(features: T[]) {
  return features.map((f) => toPublicFeature(f));
}

// -----------------------------------------------------------------------------
// Artifact content
// -----------------------------------------------------------------------------

/**
 * Pods are ephemeral, but the URL + agentPassword pair stored in IDE/BROWSER
 * artifact content is a live bearer credential to the agent server. Stakwork
 * webhooks save these into Artifact.content verbatim (and additionally encrypt
 * the password onto Task), so any route that returns `artifact.content` to a
 * public viewer would leak the password and let an anonymous visitor hit
 * /session, /stream/:id, /validate_session on the pod directly.
 *
 * For signed-in workspace members we keep the artifact content untouched —
 * the artifact UI (IDE iframe, Browser preview) needs the full payload.
 * For public viewers we drop the credential-bearing fields but keep the
 * artifact's structural shape so the UI can still render a placeholder.
 *
 * Per-type field allowlist/blocklist:
 *  - IDE / BROWSER : drop `url`, `agentPassword`, `podId` (all infra)
 *  - STREAM        : drop `eventsToken`, `baseUrl`, `requestId` (live stream creds)
 *  - BUG_REPORT    : drop `iframeUrl` (pod URL again)
 *  - everything else (CODE, FORM, LONGFORM, GRAPH, WORKFLOW, PULL_REQUEST,
 *    DIFF, MEDIA, PUBLISH_WORKFLOW, BOUNTY, PLAN, TASKS, VERIFY) is
 *    user-facing content with no live credentials — pass through unchanged.
 */
export function redactArtifactContentForPublic(
  type: string | null | undefined,
  content: unknown,
): unknown {
  if (!content || typeof content !== "object") return content;
  const obj = content as Record<string, unknown>;

  switch (type) {
    case "IDE":
    case "BROWSER": {
      const { url: _url, agentPassword: _pw, podId: _pid, ...rest } = obj;
      void _url; void _pw; void _pid;
      return rest;
    }
    case "STREAM": {
      const { eventsToken: _t, baseUrl: _b, requestId: _r, ...rest } = obj;
      void _t; void _b; void _r;
      return rest;
    }
    case "BUG_REPORT": {
      const { iframeUrl: _u, ...rest } = obj;
      void _u;
      return rest;
    }
    default:
      return content;
  }
}

type ArtifactLike = Record<string, unknown> & {
  type?: string | null;
  content?: unknown;
};

export function toPublicArtifact<T extends ArtifactLike>(artifact: T): T {
  return {
    ...artifact,
    content: redactArtifactContentForPublic(artifact.type, artifact.content),
  };
}

// -----------------------------------------------------------------------------
// Chat message
// -----------------------------------------------------------------------------

type ChatMessageLike = Record<string, unknown> & {
  user?: { id: string; name?: string | null; image?: string | null; email?: string | null } | null;
  artifacts?: ArtifactLike[];
};

/**
 * Messages are mostly already public-safe (content is user-authored), but
 * we still strip the author's email and redact credential-bearing artifact
 * content (pod URLs, agent passwords, stream tokens).
 */
export function toPublicChatMessage<T extends ChatMessageLike>(message: T) {
  return {
    ...message,
    user: toPublicUser(message.user ?? null),
    artifacts: message.artifacts?.map((a) => toPublicArtifact(a)),
  };
}

export function toPublicChatMessages<T extends ChatMessageLike>(messages: T[]) {
  return messages.map((m) => toPublicChatMessage(m));
}
