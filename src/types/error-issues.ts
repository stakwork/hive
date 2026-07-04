import type { ErrorIssueStatus } from "@prisma/client";

export type { ErrorIssueStatus };

/** A single candidate in a "likely" multi-match correlation result. */
export interface CorrelationCandidate {
  prNumber: number | null;
  prUrl: string | null;
  mergeDate: string | null;
  refId: string;
}

export interface ErrorIssueRecord {
  id: string;
  workspaceId: string;
  repositoryId: string | null;
  repoKey: string;
  fingerprint: string;
  exceptionType: string;
  title: string;
  status: ErrorIssueStatus;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  environment: string | null;
  release: string | null;
  metadata: Record<string, unknown> | null;
  kgRefId: string | null;
  /** Regression-correlation fields — null when correlation has not run or found nothing. */
  correlatedPrNumber: number | null;
  correlatedPrUrl: string | null;
  correlatedCommitSha: string | null;
  correlationConfidence: string | null;
  correlationComputedAt: string | null;
  correlationCandidates: CorrelationCandidate[] | null;
  /** Blast-radius impact score [0,1] from KG node centrality. null = unscored. */
  impactScore: number | null;
  impactScoredAt: string | null;
  /** Top contributing node breakdown: name, type, pagerank, in_degree, nodeCount. */
  impactMeta: Record<string, unknown> | null;
}

export interface ErrorEventRecord {
  id: string;
  issueId: string;
  workspaceId: string;
  repositoryId: string | null;
  repoKey: string;
  exceptionType: string;
  message: string | null;
  environment: string | null;
  release: string | null;
  fingerprint: string;
  commitSha: string | null;
  repositoryUrl: string | null;
  defaultBranch: string | null;
  createdAt: string;
}

export interface ErrorIssuesListResponse {
  issues: ErrorIssueRecord[];
  total: number;
  hasMore: boolean;
}

export interface ErrorIssueDetailResponse {
  issue: ErrorIssueRecord;
  events: ErrorEventRecord[];
  eventsTotal: number;
  eventsHasMore: boolean;
}

/** Minimal Pusher broadcast payload — no title/exceptionType included. */
export interface ErrorIssueUpdatedPayload {
  id: string;
  repositoryId: string | null;
  fingerprint: string;
  isNew: boolean;
  occurrenceCount: number;
  status: ErrorIssueStatus;
  lastSeenAt: string;
}
