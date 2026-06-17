"use client";

/**
 * Redesigned workflow canvas node — compact, theme-aware card.
 *
 * `StepCardContent` renders just the card/pill body (no React Flow handles) so
 * it can be reused by the real StepNode (which owns handle placement). The
 * default export wraps it with handles for the standalone preview / direct use.
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
  Play,
  Flag,
  Octagon,
  MessageSquare,
  ToggleLeft,
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
  | "loop"
  | "prompt"
  | "boolean";

export type StepStatus =
  | "finished"
  | "completed"
  | "error"
  | "in_progress"
  | "halted"
  | "skipped"
  | "pending";

export type TerminalKind = "start" | "end" | "halt";

export interface StepNodeCardData {
  alias: string;
  skill: string;
  category: StepCategory;
  status?: StepStatus;
  timing?: string;
  variant?: "step" | "condition" | "terminal";
  terminalKind?: TerminalKind;
  /** When an End terminal is reached on a completed run, render it green. */
  completed?: boolean;
  [key: string]: unknown;
}

const TERMINAL: Record<TerminalKind, { icon: LucideIcon; pill: string; tint: string }> = {
  start: {
    icon: Play,
    pill: "border-emerald-500/30 bg-emerald-500/10",
    tint: "text-emerald-700 dark:text-emerald-400",
  },
  end: {
    icon: Flag,
    pill: "border-border bg-muted",
    tint: "text-foreground",
  },
  halt: {
    icon: Octagon,
    pill: "border-rose-500/30 bg-rose-500/10",
    tint: "text-rose-700 dark:text-rose-400",
  },
};

export const STEP_HANDLE_CLASS = "!h-2 !w-2 !border-2 !border-background !bg-muted-foreground/60";

const CATEGORY: Record<StepCategory, { icon: LucideIcon; tint: string }> = {
  condition: { icon: GitBranch, tint: "text-amber-600 dark:text-amber-500" },
  request: { icon: Globe, tint: "text-teal-600 dark:text-teal-400" },
  setvar: { icon: Variable, tint: "text-sky-600 dark:text-sky-400" },
  json: { icon: Braces, tint: "text-violet-600 dark:text-violet-400" },
  automated: { icon: Zap, tint: "text-zinc-500 dark:text-zinc-400" },
  human: { icon: User, tint: "text-pink-600 dark:text-pink-400" },
  loop: { icon: Repeat, tint: "text-purple-600 dark:text-purple-400" },
  prompt: { icon: MessageSquare, tint: "text-blue-600 dark:text-blue-400" },
  boolean: { icon: ToggleLeft, tint: "text-fuchsia-600 dark:text-fuchsia-400" },
};

const STATUS: Record<StepStatus, { dot: string; bar: string; pulse: boolean }> = {
  finished: { dot: "bg-emerald-500", bar: "bg-emerald-500", pulse: false },
  completed: { dot: "bg-emerald-500", bar: "bg-emerald-500", pulse: false },
  error: { dot: "bg-rose-500", bar: "bg-rose-500", pulse: false },
  in_progress: { dot: "bg-sky-500", bar: "bg-sky-500", pulse: true },
  halted: { dot: "bg-amber-500", bar: "bg-amber-500", pulse: false },
  skipped: { dot: "bg-zinc-400", bar: "bg-zinc-400/60", pulse: false },
  pending: { dot: "bg-zinc-300 dark:bg-zinc-600", bar: "bg-transparent", pulse: false },
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

export function StepCardContent({ data }: { data: StepNodeCardData }) {
  const cat = CATEGORY[data.category] ?? CATEGORY.automated;
  const Icon = cat.icon;
  const status = data.status ?? "pending";
  const meta = STATUS[status];

  if (data.variant === "terminal") {
    const kind = data.terminalKind ?? "end";
    // A reached End on a completed run goes green, mirroring the legacy design.
    const t = kind === "end" && data.completed ? TERMINAL.start : TERMINAL[kind];
    const TIcon = kind === "end" && data.completed ? Check : t.icon;
    return (
      <div className={cn("flex items-center gap-2 rounded-full border px-3.5 py-2 shadow-sm", t.pill)}>
        <TIcon className={cn("h-3.5 w-3.5", t.tint)} strokeWidth={kind === "end" && data.completed ? 3 : undefined} />
        <span className={cn("text-xs font-semibold", t.tint)}>{data.alias}</span>
      </div>
    );
  }

  if (data.variant === "condition") {
    return (
      <div className="group flex items-center gap-2 rounded-full border bg-card px-3 py-2 shadow-sm transition-shadow hover:shadow-md">
        <GitBranch className={cn("h-3.5 w-3.5", cat.tint)} />
        <span className="max-w-[150px] truncate text-xs font-medium text-foreground">{data.alias}</span>
        {data.status && <StatusDot status={status} />}
      </div>
    );
  }

  return (
    <div className="group relative w-[208px] overflow-hidden rounded-xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      {/* status accent — keeps state legible when zoomed out */}
      <span className={cn("absolute left-0 top-0 h-full w-1", meta.bar)} aria-hidden="true" />
      <div className="flex items-center gap-2.5 py-2.5 pl-3.5 pr-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted">
          <Icon className={cn("h-4 w-4", cat.tint)} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{data.alias}</div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {data.skill}
            {data.timing ? ` · ${data.timing}` : ""}
          </div>
        </div>
        {data.status && <StatusDot status={status} />}
      </div>
    </div>
  );
}

export default function StepNodeCard({ data }: NodeProps) {
  const d = data as unknown as StepNodeCardData;
  const isStart = d.variant === "terminal" && d.terminalKind === "start";
  const isEndHalt = d.variant === "terminal" && (d.terminalKind === "end" || d.terminalKind === "halt");
  return (
    <>
      {!isStart && <Handle type="target" position={Position.Left} className={STEP_HANDLE_CLASS} />}
      <StepCardContent data={d} />
      {!isEndHalt && <Handle type="source" position={Position.Right} className={STEP_HANDLE_CLASS} />}
    </>
  );
}
