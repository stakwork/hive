/**
 * Streaming send-message hook for the canvas chat.
 *
 * Lives outside `canvasChatStore` because `useStreamProcessor` is a
 * React hook (so it can't be called from a vanilla store action) and
 * because keeping it here means the store stays a pure data layer —
 * no fetch, no streaming machinery, easy to reason about.
 *
 * Flow:
 *   1. Append user message to the store.
 *   2. POST to `/api/ask/quick` with the conversation's full
 *      message history (built from store state) + canvas-scope hints
 *      from the conversation's context.
 *   3. Pipe the response stream through `useStreamProcessor`. On
 *      every chunk, build a fresh assistant-side timeline of
 *      messages (split at tool-call boundaries) and write them back
 *      into the store via `replaceAssistantStream`.
 *   4. On stream end, clear `activeToolCalls`. On error, append a
 *      synthetic assistant error message.
 *
 * Performance: we commit one `set()` per stream chunk (~50/sec
 * during streaming). Consumers selecting only `proposals` /
 * `artifacts` are unaffected because their selector returns the same
 * reference; consumers selecting `messages` re-render at chunk rate,
 * which is the expected cost of a live chat.
 */
"use client";

import { useCallback } from "react";
import { useStreamProcessor } from "@/lib/streaming";
import type {
  ApprovalIntent,
  ApprovalResult,
  RejectionIntent,
} from "@/lib/proposals/types";
import {
  toModelMessages,
  useCanvasChatStore,
  type CanvasChatMessage,
  type ToolCall,
} from "./canvasChatStore";

interface SendArgs {
  conversationId: string;
  content: string;
  /** Called when the assistant's first chunk arrives. */
  onResponseStart?: () => void;
  /**
   * Optional structured intent fields that ride along on the user
   * message. Used by `<ProposalCard>` to send Approve / Reject clicks
   * through the same send pipeline as a regular chat message — the
   * route inspects these on the latest user message and runs the
   * approval handler before (or instead of) the LLM.
   */
  approval?: ApprovalIntent;
  rejection?: RejectionIntent;
}

export function useSendCanvasChatMessage() {
  const { processStream } = useStreamProcessor();

  return useCallback(
    async ({
      conversationId,
      content,
      onResponseStart,
      approval,
      rejection,
    }: SendArgs) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const {
        appendUserMessage,
        replaceAssistantStream,
        setActiveToolCalls,
        setIsLoading,
        appendAssistantError,
      } = useCanvasChatStore.getState();

      // Snapshot the conversation BEFORE we mutate so the request
      // body sees a consistent message list. We also need its
      // `context` to build the request.
      const conv =
        useCanvasChatStore.getState().conversations[conversationId];
      if (!conv) return;

      const userMessage: CanvasChatMessage = {
        id: Date.now().toString(),
        role: "user",
        content: trimmed,
        timestamp: new Date(),
        ...(approval ? { approval } : {}),
        ...(rejection ? { rejection } : {}),
      };
      const updatedMessages = [...conv.messages, userMessage];

      appendUserMessage(conversationId, userMessage);
      setIsLoading(conversationId, true);

      let firstChunk = true;
      const ctx = conv.context;

      try {
        const response = await fetch(`/api/ask/quick`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: toModelMessages(updatedMessages),
            ...(ctx.workspaceSlugs.length > 0
              ? {
                  workspaceSlugs: [
                    ctx.workspaceSlug,
                    ...ctx.workspaceSlugs,
                  ].filter(Boolean),
                }
              : { workspaceSlug: ctx.workspaceSlug }),
            orgId: ctx.orgId,
            currentCanvasRef: ctx.currentCanvasRef,
            ...(ctx.currentCanvasBreadcrumb
              ? { currentCanvasBreadcrumb: ctx.currentCanvasBreadcrumb }
              : {}),
            ...(ctx.selectedNodeId ? { selectedNodeId: ctx.selectedNodeId } : {}),
            // Sidebar chat doesn't render follow-ups or provenance;
            // skip the server-side enrichment block to save tokens
            // and a stakgraph round-trip per turn.
            skipEnrichments: true,
            // Approve / reject intents ride alongside the AI SDK
            // `messages` array — `toModelMessages` strips them by
            // design (they're chat metadata, not model input). The
            // route checks these before deciding whether to call the
            // LLM at all; the chat-side raw transcript is also passed
            // so the route can find the matching proposal tool call
            // and run its idempotency scan.
            ...(approval ? { approvalIntent: approval } : {}),
            ...(rejection ? { rejectionIntent: rejection } : {}),
            ...(approval || rejection
              ? { canvasChatMessages: updatedMessages }
              : {}),
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        // The proposal-approval endpoint stamps the structured
        // outcome (proposalId, kind, createdEntityId, landedOn) onto
        // a custom HTTP header. We read it once here so when the
        // synthetic stream finishes we can attach `approvalResult` to
        // the assistant message — that's what flips the proposal
        // card to its "approved" state and what survives a refresh.
        let approvalResult: ApprovalResult | null = null;
        const approvalResultHeader = response.headers.get(
          "X-Approval-Result",
        );
        if (approvalResultHeader) {
          try {
            approvalResult = JSON.parse(approvalResultHeader) as ApprovalResult;
          } catch (e) {
            console.warn("Invalid X-Approval-Result header:", e);
          }
        }

        const messageId = (Date.now() + 1).toString();
        const loggedToolCalls = new Set<string>();

        await processStream(response, messageId, (updatedMessage) => {
          if (firstChunk) {
            firstChunk = false;
            setIsLoading(conversationId, false);
            onResponseStart?.();
          }

          const timeline = updatedMessage.timeline || [];
          const timelineMessages: CanvasChatMessage[] = [];
          let currentText = "";
          let currentToolCalls: ToolCall[] = [];
          let msgCounter = 0;

          for (const item of timeline) {
            if (item.type === "text") {
              currentText += (item.data as { content: string }).content;
            } else if (item.type === "toolCall") {
              if (currentText.trim()) {
                timelineMessages.push({
                  id: `${messageId}-${msgCounter++}`,
                  role: "assistant",
                  content: currentText,
                  timestamp: new Date(),
                });
                currentText = "";
              }
              const toolCall = item.data as {
                id: string;
                toolName: string;
                input?: unknown;
                output?: unknown;
                status: string;
              };

              // Debug logging on the org canvas page or when DEBUG is
              // set. Same gate as `DashboardChat` so canvas tool-call
              // traces stay easy to read while bringing this up.
              if (
                typeof window !== "undefined" &&
                (/^\/org\/[^/]+$/.test(window.location.pathname) ||
                  (window as Window & { DEBUG?: boolean }).DEBUG)
              ) {
                const callKey = `${toolCall.id}-${toolCall.status}`;
                if (!loggedToolCalls.has(callKey)) {
                  loggedToolCalls.add(callKey);
                  if (toolCall.status === "call") {
                    console.log(
                      `%c[TOOL CALL] ${toolCall.toolName}`,
                      "color: #4fc3f7; font-weight: bold",
                      JSON.stringify(toolCall.input),
                    );
                  }
                  if (toolCall.output !== undefined) {
                    console.log(
                      `%c[TOOL RESULT] ${toolCall.toolName}`,
                      "color: #81c784; font-weight: bold",
                      JSON.stringify(toolCall.output),
                    );
                  }
                  if (toolCall.status === "output-error") {
                    console.log(
                      `%c[TOOL ERROR] ${toolCall.toolName}`,
                      "color: #e57373; font-weight: bold",
                      JSON.stringify(toolCall.output),
                    );
                  }
                }
              }

              currentToolCalls.push({
                id: toolCall.id,
                toolName: toolCall.toolName,
                input: toolCall.input,
                status: toolCall.status,
                output: toolCall.output,
                errorText:
                  toolCall.status === "output-error"
                    ? "Tool call failed"
                    : undefined,
              });
            }
          }

          if (currentToolCalls.length > 0) {
            timelineMessages.push({
              id: `${messageId}-${msgCounter++}`,
              role: "assistant",
              content: "",
              timestamp: new Date(),
              toolCalls: currentToolCalls,
            });
            currentToolCalls = [];
          }

          if (currentText.trim()) {
            timelineMessages.push({
              id: `${messageId}-${msgCounter++}`,
              role: "assistant",
              content: currentText,
              timestamp: new Date(),
            });
          }

          // Stamp the structured approval outcome onto the last
          // assistant text message in this batch, when the route
          // returned one. This is what the proposal card scans for
          // when computing status, and what survives a refresh
          // because the field round-trips through
          // `SharedConversation.messages` JSON.
          if (approvalResult) {
            for (let i = timelineMessages.length - 1; i >= 0; i--) {
              const m = timelineMessages[i];
              if (m.role === "assistant" && !m.toolCalls?.length) {
                timelineMessages[i] = { ...m, approvalResult };
                break;
              }
            }
          }

          const lastMsg = timelineMessages[timelineMessages.length - 1];
          if (lastMsg?.toolCalls && lastMsg.toolCalls.length > 0) {
            setActiveToolCalls(conversationId, lastMsg.toolCalls);
          } else {
            setActiveToolCalls(conversationId, []);
          }

          replaceAssistantStream(conversationId, messageId, timelineMessages);
        });

        setActiveToolCalls(conversationId, []);
      } catch (error) {
        console.error("Error calling ask API:", error);
        appendAssistantError(
          conversationId,
          "I'm sorry, but I encountered an error while processing your question. Please try again later.",
        );
      } finally {
        setIsLoading(conversationId, false);
      }
    },
    [processStream],
  );
}
