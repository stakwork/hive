"use client";

import React, { useMemo, type ReactNode } from "react";
import {
  AlertTriangle,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { cn } from "@/lib/utils";
import type {
  ArtifactContents,
  ArtifactViewerProps,
  PullRequestCheck,
  PullRequestState,
} from "../../../_state/canvasChatArtifacts";
import { ScrollFade } from "../chrome";
import { MultiFileDiffView, parseDiffs } from "../diff";
import { plural } from "../lines";
import { LineCounts } from "./diff";

/** GitHub's colours for a pull request's state — the ones the task page's pull request card wears. */
const STATE: Record<PullRequestState, { label: string; Icon: LucideIcon; color: string }> = {
  open: { label: "Open", Icon: GitPullRequest, color: "#238636" },
  draft: { label: "Draft", Icon: GitPullRequestDraft, color: "#6e7681" },
  merged: { label: "Merged", Icon: GitMerge, color: "#8957e5" },
  closed: { label: "Closed", Icon: GitPullRequestClosed, color: "#6e7681" },
};

/** What to read first: what failed, what is still running, then the rest. */
const CHECK_ORDER: Record<PullRequestCheck["status"], number> = { failure: 0, pending: 1, success: 2, skipped: 3 };
const CHECK_WORD: Record<PullRequestCheck["status"], string> = {
  failure: "Failed",
  pending: "Running",
  success: "Passed",
  skipped: "Skipped",
};

/** "5 of 6" — how many checks passed of those that ran. A skipped check never ran, so it is not counted. */
function passedOfRan(checks: PullRequestCheck[] | undefined): string | null {
  const ran = (checks ?? []).filter((check) => check.status !== "skipped");
  if (ran.length === 0) return null;
  return `${ran.filter((check) => check.status === "success").length} of ${ran.length}`;
}

function branches({ headBranch, baseBranch }: ArtifactContents["pull_request"]): string | null {
  if (!headBranch) return null;
  return baseBranch ? `${headBranch} → ${baseBranch}` : headBranch;
}

function CheckMark({ status }: { status: PullRequestCheck["status"] }) {
  if (status === "failure") return <AlertTriangle aria-hidden className="h-3.5 w-3.5 text-amber-500" />;
  if (status === "pending") return <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-sky-500" />;
  return (
    <span
      aria-hidden
      className={cn(
        "mx-[3px] h-2 w-2 rounded-full",
        status === "success" ? "bg-green-500" : "border border-muted-foreground/50",
      )}
    />
  );
}

export function PullRequestInline({ content }: ArtifactViewerProps<"pull_request">) {
  const state = STATE[content.state];
  const files = useMemo(() => (content.diffs?.length ? parseDiffs(content.diffs) : null), [content.diffs]);
  const passed = passedOfRan(content.checks);
  const fromTo = branches(content);
  return (
    <div className="space-y-1.5 px-3 py-2.5 text-xs">
      <div className="flex items-center gap-1.5">
        <state.Icon aria-hidden className="h-3.5 w-3.5 shrink-0" style={{ color: state.color }} />
        <span className="shrink-0 font-medium" style={{ color: state.color }}>
          {state.label}
        </span>
        {fromTo && <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{fromTo}</span>}
      </div>
      {(files || passed) && (
        // Spaced, not dotted: in a narrow chat these wrap, and a separator would be left hanging at a line's end.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground">
          {files && (
            <>
              <LineCounts files={files} />
              <span>{plural(files.length, "file")}</span>
            </>
          )}
          {passed && <span>{passed} checks passed</span>}
        </div>
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-3 flex items-baseline gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

export function PullRequestPanel({ artifact, content }: ArtifactViewerProps<"pull_request">) {
  const state = STATE[content.state];
  const fromTo = branches(content);
  const checks = useMemo(
    () => [...(content.checks ?? [])].sort((a, b) => CHECK_ORDER[a.status] - CHECK_ORDER[b.status]),
    [content.checks],
  );
  const passed = passedOfRan(checks);

  return (
    <ScrollFade className="mx-auto w-full max-w-4xl space-y-8 px-8 py-8">
      <header className="space-y-3">
        <h2 className="text-xl font-semibold leading-snug">
          {artifact.title} <span className="font-normal text-muted-foreground">#{content.number}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-muted-foreground">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white"
            style={{ backgroundColor: state.color }}
          >
            <state.Icon aria-hidden className="h-3.5 w-3.5" />
            {state.label}
          </span>
          <span>{content.repo}</span>
          {content.author && <span>{content.author}</span>}
          {fromTo && <span className="font-mono text-xs">{fromTo}</span>}
        </div>
      </header>

      {checks.length > 0 && (
        <section>
          <SectionHeading>
            Checks
            {passed && <span className="normal-case tracking-normal">{passed} passed</span>}
          </SectionHeading>
          {/* As wide as its longest name, so each check's outcome sits beside it, in a column. */}
          <div className="grid w-fit max-w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-2 text-sm">
            {checks.map((check) => (
              <React.Fragment key={check.name}>
                <CheckMark status={check.status} />
                <span className={cn("truncate", check.status === "skipped" && "text-muted-foreground")}>
                  {check.name}
                </span>
                <span
                  className={cn(
                    "pl-6 text-xs",
                    check.status === "failure" ? "text-amber-600 [.dark_&]:text-amber-400" : "text-muted-foreground",
                  )}
                >
                  {CHECK_WORD[check.status]}
                </span>
              </React.Fragment>
            ))}
          </div>
        </section>
      )}

      {content.body && (
        <section>
          <SectionHeading>Description</SectionHeading>
          <MarkdownRenderer size="compact" className="[&>*:first-child]:!mt-0">
            {content.body}
          </MarkdownRenderer>
        </section>
      )}

      {!!content.diffs?.length && (
        <section>
          <SectionHeading>Files changed</SectionHeading>
          <MultiFileDiffView diffs={content.diffs} maxHeight="none" />
        </section>
      )}
    </ScrollFade>
  );
}
