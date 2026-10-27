"use client";

import React, { useEffect, useState } from "react";
import { Wrench, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ErrorFixStatus } from "@/types/error-issues";

export interface FixState {
  fixStatus: ErrorFixStatus | null;
  fixPrUrl: string | null;
}

interface FixActionProps {
  issueId: string;
  fixStatus?: ErrorFixStatus | null;
  fixPrUrl?: string | null;
  /** Poll interval while a fix is in flight. */
  pollMs?: number;
}

const isInFlight = (s: ErrorFixStatus | null) => s === "DISPATCHING" || s === "IN_PROGRESS";

export function FixAction({ issueId, fixStatus = null, fixPrUrl = null, pollMs = 15_000 }: FixActionProps) {
  const [fix, setFix] = useState<FixState>({ fixStatus, fixPrUrl });
  const [pending, setPending] = useState(false);

  // Follow prop changes (list refetch / Pusher updates)
  useEffect(() => {
    setFix({ fixStatus, fixPrUrl });
  }, [fixStatus, fixPrUrl]);

  // Refresh status while the job runs
  useEffect(() => {
    if (!isInFlight(fix.fixStatus)) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/errors/${issueId}/fix`);
        if (!res.ok) return;
        const { data } = await res.json();
        setFix({ fixStatus: data.fixStatus ?? null, fixPrUrl: data.fixPrUrl ?? null });
      } catch {
        // transient — try again next tick
      }
    }, pollMs);
    return () => clearInterval(timer);
  }, [fix.fixStatus, issueId, pollMs]);

  const dispatch = async () => {
    setPending(true);
    try {
      const res = await fetch(`/api/errors/${issueId}/fix`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok || res.status === 409) {
        if (body?.data) setFix({ fixStatus: body.data.fixStatus ?? null, fixPrUrl: body.data.fixPrUrl ?? null });
        if (res.ok) toast.success("Fix job started");
      } else {
        toast.error(body?.error ?? "Failed to start fix");
      }
    } catch (err) {
      console.error("[FixAction] dispatch failed", err);
      toast.error("Failed to start fix");
    } finally {
      setPending(false);
    }
  };

  const dispatched = fix.fixStatus !== null && fix.fixStatus !== "FAILED";

  return (
    <div className="flex items-center gap-2" data-testid={`fix-action-${issueId}`}>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || dispatched}
        onClick={dispatch}
        data-testid="fix-button"
      >
        <Wrench className="h-4 w-4 mr-1" />
        {fix.fixStatus === "FAILED" ? "Retry fix" : "Fix"}
      </Button>
      {isInFlight(fix.fixStatus) && (
        <Badge variant="secondary" data-testid="fix-badge">
          Fix in progress
        </Badge>
      )}
      {fix.fixStatus === "PR_OPENED" && (
        <Badge variant="default" data-testid="fix-badge">
          {fix.fixPrUrl ? (
            <a
              href={fix.fixPrUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1"
              data-testid="fix-pr-link"
            >
              PR opened <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            "PR opened"
          )}
        </Badge>
      )}
      {fix.fixStatus === "FAILED" && (
        <Badge variant="destructive" data-testid="fix-badge">
          Fix failed
        </Badge>
      )}
    </div>
  );
}
