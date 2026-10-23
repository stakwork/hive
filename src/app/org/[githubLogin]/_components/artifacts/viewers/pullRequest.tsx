"use client";

import React, { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { checksFailedEvent } from "@/lib/strut-jobs";
import { cn } from "@/lib/utils";
import type {
  ArtifactContents,
  ArtifactViewerProps,
  PullRequestCheck,
  PullRequestState,
} from "../../../_state/canvasChatArtifacts";
import { useCanvasChatStore } from "../../../_state/canvasChatStore";
import { ScrollFade } from "../chrome";
import { MultiFileDiffView } from "../diff";
import { prLiveQueryKey } from "../useArtifactContent";
import { useChatOrgLogin } from "../useArtifactPanel";

/** GitHub's colours for a pull request's state — the ones the task page's pull request card wears. */
export const PULL_REQUEST_STATE: Record<PullRequestState, { label: string; Icon: LucideIcon; color: string }> = {
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

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-3 flex items-baseline gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

/** What the Fix sends (strut plans/job-artifact-events.md §5): the `checks failed` event — the head commit and the failing checks, each with its link — composed from the card's live state, the same one hive sends on its own once (`check-failures.ts`). Null while nothing has failed. */
export function fixEventOf(content: ArtifactContents["pull_request"]): { url: string; what: string; details: string[] } | null {
  return checksFailedEvent(content);
}

type FixState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent" }
  | { status: "busy"; note: string }
  | { status: "failed"; error: string };

/**
 * Fix — send the failing checks to the job that opened the pull request,
 * as its next turn (`api/orgs/[githubLogin]/strut/jobs/[jobId]/events`):
 * the `Pod` page has it reproduce, fix in the pod and push to this same
 * pull request. A click where a `continue_job` would be; only the job's
 * owner may (the route's 403). A job mid-turn says so — try again in a
 * minute — rather than queueing from a button. The FIRST fix on a pull
 * request goes without a click, once every check has run
 * (`services/strut-jobs/check-failures.ts`); this button is every one
 * after it.
 */
function FixButton({ jobId, event }: { jobId: string; event: NonNullable<ReturnType<typeof fixEventOf>> }) {
  const githubLogin = useChatOrgLogin();
  const [state, setState] = useState<FixState>({ status: "idle" });

  const send = async () => {
    setState({ status: "sending" });
    try {
      const res = await fetch(`/api/orgs/${encodeURIComponent(githubLogin)}/strut/jobs/${encodeURIComponent(jobId)}/events`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; busy?: boolean };
      if (res.status === 202) setState({ status: "sent" });
      else if (res.status === 409 && body.busy) setState({ status: "busy", note: "A turn of the job is running — try again in a minute." });
      else setState({ status: "failed", error: body.error ?? `HTTP ${res.status}` });
    } catch (err) {
      setState({ status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  };

  if (state.status === "sent") {
    return (
      <span data-testid="pr-fix-sent" className="ml-auto text-xs normal-case tracking-normal">
        Sent to the job
      </span>
    );
  }
  return (
    <span className="ml-auto flex items-baseline gap-2 normal-case tracking-normal">
      {state.status === "busy" && <span className="text-xs">{state.note}</span>}
      {state.status === "failed" && <span className="text-xs text-amber-600 dark-app:text-amber-400">Could not send: {state.error}</span>}
      <button
        type="button"
        data-testid="pr-fix"
        onClick={send}
        disabled={state.status === "sending"}
        title="Send the failing checks to the job: it reproduces, fixes, and pushes to this pull request"
        className="rounded-md border bg-background px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
      >
        {state.status === "sending" ? "Sending…" : "Fix"}
      </button>
    </span>
  );
}

type MergeState = { status: "idle" } | { status: "merging" } | { status: "merged" } | { status: "failed"; error: string };

/**
 * Merge — merge the pull request from the chat
 * (`api/orgs/[githubLogin]/strut/pull-request/merge`), with the viewer's own
 * GitHub token, so GitHub decides whether they may. Shown on any open pull
 * request in the chat; it does not depend on the job that opened it.
 */
function MergeButton({ repo, number, onMerged }: { repo: string; number: number; onMerged: () => void }) {
  const githubLogin = useChatOrgLogin();
  const queryClient = useQueryClient();
  const conversationId = useCanvasChatStore((s) =>
    s.activeConversationId ? (s.conversations[s.activeConversationId]?.serverConversationId ?? null) : null,
  );
  const [state, setState] = useState<MergeState>({ status: "idle" });

  const merge = async () => {
    setState({ status: "merging" });
    try {
      const res = await fetch(`/api/orgs/${encodeURIComponent(githubLogin)}/strut/pull-request/merge`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, number, mergeMethod: "squash", ...(conversationId ? { conversationId } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setState({ status: "failed", error: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ status: "merged" });
      toast.success("Pull request merged");
      onMerged();
      void queryClient.invalidateQueries({ queryKey: prLiveQueryKey(githubLogin, repo, number) });
    } catch (err) {
      setState({ status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  };

  if (state.status === "merged") return null;
  return (
    <span className="ml-auto flex items-baseline gap-2">
      {state.status === "failed" && <span className="text-xs text-amber-600 dark-app:text-amber-400">Could not merge: {state.error}</span>}
      <button
        type="button"
        data-testid="pr-merge"
        onClick={merge}
        disabled={state.status === "merging"}
        title="Merge this pull request on GitHub"
        className="rounded-md border bg-background px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
      >
        {state.status === "merging" ? "Merging…" : "Merge"}
      </button>
    </span>
  );
}

export function PullRequestPanel({ artifact, content: inlineContent, jobId }: ArtifactViewerProps<"pull_request">) {
  // A merge done here shows at once, before the live read catches up.
  const [mergedHere, setMergedHere] = useState(false);
  const content = useMemo(
    () => (mergedHere ? { ...inlineContent, state: "merged" as const } : inlineContent),
    [inlineContent, mergedHere],
  );
  const state = PULL_REQUEST_STATE[content.state];
  const fromTo = branches(content);
  const checks = useMemo(
    () => [...(content.checks ?? [])].sort((a, b) => CHECK_ORDER[a.status] - CHECK_ORDER[b.status]),
    [content.checks],
  );
  const passed = passedOfRan(checks);
  // The job that opened it can be sent the failures — while the pull request is still open to a fix.
  const fix = jobId && content.state !== "merged" && content.state !== "closed" ? fixEventOf(content) : null;

  return (
    <ScrollFade className="mx-auto w-full max-w-4xl space-y-8 px-8 py-8">
      <header className="space-y-3">
        <h2 className="text-xl font-semibold leading-snug">
          {artifact.title}{" "}
          <a
            href={content.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="pr-number"
            title="Open on GitHub"
            className="font-normal text-muted-foreground hover:text-foreground hover:underline"
          >
            #{content.number}
          </a>
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
          {content.state === "open" && content.repo && content.number && (
            <MergeButton repo={content.repo} number={content.number} onMerged={() => setMergedHere(true)} />
          )}
        </div>
      </header>

      {checks.length > 0 && (
        <section>
          <SectionHeading>
            Checks
            {passed && <span className="normal-case tracking-normal">{passed} passed</span>}
            {fix && jobId && <FixButton jobId={jobId} event={fix} />}
          </SectionHeading>
          {/* As wide as its longest name, so each check's outcome sits beside it, in a column. */}
          <div className="grid w-fit max-w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-2 text-sm">
            {checks.map((check) => (
              <React.Fragment key={check.name}>
                <CheckMark status={check.status} />
                {check.url ? (
                  <a
                    href={check.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn("truncate hover:underline", check.status === "skipped" && "text-muted-foreground")}
                  >
                    {check.name}
                  </a>
                ) : (
                  <span className={cn("truncate", check.status === "skipped" && "text-muted-foreground")}>{check.name}</span>
                )}
                <span
                  className={cn(
                    "pl-6 text-xs",
                    check.status === "failure" ? "text-amber-600 dark-app:text-amber-400" : "text-muted-foreground",
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

/** The pull request's row in the chat: how many checks passed, then its state in GitHub's colours. */
export function PullRequestRowMeta({ content }: ArtifactViewerProps<"pull_request">) {
  const state = PULL_REQUEST_STATE[content.state];
  const passed = passedOfRan(content.checks);
  return (
    <span className="flex items-center gap-2">
      {passed && <span className="tabular-nums">{passed} checks</span>}
      <span className="flex items-center gap-1" style={{ color: state.color }}>
        <state.Icon aria-hidden className="h-3.5 w-3.5" />
        {state.label}
      </span>
    </span>
  );
}
