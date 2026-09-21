/**
 * Graph-backed Protect finding payload.
 *
 * Intentionally named `ProtectFinding` so Hive TypeScript does not reuse
 * `src/lib/run-report/types.ts` `SecurityFinding` (a run-report projection).
 * The Jarvis node type remains `SecurityFinding`.
 */

export const PROTECT_FINDING_CATEGORIES = [
  "security",
  "code-dup",
  "bug",
  "secret",
  "supply-chain",
  "other",
] as const;

export const PROTECT_FINDING_SEVERITIES = ["critical", "high", "medium", "low"] as const;

export const PROTECT_FINDING_VERIFICATIONS = ["confirmed", "reported"] as const;

export const PROTECT_FINDING_STATUSES = ["open", "stale"] as const;

export const PROTECT_STRING_LIMITS = {
  title: 500,
  area: 200,
  file: 1000,
  description: 8000,
  evidence: 8000,
  recommendation: 8000,
  repositoryUrl: 2000,
} as const;

export type ProtectFindingCategory = (typeof PROTECT_FINDING_CATEGORIES)[number];
export type ProtectFindingSeverity = (typeof PROTECT_FINDING_SEVERITIES)[number];
export type ProtectFindingVerification = (typeof PROTECT_FINDING_VERIFICATIONS)[number];
export type ProtectFindingStatus = (typeof PROTECT_FINDING_STATUSES)[number];

export type ProtectPageStatus = "empty" | "in-progress" | "ready" | "error";

export interface ProtectFinding {
  ref_id: string;
  node_key: string;
  id: string;
  category: ProtectFindingCategory;
  severity: ProtectFindingSeverity;
  area: string;
  file: string;
  line: number | null;
  title: string;
  description: string;
  evidence: string;
  recommendation: string;
  verification: ProtectFindingVerification | null;
  status: ProtectFindingStatus;
  repositoryUrl: string;
}

export interface ProtectReviewRunSummary {
  id: string;
  mode: "full" | "incremental";
  status: "pending" | "running" | "completed" | "failed";
  repositoryUrl: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ProtectScopeRepository {
  id: string;
  name: string;
  repositoryUrl: string;
  inScope: boolean;
}

export interface ProtectScopePayload {
  repositories: ProtectScopeRepository[];
  selected: Array<{
    id: string;
    repositoryUrl: string;
  }>;
  empty: boolean;
}

export interface ProtectFindingsResponse {
  status: ProtectPageStatus;
  findings: ProtectFinding[];
  run: ProtectReviewRunSummary | null;
  scope: ProtectScopePayload;
  error?: string;
}

export interface ProtectEndpoint {
  refId: string;
  name: string;
  verb: string;
  file: string;
}

export interface ProtectEndpointsResponse {
  status: "ready" | "error";
  endpoints: ProtectEndpoint[];
  truncated: boolean;
  error?: string;
}

export interface ProtectReviewCounts {
  created: number;
  updated: number;
  skipped: number;
  stale: number;
}

export interface IncomingProtectFinding {
  id?: string;
  category: ProtectFindingCategory;
  severity: ProtectFindingSeverity;
  area: string;
  file: string;
  line: number | null;
  title: string;
  description: string;
  evidence: string;
  recommendation: string;
  status?: ProtectFindingStatus;
  repositoryUrl: string;
  titlefingerprint?: string;
}
