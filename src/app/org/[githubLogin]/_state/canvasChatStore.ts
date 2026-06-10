/**
 * Canvas chat store — the source of truth for the org-canvas
 * sidebar chat and (eventually) every feature that has to flow
 * between the chat and the canvas itself.
 *
 * Why a store, and why scoped to the org canvas page:
 *
 * - Several features in the pipeline create bidirectional
 *   communication between the chat and the canvas: LLM-generated
 *   `propose-canvas-change` artifacts that render *both* as a card
 *   in the chat scroll *and* as a halo/badge on the affected canvas
 *   node; sub-agents kicked off from the chat that need to surface
 *   on the nodes they're working on; rich artifacts (task-status,
 *   pr-list, deep-research) that are attached to messages but read
 *   from elsewhere. Two `useState` islands talking via prop drilling
 *   would be miserable; a shared store lets each consumer subscribe
 *   to exactly the slice it cares about.
 * - Tab switches in `OrgRightPanel` unmount the chat tab body. With
 *   chat state in component-local `useState`, switching to Details
 *   and back wipes the conversation. Lifting messages to the store
 *   makes the unmount cheap and idempotent.
 * - Org-canvas-scoped (in `_state/`, not `src/stores/`) because
 *   proposals/canvas badges/sub-agents on canvas nodes are
 *   meaningless on a workspace dashboard. The dashboard chat is
 *   diverging from the canvas chat on purpose; co-locating the
 *   store with the canvas page reinforces that.
 *
 * Performance contract:
 *
 * - **Always select.** Never call `useCanvasChatStore()` without a
 *   selector — that subscribes to the whole store and re-renders on
 *   every text-delta during streaming (~50/sec). Use
 *   `useCanvasChatStore((s) => s.x)` instead.
 * - **Use `useShallow` for derived collections.** A selector that
 *   returns a fresh array/object on every call (e.g. `Array.from(
 *   s.conversations.values())`) defeats Zustand's `Object.is`
 *   bail-out. Wrap with `useShallow` from `zustand/react/shallow`.
 * - **Keep streaming writes inside one `set()` call per chunk.**
 *   The streaming reducer in `sendMessage` builds the whole next
 *   timeline locally and commits it once; consumers selecting only
 *   `proposals` or `artifacts` get zero re-renders during streaming.
 * - **Don't watch the whole conversation.** `SidebarChat` selects
 *   `messages` / `isLoading` / `activeToolCalls` separately, not
 *   the conversation object — keeps re-renders tight.
 *
 * What's intentionally NOT in this store:
 *
 * - **Voice transcript / mic state** — separate concern, separate
 *   lifetime (mic-session-scoped, can be available across surfaces).
 *   Lives in `src/stores/useVoiceStore.ts`. When voice transcription
 *   wants to drop a finalized transcript into the chat, it calls
 *   `useCanvasChatStore.getState().appendUserMessage(...)`.
 * - **The dashboard chat's state.** `DashboardChat` keeps its own
 *   local state on purpose; we explicitly don't merge surfaces.
 */
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { ModelMessage } from "ai";
import type {
  ApprovalIntent,
  ApprovalResult,
  RejectionIntent,
} from "@/lib/proposals/types";
import type { ClarifyingQuestion } from "@/types/stakwork";
import type { StreamTimelineItem } from "@/types/streaming";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  toolName: string;
  input?: unknown;
  status: string;
  output?: unknown;
  errorText?: string;
}

/**
 * Marks a `CanvasChatMessage` row whose origin is NOT the canvas
 * conversation itself. The fan-out worker
 * (`src/services/canvas-planner-fanout.ts`) writes inbound rows
 * carrying `kind: "planner"`; Phase 4's planner-form answer endpoint
 * writes outbound rows carrying `kind: "user-answered-planner-form"`.
 *
 * Render-side filters key on `source.kind` directly — see
 * `SidebarChat.tsx` (early-return) and `SubAgentRunCard.tsx`
 * (inbound thread entries). Round-trips through
 * `SharedConversation.messages` JSON for free.
 *
 * Discriminated union (rather than a flat marker) so Phase 4 can
 * land its variant without breaking Phase 2 consumers.
 */
export type CanvasMessageSource =
  | {
      kind: "planner";
      featureId: string;
      plannerMessageId: string;
      /**
       * Feature display metadata at fan-out time, so an inbound-only run
       * (the approval flow, where the canvas agent never made an outbound
       * `send_to_feature_planner` call) can render the real feature name /
       * workspace + a working "Open plan" link instead of "Unknown
       * feature". All optional — rows written before this landed (and any
       * future caller that omits them) fall back to the placeholder.
       */
      featureTitle?: string;
      workspaceSlug?: string;
      workspaceName?: string;
      /**
       * The feature's `workflowStatus` at the moment the planner posted
       * (Phase 3). Lets `SubAgentRunCard` show a meaningful status pill
       * — `Running` (IN_PROGRESS), `Plan ready` (COMPLETED), `Failed`
       * (FAILED/ERROR/HALTED) — without a re-read. Optional: rows
       * written before Phase 3 (and any non-planner source) won't carry
       * it, and the card falls back to its direction-based headline.
       */
      workflowStatus?: string;
      /**
       * `true` when the planner message carried a clarifying-questions
       * artifact (`PLAN` + `ask_clarifying_questions`) — its explicit
       * "a human must pick" signal (Phase 3). Drives the `Waiting for
       * you` pill and surfaces the FORM via `PlannerFormSlot`.
       */
      hasForm?: boolean;
      /**
       * The planner's clarifying-question list (Phase 4), embedded so
       * `PlannerFormSlot` can render `ClarifyingQuestionsPreview`
       * verbatim with no extra fetch. Present iff `hasForm` is `true`.
       */
      formQuestions?: ClarifyingQuestion[];
      /**
       * `true` when the planner just generated a task breakdown (a
       * `TASKS` artifact). Gates the card's **Start Tasks** button,
       * which reads the live ready-count from the feature itself.
       */
      hasTasks?: boolean;
    }
  // Added in Phase 4 — kept in the union now to make exhaustive
  // checks in switch statements complete from Phase 2 onward.
  | { kind: "user-answered-planner-form"; featureId: string; plannerMessageId: string };

export interface CanvasChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  /**
   * Interleaved render timeline (text / reasoning / tool-call items) for
   * an assistant turn, in the AI-SDK `StreamToolCall` shape — i.e. richer
   * than `toolCalls` (carries `inputText` + the typed `ToolCallStatus`).
   * `SidebarChat` renders this via `<StreamingMessage>` so tool calls show
   * as expandable cards with names / args / outputs, in order with text.
   *
   * Populated by `useSendCanvasChatMessage` for streamed tool-call rows
   * and round-trips through `SharedConversation.messages` JSON (so reload,
   * share, and live-sync all keep the rich rendering). `toolCalls` stays
   * the source of truth for the model context (`toModelMessages`) and the
   * sub-agent projection (`getSubAgentRunsFromMessages`); `timeline` is the
   * display layer only.
   */
  timeline?: StreamTimelineItem[];
  /**
   * Forward-compat: ids referencing entries in `state.artifacts`.
   * Empty in PR 1; populated when the first artifact type ships.
   */
  artifactIds?: string[];

  // ── Agent-proposal lifecycle (see `src/lib/proposals/types.ts`) ──
  // The chat is the source of truth for proposal status. These fields
  // ride along on user/assistant messages, round-trip through
  // `SharedConversation.messages` JSON for free, and let the proposal
  // card derive status by scanning the conversation. No DB writes
  // happen for any of these — they're just chat metadata.
  /** User clicked Approve on a proposal. Set on user messages only. */
  approval?: ApprovalIntent;
  /** User clicked Reject on a proposal. Set on user messages only. */
  rejection?: RejectionIntent;
  /**
   * Synthetic assistant message describing an approval outcome. Set by
   * `/api/ask/quick` after `handleApproval` creates the DB row; carries
   * the new entity id and the canvas ref it landed on.
   */
  approvalResult?: ApprovalResult;
  /**
   * Provenance marker for rows that didn't originate in the canvas
   * conversation (planner fan-out, planner-form answers).
   * See `CanvasMessageSource`.
   */
  source?: CanvasMessageSource;
}

export interface CanvasConversation {
  id: string;
  /** Server-side `SharedConversation.id`, if auto-save has created one. */
  serverConversationId: string | null;
  /**
   * Provenance: the `?chat=<shareId>` this conversation originated
   * from, if any. Informational only — by default we *join* that
   * shared row (see `serverConversationId`), so this is not a fork
   * marker today; it's retained for telemetry and a future explicit
   * "Fork" action that would set this without adopting the server row.
   */
  forkedFromShareId: string | null;
  messages: CanvasChatMessage[];
  isLoading: boolean;
  /**
   * `true` for the full lifetime of a streaming response — from the
   * initial fetch until the stream's `finally` block. Unlike
   * `isLoading` (which flips to `false` on the first chunk for UX),
   * `isStreaming` stays `true` until tool call outputs have fully
   * arrived. Auto-save gates on this flag so it never persists
   * partial tool call data.
   */
  isStreaming: boolean;
  activeToolCalls: ToolCall[];
  /** Hint context used when building `/api/ask/quick` requests. */
  context: ConversationContext;
}

export interface ConversationContext {
  workspaceSlug: string | null;
  workspaceSlugs: string[];
  orgId: string;
  githubLogin: string;
  currentCanvasRef: string;
  currentCanvasBreadcrumb: string;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
}

// ─── Reserved slots for canvas-bound features (filled in later PRs) ─────────
// These are declared now so canvas selectors can subscribe to them today
// (returning empty maps), and so we don't reshape the store when artifacts
// land. Each is its own slice; consumers select narrowly.

/** A LLM-proposed canvas change awaiting Approve/Reject. */
export interface CanvasProposal {
  id: string;
  conversationId: string;
  messageId: string;
  /** Affected canvas node id (e.g. `"initiative:abc"`). Used by canvas badges. */
  nodeId: string | null;
  status: "pending" | "approved" | "rejected" | "applied";
  /** Patch payload to send to `update_canvas` on approve. */
  patch: unknown;
  rationale: string;
}

/** A long-running agent run forked from chat (deep research, etc.). */
export interface SubAgentRun {
  id: string;
  conversationId: string;
  messageId: string;
  /** `StakworkRun` id when the underlying job is a Stakwork run. */
  stakworkRunId: string | null;
  status: "running" | "ready" | "failed" | "cancelled";
  prompt: string;
  result?: unknown;
}

/** Generic artifact registry. Keyed by artifact id. */
export interface CanvasArtifact {
  id: string;
  type: string;
  conversationId: string;
  messageId: string;
  data: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store shape
// ─────────────────────────────────────────────────────────────────────────────

interface CanvasChatState {
  // ─── Conversations ───────────────────────────────────────────────────
  conversations: Record<string, CanvasConversation>;
  activeConversationId: string | null;
  /**
   * Per-conversation count of seed messages that should NOT be
   * persisted by `useCanvasChatAutoSave`. Used by the synthetic
   * "top items needing your attention" intro: the seed message is
   * regenerated from live DB state on each fresh page entry, so
   * persisting it would create stale rows and leak the original
   * viewer's intro through `?chat=<shareId>` shares.
   *
   * Auto-save reads this on conversation start: when set, it primes
   * its `savedCountRef` to this value so the first PUT/POST only
   * sends messages added after the seed.
   */
  ephemeralSeedCounts: Record<string, number>;

  /**
   * One-shot text the chat input should adopt the next time it
   * renders. `null` means "no draft pending"; non-null means "set
   * the textarea to this string, focus it, then clear this slot."
   *
   * This is the channel used by canvas affordances that want to
   * compose a message *for* the user — e.g. clicking the `+` button
   * in the Connections-tab edge-link mode prefills the input with
   * `Make a connection document between A and B` and switches to
   * the Chat tab. The user can edit before sending.
   *
   * Lives at the store level (not local input state) so any caller
   * can write to it without imperative refs into `<SidebarChat />`.
   * The input owns the consumption — `<SidebarChatInput />` watches
   * for non-null values and applies + clears them in an effect.
   */
  pendingInputDraft: string | null;

  // ─── Reserved slots (empty in PR 1; canvas may already select these) ─
  proposals: Record<string, CanvasProposal>;
  subAgentRuns: Record<string, SubAgentRun>;
  artifacts: Record<string, CanvasArtifact>;
  /**
   * Artifacts the user has dismissed for this session. Renderers
   * (e.g. `MessageArtifacts` in `SidebarChat`) skip ids in this set.
   * Lives in-memory only; outer code is responsible for persisting
   * decisions across page loads (e.g. via `sessionStorage`) when
   * relevant.
   */
  dismissedArtifactIds: Record<string, true>;

  // ─── Conversation actions ────────────────────────────────────────────
  /**
   * Create + activate a fresh conversation. Returns its id.
   *
   * `ephemeralSeedCount` (default = 0) tells `useCanvasChatAutoSave`
   * how many leading seed messages to skip when computing the first
   * autosave delta. Set this to `seedMessages.length` for synthetic
   * messages that must not round-trip through `chat_conversations`.
   *
   * `serverConversationId` (default = null) adopts an existing
   * `shared_conversations` row as this conversation's server row, so
   * new turns PUT-append to it instead of POSTing a fresh row. This
   * is the "share = drop in and continue the same conversation" path:
   * landing on `?chat=<shareId>` passes the shared row's id here. Omit
   * it to fork (start a brand-new row from the seed) — kept reachable
   * for a future explicit "Fork" action.
   */
  startConversation: (
    context: ConversationContext,
    seedMessages?: CanvasChatMessage[],
    forkedFromShareId?: string,
    ephemeralSeedCount?: number,
    serverConversationId?: string,
  ) => string;
  setActiveConversation: (conversationId: string | null) => void;
  /** Update the context of the active conversation (canvas-scope changes). */
  updateActiveContext: (patch: Partial<ConversationContext>) => void;
  /** Wipe the active conversation's messages but keep the conversation row. */
  clearActiveConversation: () => void;
  /** Drop the active conversation and start fresh. */
  resetActiveConversation: () => void;
  /** Record the server-assigned `SharedConversation` id (auto-save creation). */
  setServerConversationId: (
    conversationId: string,
    serverId: string,
  ) => void;

  // ─── Message actions ─────────────────────────────────────────────────
  appendUserMessage: (
    conversationId: string,
    message: CanvasChatMessage,
  ) => void;
  /**
   * Replace a conversation's entire message list with the authoritative
   * server copy. Used by the live-sync (`useCanvasChatAutoSave` Pusher
   * nudge → refetch) to bring in server-appended rows (planner fan-out,
   * autonomous canvas-agent turns, planner-form answers). Callers MUST
   * only invoke this when the conversation has no unsaved local messages,
   * so the server copy is a strict superset and nothing local is lost.
   */
  setConversationMessages: (
    conversationId: string,
    messages: CanvasChatMessage[],
  ) => void;
  /** Replace any messages whose id starts with `prefix` with `next`. */
  replaceAssistantStream: (
    conversationId: string,
    prefix: string,
    next: CanvasChatMessage[],
  ) => void;
  setActiveToolCalls: (
    conversationId: string,
    toolCalls: ToolCall[],
  ) => void;
  setIsLoading: (conversationId: string, isLoading: boolean) => void;
  /** Mirror of `setIsLoading` but for the streaming gate. See `CanvasConversation.isStreaming`. */
  setIsStreaming: (conversationId: string, streaming: boolean) => void;
  /** Append a synthetic assistant error message to a conversation. */
  appendAssistantError: (
    conversationId: string,
    content: string,
  ) => void;

  /**
   * Queue text for the chat input to adopt on its next render. Pass
   * `null` to clear without applying (the input clears its own draft
   * after consumption — callers usually shouldn't need to clear).
   */
  setPendingInputDraft: (draft: string | null) => void;

  // ─── Artifact actions ────────────────────────────────────────────────
  /**
   * Register a `CanvasArtifact` so that `MessageArtifacts` (and any
   * canvas-side subscribers) can find it by id. Safe to call from
   * outside React; no re-render cost on the chat scroll because
   * `SidebarChat` selects only `messages` / `isLoading` /
   * `activeToolCalls`. Idempotent — same id overwrites in place.
   */
  registerArtifact: (artifact: CanvasArtifact) => void;
  /** Mark an artifact as dismissed for the lifetime of the store. */
  dismissArtifact: (artifactId: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store implementation
// ─────────────────────────────────────────────────────────────────────────────

let conversationCounter = 0;
const newConversationId = () =>
  `conv-${Date.now().toString(36)}-${(++conversationCounter).toString(36)}`;

export const useCanvasChatStore = create<CanvasChatState>()(
  devtools(
    (set) => ({
      conversations: {},
      activeConversationId: null,
      ephemeralSeedCounts: {},
      pendingInputDraft: null,
      proposals: {},
      subAgentRuns: {},
      artifacts: {},
      dismissedArtifactIds: {},

      startConversation: (
        context,
        seedMessages,
        forkedFromShareId,
        ephemeralSeedCount,
        serverConversationId,
      ) => {
        const id = newConversationId();
        const conv: CanvasConversation = {
          id,
          serverConversationId: serverConversationId ?? null,
          forkedFromShareId: forkedFromShareId ?? null,
          messages: seedMessages ?? [],
          isLoading: false,
          isStreaming: false,
          activeToolCalls: [],
          context,
        };
        const seedSkip = ephemeralSeedCount ?? 0;
        set(
          (s) => ({
            conversations: { ...s.conversations, [id]: conv },
            activeConversationId: id,
            ephemeralSeedCounts: seedSkip > 0
              ? { ...s.ephemeralSeedCounts, [id]: seedSkip }
              : s.ephemeralSeedCounts,
          }),
          false,
          "startConversation",
        );
        return id;
      },

      setActiveConversation: (conversationId) =>
        set({ activeConversationId: conversationId }, false, "setActiveConversation"),

      updateActiveContext: (patch) =>
        set(
          (s) => {
            const id = s.activeConversationId;
            if (!id) return s;
            const conv = s.conversations[id];
            if (!conv) return s;
            return {
              conversations: {
                ...s.conversations,
                [id]: { ...conv, context: { ...conv.context, ...patch } },
              },
            };
          },
          false,
          "updateActiveContext",
        ),

      clearActiveConversation: () =>
        set(
          (s) => {
            const id = s.activeConversationId;
            if (!id) return s;
            const conv = s.conversations[id];
            if (!conv) return s;
            return {
              conversations: {
                ...s.conversations,
                [id]: {
                  ...conv,
                  messages: [],
                  activeToolCalls: [],
                  isLoading: false,
                  // Cleared local state means we want a fresh server row
                  // on the next user message — not an append to the old
                  // auto-save row that still has the wiped messages.
                  serverConversationId: null,
                },
              },
            };
          },
          false,
          "clearActiveConversation",
        ),

      resetActiveConversation: () =>
        set(
          (s) => {
            const id = s.activeConversationId;
            if (!id) return s;
            const nextConversations = { ...s.conversations };
            delete nextConversations[id];
            const nextSeedCounts = { ...s.ephemeralSeedCounts };
            delete nextSeedCounts[id];
            return {
              conversations: nextConversations,
              activeConversationId: null,
              ephemeralSeedCounts: nextSeedCounts,
            };
          },
          false,
          "resetActiveConversation",
        ),

      setServerConversationId: (conversationId, serverId) =>
        set(
          (s) => {
            const conv = s.conversations[conversationId];
            if (!conv) return s;
            return {
              conversations: {
                ...s.conversations,
                [conversationId]: { ...conv, serverConversationId: serverId },
              },
            };
          },
          false,
          "setServerConversationId",
        ),

      appendUserMessage: (conversationId, message) =>
        set(
          (s) => {
            const conv = s.conversations[conversationId];
            if (!conv) return s;
            return {
              conversations: {
                ...s.conversations,
                [conversationId]: {
                  ...conv,
                  messages: [...conv.messages, message],
                },
              },
            };
          },
          false,
          "appendUserMessage",
        ),

      setConversationMessages: (conversationId, messages) =>
        set(
          (s) => {
            const conv = s.conversations[conversationId];
            if (!conv) return s;
            return {
              conversations: {
                ...s.conversations,
                [conversationId]: { ...conv, messages },
              },
            };
          },
          false,
          "setConversationMessages",
        ),

      replaceAssistantStream: (conversationId, prefix, next) =>
        set(
          (s) => {
            const conv = s.conversations[conversationId];
            if (!conv) return s;
            const filtered = conv.messages.filter(
              (m) => !m.id.startsWith(prefix),
            );
            return {
              conversations: {
                ...s.conversations,
                [conversationId]: {
                  ...conv,
                  messages: [...filtered, ...next],
                },
              },
            };
          },
          false,
          "replaceAssistantStream",
        ),

      setActiveToolCalls: (conversationId, toolCalls) =>
        set(
          (s) => {
            const conv = s.conversations[conversationId];
            if (!conv) return s;
            return {
              conversations: {
                ...s.conversations,
                [conversationId]: { ...conv, activeToolCalls: toolCalls },
              },
            };
          },
          false,
          "setActiveToolCalls",
        ),

      setIsLoading: (conversationId, isLoading) =>
        set(
          (s) => {
            const conv = s.conversations[conversationId];
            if (!conv) return s;
            return {
              conversations: {
                ...s.conversations,
                [conversationId]: { ...conv, isLoading },
              },
            };
          },
          false,
          "setIsLoading",
        ),

      setIsStreaming: (conversationId, isStreaming) =>
        set(
          (s) => {
            const conv = s.conversations[conversationId];
            if (!conv) return s;
            return {
              conversations: {
                ...s.conversations,
                [conversationId]: { ...conv, isStreaming },
              },
            };
          },
          false,
          "setIsStreaming",
        ),

      appendAssistantError: (conversationId, content) =>
        set(
          (s) => {
            const conv = s.conversations[conversationId];
            if (!conv) return s;
            const errMessage: CanvasChatMessage = {
              id: `error-${Date.now().toString(36)}`,
              role: "assistant",
              content,
              timestamp: new Date(),
            };
            return {
              conversations: {
                ...s.conversations,
                [conversationId]: {
                  ...conv,
                  messages: [...conv.messages, errMessage],
                  isLoading: false,
                  activeToolCalls: [],
                },
              },
            };
          },
          false,
          "appendAssistantError",
        ),

      registerArtifact: (artifact) =>
        set(
          (s) => ({
            artifacts: { ...s.artifacts, [artifact.id]: artifact },
          }),
          false,
          "registerArtifact",
        ),

      dismissArtifact: (artifactId) =>
        set(
          (s) => ({
            dismissedArtifactIds: {
              ...s.dismissedArtifactIds,
              [artifactId]: true,
            },
          }),
          false,
          "dismissArtifact",
        ),

      setPendingInputDraft: (draft) =>
        set({ pendingInputDraft: draft }, false, "setPendingInputDraft"),
    }),
    { name: "canvas-chat-store" },
  ),
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (pure — no React, no store closure)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the `messages` array that `/api/ask/quick` expects from the
 * UI-side message timeline. Mirrors the AI SDK `ModelMessage[]`
 * shape with separate entries for tool-call / tool-result / text
 * blocks.
 */
export function toModelMessages(
  messages: CanvasChatMessage[],
): ModelMessage[] {
  return messages
    .filter((m) => m.content.trim() || m.toolCalls)
    .flatMap((m): ModelMessage[] => {
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const out: ModelMessage[] = [];
        out.push({
          role: m.role,
          content: m.toolCalls.map((tc) => ({
            type: "tool-call" as const,
            toolCallId: tc.id,
            toolName: tc.toolName,
            input: tc.input || {},
          })),
        });
        const toolResults = m.toolCalls.filter(
          (tc) => tc.output !== undefined || tc.errorText !== undefined,
        );
        if (toolResults.length > 0) {
          out.push({
            role: "tool" as const,
            content: toolResults.map((tc) => {
              let wrappedOutput = tc.output;
              if (
                tc.output &&
                typeof tc.output === "object" &&
                !("type" in tc.output)
              ) {
                wrappedOutput = { type: "json", value: tc.output };
              }
              return {
                type: "tool-result" as const,
                toolCallId: tc.id,
                toolName: tc.toolName,
                output: wrappedOutput as never,
              };
            }),
          } satisfies ModelMessage);
        }
        if (m.content) {
          out.push({ role: m.role, content: m.content });
        }
        return out;
      }
      return [{ role: m.role, content: m.content }];
    });
}
