"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "@/lib/chat";
import type { ClarifyingQuestion } from "@/types/stakwork";

/**
 * Parses the formatted Q&A string produced by `ClarifyingQuestionsPreview.onSubmit`
 * back into structured pairs. The format is one question/answer per pair,
 * separated by blank lines:
 *
 *   Q: First question
 *   A: First answer
 *
 *   Q: Second question
 *   A: Second answer
 *
 * Used by the answered-state collapsible to display the original
 * questions alongside the user's answers.
 */
export function parseQAPairs(text: string): { question: string; answer: string }[] {
  return text
    .split("\n\n")
    .map((block) => {
      const lines = block.split("\n");
      const question = lines[0]?.replace(/^Q:\s*/, "") ?? "";
      const answer = lines[1]?.replace(/^A:\s*/, "") ?? "";
      return { question, answer };
    })
    .filter((pair) => pair.question.length > 0);
}

interface AnsweredClarifyingQuestionsProps {
  questions: ClarifyingQuestion[];
  replyMessage: ChatMessageType;
}

/**
 * Collapsed summary card shown after the user has answered a set of
 * clarifying questions. Click to expand and review the Q&A pairs.
 *
 * Shared by the task/feature plan-page chat (`ChatMessage`) and the
 * canvas-sidebar feature chat (`FeaturePlanChatMessage`). Stays free
 * of surface-specific concerns (no task ids, no workspace context) —
 * it just renders what's been answered.
 */
export function AnsweredClarifyingQuestions({
  questions,
  replyMessage,
}: AnsweredClarifyingQuestionsProps) {
  const [expanded, setExpanded] = useState(false);
  const pairs = parseQAPairs(replyMessage.message);
  const count = questions.length;

  return (
    <div className="rounded-md border border-border bg-muted/50 p-4">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <HelpCircle className="h-3 w-3" />
        <span>
          {count} {count === 1 ? "question" : "questions"} answered
        </span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-3">
          {pairs.map((pair, i) => (
            <div key={i}>
              <p className="font-medium text-foreground text-sm">{pair.question}</p>
              <p className="text-muted-foreground text-sm pl-2 border-l border-border ml-1 mt-0.5">
                {pair.answer}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
