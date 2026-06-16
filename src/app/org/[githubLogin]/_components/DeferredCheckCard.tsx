"use client";

/**
 * Renders a deferred-check confirmation card below an assistant message.
 *
 * The card has four display states driven by `deferredCheck.status`:
 *   - PENDING  — live countdown timer + Cancel button
 *   - PENDING (countdown reached 0) — "Checking…" spinner (cron hasn't fired yet)
 *   - FIRED    — "Completed ✓" in green
 *   - CANCELLED — "Cancelled" muted
 *   - FAILED   — "Check failed" in red
 *
 * Visual language is intentionally aligned with `<AttentionList>` and
 * `<ProposalCard>` (rounded-lg border, bg-card, compact text-sm, tracking-wide
 * uppercase meta row) so all card types share a coherent vocabulary in the
 * sidebar chat.
 */

import React, { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface DeferredCheck {
  id: string;
  description: string;
  fireAt: string; // ISO timestamp
  status: "PENDING" | "FIRED" | "CANCELLED" | "FAILED";
}

interface DeferredCheckCardProps {
  deferredCheck: DeferredCheck;
  githubLogin: string;
}

/**
 * Format remaining milliseconds as a compact countdown string.
 *   < 1 min  → "0:SS"
 *   < 1 hour → "M:SS"
 *   ≥ 1 hour → "Xh Xm"
 */
function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function DeferredCheckCard({
  deferredCheck,
  githubLogin,
}: DeferredCheckCardProps) {
  const [localStatus, setLocalStatus] = useState(deferredCheck.status);
  const [remaining, setRemaining] = useState<number>(
    () => new Date(deferredCheck.fireAt).getTime() - Date.now(),
  );
  const [isCancelling, setIsCancelling] = useState(false);

  // Keep the countdown ticking while status is PENDING.
  useEffect(() => {
    if (localStatus !== "PENDING") return;

    const interval = setInterval(() => {
      setRemaining(new Date(deferredCheck.fireAt).getTime() - Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [localStatus, deferredCheck.fireAt]);

  // Sync external status changes (e.g. Pusher live-update flips PENDING→FIRED).
  useEffect(() => {
    setLocalStatus(deferredCheck.status);
  }, [deferredCheck.status]);

  const handleCancel = async () => {
    // Optimistic update
    setLocalStatus("CANCELLED");
    setIsCancelling(true);

    try {
      const res = await fetch(
        `/api/orgs/${githubLogin}/chat/deferred-actions/${deferredCheck.id}`,
        { method: "DELETE" },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to cancel");
      }
    } catch (err) {
      // Revert optimistic update on error
      setLocalStatus("PENDING");
      toast.error("Could not cancel scheduled check", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const isPending = localStatus === "PENDING";
  const isCountdownDone = isPending && remaining <= 0;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground text-sm",
        localStatus === "FIRED" && "border-emerald-500/30 bg-emerald-500/5",
        localStatus === "FAILED" && "border-destructive/30 bg-destructive/5",
        localStatus === "CANCELLED" && "opacity-60",
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
          Scheduled check
        </span>
        <StatusBadge status={localStatus} />
      </div>

      {/* Description */}
      <p className="px-3 pb-2 text-[13px] leading-snug text-foreground/80">
        {deferredCheck.description}
      </p>

      {/* Footer — countdown or status message */}
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-t px-3 py-2",
          localStatus === "CANCELLED" && "border-t-transparent",
        )}
      >
        <Footer
          status={localStatus}
          remaining={remaining}
          isCountdownDone={isCountdownDone}
          fireAt={deferredCheck.fireAt}
        />

        {isPending && !isCountdownDone && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={isCancelling}
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Cancel scheduled check"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: DeferredCheck["status"] }) {
  switch (status) {
    case "PENDING":
      return (
        <span className="flex items-center gap-1 text-[10px] text-amber-500">
          <Clock className="h-3 w-3" />
          Pending
        </span>
      );
    case "FIRED":
      return (
        <span className="flex items-center gap-1 text-[10px] text-emerald-500">
          <CheckCircle2 className="h-3 w-3" />
          Done
        </span>
      );
    case "CANCELLED":
      return (
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <XCircle className="h-3 w-3" />
          Cancelled
        </span>
      );
    case "FAILED":
      return (
        <span className="flex items-center gap-1 text-[10px] text-destructive">
          <XCircle className="h-3 w-3" />
          Failed
        </span>
      );
  }
}

interface FooterProps {
  status: DeferredCheck["status"];
  remaining: number;
  isCountdownDone: boolean;
  fireAt: string;
}

function Footer({ status, remaining, isCountdownDone, fireAt }: FooterProps) {
  if (status === "FIRED") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-500">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Completed ✓
      </span>
    );
  }

  if (status === "CANCELLED") {
    return (
      <span className="text-[12px] text-muted-foreground italic">
        This check was cancelled.
      </span>
    );
  }

  if (status === "FAILED") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-destructive">
        <XCircle className="h-3.5 w-3.5" />
        Check failed
      </span>
    );
  }

  // PENDING
  if (isCountdownDone) {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking…
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-[12px] tabular-nums text-muted-foreground">
      <Clock className="h-3.5 w-3.5 text-amber-500/80" />
      <span>
        Fires in{" "}
        <span className="font-medium text-foreground/80">
          {formatRemaining(remaining)}
        </span>
      </span>
    </span>
  );
}
