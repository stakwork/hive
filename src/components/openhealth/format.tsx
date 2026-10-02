import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { openHealthBenchmarkLabel, openHealthMetricLabel } from "@/lib/openhealth-benchmarks/constants";
import type {
  OpenHealthBenchmark,
  OpenHealthClimbStatus,
  OpenHealthDifficulty,
  OpenHealthOutcome,
} from "@/types/openhealth";

export const formatScore = (value: number | null | undefined): string =>
  typeof value === "number" ? value.toFixed(2) : "—";

export const formatPercent = (value: number | null | undefined): string =>
  typeof value === "number" ? `${Math.round(value * 100)}%` : "—";

export const formatCost = (usd: number | null | undefined): string =>
  typeof usd === "number" ? `$${usd.toFixed(2)}` : "—";

export function formatDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number") return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export const formatWhen = (iso: string): string => new Date(iso).toLocaleString();

/** "Weighted F1", "Clinical F1", "Conditioned F1", "Abstention"; "Score" when the metric is unknown. */
export const formatMetric = (metric: string | null | undefined): string => openHealthMetricLabel(metric);

/** "Diagnosis", "Summary", "Cardiology summary". */
export const formatBenchmark = (benchmark: OpenHealthBenchmark, specialty?: string | null): string =>
  openHealthBenchmarkLabel(benchmark, specialty);

const OUTCOME_LABEL: Record<OpenHealthOutcome, string> = {
  running: "Running",
  succeeded: "Scored",
  failed: "Failed",
  cancelled: "Cancelled",
};

const OUTCOME_VARIANT: Record<OpenHealthOutcome, "default" | "secondary" | "destructive" | "outline"> = {
  running: "secondary",
  succeeded: "default",
  failed: "destructive",
  cancelled: "outline",
};

export function OutcomeBadge({ outcome }: { outcome: OpenHealthOutcome }) {
  return (
    <Badge variant={OUTCOME_VARIANT[outcome]} className="gap-1" data-testid="openhealth-outcome">
      {outcome === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
      {OUTCOME_LABEL[outcome]}
    </Badge>
  );
}

export function DifficultyBadge({ difficulty }: { difficulty: OpenHealthDifficulty | null }) {
  if (!difficulty) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className="capitalize">
      {difficulty}
    </Badge>
  );
}

/** Which benchmark a row is: shown beside the task id wherever runs of several benchmarks mix. */
export function BenchmarkBadge({
  benchmark,
  specialty,
}: {
  benchmark: OpenHealthBenchmark;
  specialty?: string | null;
}) {
  return (
    <Badge variant="secondary" className="font-sans font-normal" data-testid="openhealth-benchmark">
      {formatBenchmark(benchmark, specialty)}
    </Badge>
  );
}

const CLIMB_LABEL: Record<OpenHealthClimbStatus, string> = {
  running: "Climbing",
  reached: "Reached",
  exhausted: "Runs spent",
  stopped: "Stopped",
  failed: "Failed",
};

const CLIMB_VARIANT: Record<OpenHealthClimbStatus, "default" | "secondary" | "destructive" | "outline"> = {
  running: "secondary",
  reached: "default",
  exhausted: "outline",
  stopped: "outline",
  failed: "destructive",
};

export function ClimbStatusBadge({ status }: { status: OpenHealthClimbStatus }) {
  return (
    <Badge variant={CLIMB_VARIANT[status]} className="gap-1" data-testid="openhealth-climb-status">
      {status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
      {CLIMB_LABEL[status]}
    </Badge>
  );
}
