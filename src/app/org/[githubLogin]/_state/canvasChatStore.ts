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
import { STOPPED_TURN_TEXT } from "@/lib/ai/conversationHelpers";
import type { ApprovalIntent, ApprovalResult, RejectionIntent } from "@/lib/proposals/types";
import type { ClarifyingQuestion } from "@/types/stakwork";
import type { StreamTimelineItem, StreamToolCall, ToolCallStatus } from "@/types/streaming";
import type { TokenUsage } from "@/types/usage";
import type { ArtifactPanelState, ArtifactRef } from "./canvasChatArtifacts";

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
 * A file attachment uploaded by the user before sending a canvas chat message.
 * Persisted in SharedConversation JSON so it survives reload and live-sync.
 */
export interface CanvasAttachment {
  /** S3 path (key) — used to generate a presigned download URL. */
  path: string;
  filename: string;
  mimeType: string;
  size: number;
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
  | { kind: "user-answered-planner-form"; featureId: string; plannerMessageId: string }
  | {
      kind: "research";
      researchId: string;
      slug: string;
      topic: string;
      title: string;
      /** "ready" | "failed" | "cancelled" — status at fan-out time */
      status: string;
      initiativeId?: string;
    }
  | {
      /**
       * One callback of a dispatched strut chat — a turn end, or the
       * closing `settled` (`canvas-strut-fanout.ts`). The row renders as a
       * bubble; `StrutChatCard` reads the chat's state off its latest one.
       */
      kind: "strut";
      runId: string;
      title: string;
      workspaceSlug: string;
      chatId: string;
      turn: number;
      event: string;
      /** "done" | "error" — how the turn ended. */
      status: string;
      /** `false` while strut will start another turn on its own. */
      settled: boolean;
      parked?: boolean;
      /** Parsed by `parseStrutChatActivity` — never trusted as typed. */
      activity?: unknown;
    }
  | {
      /**
       * One turn of a strut JOB (`services/strut-runs/job-turn.ts`): the
       * reply the `job` workflow's agent gave, with what it produced riding
       * on the row as `artifacts`. Renders collapsed (`JobTurnCard`: the
       * title and how the turn ended, opened on click) plus its artifact
       * cards — the canvas agent is woken to summarize it. The header line
       * of `content` carries the job id the agent reads back for
       * `continue_job`.
       */
      kind: "job";
      jobId: string;
      strutRunId: string;
      workflow: string;
      /** "success" | "error" | "cancelled" | "lost" — how the turn ended. */
      status: string;
      title?: string;
      /** The agent stopped for a decision: the question, verbatim. */
      ask?: string;
    }
  | {
      /**
       * The end of a turn the user stopped — after whatever it got
       * through. Renders as a muted "Stopped" line; replayed to the model
       * as a notice from the user (`toModelMessages`).
       */
      kind: "stopped";
    };

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
   * Ids into the `state.artifacts` registry, which nothing registers in
   * or reads (see there). Always empty; a message's artifacts are the
   * refs in `artifacts` below.
   */
  artifactIds?: string[];
  /**
   * What this message hands the reader to look at — a plan, a screenshot,
   * a pull request — as refs: what each is and where its content lives
   * (see `canvasChatArtifacts.ts`). Each renders as a card under the
   * message and opens on the artifact panel.
   */
  artifacts?: ArtifactRef[];

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
  /** Files attached by the user before send. Persisted in SharedConversation JSON. */
  attachments?: CanvasAttachment[];
  /**
   * Per-turn aggregated token usage, stamped by `useSendCanvasChatMessage`
   * onto the last tool-call batch message when the stream `finish` event
   * carries usage data. Live-stream only — not persisted to `SharedConversation`.
   */
  usage?: TokenUsage;
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
  /**
   * Populated when this assistant message is the confirmation for a
   * `schedule_check` tool call. Persisted in `SharedConversation.messages`
   * JSON so the `DeferredCheckCard` renders correctly after reload/share.
   */
  deferredCheck?: {
    id: string;
    description: string;
    fireAt: string; // ISO timestamp
    status: "PENDING" | "FIRED" | "CANCELLED" | "FAILED";
  };
}

/**
 * Reconstruct a render `timeline` from a message's persisted `toolCalls`.
 *
 * The streamed (live) path attaches a rich `timeline` to tool-call rows so
 * `<StreamingMessage>` renders expandable tool cards. But the server only
 * persists `toolCalls` to `SharedConversation.messages` (see
 * `canvas-turn-persistence.ts`) — `timeline` is never written. So on reload,
 * share, or live-sync of another tab's turn, a tool-call row arrives with
 * `toolCalls` but no `timeline` and would render nothing.
 *
 * `SidebarChat` calls this to synthesize the missing `timeline` from the
 * persisted `toolCalls` so reloaded tool calls render identically to live
 * ones. `toolCalls` carries everything `<StreamToolCall>` needs (name, input,
 * output, status, error); `inputText` is derived from `input` for the
 * expandable "Input" section.
 */
export function timelineFromToolCalls(toolCalls: ToolCall[]): StreamTimelineItem[] {
  return toolCalls.map((tc) => {
    const data: StreamToolCall = {
      id: tc.id,
      toolName: tc.toolName,
      input: tc.input,
      inputText:
        tc.input === undefined
          ? undefined
          : typeof tc.input === "string"
            ? tc.input
            : JSON.stringify(tc.input, null, 2),
      output: tc.output,
      status: tc.status as ToolCallStatus,
      errorText: tc.errorText,
    };
    return { type: "toolCall", id: tc.id, data };
  });
}

export interface CanvasConversation {
  id: string;
  /** Server-side `SharedConversation.id`, if auto-save has created one. */
  serverConversationId: string | null;
  /**
   * Persisted conversation title (`SharedConversation.title`). `null`
   * until an LLM title (or a seeded legacy/share/fork title) lands —
   * the chat chrome falls back to "Ask Jamie" in that case.
   */
  title: string | null;
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
  /**
   * True while a repo_agent run is active in this conversation.
   * Driven by (a) local tool-call detection (instant feedback for the
   * initiator) and (b) the Pusher CANVAS_RUN_ACTIVE event (for all
   * participants in a shared room).
   */
  runActive: boolean;
  /**
   * Reference count of unsettled agent turns in this conversation.
   * Incremented on send, decremented only in the send hook's `finally`
   * block. A send now waits for the running turn (`activeTurn`), so it is
   * 0 or 1 in practice; the refcount stays so a stray settle can never
   * extinguish the indicator early. The "Ask Jamie" thinking dots gate on
   * `agentTurnsInProgress > 0`.
   */
  agentTurnsInProgress: number;
  /**
   * The turn this tab is streaming, from send until its reply ends — what
   * the composer's Stop button cancels. A new send waits for it to end.
   */
  activeTurn?: ActiveTurn | null;
  /**
   * The turn this tab last stopped, while it is still the conversation's
   * last — its message can be edited and sent again in its place.
   */
  stoppedTurnId?: string | null;
  /** Set while the composer holds `stoppedTurnId`'s message for editing. */
  editingTurnId?: string | null;
  /** Hint context used when building `/api/ask/quick` requests. */
  context: ConversationContext;
}

export interface ActiveTurn {
  turnId: string;
  /** Aborts this tab's request once the server has accepted the Stop. */
  controller: AbortController;
  /**
   * False for an Approve / Reject turn — the server answers it without
   * the model, so there is nothing to stop; it still holds the slot.
   */
  canStop: boolean;
  /** A Stop was sent and hasn't been answered yet. */
  stopping: boolean;
}

/** The knowledge-graph node the user is looking at on the org page's graph view. */
export interface GraphFocus {
  workspaceSlug: string;
  refId: string;
  name: string;
  type: string;
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
  /** Set on the graph view: what "this" means there. */
  graphFocus?: GraphFocus | null;
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
   * Turn ids this client authored (sent via `useSendCanvasChatMessage`).
   * Backend-driven persistence (docs/plans/backend-driven-canvas-turns.md):
   * the SERVER writes each turn's rows under `${turnId}-u` / `${turnId}-a*`
   * and broadcasts a Pusher nudge. The authoring tab is already showing its
   * own optimistic stream for those turns, so `useCanvasChatAutoSave`'s
   * live-sync filters server rows whose id starts with `${turnId}-` for any
   * id in this set — preventing a double-render. Other tabs / a reopened tab
   * have an empty set and merge the server rows normally. Grow-only per
   * session (ids are unique; stale entries simply never match).
   */
  locallyAuthoredTurnIds: Set<string>;

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
   * for non-null values and applies + clears them in an effect. An
   * empty string only focuses the input and leaves its text alone
   * (the control panel's "New chat" uses it).
   */
  pendingInputDraft: string | null;

  // ─── Canvas viewport (written by OrgCanvasBackground on every pan/zoom) ─
  /**
   * The live viewport state from the canvas renderer, plus the pixel
   * dimensions of the canvas container element. Written by
   * `OrgCanvasBackground.onViewportChange` so that `ProposalCard`
   * can compute canvas-space bounds for viewport-aware node placement
   * without prop drilling.
   *
   * `null` when the canvas is not mounted (before first render or
   * after unmount). All consumers must handle null gracefully.
   */
  canvasViewport: {
    x: number;
    y: number;
    zoom: number;
    containerW: number;
    containerH: number;
  } | null;
  setCanvasViewport: (
    v: {
      x: number;
      y: number;
      zoom: number;
      containerW: number;
      containerH: number;
    } | null,
  ) => void;

  // ─── Reserved slots (empty in PR 1; canvas may already select these) ─
  proposals: Record<string, CanvasProposal>;
  subAgentRuns: Record<string, SubAgentRun>;
  /**
   * Unused. Nothing registers an artifact here and nothing reads one: the
   * chat's artifacts are the refs its messages carry
   * (`CanvasChatMessage.artifacts`), and the one on the panel is
   * `artifactPanel` below.
   */
  artifacts: Record<string, CanvasArtifact>;
  /**
   * Ids of `artifacts` entries dismissed for this session. Unused along
   * with the registry. Lives in-memory only; outer code is responsible
   * for persisting decisions across page loads (e.g. via
   * `sessionStorage`) when relevant.
   */
  dismissedArtifactIds: Record<string, true>;

  // ─── Artifact panel ──────────────────────────────────────────────────
  /**
   * The artifact of the active conversation that is up on the artifact
   * panel, or null when the panel is closed. A card in the chat opens it;
   * `OrgCanvasView` gives the panel the canvas's place while it is set.
   * Cleared whenever the active conversation changes — an artifact belongs
   * to the chat it came from.
   */
  artifactPanel: ArtifactPanelState | null;
  /** Put an artifact on the panel, by its `artifactIdentity`. Omit `version` to follow its newest version. */
  openArtifactPanel: (identity: string, version?: number | null) => void;
  closeArtifactPanel: () => void;

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
   *
   * `title` (default = null) seeds the chrome/list label so a share-link
   * recipient, reopen, or fork sees the persisted title without waiting
   * on live-sync. Omit it for a fresh chat ("Ask Jamie" until the LLM
   * title arrives).
   */
  startConversation: (
    context: ConversationContext,
    seedMessages?: CanvasChatMessage[],
    forkedFromShareId?: string,
    ephemeralSeedCount?: number,
    serverConversationId?: string,
    title?: string | null,
  ) => string;
  setActiveConversation: (conversationId: string | null) => void;
  /** Record a turn id this client just sent (see `locallyAuthoredTurnIds`). */
  markTurnAuthored: (turnId: string) => void;
  /** Update the context of the active conversation (canvas-scope changes). */
  updateActiveContext: (patch: Partial<ConversationContext>) => void;
  /** Wipe the active conversation's messages but keep the conversation row. */
  clearActiveConversation: () => void;
  /** Drop the active conversation and start fresh. */
  resetActiveConversation: () => void;
  /** Record the server-assigned `SharedConversation` id (auto-save creation). */
  setServerConversationId: (conversationId: string, serverId: string) => void;
  /** Record the persisted conversation title (LLM live-sync / seed). */
  setConversationTitle: (conversationId: string, title: string | null) => void;

  // ─── Message actions ─────────────────────────────────────────────────
  appendUserMessage: (conversationId: string, message: CanvasChatMessage) => void;
  /**
   * Replace a conversation's entire message list with the authoritative
   * server copy. Used by the live-sync (`useCanvasChatAutoSave` Pusher
   * nudge → refetch) to bring in server-appended rows (planner fan-out,
   * autonomous canvas-agent turns, planner-form answers). Callers MUST
   * only invoke this when the conversation has no unsaved local messages,
   * so the server copy is a strict superset and nothing local is lost.
   */
  setConversationMessages: (conversationId: string, messages: CanvasChatMessage[]) => void;
  /** Replace any messages whose id starts with `prefix` with `next`. */
  replaceAssistantStream: (conversationId: string, prefix: string, next: CanvasChatMessage[]) => void;
  setActiveToolCalls: (conversationId: string, toolCalls: ToolCall[]) => void;
  setIsLoading: (conversationId: string, isLoading: boolean) => void;
  /** Mirror of `setIsLoading` but for the streaming gate. See `CanvasConversation.isStreaming`. */
  setIsStreaming: (conversationId: string, streaming: boolean) => void;
  /**
   * Adjust the `agentTurnsInProgress` refcount by `delta` (positive on
   * send, negative in the send hook's `finally`). Clamped at a floor of
   * 0 so a stray decrement can't wedge the count above reality. See
   * `CanvasConversation.agentTurnsInProgress`.
   */
  bumpAgentTurns: (conversationId: string, delta: number) => void;
  /**
   * Set the runActive flag for a conversation — driven by local tool-call
   * detection and by the Pusher CANVAS_RUN_ACTIVE event (for non-initiating
   * participants).
   */
  setRunActive: (conversationId: string, active: boolean) => void;
  /**
   * Stop all in-flight repo_agent runs for the active conversation.
   * POSTs to /api/ask/abort. Does NOT expose request_id to the client.
   */
  stopRun: (opts: { serverConversationId: string; orgId: string; turnId?: string }) => Promise<void>;
  /** Append a synthetic assistant error message to a conversation. */
  appendAssistantError: (conversationId: string, content: string) => void;
  /** Starting a turn also ends any edit of the stopped one before it. */
  setActiveTurn: (conversationId: string, turn: ActiveTurn | null) => void;
  /**
   * End a stopped turn's streamed rows (`${turnId}-a…`): tool calls still
   * in flight become "interrupted", and a "Stopped" row follows.
   */
  finishStoppedTurn: (conversationId: string, turnId: string) => void;
  /**
   * Put the stopped turn's message in the composer to edit, or (`null`)
   * stop editing — the composer clears its own text on cancel.
   */
  setEditingTurn: (conversationId: string, turnId: string | null) => void;
  /** Drop a turn's rows (`${turnId}-…`) — an edited resend takes its place. */
  removeTurn: (conversationId: string, turnId: string) => void;

  /**
   * Queue text for the chat input to adopt on its next render. Pass
   * `null` to clear without applying (the input clears its own draft
   * after consumption — callers usually shouldn't need to clear).
   */
  setPendingInputDraft: (draft: string | null) => void;

  // ─── Canvas deeplink ─────────────────────────────────────────────────
  /**
   * A pending imperative navigation request emitted when the user
   * clicks a `CanvasDeeplinkChip` in chat. `OrgCanvasBackground`
   * consumes this in a `useEffect`, navigates to the target canvas/node,
   * and calls `clearDeeplink()` in the `finally` block so the slot is
   * never stuck.
   *
   * `canvasRef` is an empty string for the root canvas.
   */
  pendingDeeplink: {
    nodeId: string;
    canvasRef: string;
    label: string;
    x?: number;
    y?: number;
  } | null;
  triggerDeeplink: (dl: { nodeId: string; canvasRef: string; label: string; x?: number; y?: number }) => void;
  clearDeeplink: () => void;

  // ─── Artifact actions ────────────────────────────────────────────────
  /**
   * Register a `CanvasArtifact` by id in `state.artifacts`. Nothing
   * calls this and nothing reads the registry — the chat's cards come
   * from the refs on its messages. Idempotent — same id overwrites in
   * place.
   */
  registerArtifact: (artifact: CanvasArtifact) => void;
  /** Mark an artifact as dismissed for the lifetime of the store. */
  dismissArtifact: (artifactId: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store implementation
// ─────────────────────────────────────────────────────────────────────────────

let conversationCounter = 0;
const newConversationId = () => `conv-${Date.now().toString(36)}-${(++conversationCounter).toString(36)}`;

/** The active conversation's messages, when there is one. */
export const selectActiveMessages = (s: CanvasChatState): CanvasChatMessage[] | undefined =>
  s.activeConversationId ? s.conversations[s.activeConversationId]?.messages : undefined;

export const useCanvasChatStore = create<CanvasChatState>()(
  devtools(
    (set) => ({
      conversations: {},
      activeConversationId: null,
      ephemeralSeedCounts: {},
      locallyAuthoredTurnIds: new Set<string>(),
      pendingInputDraft: null,
      pendingDeeplink: null,
      canvasViewport: null,
      proposals: {},
      subAgentRuns: {},
      artifacts: {},
      dismissedArtifactIds: {},
      artifactPanel: null,

      openArtifactPanel: (identity, version = null) =>
        set({ artifactPanel: { identity, version } }, false, "openArtifactPanel"),

      closeArtifactPanel: () => set({ artifactPanel: null }, false, "closeArtifactPanel"),

      startConversation: (context, seedMessages, forkedFromShareId, ephemeralSeedCount, serverConversationId, title) => {
        const id = newConversationId();
        const conv: CanvasConversation = {
          id,
          serverConversationId: serverConversationId ?? null,
          forkedFromShareId: forkedFromShareId ?? null,
          title: title ?? null,
          messages: seedMessages ?? [],
          isLoading: false,
          isStreaming: false,
          runActive: false,
          agentTurnsInProgress: 0,
          activeToolCalls: [],
          context,
        };
        const seedSkip = ephemeralSeedCount ?? 0;
        set(
          (s) => ({
            conversations: { ...s.conversations, [id]: conv },
            activeConversationId: id,
            ephemeralSeedCounts: seedSkip > 0 ? { ...s.ephemeralSeedCounts, [id]: seedSkip } : s.ephemeralSeedCounts,
            artifactPanel: null,
          }),
          false,
          "startConversation",
        );
        return id;
      },

      setActiveConversation: (conversationId) =>
        set({ activeConversationId: conversationId, artifactPanel: null }, false, "setActiveConversation"),

      markTurnAuthored: (turnId) =>
        set(
          (s) => {
            if (s.locallyAuthoredTurnIds.has(turnId)) return s;
            const next = new Set(s.locallyAuthoredTurnIds);
            next.add(turnId);
            return { locallyAuthoredTurnIds: next };
          },
          false,
          "markTurnAuthored",
        ),

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
                  title: null,
                },
              },
              artifactPanel: null,
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
              artifactPanel: null,
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

      setConversationTitle: (conversationId, title) =>
        set(
          (s) => {
            const conv = s.conversations[conversationId];
            if (!conv) return s;
            return {
              conversations: {
                ...s.conversations,
                [conversationId]: { ...conv, title },
              },
            };
          },
          false,
          "setConversationTitle",
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
            const filtered = conv.messages.filter((m) => !m.id.startsWith(prefix));
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

      setRunActive: (conversationId, active) =>
        set(
          (s) => {
            const conv = s.conversations[conversationId];
            if (!conv) return s;
            return {
              conversations: {
                ...s.conversations,
                [conversationId]: { ...conv, runActive: active },
              },
            };
          },
          false,
          "setRunActive",
        ),

      bumpAgentTurns: (conversationId, delta) =>
        set(
          (s) => {
            const conv = s.conversations[conversationId];
            if (!conv) return s;
            const next = Math.max(0, conv.agentTurnsInProgress + delta);
            return {
              conversations: {
                ...s.conversations,
                [conversationId]: { ...conv, agentTurnsInProgress: next },
              },
            };
          },
          false,
          "bumpAgentTurns",
        ),

      stopRun: async ({ serverConversationId, orgId, turnId }) => {
        try {
          await fetch("/api/ask/abort", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId: serverConversationId, orgId, turnId }),
          });
        } catch (e) {
          console.error("[canvasChatStore] stopRun failed:", e);
        }
      },

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

      setActiveTurn: (conversationId, activeTurn) =>
        set(
          (s) => {
            const conv = s.conversations[conversationId];
            if (!conv) return s;
            return {
              conversations: {
                ...s.conversations,
                [conversationId]: {
                  ...conv,
                  activeTurn,
                  ...(activeTurn ? { stoppedTurnId: null, editingTurnId: null } : {}),
                },
              },
            };
          },
          false,
          "setActiveTurn",
        ),

      finishStoppedTurn: (conversationId, turnId) =>
        set(
          (s) => {
            const conv = s.conversations[conversationId];
            if (!conv) return s;
            const prefix = `${turnId}-a`;
            const stopped: CanvasChatMessage = {
              id: `${prefix}stopped`,
              role: "assistant",
              content: STOPPED_TURN_TEXT,
              timestamp: new Date(),
              source: { kind: "stopped" },
            };
            return {
              conversations: {
                ...s.conversations,
                [conversationId]: {
                  ...conv,
                  messages: [
                    ...conv.messages.map((m) => (m.id.startsWith(prefix) ? interruptUnfinishedToolCalls(m) : m)),
                    stopped,
                  ],
                  activeToolCalls: [],
                  stoppedTurnId: turnId,
                },
              },
            };
          },
          false,
          "finishStoppedTurn",
        ),

      setEditingTurn: (conversationId, turnId) =>
        set(
          (s) => {
            const conv = s.conversations[conversationId];
            if (!conv) return s;
            const draft = turnId ? conv.messages.find((m) => m.id === `${turnId}-u`)?.content : undefined;
            return {
              conversations: {
                ...s.conversations,
                [conversationId]: { ...conv, editingTurnId: turnId },
              },
              // Editing starts with the message in the composer.
              ...(draft !== undefined ? { pendingInputDraft: draft } : {}),
            };
          },
          false,
          "setEditingTurn",
        ),

      removeTurn: (conversationId, turnId) =>
        set(
          (s) => {
            const conv = s.conversations[conversationId];
            if (!conv) return s;
            return {
              conversations: {
                ...s.conversations,
                [conversationId]: {
                  ...conv,
                  messages: conv.messages.filter((m) => !m.id.startsWith(`${turnId}-`)),
                  stoppedTurnId: null,
                  editingTurnId: null,
                },
              },
            };
          },
          false,
          "removeTurn",
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

      setPendingInputDraft: (draft) => set({ pendingInputDraft: draft }, false, "setPendingInputDraft"),

      triggerDeeplink: (dl) => set({ pendingDeeplink: dl }, false, "triggerDeeplink"),

      clearDeeplink: () => set({ pendingDeeplink: null }, false, "clearDeeplink"),

      setCanvasViewport: (v) => set({ canvasViewport: v }, false, "setCanvasViewport"),
    }),
    { name: "canvas-chat-store" },
  ),
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (pure — no React, no store closure)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conversation-level token totals, summed across every message that
 * carries a `usage` stamp. `used` is what the header counter shows
 * (input + output — the two halves of what actually flowed through the
 * model this turn); `cacheReadTokens` / `cacheWriteTokens` ride along
 * for the tooltip breakdown only.
 */
export interface ConversationTokenTotals {
  used: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Sum `CanvasChatMessage.usage` across a conversation's messages.
 *
 * `usage` is stamped live-stream-only (see `CanvasChatMessage.usage`)
 * onto the tool-call batch message of a turn once its `finish` event
 * carries usage data — so a reloaded/shared conversation has no usage
 * on any message. Returns `null` in that case (and whenever no message
 * has any usage numbers at all) so callers can hide the counter instead
 * of rendering a misleading "0" — a fresh page load looks identical to
 * a conversation that really used zero tokens otherwise.
 *
 * Pure and store-independent so it's cheap to unit test and to call
 * from a tight selector (see `SidebarChat`'s header counter, which
 * selects only these five numbers — never the message array itself —
 * so streaming text-deltas on other fields don't re-render it).
 */
export function sumConversationTokenUsage(messages: CanvasChatMessage[]): ConversationTokenTotals | null {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let sawUsage = false;

  for (const m of messages) {
    if (!m.usage) continue;
    sawUsage = true;
    inputTokens += m.usage.inputTokens ?? 0;
    outputTokens += m.usage.outputTokens ?? 0;
    cacheReadTokens += m.usage.cacheReadTokens ?? 0;
    cacheWriteTokens += m.usage.cacheWriteTokens ?? 0;
  }

  if (!sawUsage) return null;
  return { used: inputTokens + outputTokens, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}

/** A tool call that hasn't produced a result yet. */
function isUnfinished(status: string): boolean {
  return status !== "output-available" && status !== "output-error" && status !== "input-error";
}

/** A stopped turn's in-flight tool calls never finish — mark them, so they stop spinning. */
function interruptUnfinishedToolCalls(m: CanvasChatMessage): CanvasChatMessage {
  if (!m.toolCalls?.length) return m;
  return {
    ...m,
    toolCalls: m.toolCalls.map((tc) => (isUnfinished(tc.status) ? { ...tc, status: "interrupted" } : tc)),
    timeline: m.timeline?.map((item) => {
      if (item.type !== "toolCall") return item;
      const tc = item.data as StreamToolCall;
      return isUnfinished(tc.status) ? { ...item, data: { ...tc, status: "interrupted" } } : item;
    }),
  };
}

/** The org-canvas chat sends its own history each turn, built the same way as server-side history. */
export { toModelMessages } from "@/lib/ai/conversationHelpers";
