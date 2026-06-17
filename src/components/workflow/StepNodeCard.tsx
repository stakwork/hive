"use client";

/**
 * Redesigned workflow canvas node — compact, theme-aware card.
 * Currently rendered in the /prototype/workflow-nodes preview; intended to
 * replace the generated-HTML node body in StepNode/NodeArray once locked.
 */

import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  GitBranch,
  Globe,
  Variable,
  Braces,
  Zap,
  User,
  Repeat,
  Check,
  AlertTriangle,
  Ban,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type StepCategory =
  | "condition"
  | "request"
  | "setvar"
  | "json"
  | "automated"
  | "human"
  | "loop";

export type StepStatus =
  | "finished"
  | "completed"
  | "error"
  | "in_progress"
  | "halted"
  | "skipped"
  | "pending";

export interface StepNodeCardData {
  alias: string;
  skill: string;
  category: StepCategory;
  status?: StepStatus;
  timing?: string;
  variant?: "step" | "condition";
  [key: string]: unknown;
}

const CATEGORY: Record<StepCategory, { icon: LucideIcon; tint: string }> = {
  condition: { icon: GitBranch, tint: "text-amber-600 dark:text-amber-500" },
  request: { icon: Globe, tint: "text-teal-600 dark:text-teal-400" },
  setvar: { icon: Variable, tint: "text-sky-600 dark:text-sky-400" },
  json: { icon: Braces, tint: "text-violet-600 dark:text-violet-400" },
  automated: { icon: Zap, tint: "text-violet-600 dark:text-violet-400" },
  human: { icon: User, tint: "text-pink-600 dark:text-pink-400" },
  loop: { icon: Repeat, tint: "text-purple-600 dark:text-purple-400" },
};

const STATUS: Record<
  StepStatus,
  { dot: string; bar: string; label: string; pulse: boolean }
> = {
  finished: { dot: "bg-emerald-500", bar: "bg-emerald-500", label: "Finished", pulse: false },
  completed: { dot: "bg-emerald-500", bar: "bg-emerald-500", label: "Completed", pulse: false },
  error: { dot: "bg-rose-500", bar: "bg-rose-500", label: "Error", pulse: false },
  in_progress: { dot: "bg-sky-500", bar: "bg-sky-500", label: "Running", pulse: true },
  halted: { dot: "bg-amber-500", bar: "bg-amber-500", label: "Halted", pulse: false },
  skipped: { dot: "bg-zinc-400", bar: "bg-zinc-400/60", label: "Skipped", pulse: false },
  pending: { dot: "bg-zinc-300 dark:bg-zinc-600", bar: "bg-transparent", label: "Pending", pulse: false },
};

function StatusDot({ status }: { status: StepStatus }) {
  const m = STATUS[status];
  if (status === "finished" || status === "completed") {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-rose-500 text-white">
        <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-zinc-400/20 text-zinc-400">
        <Ban className="h-2.5 w-2.5" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {m.pulse && (
        <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", m.dot)} />
      )}
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", m.dot)} />
    </span>
  );
}

const handleClass = "!h-2 !w-2 !border-2 !border-background !bg-muted-foreground/60";

export default function StepNodeCard({ data }: NodeProps) {
  const d = data as StepNodeCardData;
  const cat = CATEGORY[d.category] ?? CATEGORY.automated;
  const Icon = cat.icon;
  const status = d.status ?? "pending";
  const meta = STATUS[status];

  if (d.variant === "condition") {
    return (
      <div className="group relative flex items-center gap-2 rounded-full border bg-card px-3 py-2 shadow-sm transition-shadow hover:shadow-md">
        <Handle type="target" position={Position.Left} className={handleClass} />
        <GitBranch className={cn("h-3.5 w-3.5", cat.tint)} />
        <span className="max-w-[150px] truncate text-xs font-medium text-foreground">{d.alias}</span>
        {d.status && <StatusDot status={status} />}
        <Handle type="source" position={Position.Right} className={handleClass} />
      </div>
    );
  }

  return (
    <div className="group relative w-[208px] overflow-hidden rounded-xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <Handle type="target" position={Position.Left} className={handleClass} />
      {/* status accent — keeps state legible when zoomed out */}
      <span className={cn("absolute left-0 top-0 h-full w-1", meta.bar)} aria-hidden="true" />

      <div className="flex items-center gap-2.5 py-2.5 pl-3.5 pr-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted">
          <Icon className={cn("h-4 w-4", cat.tint)} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{d.alias}</div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {d.skill}
            {d.timing ? ` · ${d.timing}` : ""}
          </div>
        </div>
        {d.status && <StatusDot status={status} />}
      </div>

      <Handle type="source" position={Position.Right} className={handleClass} />
    </div>
  );
}
