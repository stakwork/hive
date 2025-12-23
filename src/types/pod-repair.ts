import { z } from "zod";

// Process statuses that indicate failure and should trigger repair
export const FAILED_STATUSES = ["error", "errored", "offline"] as const;

// Processes to ignore when checking for failures
export const IGNORED_PROCESSES = ["goose"] as const;

// Staklink proxy process name (prioritized for repair)
export const STAKLINK_PROXY_PROCESS = "staklink-proxy" as const;

// jlist endpoint response types
export interface JlistProcess {
  pid: number | null;
  name: string;
  status: string;
  pm_uptime?: number | null;
  port?: string;
  cwd?: string;
}

export const JlistResponseSchema = z.array(
  z.object({
    pid: z.number().nullable(),
    name: z.string(),
    status: z.string(),
    pm_uptime: z.number().nullable().optional(),
    port: z.string().optional(),
    cwd: z.string().optional(),
  })
);

export type JlistResponse = z.infer<typeof JlistResponseSchema>;

// Cron execution result
export interface PodRepairCronResult {
  success: boolean;
  workspacesProcessed: number;
  workspacesWithRunningPods: number;
  repairsTriggered: number;
  skipped: {
    maxAttemptsReached: number;
    workflowInProgress: number;
    noFailedProcesses: number;
  };
  errors: Array<{
    workspaceSlug: string;
    error: string;
  }>;
  timestamp: string;
}
