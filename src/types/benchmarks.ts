export interface BenchmarkArtifact {
  name: string;
  url: string;
  kind: string | null;
}

export interface BenchmarkHeadline {
  score: number | null;
  metric: string | null;
  officialScore: number | null;
  summary: string | null;
  artifacts: BenchmarkArtifact[];
  parentRunId: string | null;
}

export interface BenchmarkTask {
  id: string | number;
  title: string;
  [key: string]: unknown;
}

export type BenchmarkRunStatus = "PENDING" | "SUCCESS" | "ERROR" | "CANCELLED" | "LOST";

export interface BenchmarkRun {
  id: string;
  status: BenchmarkRunStatus;
  taskId: string | number | null;
  score: number | null;
  metric: string | null;
  officialScore: number | null;
  error: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface BenchmarkRunDetail extends BenchmarkRun, BenchmarkHeadline {
  /** Strut's own id for the run — what a benchmark's app is opened on. */
  strutRunId: string | null;
  params: Record<string, unknown> | null;
  extra: { value: unknown; truncated: boolean; bytes?: number };
}

export interface BenchmarkInfo {
  slug: string;
  name: string;
  hasTaskList: boolean;
}
