"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Exported pure types ────────────────────────────────────────────────────

export type PublishState =
  | { kind: "published" }
  | { kind: "superseded"; latestVersionNumber: number }
  | { kind: "publishable" }
  | { kind: "unresolved" } // target id absent from list — deleted/rewritten
  | { kind: "hidden" }; // nothing to render (no target id, no data)

/** Per-version shape returned by `?fields=state`. */
export interface VersionStateEntry {
  id: string;
  version_number: number;
  published: boolean;
  created_at: string; // ISO
  source: string;
}

/** Lean response envelope from `?fields=state`. */
export interface VersionStateResponse {
  success: boolean;
  data: {
    prompt_id: string;
    versions: VersionStateEntry[];
    current_version_id: string | null;
    published_version_id: string | null;
  };
}

// ─── derivePublishState ─────────────────────────────────────────────────────

/**
 * Pure derivation of publish state from a `?fields=state` response.
 *
 * `published` iff `targetVersionId === published_version_id` — the
 * authoritative Prompt field, NOT the per-version `published` boolean
 * (those two fields can disagree on race-y paths).
 *
 * `superseded` iff the target is unpublished AND a row with a greater
 * version_number exists.
 *
 * `unresolved` when the target id is absent from the version list
 * (deleted/rewritten version). This is NOT the same as "nothing to show".
 *
 * `hidden` when there is no target id at all.
 */
export function derivePublishState(
  targetVersionId: string | null | undefined,
  data: VersionStateResponse["data"] | null,
): PublishState {
  if (!targetVersionId) return { kind: "hidden" };
  if (!data) return { kind: "hidden" };

  const { versions, published_version_id } = data;

  // Check if published — authoritative field comparison
  if (targetVersionId === published_version_id) {
    return { kind: "published" };
  }

  // Find the target version in the list
  const target = versions.find((v) => v.id === targetVersionId);
  if (!target) {
    return { kind: "unresolved" };
  }

  // Target is unpublished — check if superseded
  const isSuperseded = versions.some(
    (v) => v.version_number > target.version_number,
  );
  if (isSuperseded) {
    const latestVersionNumber = Math.max(...versions.map((v) => v.version_number));
    return { kind: "superseded", latestVersionNumber };
  }

  return { kind: "publishable" };
}

// ─── resolveLegacyVersion ───────────────────────────────────────────────────

/**
 * Legacy resolution: find the version the user actually approved when
 * `ApprovalResult.promptVersionId` is absent (pre-existing approvals
 * or re-approvals that hit the idempotency short-circuit).
 *
 * Strategy: the newest version with `source === "MCP"` whose `created_at`
 * falls within a 10-minute window BEFORE the approval timestamp. The draft
 * is written immediately before the approval row is persisted, so a 10-minute
 * window captures it safely. We require exactly ONE candidate — if zero or
 * multiple candidates match, we return null (unresolvable → read-only text).
 *
 * NEVER uses `current_version_id` — that field is "whatever the newest draft
 * is", with no link to the approving proposal.
 *
 * Exported as a pure function so it can be tested directly.
 */
export function resolveLegacyVersion(
  versions: VersionStateEntry[],
  approvalTimestamp: Date,
  windowMs = 10 * 60 * 1000, // 10 minutes
): VersionStateEntry | null {
  const approvalMs = approvalTimestamp.getTime();
  const windowStart = approvalMs - windowMs;

  const candidates = versions.filter((v) => {
    if (v.source !== "MCP") return false;
    const createdMs = new Date(v.created_at).getTime();
    return createdMs <= approvalMs && createdMs >= windowStart;
  });

  if (candidates.length !== 1) return null;
  return candidates[0];
}

// ─── publishPromptVersion ───────────────────────────────────────────────────

export interface PublishExpected {
  expectedPublishedVersionId: string | null | undefined;
  expectedLatestVersionNumber: number | undefined;
}

export interface PublishPromptVersionResult {
  syncOutcome: "PUSHED" | "PUSH_FAILED" | "NOT_CONFIGURED";
}

/**
 * Thin fetch function for publishing a specific prompt version.
 * Posts `expectedPublishedVersionId` and `expectedLatestVersionNumber`
 * as the stale-publish guard fields. Never posts `artifactId`.
 *
 * Returns `{ status, syncOutcome }` where status is the HTTP status code.
 */
export async function publishPromptVersion(
  promptId: string,
  versionId: string,
  expected: PublishExpected,
): Promise<{ status: number; syncOutcome?: string }> {
  const res = await fetch(
    `/api/workflow/prompts/${promptId}/versions/${versionId}/publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedPublishedVersionId: expected.expectedPublishedVersionId ?? null,
        expectedLatestVersionNumber: expected.expectedLatestVersionNumber,
      }),
    },
  );
  const body = await res.json().catch(() => ({}));
  return { status: res.status, syncOutcome: body?.syncOutcome };
}

// ─── Fetch dedup ────────────────────────────────────────────────────────────

const DEDUP_WINDOW_MS = 10_000; // 10 seconds

// ─── PublishPromptSlot ──────────────────────────────────────────────────────

interface PublishPromptSlotProps {
  promptId: string;
  /** Version id from `ApprovalResult.promptVersionId` — null = legacy resolution needed. */
  promptVersionId: string | null | undefined;
  /** Slug from `ApprovalResult.workspaceSlug` — used for deep links. */
  workspaceSlug: string | null | undefined;
  /** Timestamp of the message that bears this approval — used for legacy resolution. */
  approvalTimestamp: Date;
  /**
   * Called whenever the resolved publish state changes. `ProposalCard` uses
   * this to conditionally suppress the "New draft version saved ✓" subtext
   * when the slot shows "Published ✓".
   */
  onStateChange?: (state: PublishState | null) => void;
}

export function PublishPromptSlot({
  promptId,
  promptVersionId: propVersionId,
  workspaceSlug,
  approvalTimestamp,
  onStateChange,
}: PublishPromptSlotProps) {
  const [data, setData] = useState<VersionStateResponse["data"] | null>(null);
  const [fetchError, setFetchError] = useState<"forbidden" | "gone" | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [lastSyncOutcome, setLastSyncOutcome] = useState<string | null>(null);

  // Dedup: track last-fetch time and in-flight flag
  const lastFetchMs = useRef<number>(0);
  const fetchInFlight = useRef(false);

  // ── Resolve target version id ─────────────────────────────────────────────
  // Precedence: explicit promptVersionId > legacy resolution > null
  const resolvedVersionId: string | null = (() => {
    if (propVersionId) return propVersionId;
    if (!data) return null;
    const legacy = resolveLegacyVersion(data.versions, approvalTimestamp);
    return legacy?.id ?? null;
  })();

  // ── Derive publish state ─────────────────────────────────────────────────
  const publishState: PublishState = derivePublishState(resolvedVersionId, data);

  // Report state changes up to ProposalCard
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  useEffect(() => {
    onStateChangeRef.current?.(fetchError ? null : publishState);
  }, [publishState, fetchError]);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const doFetch = useCallback(async () => {
    if (fetchInFlight.current) return;
    const now = Date.now();
    if (now - lastFetchMs.current < DEDUP_WINDOW_MS) return;

    fetchInFlight.current = true;
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/workflow/prompts/${promptId}/versions?fields=state`,
      );
      if (res.status === 403) {
        setFetchError("forbidden");
        return;
      }
      if (res.status === 404 || !res.ok) {
        setFetchError("gone");
        return;
      }
      const json: VersionStateResponse = await res.json();
      if (json.success && json.data) {
        setData(json.data);
        setFetchError(null);
        lastFetchMs.current = Date.now();
      }
    } catch {
      setFetchError("gone");
    } finally {
      fetchInFlight.current = false;
      setIsLoading(false);
    }
  }, [promptId]);

  // Fetch on mount
  useEffect(() => {
    void doFetch();
  }, [doFetch]);

  // Fetch on window focus (deduped)
  useEffect(() => {
    const handler = () => void doFetch();
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
  }, [doFetch]);

  // ── Publish action ────────────────────────────────────────────────────────
  const handlePublish = async () => {
    if (!resolvedVersionId || isPublishing) return;
    setIsPublishing(true);
    setPublishError(null);

    const expected: PublishExpected = {
      expectedPublishedVersionId: data?.published_version_id,
      expectedLatestVersionNumber: data
        ? Math.max(...data.versions.map((v) => v.version_number), 0)
        : undefined,
    };

    const result = await publishPromptVersion(
      promptId,
      resolvedVersionId,
      expected,
    ).catch(() => ({ status: 500, syncOutcome: undefined }));

    if (result.status === 409) {
      // Stale state — refetch and re-render with fresh warning
      lastFetchMs.current = 0; // reset dedup
      await doFetch();
      setPublishError("stale");
    } else if (result.status === 200 || result.status === 201) {
      setLastSyncOutcome(result.syncOutcome ?? null);
      lastFetchMs.current = 0;
      await doFetch();
    } else if (result.status === 403) {
      setFetchError("forbidden");
    } else {
      setPublishError("error");
    }

    setIsPublishing(false);
  };

  // ── Render states ─────────────────────────────────────────────────────────

  // 404 / network error → render nothing
  if (fetchError === "gone") return null;

  // 403 → read-only text
  if (fetchError === "forbidden") {
    return (
      <div className="mt-1.5 text-xs text-muted-foreground">
        Draft version saved — not published. Publishing requires prompt library
        access.
      </div>
    );
  }

  // Still loading initial data
  if (isLoading && !data) {
    return (
      <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Checking publish state…</span>
      </div>
    );
  }

  if (!data) return null;

  // Compute deep link to prompts page
  const slug = workspaceSlug ?? "stakwork";
  const promptsLink = `/w/${slug}/prompts?prompt=${promptId}${resolvedVersionId ? `&version=${resolvedVersionId}` : ""}`;

  // Hidden — no target id and no data worth showing
  if (publishState.kind === "hidden") return null;

  // Unresolved — target id absent from list or legacy resolution ambiguous
  if (publishState.kind === "unresolved") {
    return (
      <div className="mt-1.5 text-xs text-muted-foreground">
        Draft version saved — not published.{" "}
        <a
          href={promptsLink}
          className="underline hover:text-foreground"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open the prompt library to publish.
        </a>
      </div>
    );
  }

  // No resolvedVersionId but data is present — legacy resolution failed
  if (!resolvedVersionId) {
    return (
      <div className="mt-1.5 text-xs text-muted-foreground">
        Draft version saved — not published.{" "}
        <a
          href={promptsLink}
          className="underline hover:text-foreground"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open the prompt library to publish.
        </a>
      </div>
    );
  }

  // Published ✓
  if (publishState.kind === "published") {
    const showSyncWarning = lastSyncOutcome === "PUSH_FAILED";
    return (
      <div className="mt-1.5 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
        <span>Published ✓</span>
        <a
          href={promptsLink}
          className="inline-flex items-center hover:underline"
          title="View in prompt library"
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink className="ml-0.5 h-3 w-3" />
        </a>
        {showSyncWarning && (
          <span className="text-amber-600 dark:text-amber-400">
            — sync to Stakwork pending retry
          </span>
        )}
      </div>
    );
  }

  // Publishable or Superseded — show Publish button
  const isSuperseded = publishState.kind === "superseded";

  return (
    <div className="mt-1.5 space-y-1">
      {isSuperseded && (
        <div className="text-xs text-amber-600 dark:text-amber-500">
          A newer draft (v{publishState.latestVersionNumber}) exists —
          publishing this version will make it live
        </div>
      )}
      {publishError === "stale" && (
        <div className="text-xs text-amber-600 dark:text-amber-500">
          The prompt changed while you were viewing this card. Refreshed state
          — check and try again.
        </div>
      )}
      {publishError === "error" && (
        <div className="text-xs text-rose-600 dark:text-rose-400">
          Publish failed. Please try again.
        </div>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        onClick={handlePublish}
        disabled={isPublishing}
      >
        {isPublishing ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : null}
        Publish
      </Button>
    </div>
  );
}
