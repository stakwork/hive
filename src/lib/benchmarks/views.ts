import type { ComponentType } from "react";
import type { BenchmarkRunDetail } from "@/types/benchmarks";

export interface BenchmarkRunViewProps {
  workspaceSlug: string;
  benchmarkSlug: string;
  run: BenchmarkRunDetail;
}

/**
 * Escape hatch: benchmarkSlug → a custom run-detail view. When present it
 * replaces the generic detail body. Empty: every benchmark renders generically.
 */
export const BENCHMARK_RUN_VIEWS: Record<string, ComponentType<BenchmarkRunViewProps>> = {};
