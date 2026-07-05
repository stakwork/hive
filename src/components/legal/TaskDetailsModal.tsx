"use client";

import React, { useState, useEffect } from "react";
import { FileIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { HarveyTask } from "@/lib/harvey-lab-tasks";
import { WORK_TYPE_STYLES } from "@/lib/harvey-lab-tasks";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaskDetails {
  title: string | null;
  instructions: string | null;
  criteria: Array<{ id: string; title: string; match_criteria: string }> | null;
  documents: Array<{ name: string; url: string; download_url: string }>;
}

export interface TaskDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: HarveyTask;
  slug: string;
  onRunTask: () => void;
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function DetailsSkeleton() {
  return (
    <div className="space-y-6 p-1">
      <section>
        <Skeleton className="h-4 w-24 mb-3" />
        <Skeleton className="h-3 w-full mb-2" />
        <Skeleton className="h-3 w-5/6 mb-2" />
        <Skeleton className="h-3 w-4/5" />
      </section>

      <Separator className="my-4" />

      <section>
        <Skeleton className="h-4 w-32 mb-3" />
        <Skeleton className="h-3 w-2/3 mb-2" />
        <Skeleton className="h-3 w-1/2" />
      </section>

      <Separator className="my-4" />

      <section>
        <Skeleton className="h-4 w-28 mb-3" />
        <Skeleton className="h-3 w-full mb-2" />
        <Skeleton className="h-3 w-5/6 mb-2" />
        <Skeleton className="h-3 w-3/4" />
      </section>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TaskDetailsModal({
  open,
  onOpenChange,
  task,
  slug,
  onRunTask,
}: TaskDetailsModalProps) {
  const [details, setDetails] = useState<TaskDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !task?.slug) {
      setDetails(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const fetchDetails = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/workspaces/${slug}/legal/benchmarks/tasks/${task.slug}/details`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `Request failed with status ${res.status}`);
        }
        const data: TaskDetails = await res.json();
        if (!cancelled) setDetails(data);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load task details");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchDetails();
    return () => {
      cancelled = true;
    };
  }, [open, task?.slug, slug]);

  const visibleTags = task.tags.slice(0, 3);
  const overflowCount = task.tags.length - 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{task.title}</DialogTitle>
          <div className="flex flex-wrap gap-2 mt-1">
            <Badge
              variant="outline"
              className={`text-xs capitalize border-0 ${WORK_TYPE_STYLES[task.work_type]}`}
            >
              {task.work_type}
            </Badge>

            {visibleTags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs text-muted-foreground">
                {tag}
              </Badge>
            ))}

            {overflowCount > 0 && (
              <Badge variant="secondary" className="text-xs text-muted-foreground">
                +{overflowCount} more
              </Badge>
            )}
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 pr-1">
          <div className="p-1">
            {loading ? (
              <DetailsSkeleton />
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDetails(null);
                    setError(null);
                    setLoading(true);
                    fetch(
                      `/api/workspaces/${slug}/legal/benchmarks/tasks/${task.slug}/details`,
                    )
                      .then(async (res) => {
                        if (!res.ok) {
                          const body = await res.json().catch(() => ({}));
                          throw new Error(
                            body?.error ?? `Request failed with status ${res.status}`,
                          );
                        }
                        return res.json();
                      })
                      .then((data) => {
                        setDetails(data);
                        setLoading(false);
                      })
                      .catch((err) => {
                        setError(
                          err instanceof Error ? err.message : "Failed to load task details",
                        );
                        setLoading(false);
                      });
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : details ? (
              <div className="space-y-0">
                {/* Section 1: Task Instructions */}
                <section>
                  <h3 className="text-sm font-semibold mb-2">Task</h3>
                  {details.instructions ? (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {details.instructions}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No instructions available.</p>
                  )}
                </section>

                <Separator className="my-4" />

                {/* Section 2: Documents */}
                <section>
                  <h3 className="text-sm font-semibold mb-2">
                    Documents ({details.documents.length})
                  </h3>
                  {details.documents.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No documents attached.</p>
                  ) : (
                    <ul className="space-y-1">
                      {details.documents.map((doc) => (
                        <li key={doc.name} className="flex items-center gap-2 text-sm">
                          <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline truncate"
                          >
                            {doc.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <Separator className="my-4" />

                {/* Section 3: Rubric Criteria */}
                <section>
                  <h3 className="text-sm font-semibold mb-2">
                    Rubric ({details.criteria?.length ?? 0} criteria)
                  </h3>
                  {!details.criteria || details.criteria.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No rubric criteria available.</p>
                  ) : (
                    <ol className="space-y-3">
                      {details.criteria.map((c) => (
                        <li key={c.id} className="text-sm">
                          <span className="font-medium text-muted-foreground mr-2">{c.id}</span>
                          <span>{c.title}</span>
                          <p className="text-xs text-muted-foreground mt-1 pl-8">
                            {c.match_criteria}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t pt-4 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              onRunTask();
            }}
          >
            Run Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
