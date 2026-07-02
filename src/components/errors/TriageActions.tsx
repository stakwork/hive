"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, EyeOff, RotateCcw } from "lucide-react";
import type { ErrorIssueStatus } from "@/types/error-issues";

interface TriageActionsProps {
  issueId: string;
  status: ErrorIssueStatus;
  onStatusChange?: (newStatus: ErrorIssueStatus) => void;
}

async function patchStatus(issueId: string, status: ErrorIssueStatus): Promise<void> {
  const res = await fetch(`/api/errors/${issueId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? "Failed to update status");
  }
}

export function TriageActions({ issueId, status, onStatusChange }: TriageActionsProps) {
  const [optimisticStatus, setOptimisticStatus] = useState<ErrorIssueStatus>(status);
  const [pending, setPending] = useState(false);

  // Keep optimistic status in sync with prop changes (e.g. Pusher updates)
  if (status !== optimisticStatus && !pending) {
    setOptimisticStatus(status);
  }

  const apply = async (next: ErrorIssueStatus) => {
    const prev = optimisticStatus;
    setOptimisticStatus(next);
    setPending(true);
    try {
      await patchStatus(issueId, next);
      onStatusChange?.(next);
    } catch (err) {
      console.error("[TriageActions] status update failed", err);
      setOptimisticStatus(prev); // rollback
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {optimisticStatus !== "RESOLVED" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => apply("RESOLVED")}
          data-testid="triage-resolve"
        >
          <CheckCircle className="h-4 w-4 mr-1" />
          Resolve
        </Button>
      )}
      {optimisticStatus !== "IGNORED" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => apply("IGNORED")}
          data-testid="triage-ignore"
        >
          <EyeOff className="h-4 w-4 mr-1" />
          Ignore
        </Button>
      )}
      {optimisticStatus !== "UNRESOLVED" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => apply("UNRESOLVED")}
          data-testid="triage-reopen"
        >
          <RotateCcw className="h-4 w-4 mr-1" />
          Reopen
        </Button>
      )}
    </div>
  );
}
