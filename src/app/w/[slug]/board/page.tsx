"use client";

import React, { useEffect, useState } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { BoardCanvas } from "@/components/features/BoardCanvas";
import { FEATURE_STATUS_LABELS } from "@/types/roadmap";
import type { BoardFeature } from "@/types/roadmap";
import type { FeatureStatus } from "@prisma/client";

// Filter options shown in the dropdown (excludes CANCELLED from default view)
const FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "BACKLOG", label: FEATURE_STATUS_LABELS.BACKLOG },
  { value: "PLANNED", label: FEATURE_STATUS_LABELS.PLANNED },
  { value: "IN_PROGRESS", label: FEATURE_STATUS_LABELS.IN_PROGRESS },
  { value: "COMPLETED", label: FEATURE_STATUS_LABELS.COMPLETED },
];

export default function BoardPage() {
  const { id: workspaceId, slug } = useWorkspace();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [features, setFeatures] = useState<BoardFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;

    const fetchBoard = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ workspaceId });
        if (statusFilter !== "all") {
          params.set("status", statusFilter as FeatureStatus);
        }

        const res = await fetch(`/api/features/board?${params.toString()}`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "Failed to load board");
        }

        const data = await res.json();
        setFeatures(data.data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load board");
      } finally {
        setLoading(false);
      }
    };

    fetchBoard();
  }, [workspaceId, statusFilter]);

  return (
    <div className="flex flex-col h-full" style={{ minHeight: "calc(100vh - 80px)" }}>
      <PageHeader
        title="Board"
        actions={
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]" data-testid="status-filter">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              {FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {loading && (
        <div className="flex-1 flex gap-6 p-1" data-testid="board-skeleton">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-full flex-1 min-h-[400px] rounded-lg" />
          ))}
        </div>
      )}

      {!loading && error && (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>Failed to load board</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {!loading && !error && features.length === 0 && (
        <Empty className="flex-1" data-testid="board-empty">
          <EmptyHeader>
            <EmptyTitle>No features found</EmptyTitle>
            <EmptyDescription>
              {statusFilter === "all"
                ? "Create a feature in the Plan page to get started."
                : `No features with status "${FILTER_OPTIONS.find((o) => o.value === statusFilter)?.label ?? statusFilter}".`}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {!loading && !error && features.length > 0 && (
        <div className="flex-1" style={{ minHeight: 500 }}>
          <BoardCanvas features={features} slug={slug ?? ""} />
        </div>
      )}
    </div>
  );
}
