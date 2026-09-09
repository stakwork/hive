import { WorkflowStatus } from "@prisma/client";
import type { BenchmarkRunListRow } from "@/hooks/useLegalBenchmarkRunList";

/** In-memory `BenchmarkRunListRow` for component tests — no DB involved. */
export function makeBenchmarkRunListRow(
  overrides: Partial<BenchmarkRunListRow> = {},
): BenchmarkRunListRow {
  return {
    id: "run-1",
    workspaceId: "ws-1",
    runType: "manual",
    status: WorkflowStatus.COMPLETED,
    projectId: null,
    taskSlug: "antitrust/task-1",
    taskTitle: "",
    createdAt: "2026-08-18T11:00:00.000Z",
    updatedAt: "2026-08-18T11:00:00.000Z",
    hasReport: false,
    ...overrides,
  };
}

/** An in-flight consolidated-report row, as the Recursion tab sees it. */
export function makeConsolidatedRunRow(
  overrides: Partial<BenchmarkRunListRow> = {},
): BenchmarkRunListRow {
  return makeBenchmarkRunListRow({
    id: "consolidated-run-1",
    runType: "consolidated",
    status: WorkflowStatus.PENDING,
    ...overrides,
  });
}
