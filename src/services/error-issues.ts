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
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { kgGetNeighbors } from "@/lib/ai/kg-adapter";

const ALLOWED_STATUSES: ErrorIssueStatus[] = ["UNRESOLVED", "RESOLVED", "IGNORED"];
const DEFAULT_EVENTS_LIMIT = 20;

// ── List ──────────────────────────────────────────────────────────────────────

export type ErrorIssuesSortOrder = "recent" | "impact";

export interface ListErrorIssuesParams {
  workspaceId: string;
  status?: ErrorIssueStatus;
  includeAll?: boolean;
  repoKey?: string;
  skip?: number;
  limit?: number;
  sort?: ErrorIssuesSortOrder;
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

  // impact ordering: impactScore desc nulls-last, then occurrenceCount desc, then lastSeenAt desc.
  // Prisma/PostgreSQL default for DESC is NULLS FIRST, so we must explicitly set nulls: "last"
  // to push unscored issues below scored ones.
  // recent ordering: lastSeenAt desc (default behaviour — unchanged for existing callers)
  const orderBy =
    sort === "impact"
      ? [
          { impactScore: { sort: "desc" as const, nulls: "last" as const } },
          { occurrenceCount: "desc" as const },
          { lastSeenAt: "desc" as const },
        ]
      : { lastSeenAt: "desc" as const };

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
        correlatedPrNumber: true,
        correlatedPrUrl: true,
        correlatedCommitSha: true,
        correlationConfidence: true,
        correlationComputedAt: true,
        correlationCandidates: true,
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
      correlatedPrNumber: true,
      correlatedPrUrl: true,
      correlatedCommitSha: true,
      correlationConfidence: true,
      correlationComputedAt: true,
      correlationCandidates: true,
    },
  });

  if (!issue) return null;

  const [rawEvents, eventsTotal, linkedFeatures] = await Promise.all([
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
    db.feature.findMany({
      where: { errorIssueId: issueId, deleted: false },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, createdAt: true },
    }),
  ]);

  // Flatten repository fields so callers get a consistent, serializable shape
  const events = rawEvents.map(({ repository, ...event }) => ({
    ...event,
    repositoryUrl: repository?.repositoryUrl ?? null,
    defaultBranch: repository?.branch ?? null,
  }));

  const features = linkedFeatures.map((f) => ({
    id: f.id,
    title: f.title,
    createdAt: f.createdAt.toISOString(),
  }));

  return {
    issue,
    events,
    eventsTotal,
    eventsHasMore: eventsSkip + eventsLimit < eventsTotal,
    features,
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

// ── Auto-resolve ──────────────────────────────────────────────────────────────

/**
 * Resolves all ErrorIssues linked to the given Feature IDs that are not yet
 * RESOLVED or IGNORED.
 *
 * - Idempotent: already-RESOLVED issues are silently skipped (notIn filter).
 * - IGNORED protection: IGNORED issues are never touched (notIn filter).
 * - Partial failure: one issue failing does not block others.
 * - Returns the list of issue IDs that were actually resolved.
 */
export async function autoResolveErrorIssuesForFeatures(
  featureIds: string[],
): Promise<{ resolvedIssueIds: string[] }> {
  if (featureIds.length === 0) return { resolvedIssueIds: [] };

  const issues = await db.errorIssue.findMany({
    where: {
      features: { some: { id: { in: featureIds } } },
      status: { notIn: ["RESOLVED", "IGNORED"] },
    },
    select: { id: true },
  });

  const resolvedIssueIds: string[] = [];

  for (const { id } of issues) {
    try {
      await updateErrorIssueStatus(id, "RESOLVED");
      resolvedIssueIds.push(id);
    } catch (err) {
      console.error("[error-auto-resolve] failed to resolve issue (non-blocking)", {
        issueId: id,
        error: err,
      });
    }
  }

  return { resolvedIssueIds };
}

// ── Related Issues ────────────────────────────────────────────────────────────

const RELATED_ISSUES_CAP = 10;

export interface RelatedErrorIssue {
  id: string;
  title: string;
  exceptionType: string;
  status: ErrorIssueStatus;
  occurrenceCount: number;
  lastSeenAt: string;
  kgRefId: string | null;
  sharedCodeNodeCount: number;
}

/**
 * Finds other ErrorIssues in the same workspace/repository that share
 * File/Function code entities with the given issue via the knowledge graph.
 *
 * Two-hop traversal:
 *   Hop 1: ErrorIssue → REFERENCES → File/Function
 *   Hop 2: File/Function → REFERENCES (reverse) → ErrorIssue (siblings)
 *
 * Returns [] (never throws) when:
 *   - Issue not found
 *   - Issue has no kgRefId
 *   - No Jarvis config for the workspace
 *   - Graph is unreachable
 *   - Any unexpected error
 */
export async function getRelatedErrorIssues(issueId: string): Promise<RelatedErrorIssue[]> {
  try {
    const issue = await db.errorIssue.findUnique({
      where: { id: issueId },
      select: { id: true, workspaceId: true, repositoryId: true, kgRefId: true },
    });

    if (!issue?.kgRefId) {
      console.info("[error-related] skipped: no kgRefId", { issueId });
      return [];
    }

    const jarvisConfig = await getJarvisConfigForWorkspace(issue.workspaceId);
    if (!jarvisConfig) {
      console.info("[error-related] skipped: no jarvis config", { issueId, workspaceId: issue.workspaceId });
      return [];
    }

    const { jarvisUrl, apiKey } = jarvisConfig;

    // Hop 1: get code entity (File/Function) neighbors of this issue
    const hop1 = await kgGetNeighbors(jarvisUrl, apiKey, issue.kgRefId, {
      edgeTypes: ["REFERENCES"],
      nodeTypes: ["File", "Function"],
    });

    if (!hop1.reachable) {
      console.info("[error-related] graph unreachable on hop-1", { issueId, kgRefId: issue.kgRefId });
      return [];
    }

    const codeNodes = hop1.neighbors;
    console.info("[error-related] hop-1 code nodes", {
      issueId,
      kgRefId: issue.kgRefId,
      codeNodeCount: codeNodes.length,
    });

    if (codeNodes.length === 0) return [];

    // Hop 2: for each code node, find sibling ErrorIssue ref_ids
    // Run in parallel with bounded concurrency; skip individual failures
    const CONCURRENCY = 5;
    const sharedCountMap = new Map<string, number>(); // sibling kgRefId → shared node count

    for (let i = 0; i < codeNodes.length; i += CONCURRENCY) {
      const batch = codeNodes.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((codeNode) =>
          kgGetNeighbors(jarvisUrl, apiKey, codeNode.ref_id, {
            edgeTypes: ["REFERENCES"],
            nodeTypes: ["ErrorIssue"],
          }),
        ),
      );

      for (const result of results) {
        if (result.status === "rejected") continue;
        const hop2 = result.value;
        if (!hop2.reachable) continue;

        for (const sibling of hop2.neighbors) {
          if (sibling.ref_id === issue.kgRefId) continue; // exclude source
          sharedCountMap.set(sibling.ref_id, (sharedCountMap.get(sibling.ref_id) ?? 0) + 1);
        }
      }
    }

    const siblingRefIds = [...sharedCountMap.keys()];
    console.info("[error-related] candidate siblings", {
      issueId,
      kgRefId: issue.kgRefId,
      candidateCount: siblingRefIds.length,
    });

    if (siblingRefIds.length === 0) return [];

    // Map ref_ids → DB rows, enforcing same workspace + repository scope
    const dbRows = await db.errorIssue.findMany({
      where: {
        workspaceId: issue.workspaceId,
        repositoryId: issue.repositoryId,
        kgRefId: { in: siblingRefIds },
      },
      select: {
        id: true,
        title: true,
        exceptionType: true,
        status: true,
        occurrenceCount: true,
        lastSeenAt: true,
        kgRefId: true,
      },
    });

    // Sort: unresolved first, then by shared-node count desc
    const sorted = dbRows
      .map((row) => ({
        ...row,
        lastSeenAt: row.lastSeenAt.toISOString(),
        sharedCodeNodeCount: sharedCountMap.get(row.kgRefId!) ?? 0,
      }))
      .sort((a, b) => {
        const unresolvedA = a.status === "UNRESOLVED" ? 0 : 1;
        const unresolvedB = b.status === "UNRESOLVED" ? 0 : 1;
        if (unresolvedA !== unresolvedB) return unresolvedA - unresolvedB;
        return b.sharedCodeNodeCount - a.sharedCodeNodeCount;
      })
      .slice(0, RELATED_ISSUES_CAP);

    console.info("[error-related] final results", {
      issueId,
      kgRefId: issue.kgRefId,
      finalCount: sorted.length,
    });

    return sorted;
  } catch (err) {
    console.error("[error-related] traversal failed (non-fatal)", err);
    return [];
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
