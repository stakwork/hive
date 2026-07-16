"use client";

import React, { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RecursionEntry } from "@/hooks/useLegalBenchmarkRecursionList";

interface RecursionCardProps {
  entry: RecursionEntry;
  refetch: () => Promise<void>;
}

function RecursionCard({ entry, refetch }: RecursionCardProps) {
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    setToggleError(null);
    try {
      const res = await fetch(
        `/api/workspaces/openlaw/legal/benchmarks/recursion/${entry.refId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        },
      );
      if (res.ok) {
        await refetch();
      } else {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { error?: string }).error ?? `Request failed (${res.status})`;
        console.error(`[RecursionCard] PATCH failed ref_id=${entry.refId} enabled=${enabled}`, msg);
        setToggleError(msg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[RecursionCard] PATCH error ref_id=${entry.refId} enabled=${enabled}`, msg);
      setToggleError(msg);
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-4 flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="font-mono text-sm font-medium truncate max-w-xs">
          {entry.name || entry.id}
        </span>
        <span className="text-xs text-muted-foreground truncate">{entry.id}</span>
        {toggleError && (
          <span className="text-xs text-destructive mt-1">{toggleError}</span>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => handleToggle(false)}
        disabled={toggling}
        className="shrink-0"
      >
        {toggling ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            Updating…
          </>
        ) : (
          "Disable"
        )}
      </Button>
    </div>
  );
}

interface RecursionListProps {
  entries: RecursionEntry[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function RecursionList({
  entries,
  isLoading,
  error,
  refetch,
}: RecursionListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
        <p className="text-sm">No tasks enrolled in recursion.</p>
        <p className="text-xs">
          Open a completed benchmark run with failing criteria and click{" "}
          <strong>Recursion</strong> to enroll a task — this toggles the recursion
          flag on the task&apos;s EvalSet rather than creating a row.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry) => (
        <RecursionCard key={entry.refId} entry={entry} refetch={refetch} />
      ))}
    </div>
  );
}
