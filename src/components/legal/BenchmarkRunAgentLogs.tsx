"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { ConceptsPanel } from "@/components/agent-logs/LogDetailContent";
import { LogDetailDialog } from "@/components/agent-logs/LogDetailDialog";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { SessionReflection } from "@/types/agent-logs";

interface RunAgentLogRow {
  id: string;
  agent: string;
  createdAt: string;
  model: string | null;
  reflection: SessionReflection | null;
}

/** Strip provider prefix for display, e.g. "anthropic/claude-sonnet-5" → "claude-sonnet-5" */
function displayModelName(value: string | null): string | null {
  if (!value) return null;
  const slash = value.indexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

/** Concepts with a displayable identity — mirrors ConceptsPanel's own filter */
function conceptCount(reflection: SessionReflection | null): number {
  return (reflection?.concepts ?? []).filter((c) => c && (c.name || c.ref_id || c.id))
    .length;
}

/**
 * Agent sessions attached to a benchmark run (AgentLog rows keyed by
 * stakworkRunId). Renders nothing until logs load — legacy runs without
 * agent logs show no section at all.
 */
export function BenchmarkRunAgentLogs({ runId }: { runId: string }) {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;

  const [logs, setLogs] = useState<RunAgentLogRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dialogLogId, setDialogLogId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;

    const fetchLogs = async () => {
      try {
        const res = await fetch(
          `/api/agent-logs?workspace_id=${workspaceId}&stakwork_run_id=${runId}&limit=50`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const rows: RunAgentLogRow[] = (data?.data ?? []).map(
          (l: RunAgentLogRow) => ({
            id: l.id,
            agent: l.agent,
            createdAt: l.createdAt,
            model: l.model ?? null,
            reflection: l.reflection ?? null,
          }),
        );
        // API returns newest first — show agents in execution order
        rows.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        setLogs(rows);
      } catch {
        // best-effort — section simply stays hidden
      }
    };

    fetchLogs();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, runId]);

  if (logs.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card" data-testid="run-agent-logs">
      <div className="px-4 py-3 border-b">
        <h3 className="font-semibold text-sm">
          Agents{" "}
          <span className="text-muted-foreground font-normal">({logs.length})</span>
        </h3>
      </div>
      <div className="divide-y">
        {logs.map((log) => {
          const model = displayModelName(log.model);
          const nConcepts = conceptCount(log.reflection);
          const isExpanded = expandedId === log.id;
          return (
            <div key={log.id} className="px-4 py-3">
              <div className="flex items-center gap-3 text-sm">
                <button
                  className="font-medium hover:underline text-left"
                  onClick={() => setDialogLogId(log.id)}
                  title="View full agent log"
                >
                  {log.agent}
                </button>
                {model && (
                  <Badge variant="secondary" className="text-xs font-mono px-1.5 py-0">
                    {model}
                  </Badge>
                )}
                {nConcepts > 0 && (
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    className="inline-flex items-center"
                    data-testid={`concepts-tag-${log.id}`}
                  >
                    <Badge
                      variant="outline"
                      className="text-xs px-1.5 py-0 cursor-pointer text-muted-foreground hover:bg-muted transition-colors"
                    >
                      {nConcepts} concept{nConcepts !== 1 ? "s" : ""}
                    </Badge>
                  </button>
                )}
                <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                  {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                </span>
              </div>
              {isExpanded && log.reflection && (
                <div className="mt-2">
                  <ConceptsPanel reflection={log.reflection} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <LogDetailDialog
        open={!!dialogLogId}
        onOpenChange={(open) => {
          if (!open) setDialogLogId(null);
        }}
        logId={dialogLogId}
      />
    </div>
  );
}
