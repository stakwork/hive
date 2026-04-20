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

export interface PublicUser {
  id: string;
  name: string | null;
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
 * Keep this list in sync with `prisma/schema.prisma` Task model.
 */
export const SENSITIVE_TASK_FIELDS = [
  "agentUrl",
  "agentSecret",
  "agentCredentials",
  "stakworkProjectId",
  "podCredentials",
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
// Chat message
// -----------------------------------------------------------------------------

type ChatMessageLike = Record<string, unknown> & {
  user?: { id: string; name?: string | null; image?: string | null; email?: string | null } | null;
};

/**
 * Messages are mostly already public-safe (content is user-authored), but
 * we still strip the author's email and any agent-credential leakage.
 */
export function toPublicChatMessage<T extends ChatMessageLike>(message: T) {
  return {
    ...message,
    user: toPublicUser(message.user ?? null),
  };
}

export function toPublicChatMessages<T extends ChatMessageLike>(messages: T[]) {
  return messages.map((m) => toPublicChatMessage(m));
}
