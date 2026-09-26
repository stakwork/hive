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
  type CanvasAttachment,
  type CanvasChatMessage,
} from "./canvasChatStore";
import { applyCanvasAssistantStream } from "./applyCanvasAssistantStream";

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
  /** File attachments uploaded before send. Stamped onto the user message and forwarded to the API. */
  attachments?: CanvasAttachment[];
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
      attachments,
    }: SendArgs) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const {
        appendUserMessage,
        replaceAssistantStream,
        setActiveToolCalls,
        setIsLoading,
        setIsStreaming,
        setRunActive,
        appendAssistantError,
        markTurnAuthored,
        setServerConversationId,
        bumpAgentTurns,
      } = useCanvasChatStore.getState();

      // Backend-driven persistence id for this turn
      // (docs/plans/backend-driven-canvas-turns.md). The server persists
      // the user row as `${turnId}-u` and the assistant rows as
      // `${turnId}-a*`; we register the id so the live-sync filters those
      // server rows out of the merge (this tab already shows them live).
      const turnId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `turn-${Date.now().toString(36)}-${Math.random()
              .toString(36)
              .slice(2)}`;
      markTurnAuthored(turnId);

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
        ...(attachments?.length ? { attachments } : {}),
        ...(approval ? { approval } : {}),
        ...(rejection ? { rejection } : {}),
      };
      const updatedMessages = [...conv.messages, userMessage];

      appendUserMessage(conversationId, userMessage);
      setIsLoading(conversationId, true);
      setIsStreaming(conversationId, true);
      bumpAgentTurns(conversationId, 1);

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
            ...(ctx.selectedNodeIds?.length ? { selectedNodeIds: ctx.selectedNodeIds } : {}),
            // Sidebar chat doesn't render follow-ups or provenance;
            // skip the server-side enrichment block to save tokens
            // and a stakgraph round-trip per turn.
            skipEnrichments: true,
            // The server `SharedConversation.id` (once autosave has
            // created the row). The approval handler needs it to stamp
            // `Feature.parentCanvasConversationId` on a newly-created
            // feature so the planner fan-out knows which conversation to
            // post its `source.kind === "planner"` messages back into
            // (that's what renders the `<SubAgentRunCard>`). Without it,
            // an approved feature is orphaned and never fans out.
            ...(conv.serverConversationId
              ? { conversationId: conv.serverConversationId }
              : {}),
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
            // Attachments: forwarded server-side so the LLM receives image parts.
            ...(attachments?.length ? { attachments } : {}),
            // Backend-driven persistence: the server writes this turn's
            // rows under `${turnId}-*` and returns the (possibly newly-
            // created) row id in `X-Conversation-Id`.
            turnId,
          }),
        });

        if (!response.ok) {
          // 413 (Vercel `FUNCTION_PAYLOAD_TOO_LARGE`): the request body —
          // the full transcript re-POSTed each turn — exceeded the 4.5MB
          // serverless cap. Surface an actionable message instead of the
          // generic "encountered an error", since retrying won't help.
          if (response.status === 413) {
            appendAssistantError(
              conversationId,
              "This conversation has grown too large to continue. Please start a new chat to keep going.",
            );
            return;
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        // The server is authoritative about which `SharedConversation`
        // row this turn actually persisted to, and hands it back here.
        // We always reconcile to it when it differs from what we hold:
        //   - First turn of a fresh chat → the row the server just created.
        //   - Joined `?chat=<id>` room → the same shared id (no change).
        //   - We tried to adopt an inaccessible `?chat=<id>` (deleted /
        //     wrong org) → the server forked a fresh owned row and we
        //     follow it, so the client never diverges from the DB.
        // Adopting it keeps live-sync subscribed to the right channel and
        // later turns/approvals referencing the same row.
        const serverConversationIdHeader =
          response.headers.get("X-Conversation-Id");
        if (
          serverConversationIdHeader &&
          serverConversationIdHeader !== conv.serverConversationId
        ) {
          setServerConversationId(conversationId, serverConversationIdHeader);
          // Reflect the live row in the URL (`?chat=<id>`) the moment it
          // exists, so a reload-for-any-reason re-preloads and RESUMES
          // this same conversation instead of forking a fresh one. Every
          // org-canvas row is a joinable room, so this URL is also the
          // share link — no separate Share step. Only do this for the
          // active conversation (a backgrounded send must not hijack the
          // URL). `history.replaceState` (NOT `router.replace`) to avoid
          // a Next navigation / RSC refetch on this `protected` route.
          const isActive =
            useCanvasChatStore.getState().activeConversationId ===
            conversationId;
          if (isActive && typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search);
            if (params.get("chat") !== serverConversationIdHeader) {
              params.set("chat", serverConversationIdHeader);
              window.history.replaceState(
                null,
                "",
                `${window.location.pathname}?${params.toString()}`,
              );
            }
          }
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

        // Fresh live prefix — never the persisted turnId. `replaceAssistantStream`
        // strips ids with this prefix only, so seeded `${turnId}-u` rows stay.
        const messageId = (Date.now() + 1).toString();
        const loggedToolCalls = new Set<string>();

        await processStream(response, messageId, (updatedMessage) => {
          if (firstChunk) {
            firstChunk = false;
            setIsLoading(conversationId, false);
            onResponseStart?.();
          }

          applyCanvasAssistantStream({
            conversationId,
            messageId,
            updatedMessage,
            approvalResult,
            loggedToolCalls,
            setRunActive,
            setActiveToolCalls,
            replaceAssistantStream,
          });
        });

        setActiveToolCalls(conversationId, []);
        // Stream finished cleanly — ensure runActive is cleared locally.
        setRunActive(conversationId, false);
      } catch (error) {
        console.error("Error calling ask API:", error);
        appendAssistantError(
          conversationId,
          "I'm sorry, but I encountered an error while processing your question. Please try again later.",
        );
      } finally {
        setIsLoading(conversationId, false);
        setIsStreaming(conversationId, false);
        bumpAgentTurns(conversationId, -1);
        // Always clear runActive on stream end/error (belt + suspenders with Pusher).
        setRunActive(conversationId, false);
      }
    },
    [processStream],
  );
}
