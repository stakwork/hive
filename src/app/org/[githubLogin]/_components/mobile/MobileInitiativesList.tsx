"use client";

import React from "react";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InitiativeResponse, MilestoneResponse } from "@/types/initiatives";

const INITIATIVE_STATUS: Record<InitiativeResponse["status"], string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

const MILESTONE_STATUS: Record<MilestoneResponse["status"], string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Done",
};

const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

function StatusChip({ label, tone }: { label: string; tone: "accent" | "done" | "muted" }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "accent" && "bg-primary/10 text-primary",
        tone === "done" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

/**
 * The org's initiatives, read-only: a card each, opening to its milestones.
 * The desktop's tab edits them; a phone only reads.
 */
export function MobileInitiativesList({ githubLogin }: { githubLogin: string }) {
  const [initiatives, setInitiatives] = useState<InitiativeResponse[] | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/orgs/${githubLogin}/initiatives`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: InitiativeResponse[]) => !cancelled && setInitiatives(Array.isArray(data) ? data : []))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [githubLogin]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  if (error) return <p className="p-6 text-center text-sm text-muted-foreground">Failed to load initiatives.</p>;
  if (!initiatives) return <div className="m-4 h-24 animate-pulse rounded-xl bg-muted" />;
  if (initiatives.length === 0)
    return <p className="p-6 text-center text-sm text-muted-foreground">No initiatives yet.</p>;

  return (
    <ul data-testid="mobile-initiatives" className="space-y-3 p-4">
      {initiatives.map((initiative) => {
        const open = expanded.has(initiative.id);
        const done = initiative.milestones.filter((m) => m.status === "COMPLETED").length;
        const target = formatDate(initiative.targetDate);
        return (
          <li key={initiative.id} className="rounded-xl border">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggle(initiative.id)}
              className="flex min-h-14 w-full items-start gap-2 p-3 text-left"
            >
              <span className="mt-0.5 text-muted-foreground">
                {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-medium">{initiative.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {initiative.milestones.length > 0 && `${done}/${initiative.milestones.length} milestones`}
                  {initiative.milestones.length > 0 && target && " · "}
                  {target && `Target ${target}`}
                </span>
              </span>
              <StatusChip
                label={INITIATIVE_STATUS[initiative.status]}
                tone={initiative.status === "ACTIVE" ? "accent" : initiative.status === "COMPLETED" ? "done" : "muted"}
              />
            </button>
            {open && (
              <div className="border-t px-3 pb-2">
                {initiative.description && (
                  <p className="py-2 text-sm text-muted-foreground">{initiative.description}</p>
                )}
                {initiative.milestones.length === 0 && (
                  <p className="py-2 text-sm text-muted-foreground">No milestones.</p>
                )}
                <ul>
                  {[...initiative.milestones]
                    .sort((a, b) => a.sequence - b.sequence)
                    .map((m) => (
                      <li key={m.id} className="flex min-h-11 items-center gap-2 border-b py-2 last:border-b-0">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{m.name}</span>
                          {m.dueDate && <span className="block text-xs text-muted-foreground">Due {formatDate(m.dueDate)}</span>}
                        </span>
                        <StatusChip
                          label={MILESTONE_STATUS[m.status]}
                          tone={m.status === "IN_PROGRESS" ? "accent" : m.status === "COMPLETED" ? "done" : "muted"}
                        />
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
