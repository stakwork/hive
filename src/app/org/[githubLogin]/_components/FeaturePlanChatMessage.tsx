"use client";

import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { ChatMessage as ChatMessageType, ChatRole } from "@/lib/chat";
import { isClarifyingQuestions } from "@/types/stakwork";
import type { ClarifyingQuestionsResponse } from "@/types/stakwork";
import { ClarifyingQuestionsPreview } from "@/components/features/ClarifyingQuestionsPreview";
import { AnsweredClarifyingQuestions } from "@/components/features/ClarifyingQuestionsPreview/AnsweredClarifyingQuestions";

/**
 * Narrow-column bubble for the canvas-sidebar feature-plan chat.
 *
 * Renders the message text plus a single artifact type — the
 * `ask_clarifying_questions` PLAN artifact — so the agent's
 * structured prompt-for-input UI works inside the right panel.
 *
 * Intentionally does **not** render any other artifact type (form,
 * code, browser, longform, publish-workflow, bounty, pull-request,
 * diff, …). Those still live on the full plan page (`/w/{slug}/plan/{id}`),
 * which the parent surfaces as a "Full plan view" link. Adding more
 * artifact renderers here is a follow-up; keep this fork small until
 * the canvas chat earns its way into supporting them.
 *
 * Visual idiom mirrors `SidebarChatMessage` (`./SidebarChatMessage.tsx`):
 *   - User bubble — right-aligned, `max-w-[85%]`, primary fill.
 *   - Assistant bubble — left-aligned, full column width, muted fill.
 *
 * Reply messages (those with `replyId` set) are filtered out by the
 * caller before rendering — they exist only to show as the answered
 * Q&A summary attached to their target message.
 */
interface FeaturePlanChatMessageProps {
  message: ChatMessageType;
  /**
   * The user message that answers a clarifying-questions artifact on
   * `message`, if any. Set when `messages.find((m) => m.replyId ===
   * message.id)` resolves. Triggers the collapsed
   * `AnsweredClarifyingQuestions` view in place of the interactive
   * `ClarifyingQuestionsPreview`.
   */
  replyMessage?: ChatMessageType;
  /**
   * Called when the user submits answers via the inline preview.
   * Implementation lives in `FeaturePlanChat` — POSTs to
   * `/api/features/[id]/chat` with `replyId` set so the server pairs
   * the answer back to the artifact's message.
   */
  onSubmitAnswers: (messageId: string, formattedAnswers: string) => void | Promise<void>;
}

export function FeaturePlanChatMessage({
  message,
  replyMessage,
  onSubmitAnswers,
}: FeaturePlanChatMessageProps) {
  const isUser = message.role === ChatRole.USER;
  const text = (message.message ?? "").trim();

  // Detect a `PLAN`-typed artifact carrying the clarifying-questions
  // payload. There can be multiple in theory; in practice the agent
  // emits at most one per message, but we render whatever's there.
  const clarifyingArtifacts =
    message.artifacts?.filter(
      (a) => a.type === "PLAN" && isClarifyingQuestions(a.content),
    ) ?? [];

  // If the message has neither text nor a clarifying-questions
  // artifact, render nothing — keeps the scroll free of empty bubbles
  // produced by streaming-only updates.
  if (!text && clarifyingArtifacts.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-2"
    >
      {text && (
        <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
          <div className={isUser ? "max-w-[85%]" : "w-full"}>
            <div
              className={`rounded-2xl px-3 py-2 shadow-sm ${
                isUser
                  ? "bg-primary text-primary-foreground inline-block"
                  : "bg-muted/40"
              }`}
            >
              <div
                className={`prose prose-sm max-w-none break-words ${
                  isUser
                    ? "[&>*]:!text-primary-foreground [&_*]:!text-primary-foreground"
                    : "dark:prose-invert [&>*]:!text-foreground/90 [&_*]:!text-foreground/90"
                }`}
              >
                <ReactMarkdown>{text}</ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      )}

      {clarifyingArtifacts.map((artifact) => {
        const questions = (artifact.content as ClarifyingQuestionsResponse).content;
        return (
          <div key={artifact.id} className="w-full">
            {replyMessage ? (
              <AnsweredClarifyingQuestions
                questions={questions}
                replyMessage={replyMessage}
              />
            ) : (
              <ClarifyingQuestionsPreview
                questions={questions}
                onSubmit={(formattedAnswers) =>
                  onSubmitAnswers(message.id, formattedAnswers)
                }
              />
            )}
          </div>
        );
      })}
    </motion.div>
  );
}
