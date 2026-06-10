"use client";

import React, { useState } from "react";
import {
  ExternalLink,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  FlaskConical,
} from "lucide-react";
import type { CanvasChatMessage } from "../_state/canvasChatStore";

export interface ResearchRun {
  researchId: string;
  slug: string;
  topic: string;
  title: string;
  /** "dispatched" while running, "ready" on success, "failed" on failure */
  status: "dispatched" | "ready" | "failed";
  anchorMessageId: string;
  initiativeId?: string;
}

/**
 * Walk all canvas chat messages and group `dispatch_research` tool calls
 * with their corresponding inbound fan-out rows by `researchId`.
 *
 * Convention mirrors `getSubAgentRunsFromMessages`:
 * - The inbound fan-out row (kind: "research") is **authoritative** for status
 *   and wins the anchor position (most-recent activity).
 * - Outbound tool calls seed the entry only if no inbound row exists yet.
 */
export function getResearchRunsFromMessages(
  messages: CanvasChatMessage[],
): ResearchRun[] {
  const byResearchId = new Map<string, ResearchRun>();

  messages.forEach((message) => {
    // ── Inbound: fan-out row ────────────────────────────────────
    if (message.source?.kind === "research") {
      const { researchId, slug, topic, title, status, initiativeId } =
        message.source;
      byResearchId.set(researchId, {
        researchId,
        slug,
        topic,
        title,
        status: status as ResearchRun["status"],
        anchorMessageId: message.id,
        initiativeId,
      });
      return;
    }

    // ── Outbound: dispatch_research tool call ───────────────────
    if (!message.toolCalls?.length) return;
    for (const tc of message.toolCalls) {
      if (tc.toolName !== "dispatch_research") continue;
      const input = (tc.input ?? {}) as {
        slug?: string;
        topic?: string;
        title?: string;
      };
      const output = (tc.output ?? {}) as {
        researchId?: string;
        slug?: string;
        topic?: string;
        title?: string;
        status?: string;
        awaitingReply?: boolean;
      };
      const researchId = output.researchId;
      if (!researchId) continue;
      // Only seed if not already present — inbound row is authoritative
      if (!byResearchId.has(researchId)) {
        byResearchId.set(researchId, {
          researchId,
          slug: output.slug ?? input.slug ?? "",
          topic: output.topic ?? input.topic ?? "",
          title: output.title ?? input.title ?? "",
          status: "dispatched",
          anchorMessageId: message.id,
          initiativeId: undefined,
        });
      }
      // If inbound row is already present it already owns the anchor — no-op.
    }
  });

  return Array.from(byResearchId.values()).filter((r) => r.anchorMessageId);
}

// ── Status pill helpers ──────────────────────────────────────────────────────

type ResearchStatusTone = "running" | "ready" | "failed";

const TONE_PILL_CLASSES: Record<ResearchStatusTone, string> = {
  running:
    "bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-1 ring-inset ring-sky-500/20",
  ready:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/20",
  failed:
    "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/20",
};

function toneForStatus(status: ResearchRun["status"]): ResearchStatusTone {
  if (status === "ready") return "ready";
  if (status === "failed") return "failed";
  return "running";
}

function StatusPill({ status }: { status: ResearchRun["status"] }) {
  const tone = toneForStatus(status);
  const label =
    status === "dispatched"
      ? "Researching\u2026"
      : status === "ready"
        ? "Ready"
        : "Failed";
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${TONE_PILL_CLASSES[tone]}`}
    >
      {status === "dispatched" && (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      )}
      {status === "ready" && (
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
      )}
      {status === "failed" && <XCircle className="h-3 w-3" aria-hidden="true" />}
      {label}
    </span>
  );
}

// ── ResearchRunCard ──────────────────────────────────────────────────────────

export function ResearchRunCard({
  run,
  githubLogin,
}: {
  run: ResearchRun;
  githubLogin: string;
}) {
  const [collapsed, setCollapsed] = useState(true);

  // Deep-link to the org canvas with the research node pre-selected.
  // Pattern mirrors the ?r=<slug> deep-link format used elsewhere.
  const researchHref =
    run.slug ? `/org/${githubLogin}?r=${run.slug}` : null;

  const Chevron = collapsed ? (
    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
  ) : (
    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
  );

  return (
    <div
      data-research-id={run.researchId}
      className="rounded-lg border bg-card text-card-foreground"
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/30"
      >
        <div className="mt-0.5 flex-shrink-0">{Chevron}</div>
        <div className="mt-0.5 flex-shrink-0">
          <FlaskConical className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          {collapsed ? (
            <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
              <span className="min-w-0 truncate font-medium">{run.topic}</span>
              <span aria-hidden="true" className="text-muted-foreground">
                ·
              </span>
              <StatusPill status={run.status} />
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                <span className="font-medium">Research</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 break-words text-sm font-medium">
                <span className="min-w-0 truncate">
                  {run.title || run.topic}
                </span>
                {researchHref && (
                  <a
                    href={researchHref}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex flex-shrink-0 items-center text-muted-foreground hover:text-foreground"
                    title="Open research"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium">Topic:</span> {run.topic}
                </div>
                {run.slug && (
                  <div>
                    <span className="font-medium">Slug:</span>{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                      {run.slug}
                    </code>
                  </div>
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <StatusPill status={run.status} />
                {researchHref && run.status === "ready" && (
                  <a
                    href={researchHref}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-[10px] text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                  >
                    Open research
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </button>
    </div>
  );
}
