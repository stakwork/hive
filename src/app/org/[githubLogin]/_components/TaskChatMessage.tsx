"use client";

import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { ChatMessage as ChatMessageType, ChatRole, type Artifact, type FormContent, type Option } from "@/lib/chat";
import { FormArtifact } from "@/app/w/[slug]/task/[...taskParams]/artifacts/form";
import { PullRequestArtifact } from "@/app/w/[slug]/task/[...taskParams]/artifacts/pull-request";
import { TaskArtifactPill } from "./TaskArtifactPill";

/**
 * Narrow-column bubble for the canvas-sidebar task chat.
 *
 * Mirrors `FeaturePlanChatMessage` but renders task-flavored
 * artifacts: `FORM` (interactive button prompt) and `PULL_REQUEST`
 * (status card) inline, everything else as a click-to-open pill via
 * `<TaskArtifactPill>`. The structural difference vs the feature
 * sibling is just which artifacts are interactive; bubble styling,
 * reply pairing, markdown body are identical.
 *
 * Artifact rendering policy:
 *
 *   - **`FORM`** — inline interactive (`<FormArtifact>`). User can
 *     click options; the parent posts the reply back via
 *     `onArtifactAction` with `replyId` set, the same way the full
 *     task page does.
 *   - **`PULL_REQUEST`** — inline render (`<PullRequestArtifact>`),
 *     same compact card the full task page uses
 *     (`ChatMessage.tsx:254-264`). PR status is a primary signal in
 *     the canvas's "what did the agent do" loop, so it earns inline
 *     real estate.
 *   - **Everything else** (`CODE`, `DIFF`, `LONGFORM`, `BOUNTY`,
 *     `PUBLISH_WORKFLOW`, `BROWSER`, `IDE`, `WORKFLOW`, `GRAPH`,
 *     `MEDIA`, `BUG_REPORT`, `STREAM`, etc.) — rendered as a small
 *     `<TaskArtifactPill>` chip. Click → either a large
 *     in-canvas modal (lightweight render-only types) or
 *     `/w/<slug>/task/<id>` in a new tab (heavy types that need
 *     workspace/pod context). See `TaskArtifactPill.KIND_META`.
 */
interface TaskChatMessageProps {
  message: ChatMessageType;
  /**
   * The user message that answered this artifact's prompt, if any.
   * Set when `messages.find((m) => m.replyId === message.id)` resolves.
   * Triggers `FormArtifact`'s `isDisabled + selectedOption` view.
   */
  replyMessage?: ChatMessageType;
  /**
   * Called when the user clicks one of a FORM artifact's option
   * buttons. Implementation lives in `TaskChat` — POSTs to
   * `/api/chat/message` with `replyId` set so the server pairs the
   * reply back to the artifact's message.
   */
  onArtifactAction: (
    messageId: string,
    action: Option,
    webhook: string,
  ) => void | Promise<void>;
  /** Workspace-scoped task page URL — used by external-fallback pills. */
  taskHref: string;
}

/**
 * Artifact types we render inline (FORM, PULL_REQUEST) — every other
 * type goes through the pill+modal path. Keeping this list at module
 * scope so adding a new inline renderer is a one-line change here
 * plus the actual JSX below.
 */
const INLINE_ARTIFACT_TYPES = new Set<string>(["FORM", "PULL_REQUEST"]);

export function TaskChatMessage({
  message,
  replyMessage,
  onArtifactAction,
  taskHref,
}: TaskChatMessageProps) {
  const isUser = message.role === ChatRole.USER;
  const text = (message.message ?? "").trim();
  const allArtifacts = (message.artifacts ?? []) as Artifact[];
  const formArtifacts = allArtifacts.filter((a) => a.type === "FORM");
  const prArtifacts = allArtifacts.filter((a) => a.type === "PULL_REQUEST");
  // Pills cover everything that isn't already rendered inline. Order
  // is preserved from the original artifacts array so the rendered
  // pill row matches the agent's emission order.
  const pillArtifacts = allArtifacts.filter(
    (a) => !INLINE_ARTIFACT_TYPES.has(a.type as string),
  );

  // Skip empty messages — text-less and artifact-less. Non-FORM
  // artifact-only messages used to fall in here too; with pills they
  // now have a reason to render.
  if (
    !text &&
    formArtifacts.length === 0 &&
    prArtifacts.length === 0 &&
    pillArtifacts.length === 0
  ) {
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

      {formArtifacts.map((artifact) => {
        // Match the full task page's "find the option the user picked"
        // pattern (`ChatMessage.tsx:218-224`) so the post-reply view
        // visually highlights the same choice the user made.
        let selectedOption: Option | null | undefined = null;
        if (replyMessage && artifact.content) {
          const formContent = artifact.content as FormContent;
          selectedOption = formContent.options?.find(
            (o: Option) => o.optionResponse === replyMessage.message,
          );
        }
        return (
          <div
            key={artifact.id}
            className={`flex ${isUser ? "justify-end" : "justify-start"}`}
          >
            <div className="max-w-md w-full">
              <FormArtifact
                messageId={message.id}
                artifact={artifact}
                onAction={onArtifactAction}
                selectedOption={selectedOption}
                isDisabled={!!replyMessage}
              />
            </div>
          </div>
        );
      })}

      {prArtifacts.map((artifact) => (
        <div
          key={artifact.id}
          className={`flex ${isUser ? "justify-end" : "justify-start"}`}
        >
          <div className="max-w-md w-full">
            <PullRequestArtifact artifact={artifact} />
          </div>
        </div>
      ))}

      {pillArtifacts.length > 0 && (
        <div
          className={`flex flex-wrap gap-1.5 ${isUser ? "justify-end" : "justify-start"}`}
        >
          {pillArtifacts.map((artifact) => (
            <TaskArtifactPill
              key={artifact.id}
              artifact={artifact}
              taskHref={taskHref}
              workflowUrl={message.workflowUrl}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}
