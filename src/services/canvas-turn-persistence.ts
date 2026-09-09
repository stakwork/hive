/**
 * Shared server-side persistence for canvas-chat agent turns.
 *
 * Extracted from `canvas-agent-autoturn.ts` so BOTH the autonomous
 * planner-woken turn AND the user-driven `/api/ask/quick` turn write
 * through one code path. The contract is identical for both:
 *
 *   - Reconstruct `CanvasChatMessage`-shaped rows from a finished
 *     `streamText` run's `steps` (`messagesFromSteps`).
 *   - Append them to `SharedConversation.messages` under a
 *     `SELECT … FOR UPDATE` row lock so the write serializes against the
 *     other writers on that row (the planner fan-out, the conversations
 *     PUT route), and is idempotent on a caller-chosen id prefix so a
 *     retried `after()` / re-delivered webhook never double-appends.
 *   - Fire a `CANVAS_CONVERSATION_UPDATED` Pusher nudge on a fresh
 *     append so open browsers live-sync the new rows in.
 *
 * The id prefix is the dedup key. Callers pick a prefix unique to the
 * turn: the user-driven path uses `${turnId}-a` (assistant rows) and
 * `${turnId}-u` (the user row); the auto-turn path uses
 * `autoturn-${plannerMessageId}-`. The org-canvas client filters server
 * rows by `${turnId}-` prefix in its live-sync merge so the authoring
 * tab never double-renders its own optimistic stream.
 */

import { db } from "@/lib/db";
import {
  notifyCanvasConversationUpdated,
  type CanvasConversationUpdateReason,
} from "@/lib/pusher";

// ───────────────────────────────────────────────────────────────────
// Stored-message types (the `CanvasChatMessage` JSON shape inside
// `SharedConversation.messages`). Kept loose — the column is `Json`
// and the canonical render-side type lives in `canvasChatStore.ts`.
// ───────────────────────────────────────────────────────────────────

export interface StoredToolCall {
  id: string;
  toolName: string;
  input?: unknown;
  status?: string;
  output?: unknown;
  errorText?: string;
}

/**
 * A user-uploaded file attached to a message (image/doc). Mirrors the
 * render-side `CanvasAttachment` shape (`canvasChatStore.ts`): `path` is the
 * S3 key the client turns into a presigned download URL. Persisted in the
 * `SharedConversation.messages` JSON so attachments survive reload.
 */
export interface StoredAttachment {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
}

/**
 * Normalize the top-level `attachments` a client forwards on a turn into
 * the stored `StoredAttachment[]` shape, so the image survives reload.
 * Defensive: tolerates any input and drops anything that isn't an object
 * with all four required fields of the right types. Shared by the
 * streaming (`/api/ask/quick`) and synchronous (`/api/ask/sync`) routes
 * so the two stay in lockstep on the persisted shape.
 */
export function normalizeStoredAttachments(input: unknown): StoredAttachment[] {
  if (!Array.isArray(input)) return [];
  return (input as unknown[]).flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const r = a as Record<string, unknown>;
    if (
      typeof r.path !== "string" ||
      typeof r.filename !== "string" ||
      typeof r.mimeType !== "string" ||
      typeof r.size !== "number"
    ) {
      return [];
    }
    return [
      {
        path: r.path,
        filename: r.filename,
        mimeType: r.mimeType,
        size: r.size,
      },
    ];
  });
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  toolCalls?: StoredToolCall[];
  attachments?: StoredAttachment[];
  source?: { kind: string; featureId?: string; plannerMessageId?: string };
  // Approval-flow metadata round-tripping through the JSON. Untyped here
  // (the canonical types live in `src/lib/proposals/types.ts`); the
  // render-side store re-narrows them.
  approval?: unknown;
  rejection?: unknown;
  approvalResult?: unknown;
  /**
   * Populated when this assistant message confirmed a `schedule_check`
   * tool call. Mirrors `CanvasChatMessage.deferredCheck` in the store.
   */
  deferredCheck?: {
    id: string;
    description: string;
    fireAt: string;
    status: "PENDING" | "FIRED" | "CANCELLED" | "FAILED";
  };
}

type StepLike = {
  text?: string;
  toolCalls?: Array<{ toolCallId: string; toolName: string; input?: unknown }>;
  toolResults?: Array<{ toolCallId: string; output?: unknown; result?: unknown }>;
  /**
   * Mirrors `LanguageModelResponseMetadata.timestamp` from the AI SDK.
   * Kept optional and as `Date | string` so plain test fixtures without
   * a `response` field continue to type-check, and the `string` branch
   * is handled by the defensive parsing in `messagesFromSteps`.
   */
  response?: { timestamp?: Date | string };
};

const NO_STRIP: ReadonlySet<string> = new Set();

/**
 * Tools whose input and/or output can carry a raw HTML page body.
 * `get_html`'s OUTPUT is the page (its input is just `{ slug }`, which
 * needs no redaction); `save_html`/`update_html`'s INPUT can carry the
 * page (`html`, and now `edits[].oldStr`/`newStr` fragments), while
 * their output is just pointer metadata. Both redactors below no-op on
 * a tool name outside this set, so adding `get_html` here is what makes
 * its output redaction (and `HTML_BODY_FIELDS`) apply to it at all.
 */
const HTML_BODY_TOOLS = new Set(["save_html", "update_html", "get_html"]);

/** Field names, on either input or output, that may hold a raw HTML body. */
const HTML_BODY_FIELDS = ["html", "body"] as const;

function redactStringField(bytes: number): { redacted: true; bytes: number } {
  return { redacted: true, bytes };
}

/** Redact a single `edits[]` entry's `oldStr`/`newStr` — both are verbatim fragments of the stored page. */
function redactEditEntry(entry: unknown): unknown {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  const record = entry as Record<string, unknown>;
  const next: Record<string, unknown> = { ...record };
  for (const field of ["oldStr", "newStr"] as const) {
    const value = next[field];
    if (typeof value === "string") {
      next[field] = redactStringField(Buffer.byteLength(value, "utf8"));
    }
  }
  return next;
}

/**
 * Strip HTML bodies from persisted tool-call input. SharedConversation
 * messages must not store the page — only a redaction marker + byte length.
 *
 * Covers two shapes for `save_html`/`update_html`/`get_html`:
 *   - top-level `html`/`body` string fields (full-replace `update_html`,
 *     `save_html`);
 *   - an `edits[]` array (`update_html`'s targeted-edit mode) — each
 *     entry's `oldStr`/`newStr` is a verbatim fragment of the stored
 *     page and must be redacted the same way the whole-body fields are.
 */
export function redactHtmlToolInput(toolName: string, input: unknown): unknown {
  if (!HTML_BODY_TOOLS.has(toolName)) return input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  const next: Record<string, unknown> = { ...record };
  for (const field of HTML_BODY_FIELDS) {
    if (!(field in next)) continue;
    const value = next[field];
    const bytes =
      typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
    next[field] = redactStringField(bytes);
  }
  if (Array.isArray(next.edits)) {
    next.edits = next.edits.map(redactEditEntry);
  }
  return next;
}

/**
 * Strip HTML bodies from persisted tool-call OUTPUT. Symmetric to
 * `redactHtmlToolInput` — `get_html`'s return value IS the page
 * (`{ slug, html, size }`), so the moment that tool exists, leaving
 * `output` unredacted in `messagesFromSteps` would violate the
 * S3-pointer-only guarantee just as surely as an unredacted input would.
 * Keyed on the same `HTML_BODY_FIELDS` list as the input redactor.
 */
export function redactHtmlToolOutput(toolName: string, output: unknown): unknown {
  if (!HTML_BODY_TOOLS.has(toolName)) return output;
  if (!output || typeof output !== "object" || Array.isArray(output)) return output;
  const record = output as Record<string, unknown>;
  const next: Record<string, unknown> = { ...record };
  for (const field of HTML_BODY_FIELDS) {
    if (!(field in next)) continue;
    const value = next[field];
    const bytes =
      typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
    next[field] = redactStringField(bytes);
  }
  return next;
}

/**
 * Reconstruct the agent's output as `CanvasChatMessage`-shaped rows from
 * the finished stream's `steps`. Mirrors the client-side timeline split
 * in `useSendCanvasChatMessage.ts`: text becomes a text message, tool
 * calls become a tool-call message (so `SubAgentRunCard` can extract
 * `send_to_feature_planner` calls as outbound thread entries).
 *
 * Row ids are `${idPrefix}${n}` (n = 0,1,2,…), so `idPrefix` doubles as
 * the idempotency key for `appendTurnMessages`.
 *
 * `stripToolNames` removes control-signal tool calls that aren't real
 * transcript entries (the auto-turn's `stay_silent`). A turn that did
 * nothing but a stripped tool produces an empty array, and the caller
 * appends nothing.
 */
export function messagesFromSteps(
  steps: StepLike[],
  idPrefix: string,
  stripToolNames: ReadonlySet<string> = NO_STRIP,
): StoredMessage[] {
  const rows: StoredMessage[] = [];
  let idx = 0;
  const nextId = () => `${idPrefix}${idx++}`;
  // `now` is used only as the initial fallback for the first step in a turn
  // that lacks its own response.timestamp.
  const now = new Date().toISOString();
  // Forward-fill: tracks the most recent valid timestamp seen in this turn so
  // that steps without their own timestamp stay in chronological order.
  let lastTimestamp = now;

  for (const step of steps) {
    // Derive per-step timestamp from response.timestamp (the moment the model's
    // response for this step arrived).  Note: this reflects model-response
    // completion, not necessarily when a tool call *inside* the step finished
    // executing — per-tool-call timing is out of scope here.
    let stepTimestamp = lastTimestamp;
    try {
      const raw = step.response?.timestamp;
      if (raw !== undefined && raw !== null) {
        const parsed = new Date(raw as string | number | Date);
        if (!isNaN(parsed.getTime())) {
          stepTimestamp = parsed.toISOString();
          lastTimestamp = stepTimestamp;
        }
      }
    } catch {
      // A malformed response.timestamp must never abort the whole turn's
      // persistence — degrade silently to lastTimestamp.
    }

    // Extract any schedule_check result from this step so it can be
    // attached to the text row as `deferredCheck` metadata.
    const deferredCheck = extractDeferredCheckFromStep(step);

    // Strip the "[END_OF_ANSWER]" turn-end marker before persisting —
    // providers that don't enforce `stopSequences` server-side (e.g. some
    // OpenRouter-hosted models) leak it into the step text, and stored
    // rows feed shared conversations and reloads.
    const stepText = step.text?.replace(/\[END_OF_ANSWER\]/g, "").trim();
    if (stepText) {
      const textRow: StoredMessage = {
        id: nextId(),
        role: "assistant",
        content: stepText,
        timestamp: stepTimestamp,
      };
      if (deferredCheck) {
        textRow.deferredCheck = deferredCheck;
      }
      rows.push(textRow);
    }

    const calls = step.toolCalls ?? [];
    if (calls.length === 0) continue;

    const resultByCallId = new Map(
      (step.toolResults ?? []).map((r) => [r.toolCallId, r] as const),
    );

    const toolCalls: StoredToolCall[] = calls
      .filter((tc) => !stripToolNames.has(tc.toolName))
      .map((tc) => {
        const r = resultByCallId.get(tc.toolCallId);
        const rawOutput = r ? (r.output ?? r.result) : undefined;
        const output = redactHtmlToolOutput(tc.toolName, rawOutput);
        const isError =
          !!output &&
          typeof output === "object" &&
          "error" in (output as Record<string, unknown>);
        return {
          id: tc.toolCallId,
          toolName: tc.toolName,
          input: redactHtmlToolInput(tc.toolName, tc.input),
          output,
          status:
            output === undefined
              ? "input-available"
              : isError
                ? "output-error"
                : "output-available",
          ...(isError ? { errorText: "Tool call failed" } : {}),
        };
      });

    if (toolCalls.length > 0) {
      // Both the text row and tool-call row from the same step share the same
      // stepTimestamp — the AI SDK exposes timing at step granularity only.
      const toolRow: StoredMessage = {
        id: nextId(),
        role: "assistant",
        content: "",
        timestamp: stepTimestamp,
        toolCalls,
      };
      // If there was no text in this step, attach deferredCheck to the
      // tool-call row instead so the card is always anchored somewhere.
      if (deferredCheck && rows[rows.length - 1]?.deferredCheck == null) {
        toolRow.deferredCheck = deferredCheck;
      }
      rows.push(toolRow);
    }
  }

  return rows;
}

/**
 * Scan a single step for a completed `schedule_check` tool result and
 * return the parsed `deferredCheck` metadata, or `undefined` if none.
 */
function extractDeferredCheckFromStep(
  step: StepLike,
): StoredMessage["deferredCheck"] | undefined {
  const calls = step.toolCalls ?? [];
  const results = step.toolResults ?? [];

  const scheduleCall = calls.find((tc) => tc.toolName === "schedule_check");
  if (!scheduleCall) return undefined;

  const result = results.find((r) => r.toolCallId === scheduleCall.toolCallId);
  if (!result) return undefined;

  const output = (result.output ?? result.result) as Record<string, unknown> | undefined;
  if (
    !output ||
    typeof output !== "object" ||
    typeof output.deferredActionId !== "string" ||
    typeof output.fireAt !== "string" ||
    typeof output.description !== "string"
  ) {
    return undefined;
  }

  return {
    id: output.deferredActionId,
    description: output.description,
    fireAt: output.fireAt,
    status: "PENDING",
  };
}

/**
 * Fetch stored messages from a SharedConversation row owned by the given user.
 * Implements IDOR guard: the userId predicate ensures callers can only read
 * their own conversation. Returns null when not found or access denied.
 */
export async function fetchStoredConversationMessages(args: {
  conversationId: string;
  userId: string;
  workspaceSlug: string;
}): Promise<StoredMessage[] | null> {
  const { conversationId, userId, workspaceSlug } = args;
  const row = await db.sharedConversation.findFirst({
    where: {
      id: conversationId,
      userId,
      workspace: { slug: workspaceSlug, deleted: false },
    },
    select: { messages: true },
  });
  if (!row) return null;
  return Array.isArray(row.messages) ? (row.messages as unknown as StoredMessage[]) : [];
}

/**
 * Append rows into a canvas conversation under the same row-level lock
 * the fan-out worker and the autosave PUT use, so all writers serialize
 * on the conversation row. Idempotent on the `idPrefix`: if any existing
 * row id already starts with it, this is a no-op (a retried `after()`,
 * a re-delivered webhook). Returns whether THIS call appended.
 *
 * Fires a `CANVAS_CONVERSATION_UPDATED` nudge only on a fresh append, so
 * open browsers live-sync the new rows in. Never throws on the Pusher
 * side (the helper swallows that); the DB write is the contract.
 */
export async function appendTurnMessages(args: {
  conversationId: string;
  rows: StoredMessage[];
  idPrefix: string;
  reason: CanvasConversationUpdateReason;
}): Promise<boolean> {
  const { conversationId, rows, idPrefix, reason } = args;
  if (rows.length === 0) return false;

  let didAppend = false;
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ messages: unknown }[]>`
      SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
    `;
    if (locked.length === 0) return; // conversation deleted mid-turn

    const existing = Array.isArray(locked[0].messages)
      ? (locked[0].messages as StoredMessage[])
      : [];

    const alreadyAppended = existing.some(
      (m) => typeof m.id === "string" && m.id.startsWith(idPrefix),
    );
    if (alreadyAppended) return;

    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: {
        messages: [...existing, ...rows] as unknown as never,
        lastMessageAt: new Date(),
      },
    });
    didAppend = true;
  });

  if (didAppend) notifyCanvasConversationUpdated(conversationId, reason);
  return didAppend;
}

/**
 * Patch a stored `approvalResult` row IN PLACE (same row id) — the
 * code-change webhook / reconcile path: the approval turn was persisted
 * with `codeChange.prPending: true`, and the terminal PR outcome arrives
 * minutes later on a different request entirely.
 *
 * Locates the assistant row whose `approvalResult.proposalId` matches
 * (regardless of which writer persisted it — the server-side
 * `${turnId}-a0` row or a client autosave copy) under the same
 * `SELECT … FOR UPDATE` row lock every other conversation writer uses,
 * replaces its `approvalResult.codeChange` with the given value, and
 * optionally rewrites the row's visible `content` text.
 *
 * Idempotent by construction: re-applying the same terminal patch
 * produces an identical row. Returns whether a row was actually changed;
 * fires a `code-change-pr-update` nudge only then, so open browsers
 * reconcile the row and flip the proposal card.
 */
export async function patchStoredCodeChangeResult(args: {
  conversationId: string;
  proposalId: string;
  codeChange: Record<string, unknown>;
  /** Replacement for the row's visible assistant text (omit to keep). */
  content?: string;
}): Promise<boolean> {
  const { conversationId, proposalId, codeChange, content } = args;

  let didChange = false;
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ messages: unknown }[]>`
      SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
    `;
    if (locked.length === 0) return; // conversation deleted

    const existing = Array.isArray(locked[0].messages)
      ? (locked[0].messages as StoredMessage[])
      : [];

    const next = existing.map((m) => {
      if (m.role !== "assistant") return m;
      const ar = m.approvalResult as
        | { proposalId?: string; codeChange?: unknown }
        | undefined;
      if (!ar || ar.proposalId !== proposalId) return m;
      const patched: StoredMessage = {
        ...m,
        approvalResult: { ...ar, codeChange },
        ...(content !== undefined ? { content } : {}),
      };
      if (JSON.stringify(patched) !== JSON.stringify(m)) didChange = true;
      return patched;
    });

    if (!didChange) return;

    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: { messages: next as unknown as never },
    });
  });

  if (didChange) {
    notifyCanvasConversationUpdated(conversationId, "code-change-pr-update");
  }
  return didChange;
}
