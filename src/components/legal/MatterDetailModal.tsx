"use client";

import React, { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { formatMB } from "@/lib/utils/format";
import { StakworkRunLink } from "@/components/legal/StakworkRunLink";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MatterFile {
  name: string;
  size: number;
  path: string;
}

interface MatterCategory {
  name: string;
  files: MatterFile[];
}

interface MatterDetail {
  matterId: string;
  categories: MatterCategory[];
}

interface IngestResult {
  run_id: string;
  project_id?: number;
}

export interface MatterDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matterId: string;
  slug: string;
  isSuperAdmin: boolean;
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function DetailsSkeleton() {
  return (
    <div className="space-y-6 p-1">
      <section>
        <Skeleton className="h-4 w-32 mb-3" />
        <Skeleton className="h-3 w-full mb-2" />
        <Skeleton className="h-3 w-5/6 mb-2" />
        <Skeleton className="h-3 w-4/5" />
      </section>
      <Separator className="my-4" />
      <section>
        <Skeleton className="h-4 w-40 mb-3" />
        <Skeleton className="h-3 w-2/3 mb-2" />
        <Skeleton className="h-3 w-1/2 mb-2" />
        <Skeleton className="h-3 w-3/4" />
      </section>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MatterDetailModal({
  open,
  onOpenChange,
  matterId,
  slug,
  isSuperAdmin,
}: MatterDetailModalProps) {
  const [detail, setDetail] = useState<MatterDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);

  useEffect(() => {
    if (!open || !matterId) {
      setDetail(null);
      setError(null);
      setIngestResult(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(
          `/api/workspaces/${slug}/legal/benchmarks/cnh/matters/${matterId}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body?.error ?? `Request failed with status ${res.status}`,
          );
        }
        const data: MatterDetail = await res.json();
        if (!cancelled) setDetail(data);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load matter details",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, matterId, slug]);

  const handleIngest = async () => {
    setIsIngesting(true);
    try {
      const res = await fetch(
        `/api/workspaces/${slug}/legal/benchmarks/cnh/matters/${matterId}/ingest`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      }
      const result: IngestResult = await res.json();
      setIngestResult(result);
      toast.success("Ingestion started");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start ingestion",
      );
    } finally {
      setIsIngesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl h-[80vh] flex flex-col overflow-hidden p-0"
        style={{ backgroundColor: "var(--background)" }}
      >
        <DialogHeader className="px-6 pt-6 pb-0 pr-10 shrink-0">
          <DialogTitle className="font-mono">{matterId}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 px-6 py-4">
          <div className="p-1">
            {isLoading ? (
              <DetailsSkeleton />
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            ) : detail ? (
              <div className="space-y-0">
                {detail.categories.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">
                    No document categories found.
                  </p>
                ) : (
                  detail.categories.map((category, idx) => {
                    const totalSize = category.files.reduce(
                      (sum, f) => sum + f.size,
                      0,
                    );
                    return (
                      <React.Fragment key={category.name}>
                        {idx > 0 && <Separator className="my-4" />}
                        <section>
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="text-sm font-semibold">
                              {category.name}
                            </h3>
                            <Badge variant="secondary" className="text-xs">
                              {category.files.length}{" "}
                              {category.files.length === 1 ? "file" : "files"}
                            </Badge>
                            {totalSize > 0 && (
                              <span className="text-xs text-muted-foreground ml-auto">
                                {formatMB(totalSize)}
                              </span>
                            )}
                          </div>
                          {category.files.length === 0 ? (
                            <p className="text-sm text-muted-foreground italic pl-2">
                              No files.
                            </p>
                          ) : (
                            <ul className="space-y-1 pl-2">
                              {category.files.map((file) => (
                                <li
                                  key={file.path}
                                  className="flex items-center justify-between gap-2 text-sm"
                                >
                                  <span className="truncate min-w-0 text-muted-foreground">
                                    {file.name}
                                  </span>
                                  <span className="text-xs text-muted-foreground shrink-0">
                                    {formatMB(file.size)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                      </React.Fragment>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t px-6 py-4 gap-2 shrink-0 items-center">
          {ingestResult && (
            <StakworkRunLink
              projectId={ingestResult.project_id}
              isSuperAdmin={isSuperAdmin}
            />
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={handleIngest}
            disabled={isIngesting || !!ingestResult}
          >
            {isIngesting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading…
              </>
            ) : ingestResult ? (
              "Ingestion Started"
            ) : (
              "Load Documents"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
