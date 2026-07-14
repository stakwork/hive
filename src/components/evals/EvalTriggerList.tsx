import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, Check, ChevronRight, Loader2, Play, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  normalizeOutput,
  triggerHasIdentity,
  type EvalTrigger,
  type EvalTriggerOutput,
  type RawJarvisNode,
} from "@/lib/harvey-lab/eval-normalizers";

export interface EvalTriggerListProps {
  evalSetId: string;
  reqId: string;
  slug: string;
}

type RawTriggerNode = { ref_id: string; properties: EvalTrigger["properties"]; outputs?: RawJarvisNode[] };

export function EvalTriggerList({ evalSetId, reqId, slug }: EvalTriggerListProps) {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [triggers, setTriggers] = useState<EvalTrigger[]>([]);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  const fetchTriggers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/workspaces/${slug}/evals/${evalSetId}/requirements/${reqId}/triggers`,
      );
      const data = await res.json();
      const nodes: EvalTrigger[] = (data?.data?.nodes ?? []).map((t: RawTriggerNode) => ({
        ...t,
        outputs: (t.outputs ?? []).map(normalizeOutput).filter((o): o is EvalTriggerOutput => o !== null),
      }));
      setTriggers(nodes);
      setLoaded(true);
    } catch {
      toast.error("Failed to load triggers");
    } finally {
      setLoading(false);
    }
  }, [slug, evalSetId, reqId]);

  function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded) {
      fetchTriggers();
    }
  }

  async function handleRunEval(triggerId: string) {
    setRunningIds((prev) => new Set(prev).add(triggerId));
    try {
      const res = await fetch(
        `/api/workspaces/${slug}/evals/${evalSetId}/requirements/${reqId}/triggers/${triggerId}/run`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Run failed");
      toast.success("Eval run started");

      // Fetch outputs and merge into state
      const outRes = await fetch(
        `/api/workspaces/${slug}/evals/${evalSetId}/requirements/${reqId}/triggers/${triggerId}/outputs`,
      );
      const outData = await outRes.json();
      const outputs: EvalTriggerOutput[] = (outData?.data?.nodes as RawJarvisNode[] ?? []).map(normalizeOutput).filter((o): o is EvalTriggerOutput => o !== null);

      setTriggers((prev) =>
        prev.map((t) => (t.ref_id === triggerId ? { ...t, outputs } : t)),
      );
    } catch {
      toast.error("Failed to run eval");
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(triggerId);
        return next;
      });
    }
  }

  const visibleTriggers = triggers.filter(triggerHasIdentity);
  const count = loaded ? visibleTriggers.length : null;

  return (
    <div className="mt-3 border-t pt-2.5">
      <button
        type="button"
        data-testid="trigger-count-chip"
        onClick={handleToggle}
        className="inline-flex items-center gap-1.5 rounded-md py-1 pr-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
        <span>Triggers</span>
        {count !== null && count > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] leading-none text-foreground">
            {count}
          </span>
        )}
        {count === 0 && <span className="text-muted-foreground/70">· none yet</span>}
        {loading && <Loader2 className="h-3 w-3 animate-spin" />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2" data-testid="trigger-list">
          {loading ? (
            <>
              <Skeleton className="h-16 w-full" data-testid="trigger-skeleton" />
              <Skeleton className="h-16 w-full" data-testid="trigger-skeleton" />
            </>
          ) : visibleTriggers.length === 0 ? (
            <div className="rounded-md border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
              No triggers yet for this requirement.
            </div>
          ) : (
            visibleTriggers.map((trigger) => {
              const agent = String(trigger.properties?.agent ?? "");
              const env = String(trigger.properties?.environment ?? "");
              const runCount = Number(trigger.properties?.run_count ?? 1);
              const startPoint = String(trigger.properties?.start_point ?? "");
              const endPoint = String(trigger.properties?.end_point ?? "");
              const isRunning = runningIds.has(trigger.ref_id);
              // Drop incomplete output nodes that have no verdict yet.
              const outputs = (trigger.outputs ?? []).filter(
                (o) => o.result.trim() !== "",
              );
              const passCount = outputs.filter(
                (o) => o.result.toLowerCase() === "pass",
              ).length;

              return (
                <div
                  key={trigger.ref_id}
                  className="rounded-md border bg-card p-3"
                  data-testid="trigger-row"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">{agent || "Agent"}</span>
                        {env && (
                          <Badge variant="secondary" className="text-[11px]">
                            {env}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {runCount} attempt{runCount !== 1 ? "s" : ""} per run
                        </span>
                        {outputs.length > 0 && (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[11px]",
                              passCount === outputs.length
                                ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                                : passCount === 0
                                  ? "border-rose-500/30 text-rose-600 dark:text-rose-400"
                                  : "text-foreground",
                            )}
                          >
                            {passCount}/{outputs.length} passed
                          </Badge>
                        )}
                      </div>
                      {(startPoint || endPoint) && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="truncate">{startPoint || "—"}</span>
                          <ArrowRight className="h-3 w-3 shrink-0" />
                          <span className="truncate">{endPoint || "—"}</span>
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-xs"
                      disabled={isRunning}
                      onClick={() => handleRunEval(trigger.ref_id)}
                      data-testid="run-eval-btn"
                    >
                      {isRunning ? (
                        <>
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          Running…
                        </>
                      ) : (
                        <>
                          <Play className="mr-1 h-3 w-3" />
                          Run Eval
                        </>
                      )}
                    </Button>
                  </div>

                  {/* EvalTriggerOutput rows */}
                  {outputs.length > 0 && (
                    <div className="mt-2.5 space-y-1.5 border-t pt-2.5">
                      {outputs.map((output, i) => {
                        const verdict = output.result.toLowerCase();
                        const isPass = verdict === "pass";
                        const isFail = verdict === "fail";
                        return (
                          <div
                            key={output.ref_id}
                            className="flex items-center gap-2 text-xs"
                            data-testid="trigger-output-row"
                          >
                            <span className="w-6 shrink-0 font-mono text-muted-foreground">
                              #{output.attempt_number || i + 1}
                            </span>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium capitalize",
                                isPass
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : isFail
                                    ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                                    : "bg-muted text-muted-foreground",
                              )}
                            >
                              {isPass ? (
                                <Check className="h-3 w-3" />
                              ) : isFail ? (
                                <X className="h-3 w-3" />
                              ) : null}
                              {output.result}
                            </span>
                            <span className="font-medium tabular-nums">
                              {(output.score ?? 0).toFixed(2)}
                            </span>
                            {output.judge_notes && (
                              <span className="truncate text-muted-foreground">
                                {output.judge_notes}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
