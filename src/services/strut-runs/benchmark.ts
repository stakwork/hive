/**
 * Benchmark runs — one `StrutRun` kind (`benchmark:<slug>`) for every entry
 * of `lib/benchmarks/registry`. The row IS the result: `input` is what was
 * launched and `output` the workflow's raw output; the reconcile cron owns
 * LOST. The launch, list and read live with the benchmark that uses them
 * (`legal-benchmark.ts` for Harvey LAB).
 */

import { StrutRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { benchmarkKind, taskIdKey, type Benchmark } from "@/lib/benchmarks/registry";
import { STRUT_RUN_LOG_TAG, type StrutRunHandler } from "@/services/strut-runs";

export const handleBenchmarkRunSettled: StrutRunHandler = async (row) => {
  logger.info("Benchmark run settled", STRUT_RUN_LOG_TAG, {
    runId: row.id,
    kind: row.kind,
    workspaceId: row.workspaceId,
    status: row.status,
  });
};

/** Is a run of this task still PENDING in the workspace? (One run per task at a time.) */
export async function hasPendingBenchmarkRun(workspaceId: string, benchmark: Benchmark, taskId: string | number): Promise<boolean> {
  const row = await db.strutRun.findFirst({
    where: {
      workspaceId,
      kind: benchmarkKind(benchmark.slug),
      status: StrutRunStatus.PENDING,
      input: { path: [taskIdKey(benchmark)], equals: taskId },
    },
    select: { id: true },
  });
  return row !== null;
}
