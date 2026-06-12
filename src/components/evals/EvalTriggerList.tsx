import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, Loader2, Play } from "lucide-react";
import { toast } from "sonner";

export interface EvalTriggerListProps {
  evalSetId: string;
  reqId: string;
  slug: string;
}

interface EvalTriggerOutput {
  ref_id: string;
  attempt_number: number;
  result: string;
  score: number;
  judge_notes?: string;
}

interface EvalTrigger {
  ref_id: string;
  properties: {
    agent?: string;
    start_point?: string;
    end_point?: string;
    environment?: string;
    run_count?: number;
    change_type?: string;
    positive_cases?: string[];
    negative_cases?: string[];
    [key: string]: unknown;
  };
  outputs?: EvalTriggerOutput[];
}

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
      const nodes: EvalTrigger[] = data?.data?.nodes ?? [];
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
      const outputs: EvalTriggerOutput[] = (outData?.data?.nodes ?? []).map(
        (n: { ref_id: string; properties?: Partial<EvalTriggerOutput> }) => ({
          ref_id: n.ref_id,
          attempt_number: Number(n.properties?.attempt_number ?? 0),
          result: String(n.properties?.result ?? ""),
          score: Number(n.properties?.score ?? 0),
          judge_notes: n.properties?.judge_notes ? String(n.properties.judge_notes) : undefined,
        }),
      );

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

  const count = loaded ? triggers.length : null;
  const chipLabel =
    count === null ? "triggers" : count === 0 ? "No triggers" : `${count} trigger${count !== 1 ? "s" : ""}`;

  return (
    <div className="mt-2">
      <button
        type="button"
        data-testid="trigger-count-chip"
        onClick={handleToggle}
        className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {chipLabel}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 pl-2" data-testid="trigger-list">
          {loading ? (
            <>
              <Skeleton className="h-14 w-full" data-testid="trigger-skeleton" />
              <Skeleton className="h-14 w-full" data-testid="trigger-skeleton" />
            </>
          ) : triggers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No triggers captured yet</p>
          ) : (
            triggers.map((trigger) => {
              const agent = String(trigger.properties?.agent ?? "");
              const env = String(trigger.properties?.environment ?? "");
              const runCount = Number(trigger.properties?.run_count ?? 1);
              const startPoint = String(trigger.properties?.start_point ?? "");
              const endPoint = String(trigger.properties?.end_point ?? "");
              const isRunning = runningIds.has(trigger.ref_id);

              return (
                <div
                  key={trigger.ref_id}
                  className="rounded-md border bg-muted/30 p-3"
                  data-testid="trigger-row"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">{agent}</span>
                        {env && (
                          <Badge variant="outline" className="text-xs">
                            {env}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">{runCount}× runs</span>
                      </div>
                      {(startPoint || endPoint) && (
                        <p className="text-xs text-muted-foreground">
                          {startPoint} → {endPoint}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
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
                  {trigger.outputs && trigger.outputs.length > 0 && (
                    <div className="mt-2 space-y-1 border-t pt-2 pl-3">
                      {trigger.outputs.map((output) => {
                        const isPass = output.result === "pass";
                        return (
                          <div
                            key={output.ref_id}
                            className="flex flex-wrap items-center gap-2 text-xs"
                            data-testid="trigger-output-row"
                          >
                            <span className="font-mono text-muted-foreground">
                              #{output.attempt_number}
                            </span>
                            <Badge
                              variant={isPass ? "default" : "destructive"}
                              className={`text-xs ${isPass ? "bg-green-600 text-white" : ""}`}
                            >
                              {output.result}
                            </Badge>
                            <span className="font-medium">{output.score.toFixed(2)}</span>
                            {output.judge_notes && (
                              <span className="text-muted-foreground">{output.judge_notes}</span>
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
