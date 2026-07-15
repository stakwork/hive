"use client";

import React, { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { RecursionEntry } from "@/hooks/useLegalBenchmarkRecursionList";
import type { RecursionStatus } from "@prisma/client";

function StatusBadge({ status }: { status: RecursionStatus }) {
  const variants: Record<RecursionStatus, { label: string; className: string }> = {
    ACTIVE: {
      label: "Active",
      className: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    },
    RUNNING: {
      label: "Running",
      className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    },
    INACTIVE: {
      label: "Inactive",
      className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
    },
  };

  const { label, className } = variants[status] ?? variants.INACTIVE;

  return (
    <Badge variant="outline" className={`text-xs font-medium ${className}`}>
      {status === "RUNNING" && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
      {label}
    </Badge>
  );
}

interface RecursionCardProps {
  entry: RecursionEntry;
  onRemove: (id: string) => void;
}

function RecursionCard({ entry, onRemove }: RecursionCardProps) {
  const [removing, setRemoving] = useState(false);

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch(
        `/api/workspaces/openlaw/legal/benchmarks/recursion/${entry.id}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        onRemove(entry.id);
      } else {
        console.error("[RecursionCard] DELETE failed", res.status);
      }
    } catch (err) {
      console.error("[RecursionCard] DELETE error", err instanceof Error ? err.message : String(err));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-4 flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-medium truncate max-w-xs">
            {entry.taskSlug}
          </span>
          <StatusBadge status={entry.status} />
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          {entry.lastScore ? (
            <span>
              Score: <span className="font-medium text-foreground">{entry.lastScore}</span>
            </span>
          ) : (
            <span>No runs yet</span>
          )}

          {entry.lastRunAt && (
            <span>
              Last run:{" "}
              <span className="font-medium text-foreground">
                {formatDistanceToNow(new Date(entry.lastRunAt), { addSuffix: true })}
              </span>
            </span>
          )}

          <span className="text-muted-foreground/60">
            Enrolled {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
          </span>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={handleRemove}
        disabled={removing}
        className="shrink-0"
      >
        {removing ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            Removing…
          </>
        ) : (
          "Remove"
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
  onRemove: (id: string) => void;
}

export function RecursionList({
  entries,
  isLoading,
  error,
  refetch,
  onRemove,
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
        <p className="text-sm">No recursion enrollments yet.</p>
        <p className="text-xs">
          Open a benchmark run and click <strong>Recursion</strong> to enroll a failing task.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry) => (
        <RecursionCard key={entry.id} entry={entry} onRemove={onRemove} />
      ))}
    </div>
  );
}
