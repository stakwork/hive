"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BenchmarkRunCascade } from "@/components/legal/RunCascade";
import { StrutRunViewLink } from "@/components/legal/StrutRunViewLink";
import { isActiveStatus, type LongMemoryRunRow } from "@/hooks/useLongMemoryRuns";

const pct = (v: number | undefined) => (v === undefined ? "—" : `${Math.round(v * 100)}%`);

function RunDetail({ run }: { run: LongMemoryRunRow }) {
  const r = run.result;
  if (!r) return null;
  return (
    <div className="space-y-3 border-t bg-muted/30 px-4 py-3 text-sm" data-testid="run-detail">
      {r.errorMessage && <p className="text-destructive">{r.errorMessage}</p>}
      {r.summary && <p>{r.summary}</p>}
      {r.mode === "single" ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          {r.metric && (<><dt className="text-muted-foreground">Metric</dt><dd>{r.metric}</dd></>)}
          {r.officialScore !== undefined && (<><dt className="text-muted-foreground">Official score</dt><dd>{r.officialScore}</dd></>)}
          {r.judgeModel && (<><dt className="text-muted-foreground">Judge</dt><dd>{r.judgeModel}</dd></>)}
          {r.missCause && (<><dt className="text-muted-foreground">Miss cause</dt><dd data-testid="miss-cause">{r.missCause}</dd></>)}
          {r.hypothesis && (<><dt className="text-muted-foreground">Hypothesis</dt><dd className="whitespace-pre-wrap" data-testid="hypothesis">{r.hypothesis}</dd></>)}
        </dl>
      ) : (
        <div className="space-y-2 text-xs">
          <div className="flex flex-wrap gap-4">
            <span>n: {r.n ?? "—"}</span>
            <span>accuracy: {pct(r.accuracy)}</span>
            <span>abstention accuracy: {pct(r.abstentionAccuracy)}</span>
            {r.totalCost !== undefined && <span>cost: ${r.totalCost.toFixed(2)}</span>}
          </div>
          {r.byType && Object.keys(r.byType).length > 0 && (
            <table className="text-xs" data-testid="by-type">
              <thead>
                <tr className="text-left text-muted-foreground"><th className="pr-6">Type</th><th className="pr-6">n</th><th>Accuracy</th></tr>
              </thead>
              <tbody>
                {Object.entries(r.byType).map(([type, v]) => (
                  <tr key={type}><td className="pr-6">{type}</td><td className="pr-6">{v.n ?? "—"}</td><td>{pct(v.accuracy)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {r.misses && r.misses.length > 0 && (
            <div>
              <p className="font-medium">Misses ({r.misses.length})</p>
              <ul className="list-disc pl-5">
                {r.misses.map((m) => (
                  <li key={m.question_id}>
                    <code>{m.question_id}</code>
                    {m.questionType ? ` · ${m.questionType}` : ""}
                    {m.missCause ? ` · ${m.missCause}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-4">
        <BenchmarkRunCascade runId={run.id} runStatus={run.status} />
        <StrutRunViewLink strutRunId={r.strutRunId} workflow={r.workflow} />
      </div>
    </div>
  );
}

/** Runs tab: history of single and batch runs with scores, per-type accuracy, miss cause and hypothesis. */
export function LongMemoryRunsHistory({ runs, isLoading, error }: { runs: LongMemoryRunRow[]; isLoading: boolean; error: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">No runs yet.</p>;
  return (
    <ul className="divide-y rounded-md border" data-testid="longmemory-runs">
      {runs.map((run) => {
        const r = run.result;
        const active = isActiveStatus(run.status);
        return (
          <li key={run.id} data-testid="run-row">
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50"
              onClick={() => setOpen(open === run.id ? null : run.id)}
            >
              <span className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</span>
              <Badge variant="outline">{r?.mode === "batch" ? "batch" : "single"}</Badge>
              {r?.mode === "single" && r.question_id && <code className="text-xs">{r.question_id}</code>}
              {r?.mode === "single" && r.questionType && <span className="text-xs">{r.questionType}</span>}
              {r?.mode === "single" && r.abstention && <Badge variant="secondary">abstention</Badge>}
              <span className="ml-auto flex items-center gap-2">
                {active ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : r?.mode === "batch" ? (
                  <span>{pct(r.accuracy)}{r.n !== undefined ? ` (${r.n})` : ""}</span>
                ) : r?.score !== undefined ? (
                  <Badge variant={r.score === 1 ? "default" : "destructive"}>{r.score === 1 ? "1" : "0"}</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">{run.status}</span>
                )}
              </span>
            </button>
            {open === run.id && <RunDetail run={run} />}
          </li>
        );
      })}
    </ul>
  );
}
