import {
  handleApproval,
  handleRejection,
  type MessageLike,
} from "@/lib/proposals/handleApproval";
import type { ApprovalIntent, RejectionIntent } from "@/lib/proposals/types";
import {
  appendTurnMessages,
  type StoredMessage,
} from "@/services/canvas-turn-persistence";

// ─── Agent-proposal: synthetic SSE stream for Approve / Reject ─────
//
// We don't call the LLM for these clicks — the side effect is fully
// determined by the conversation transcript + intent. We synthesize a
// tiny UI-message-stream-shaped response (text-start / text-delta /
// text-end) carrying the human-readable summary, plus a custom
// `X-Approval-Result` header carrying the structured outcome JSON.
// The chat send hook reads that header before processing the stream
// and stamps `approvalResult` onto the assistant message before
// autosave persists. Forks then see the resolved state in transcript
// because the message JSON includes the field.
//
// Extracted from `src/app/api/ask/quick/route.ts` — the caller is the
// trust boundary: it has already validated `orgId` membership and
// resolved `conversationId` (org-scoped) before delegating here.
export async function runProposalIntent(args: {
  orgId: string;
  userId: string;
  transcript: MessageLike[];
  approvalIntent?: ApprovalIntent;
  rejectionIntent?: RejectionIntent;
  /**
   * Pre-validated `SharedConversation.id` (validated via
   * `resolveOrgConversationRowId` in the caller). Forwarded into
   * `handleApproval` so feature approvals can stamp
   * `Feature.parentCanvasConversationId` for fan-out. Never
   * un-validated — the caller is the trust boundary.
   */
  conversationId?: string;
  /**
   * Backend-driven persistence id (org-canvas). When present alongside
   * `conversationId`, the click row + synthetic assistant row (carrying
   * `approvalResult`) are written server-side under `${turnId}-`, so the
   * proposal-card "approved" state survives a refresh without the client
   * autosave. Mirrors the LLM turn's persistence.
   */
  turnId?: string;
  /**
   * The approving user's `chatAgentModel` preference (e.g.
   * `"anthropic/claude-opus-4-6"`). Forwarded to `handleApproval` so
   * feature approvals persist it as `Feature.model`, ensuring subsequent
   * plan-chat messages use it via the existing
   * `feature.model || model || undefined` chain.
   */
  chatAgentModel?: string;
}): Promise<Response> {
  const {
    orgId,
    userId,
    transcript,
    approvalIntent,
    rejectionIntent,
    conversationId,
    turnId,
    chatAgentModel,
  } = args;

  let summaryText: string;
  let approvalResultHeader: string | null = null;
  let approvalResultObj: unknown = null;
  let alreadyApproved = false;

  if (approvalIntent) {
    const outcome = await handleApproval({
      orgId,
      userId,
      messages: transcript,
      intent: approvalIntent,
      ...(conversationId ? { conversationId } : {}),
      ...(chatAgentModel ? { chatAgentModel } : {}),
    });
    if (!outcome.ok) {
      // Surface validation errors as the assistant text. The card UI
      // distinguishes "approval failed" from "approved" by checking
      // for `approvalResult` on the message; without it, the card
      // stays in pending-in-flight + shows the assistant text as the
      // failure reason. The HTTP status stays 200 so the SSE stream
      // still flushes cleanly.
      summaryText = `I couldn't create that: ${outcome.error}`;
    } else {
      const r = outcome.result;
      alreadyApproved = outcome.alreadyApproved;
      approvalResultHeader = JSON.stringify(r);
      approvalResultObj = r;
      // Prefer the resolved entity name ("Auth Refactor") over the
      // generic kind label ("an initiative canvas") so the user knows
      // exactly which workspace / initiative the new row landed
      // under. Falls back to the kind label when the lookup didn't
      // resolve (root canvas, deleted entity, older transcript). The
      // `milestone:` branch is a defensive fallback for pre-cutover
      // proposal trails — milestones aren't drillable scopes today,
      // so new approvals never produce that ref.
      const kindLabel =
        r.landedOn === ""
          ? "the org root canvas"
          : r.landedOn.startsWith("ws:")
            ? "a workspace canvas"
            : r.landedOn.startsWith("initiative:")
              ? "an initiative canvas"
              : r.landedOn.startsWith("milestone:")
                ? "an initiative canvas"
                : "the canvas";
      const where = r.landedOnName
        ? `**${r.landedOnName}**`
        : kindLabel;
      summaryText = alreadyApproved
        ? `Already created — opening the existing ${r.kind} on ${where}.`
        : r.kind === "initiative"
          ? `Created the initiative on ${where}.`
          : r.kind === "milestone"
            ? `Created the milestone on ${where}.`
            : `Created the feature on ${where}.`;
    }
  } else if (rejectionIntent) {
    const outcome = handleRejection({
      messages: transcript,
      intent: rejectionIntent,
    });
    summaryText = outcome.ok
      ? "Got it — I won't create that."
      : `Couldn't reject: ${outcome.error}`;
  } else {
    // Defensive — shouldn't happen given the caller guard.
    summaryText = "No proposal intent provided.";
  }

  // Persist the click + synthetic assistant row server-side (org-canvas
  // backend-driven turns). Single locked write under the `${turnId}-`
  // prefix (idempotent) so a re-click never double-appends. The client
  // filters its own `${turnId}-*` rows out of the live-sync merge.
  if (conversationId && turnId) {
    const lastUser = [...transcript]
      .reverse()
      .find((m) => m.role === "user") as
      | { content?: unknown; approval?: unknown; rejection?: unknown }
      | undefined;
    const clickRow: StoredMessage = {
      id: `${turnId}-u`,
      role: "user",
      content:
        typeof lastUser?.content === "string" ? lastUser.content : "",
      timestamp: new Date().toISOString(),
      ...(approvalIntent ? { approval: approvalIntent } : {}),
      ...(rejectionIntent ? { rejection: rejectionIntent } : {}),
    };
    const resultRow: StoredMessage = {
      id: `${turnId}-a0`,
      role: "assistant",
      content: summaryText,
      timestamp: new Date().toISOString(),
      ...(approvalResultObj ? { approvalResult: approvalResultObj } : {}),
    };
    await appendTurnMessages({
      conversationId,
      rows: [clickRow, resultRow],
      idPrefix: `${turnId}-`,
      reason: "user-turn",
    }).catch((err) =>
      console.error("❌ [quick-ask] Proposal persist failed:", err),
    );
  }

  // Build a minimal SSE stream of UIMessageChunk parts.
  const encoder = new TextEncoder();
  const partsTextId = `proposal-result-${Date.now().toString(36)}`;
  const parts: Array<Record<string, unknown>> = [
    { type: "start" },
    { type: "start-step" },
    { type: "text-start", id: partsTextId },
    { type: "text-delta", id: partsTextId, delta: summaryText },
    { type: "text-end", id: partsTextId },
    { type: "finish-step" },
    { type: "finish" },
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "x-vercel-ai-ui-message-stream": "v1",
  };
  if (approvalResultHeader) {
    headers["X-Approval-Result"] = approvalResultHeader;
    // Browsers expose only safelisted response headers to fetch
    // unless the server opts in via Access-Control-Expose-Headers.
    // The chat is same-origin so this isn't strictly required, but
    // setting it makes the contract explicit and safe under any
    // future origin-split.
    headers["Access-Control-Expose-Headers"] = "X-Approval-Result";
  }

  return new Response(stream, { headers });
}
