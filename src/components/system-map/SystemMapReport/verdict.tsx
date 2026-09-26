"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, Circle, CircleDot, HelpCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Verdict } from "./model";

/**
 * Verdicts are STATUS colors: each carries an icon and a label, never color
 * alone. MATCH = good, PARTIAL = warning, CONFLICT = critical; MISSING is a
 * neutral absence (most of any report) and UNKNOWN a "needs a look".
 */
export const VERDICT_STYLE: Record<
  Verdict,
  { label: string; icon: LucideIcon; text: string; fill: string; ring: string; tile: string }
> = {
  MATCH: {
    label: "Match",
    icon: CheckCircle2,
    text: "text-emerald-700 dark:text-emerald-400",
    fill: "bg-emerald-500 dark:bg-emerald-400",
    ring: "ring-emerald-500/60",
    tile: "bg-emerald-50 dark:bg-emerald-950/40",
  },
  PARTIAL: {
    label: "Partial",
    icon: CircleDot,
    text: "text-amber-700 dark:text-amber-400",
    fill: "bg-amber-500 dark:bg-amber-400",
    ring: "ring-amber-500/60",
    tile: "bg-amber-50 dark:bg-amber-950/40",
  },
  MISSING: {
    label: "Missing",
    icon: Circle,
    text: "text-slate-500 dark:text-slate-400",
    fill: "bg-slate-300 dark:bg-slate-600",
    ring: "ring-slate-400/60",
    tile: "bg-slate-50 dark:bg-slate-900/60",
  },
  UNKNOWN: {
    label: "Unknown",
    icon: HelpCircle,
    text: "text-sky-700 dark:text-sky-400",
    fill: "bg-sky-500 dark:bg-sky-400",
    ring: "ring-sky-500/60",
    tile: "bg-sky-50 dark:bg-sky-950/40",
  },
  CONFLICT: {
    label: "Conflict",
    icon: AlertTriangle,
    text: "text-rose-700 dark:text-rose-400",
    fill: "bg-rose-500 dark:bg-rose-400",
    ring: "ring-rose-500/60",
    tile: "bg-rose-50 dark:bg-rose-950/40",
  },
};

export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  const style = VERDICT_STYLE[verdict];
  const Icon = style.icon;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium", style.text, className)}
      data-testid={`verdict-${verdict.toLowerCase()}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {style.label}
    </span>
  );
}

