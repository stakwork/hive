"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkspace } from "@/hooks/useWorkspace";
import { isActiveStatus, type LongMemoryRunRow } from "@/hooks/useLongMemoryRuns";
import type { LongMemoryQuestion, LongMemoryTaskList } from "@/types/longmemory";

const pct = (v: number | undefined) => (v === undefined ? "—" : `${Math.round(v * 100)}%`);

interface Props {
  runs: LongMemoryRunRow[];
  refetchRuns: () => Promise<void>;
}

/** Benchmark tab: the question list (whatever the API returns), launch one / all, and a score summary. */
export function LongMemoryPanel({ runs, refetchRuns }: Props) {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;
  const [list, setList] = useState<LongMemoryTaskList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);
  const [limit, setLimit] = useState("");

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    fetch(`/api/workspaces/${slug}/longmemory/benchmarks/tasks`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? "Failed to load questions");
        if (!cancelled) setList(body as LongMemoryTaskList);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load questions"));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const pendingQuestions = useMemo(
    () =>
      new Set(
        runs
          .filter((r) => isActiveStatus(r.status) && r.result?.mode === "single" && r.result.question_id)
          .map((r) => r.result!.question_id as string),
      ),
    [runs],
  );
  const batchPending = runs.some((r) => isActiveStatus(r.status) && r.result?.mode === "batch");

  // Latest settled single run per question, for a per-row score badge.
  const latestScore = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of runs) {
      const id = r.result?.question_id;
      if (r.result?.mode === "single" && id && r.result.score !== undefined && !m.has(id)) m.set(id, r.result.score);
    }
    return m;
  }, [runs]);

  const summary = useMemo(() => {
    const singles = runs.filter((r) => r.result?.mode === "single" && r.result.score !== undefined);
    const correct = singles.filter((r) => r.result?.score === 1).length;
    const lastBatch = runs.find((r) => r.result?.mode === "batch" && r.result.accuracy !== undefined)?.result;
    return { scored: singles.length, correct, lastBatch };
  }, [runs]);

  const launch = useCallback(
    async (payload: Record<string, unknown>, key: string) => {
      if (!slug) return;
      setLaunching(key);
      try {
        const res = await fetch(`/api/workspaces/${slug}/longmemory/benchmarks/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? "Failed to start run");
        toast.success("Run started");
        await refetchRuns();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to start run");
      } finally {
        setLaunching(null);
      }
    },
    [slug, refetchRuns],
  );

  const launchAll = () => {
    const n = limit.trim() === "" ? undefined : Number(limit);
    if (n !== undefined && (!Number.isInteger(n) || n < 1)) {
      toast.error("Limit must be a positive whole number");
      return;
    }
    void launch({ all: true, ...(n !== undefined ? { limit: n } : {}) }, "all");
  };

  return (
    <div className="flex h-full flex-col gap-3 px-4" data-testid="longmemory-panel">
      <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="longmemory-summary">
        <span>
          Single runs: {summary.correct}/{summary.scored} correct
        </span>
        {summary.lastBatch && (
          <span>
            Last batch: {pct(summary.lastBatch.accuracy)} over {summary.lastBatch.n ?? "?"} questions
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Input
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="Limit (optional)"
            inputMode="numeric"
            className="h-8 w-36 text-xs"
            aria-label="Batch limit"
          />
          <Button size="sm" onClick={launchAll} disabled={launching !== null || batchPending} data-testid="launch-all">
            {launching === "all" || batchPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
            Launch all
          </Button>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !list ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading questions…
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <p className="pb-2 text-xs text-muted-foreground">{list.total} questions</p>
          <ul className="divide-y rounded-md border">
            {list.tasks.map((q: LongMemoryQuestion) => (
              <li key={q.id} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid="question-row">
                <code className="text-xs">{q.id}</code>
                <Badge variant="outline">{q.type || "—"}</Badge>
                {q.abstention && <Badge variant="secondary">abstention</Badge>}
                {latestScore.has(q.id) && (
                  <Badge variant={latestScore.get(q.id) === 1 ? "default" : "destructive"}>
                    {latestScore.get(q.id) === 1 ? "correct" : "miss"}
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-7"
                  disabled={launching !== null || pendingQuestions.has(q.id)}
                  onClick={() => void launch({ questionId: q.id }, q.id)}
                >
                  {launching === q.id || pendingQuestions.has(q.id) ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Launch"
                  )}
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
