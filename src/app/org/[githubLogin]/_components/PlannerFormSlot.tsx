"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { ClarifyingQuestionsPreview } from "@/components/features/ClarifyingQuestionsPreview";
import type { ClarifyingQuestion } from "@/types/stakwork";

/**
 * PlannerFormSlot — Phase 4 of
 * `docs/plans/canvas-agent-manages-planners.md`.
 *
 * Renders a feature planner's most recent UNANSWERED clarifying-
 * questions FORM as an answer-this-now card, sitting just outside the
 * collapsed `SubAgentRunCard` for that feature. The user answers in
 * canvas chat instead of navigating to `/w/<slug>/plan/<featureId>`.
 *
 * Reuses `ClarifyingQuestionsPreview` verbatim (the same renderer the
 * per-feature plan page uses). On submit it POSTs the formatted
 * answers to `POST /api/orgs/[githubLogin]/planner-forms/answer`, which
 * forwards them to the planner AND records a
 * `user-answered-planner-form` row in the canvas conversation.
 *
 * **Local-only post-submit state.** The authoritative canvas record is
 * written server-side by the endpoint; this component just flips to a
 * local "answered" confirmation so the FORM disappears immediately. The
 * persistent `✓ Answered` thread entry materializes on the next
 * conversation load (the small, accepted client-staleness race —
 * Phase 4 open question #3). We do NOT append to the local store here,
 * which keeps the canvas-conversation row single-writer (endpoint) and
 * avoids a double-append against autosave.
 */
interface PlannerFormSlotProps {
  githubLogin: string;
  featureId: string;
  /** The planner `ChatMessage.id` that asked — pairs the answer back. */
  plannerMessageId: string;
  /** The clarifying questions, embedded on the fan-out row (`source.formQuestions`). */
  questions: ClarifyingQuestion[];
  /** For the card's one-line header. */
  featureTitle?: string;
}

export function PlannerFormSlot({
  githubLogin,
  featureId,
  plannerMessageId,
  questions,
  featureTitle,
}: PlannerFormSlotProps) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (formattedAnswers: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/orgs/${encodeURIComponent(githubLogin)}/planner-forms/answer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ featureId, plannerMessageId, answer: formattedAnswers }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit answer");
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
        <span>Answer sent to the planner.</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center gap-1.5 px-3 pt-2.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
        <AlertCircle className="h-3 w-3 flex-shrink-0" />
        <span>The planner needs your input</span>
        {featureTitle && (
          <>
            <span aria-hidden="true" className="opacity-60">
              ·
            </span>
            <span className="truncate normal-case opacity-80">{featureTitle}</span>
          </>
        )}
      </div>
      <div className="p-2">
        <ClarifyingQuestionsPreview
          questions={questions}
          onSubmit={handleSubmit}
          isLoading={submitting}
        />
      </div>
      {error && (
        <div className="px-3 pb-2 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}
    </div>
  );
}

export default PlannerFormSlot;
