/**
 * legal-recursion-cron.ts
 *
 * Feature deprecated — the legal_benchmark_recursions table has been dropped.
 * This service is a no-op stub retained for import compatibility.
 */

export interface RecursionCronResult {
  success: boolean;
  entriesProcessed: number;
  dispatched: number;
  skipped: number;
  deactivated: number;
  errors: string[];
  timestamp: Date;
}

export async function executeScheduledLegalBenchmarkRecursion(): Promise<RecursionCronResult> {
  return {
    success: true,
    entriesProcessed: 0,
    dispatched: 0,
    skipped: 0,
    deactivated: 0,
    errors: [],
    timestamp: new Date(),
  };
}
