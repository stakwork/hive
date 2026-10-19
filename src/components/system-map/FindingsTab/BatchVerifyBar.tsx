"use client";

import React, { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/** Most findings one check takes (the API's `FINDING_WORKFLOWS.finding_verify.max`). */
export const MAX_BATCH = 50;

/**
 * Starts one `finding_verify` check over the selected findings. A dry run
 * by default; "Write verdicts" sets each one's `finding_status`.
 */
export function BatchVerifyBar({
  slug,
  selected,
  canWrite,
  onClear,
  onStarted,
}: {
  slug: string | undefined;
  selected: string[];
  canWrite: boolean;
  onClear: () => void;
  onStarted: () => void;
}) {
  const [apply, setApply] = useState(false);
  const [starting, setStarting] = useState(false);
  const tooMany = selected.length > MAX_BATCH;

  const start = async () => {
    if (!slug) return;
    setStarting(true);
    try {
      const response = await fetch(`/api/workspaces/${slug}/system-map/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow: "finding_verify", findingRefIds: selected, apply }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not start the check");
      toast.success(
        `Checking ${selected.length} finding${selected.length === 1 ? "" : "s"}${apply ? "" : " (dry run)"}`,
      );
      onClear();
      onStarted();
    } catch (error) {
      toast.error("Could not start the check", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm"
      data-testid="findings-batch-bar"
    >
      <span className="font-medium">{selected.length} selected</span>
      {tooMany && <span className="text-xs text-destructive">At most {MAX_BATCH} per check</span>}
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
        <Checkbox checked={apply} onCheckedChange={(v) => setApply(v === true)} data-testid="findings-batch-apply" />
        Write verdicts (confirmed / disconfirmed)
      </label>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClear}>
          Clear
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={!slug || !canWrite || starting || tooMany}
          onClick={start}
          data-testid="findings-batch-verify"
        >
          {starting ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
          )}
          {apply ? "Check on pod and write verdicts" : "Dry run on pod"}
        </Button>
      </div>
    </div>
  );
}
