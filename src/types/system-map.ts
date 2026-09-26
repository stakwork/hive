import type { StrutRunStatus } from "@prisma/client";

/** One System Map workflow run, as `GET /api/workspaces/:slug/system-map/runs` lists it. */
export interface SystemMapRun {
  id: string;
  workflow: string;
  strutRunId: string | null;
  status: StrutRunStatus;
  /** The workflow's `output` verbatim (success only). */
  output: unknown;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  settledAt: string | null;
  /** Hive link to the run in the org strut view; null until the launch returned. */
  strutUrl: string | null;
}

export type SystemMapWorkflowKey = "schema" | "materialize";

export interface SystemMapRunsResponse {
  /** Which workflow these runs belong to. */
  key: SystemMapWorkflowKey;
  workflow: string;
  runs: SystemMapRun[];
}
