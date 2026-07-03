/**
 * Service layer for ErrorIssue read/triage operations.
 *
 * All functions accept server-controlled identifiers only — never a
 * client-supplied blobUrl or workspaceId for security-sensitive paths.
 */
import { ErrorIssueStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { fetchBlobContent } from "@/lib/utils/blob-fetch";
import { pusherServer, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";

const ALLOWED_STATUSES: ErrorIssueStatus[] = ["UNRESOLVED", "RESOLVED", "IGNORED"];
const DEFAULT_EVENTS_LIMIT = 20;

// ── List ──────────────────────────────────────────────────────────────────────

export type ErrorIssueSort = "recent" | "impact";

export interface ListErrorIssuesParams {
  workspaceId: string;
  status?: ErrorIssueStatus;
  includeAll?: boolean;
  repoKey?: string;
  skip?: number;
  limit?: number;
  sort?: ErrorIssueSort;
}

export async function listErrorIssues({
  workspaceId,
  status,
  includeAll,
  repoKey,
  skip = 0,
  limit = 20,
  sort = "recent",
}: ListErrorIssuesParams) {
  const statusWhere = status
    ? { status }
    : includeAll
      ? {}
      : { status: { notIn: ["RESOLVED", "IGNORED"] as ErrorIssueStatus[] } };

  const where = {
    workspaceId,
    ...statusWhere,
    ...(repoKey ? { repoKey } : {}),
  };

  // Impact sort: impactScore desc (nulls last), then occurrenceCount desc, then lastSeenAt desc.
  // Prisma represents nulls-last for desc by using { sort: "desc", nulls: "last" }.
  const orderBy =
    sort === "impact"
      ? [
          { impactScore: { sort: "desc" as const, nulls: "last" as const } },
          { occurrenceCount: "desc" as const },
          { lastSeenAt: "desc" as const },
        ]
      : [{ lastSeenAt: "desc" as const }];

  const [issues, total] = await Promise.all([
    db.errorIssue.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        workspaceId: true,
        repositoryId: true,
        repoKey: true,
        fingerprint: true,
        exceptionType: true,
        title: true,
        status: true,
        occurrenceCount: true,
        firstSeenAt: true,
        lastSeenAt: true,
        environment: true,
        release: true,
        metadata: true,
        kgRefId: true,
        impactScore: true,
        impactScoredAt: true,
        impactMeta: true,
      },
    }),
    db.errorIssue.count({ where }),
  ]);

  return { issues, total, hasMore: skip + limit < total };
}

// ── Detail ────────────────────────────────────────────────────────────────────

export async function getErrorIssueDetail(
  issueId: string,
  eventsLimit = DEFAULT_EVENTS_LIMIT,
  eventsSkip = 0,
) {
  const issue = await db.errorIssue.findUnique({
    where: { id: issueId },
    select: {
      id: true,
      workspaceId: true,
      repositoryId: true,
      repoKey: true,
      fingerprint: true,
      exceptionType: true,
      title: true,
      status: true,
      occurrenceCount: true,
      firstSeenAt: true,
      lastSeenAt: true,
      environment: true,
      release: true,
      metadata: true,
      kgRefId: true,
    },
  });

  if (!issue) return null;

  const [rawEvents, eventsTotal] = await Promise.all([
    db.errorEvent.findMany({
      where: { issueId },
      orderBy: { createdAt: "desc" },
      skip: eventsSkip,
      take: eventsLimit,
      select: {
        id: true,
        issueId: true,
        workspaceId: true,
        repositoryId: true,
        repoKey: true,
        exceptionType: true,
        message: true,
        environment: true,
        release: true,
        fingerprint: true,
        commitSha: true,
        createdAt: true,
        // blobUrl is intentionally omitted — callers fetch via getErrorEventBlob
        repository: { select: { repositoryUrl: true, branch: true } },
      },
    }),
    db.errorEvent.count({ where: { issueId } }),
  ]);

  // Flatten repository fields so callers get a consistent, serializable shape
  const events = rawEvents.map(({ repository, ...event }) => ({
    ...event,
    repositoryUrl: repository?.repositoryUrl ?? null,
    defaultBranch: repository?.branch ?? null,
  }));

  return {
    issue,
    events,
    eventsTotal,
    eventsHasMore: eventsSkip + eventsLimit < eventsTotal,
  };
}

// ── Blob fetch ────────────────────────────────────────────────────────────────

const REDACTED_KEYS = new Set([
  "authorization",
  "cookie",
  "token",
  "secret",
  "password",
  "x-api-key",
  "api_key",
  "apikey",
]);

function redactSensitiveKeys(obj: unknown, depth = 0): unknown {
  if (depth > 10 || obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactSensitiveKeys(v, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = REDACTED_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : redactSensitiveKeys(v, depth + 1);
  }
  return result;
}

/**
 * Resolves an ErrorEvent's ownership metadata without fetching the blob.
 * Used by the route to check authorization before any external call.
 *
 * Returns null when the event doesn't exist or doesn't belong to issueId.
 */
export async function getErrorEventMeta(
  issueId: string,
  eventId: string,
): Promise<{ workspaceId: string; blobUrl: string } | null> {
  const event = await db.errorEvent.findUnique({
    where: { id: eventId },
    select: { issueId: true, workspaceId: true, blobUrl: true },
  });

  if (!event || event.issueId !== issueId) return null;

  return { workspaceId: event.workspaceId, blobUrl: event.blobUrl };
}

/**
 * Fetches and redacts the raw blob payload for a pre-authorized ErrorEvent.
 *
 * Caller MUST have already verified workspace access before calling this.
 * blobUrl is always server-set by ingest — it is never client-supplied.
 */
export async function fetchRedactedBlobContent(blobUrl: string): Promise<string> {
  const raw = await fetchBlobContent(blobUrl);

  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(redactSensitiveKeys(parsed), null, 2);
  } catch {
    return raw;
  }
}

// ── Triage ────────────────────────────────────────────────────────────────────

export class InvalidStatusError extends Error {
  constructor(status: string) {
    super(`Invalid status: "${status}". Must be one of: ${ALLOWED_STATUSES.join(", ")}`);
    this.name = "InvalidStatusError";
  }
}

/**
 * Updates an ErrorIssue's status and re-broadcasts via Pusher.
 *
 * @throws InvalidStatusError if status is not in the allowlist.
 */
export async function updateErrorIssueStatus(
  issueId: string,
  status: string,
): Promise<{ issue: { id: string; workspaceId: string; status: ErrorIssueStatus } }> {
  if (!ALLOWED_STATUSES.includes(status as ErrorIssueStatus)) {
    throw new InvalidStatusError(status);
  }

  const typedStatus = status as ErrorIssueStatus;

  const issue = await db.errorIssue.findUnique({
    where: { id: issueId },
    select: { id: true, workspaceId: true, status: true },
  });

  if (!issue) return { issue: { id: issueId, workspaceId: "", status: typedStatus } };

  const oldStatus = issue.status;

  const updated = await db.errorIssue.update({
    where: { id: issueId },
    data: { status: typedStatus },
    select: {
      id: true,
      workspaceId: true,
      repositoryId: true,
      fingerprint: true,
      occurrenceCount: true,
      status: true,
      lastSeenAt: true,
      workspace: { select: { slug: true } },
    },
  });

  console.info("[error-triage] status updated", {
    issueId,
    oldStatus,
    newStatus: typedStatus,
  });

  // Re-broadcast so live clients reflect the triage action
  try {
    await pusherServer.trigger(
      getWorkspaceChannelName(updated.workspace.slug),
      PUSHER_EVENTS.ERROR_ISSUE_UPDATED,
      {
        id: updated.id,
        repositoryId: updated.repositoryId,
        fingerprint: updated.fingerprint,
        isNew: false,
        occurrenceCount: updated.occurrenceCount,
        status: updated.status,
        lastSeenAt: updated.lastSeenAt,
      },
    );
  } catch (err) {
    console.error("[error-triage] Pusher broadcast failed (non-fatal)", err);
  }

  return { issue: { id: updated.id, workspaceId: updated.workspaceId, status: updated.status } };
}
