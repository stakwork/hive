"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RunCard } from "@/components/system-map/SystemMapRuns";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import type { SystemMapRunsResponse } from "@/types/system-map";

const POLL_MS = 5_000;

/**
 * Checks one finding on the workspace's pods (`finding_verify`) and lists
 * the checks that covered it, batches included. A dry run by default;
 * "Write verdict" sets `finding_status`.
 */
export function FindingVerify({
  refId,
  version = 0,
  onVerdict,
}: {
  refId: string;
  /** Bumped when a batch check is started elsewhere, so the list re-reads. */
  version?: number;
  onVerdict?: () => void;
}) {
  const { workspace } = useWorkspace();
  const { canWrite } = useWorkspaceAccess();
  const slug = workspace?.slug;
  const [data, setData] = useState<SystemMapRunsResponse | null>(null);
  const [apply, setApply] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const response = await fetch(
        `/api/workspaces/${slug}/system-map/runs?workflow=finding_verify&findingRefId=${encodeURIComponent(refId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData((await response.json()) as SystemMapRunsResponse);
    } catch (error) {
      toast.error("Could not load finding checks", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }, [slug, refId]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const runs = useMemo(() => data?.runs ?? [], [data?.runs]);
  const inFlight = runs.some((run) => run.status === "PENDING");

  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [inFlight, load]);

  // A check that wrote its verdict changed the finding: let the list re-read it.
  const pendingApply = useRef(false);
  useEffect(() => {
    if (inFlight) {
      pendingApply.current ||= runs.some((run) => run.status === "PENDING" && run.apply);
    } else if (pendingApply.current) {
      pendingApply.current = false;
      onVerdict?.();
    }
  }, [inFlight, runs, onVerdict]);

  const start = useCallback(async () => {
    if (!slug) return;
    setStarting(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/system-map/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow: "finding_verify", findingRefIds: [refId], apply }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not start the check");
      toast.success(apply ? "Finding check started" : "Finding check started (dry run)");
      await load();
    } catch (error) {
      toast.error("Could not start the check", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setStarting(false);
    }
  }, [slug, refId, apply, load]);

  return (
    <div className="space-y-2" data-testid="finding-verify">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs font-medium">Check on pod</p>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={apply} onCheckedChange={(v) => setApply(v === true)} data-testid="finding-verify-apply" />
          Write verdict (confirmed / disconfirmed)
        </label>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 text-xs"
          disabled={!slug || !canWrite || starting || inFlight}
          onClick={start}
          data-testid="finding-verify-button"
        >
          {starting || inFlight ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
          )}
          {inFlight ? "Checking…" : apply ? "Check and write verdict" : "Dry run"}
        </Button>
      </div>
      {data && runs.length === 0 && <p className="text-xs text-muted-foreground">Not checked yet.</p>}
      {runs.slice(0, 3).map((run, index) => (
        <RunCard key={run.id} run={run} defaultExpanded={index === 0} workflowKey="finding_verify" />
      ))}
    </div>
  );
}
