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

export interface CanvasChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
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
}

export interface CanvasConversation {
  id: string;
  /** Server-side `SharedConversation.id`, if auto-save has created one. */
  serverConversationId: string | null;
  /** Set when this conversation was forked from `?chat=<shareId>`. Informational. */
  forkedFromShareId: string | null;
  messages: CanvasChatMessage[];
  isLoading: boolean;
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

  // ─── Reserved slots (empty in PR 1; canvas may already select these) ─
  proposals: Record<string, CanvasProposal>;
  subAgentRuns: Record<string, SubAgentRun>;
  artifacts: Record<string, CanvasArtifact>;

  // ─── Conversation actions ────────────────────────────────────────────
  /** Create + activate a fresh conversation. Returns its id. */
  startConversation: (
    context: ConversationContext,
    seedMessages?: CanvasChatMessage[],
    forkedFromShareId?: string,
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
  /** Append a synthetic assistant error message to a conversation. */
  appendAssistantError: (
    conversationId: string,
    content: string,
  ) => void;
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
      proposals: {},
      subAgentRuns: {},
      artifacts: {},

      startConversation: (context, seedMessages, forkedFromShareId) => {
        const id = newConversationId();
        const conv: CanvasConversation = {
          id,
          serverConversationId: null,
          forkedFromShareId: forkedFromShareId ?? null,
          messages: seedMessages ?? [],
          isLoading: false,
          activeToolCalls: [],
          context,
        };
        set(
          (s) => ({
            conversations: { ...s.conversations, [id]: conv },
            activeConversationId: id,
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
            const next = { ...s.conversations };
            delete next[id];
            return { conversations: next, activeConversationId: null };
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
