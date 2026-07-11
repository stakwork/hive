/**
 * `runCanvasAgent` — the canonical canvas/org-aware agent loop.
 *
 * This is the in-process primitive that powers the streaming chat at
 * `POST /api/ask/quick` (the org canvas SidebarChat + dashboard chat),
 * and is intended to be reusable by other callers that want to ask
 * the same agent a question programmatically — e.g. the plan-mode
 * dispatcher in `src/services/roadmap/feature-chat.ts`, which wants
 * a brief org-wide context scout before firing off a Stakwork
 * workflow.
 *
 * What lives here:
 *   - Tool assembly (single- vs multi-workspace; optional org tools;
 *     optional readonly stripping).
 *   - Prefix-message construction (system prompt + canvas scope hint
 *     + pre-seeded `list_concepts` tool-call/tool-result pairs).
 *   - Tool-call sanitization, web_search result capture (so
 *     `update_research` can linkify `<cite>` tags), and per-step
 *     concept extraction.
 *   - The `streamText` invocation itself, configured with the
 *     `[END_OF_ANSWER]` stop condition.
 *   - Best-effort Pusher fan-out for "agent is researching" highlights
 *     (gated on `silentPusher`).
 *
 * What stays at the caller (i.e. the HTTP route):
 *   - Request parsing & auth gating (membership, public-viewer
 *     envelope, public-chat budget).
 *   - Agent-proposal Approve/Reject short-circuit (no LLM call).
 *   - Token attribution & `after()` enrichments (follow-up questions,
 *     stakgraph provenance).
 *   - HTTP response shaping (`toUIMessageStreamResponse`, headers).
 *
 * The signature returns the raw `streamText` result handle so each
 * caller can consume the stream however it wants:
 *   - HTTP route → `result.toUIMessageStreamResponse()`
 *   - Programmatic caller → `await result.text` (or iterate
 *     `result.textStream`)
 */

import { streamText, ModelMessage, ToolSet } from "ai";
import type {
  StreamTextResult,
  StopCondition,
  PrepareStepFunction,
} from "ai";
import {
  getMultiWorkspacePrefixMessages,
  getQuickAskPrefixMessages,
} from "@/lib/constants/prompt";
import type { CanvasScopeHint } from "@/lib/constants/prompt";
import { getCanvasSystemPrompt } from "@/lib/ai/canvas-system-prompt";
import { askTools, listConcepts, createHasEndMarkerCondition } from "@/lib/ai/askTools";
import { askToolsMulti } from "@/lib/ai/askToolsMulti";
import {
  buildWorkspaceConfigs,
  buildPublicWorkspaceConfig,
  fetchConceptsForWorkspaces,
} from "@/lib/ai/workspaceConfig";
import type { CapturedSearchResult, DispatchedResearchIntent } from "@/lib/ai/researchTools";
import type { DispatchedGraphWalkIntent } from "@/lib/ai/graphWalkDispatchTools";
import {
  ALL_CAPABILITIES,
  composeCapabilityPromptSuffix,
  composeCapabilityTools,
  composeWriteToolNames,
  resolveOrgCapabilities,
  type OrgCapability,
} from "@/lib/ai/capabilities";
import { getLinkedWorkspacesForInitiative } from "@/lib/canvas/linkedWorkspaces";
import { sanitizeAndCompleteToolCalls } from "@/lib/ai/message-sanitizer";
import {
  getModel,
  getApiKeyForProvider,
  isGatewayReachable,
  type Provider,
} from "@/lib/ai/provider";
import { getProviderOptions } from "aieo";
// Deep import — see comment in services/task-workflow.ts.
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import { getWorkspaceChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";

// ---------------------------------------------------------------------------
// Write-mode tool names — stripped when `readonly: true` is requested.
//
// Derived from the capability registry (`writeToolNames` per capability)
// so the strip set always tracks the tool families actually composed in.
// All entries are bare names (no `{slug}__` namespace). When askToolsMulti
// namespaces a single-WS tool, we never strip those — every name in the
// set is an org-scoped capability tool, which is NOT namespaced.
// ---------------------------------------------------------------------------

// Computed lazily, NOT at module scope: this module sits on an import
// cycle (capabilities → tool factories → … → runCanvasAgent), so the
// registry's bindings aren't initialized yet while this module body
// evaluates. By first call time every module in the cycle is loaded.
let defaultReadonlyStrip: ReadonlySet<string> | undefined;
function getDefaultReadonlyStrip(): ReadonlySet<string> {
  return (defaultReadonlyStrip ??= composeWriteToolNames(ALL_CAPABILITIES));
}

export function filterReadonly(
  tools: ToolSet,
  keepWriteToolNames?: string[],
  stripToolNames?: ReadonlySet<string>,
): ToolSet {
  const strip = stripToolNames ?? getDefaultReadonlyStrip();
  const out: ToolSet = {};
  for (const [name, def] of Object.entries(tools)) {
    if (strip.has(name)) {
      // Spare tools the caller explicitly wants to keep even in readonly mode.
      if (!keepWriteToolNames?.includes(name)) continue;
    }
    out[name] = def;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * When the request comes from an unauthenticated public viewer of a
 * single `isPublicViewable` workspace, the caller has already resolved
 * access (via `resolveWorkspaceAccess`) and passes the workspace id
 * here. This selects the public-WS config path (no per-user PAT;
 * falls back to the workspace owner's) and skips the per-slug
 * membership validation in `buildWorkspaceConfigs`.
 *
 * Mutually exclusive with `userId` (semantically — auth is one or
 * the other). Public viewer mode is rejected by the caller for any
 * request involving `orgId`, multiple workspaces, or approval/
 * rejection intents.
 */
export interface PublicViewerContext {
  workspaceId: string;
  primarySlug: string;
}

/**
 * Caller-provided side-effect hooks. These are invoked from inside
 * `streamText`'s own callbacks AFTER our internal bookkeeping
 * (web_search capture, learned-concept extraction, optional Pusher
 * fan-out) has run. The shape matches `streamText`'s callback shape
 * one-for-one so callers can pass them straight through.
 */
export interface CanvasAgentHooks {
  /**
   * Called once per agent step (i.e. each LLM turn + tool round in
   * the agentic loop). Receives the raw step content. `route.ts`
   * uses this for token-attribution prep work; programmatic callers
   * typically don't need it.
   */
  onStepFinish?: (sf: { content: unknown }) => void | Promise<void>;
  /**
   * Called once when the stream finishes successfully. Receives the
   * final `usage` so the caller can record token spend.
   */
  onFinish?: (args: { usage: unknown }) => void | Promise<void>;
}

/**
 * Cached swarm concept data, keyed to match the two `runCanvasAgent`
 * branches. Exactly one shape is populated per conversation depending on
 * whether it's single- or multi-workspace. Stored verbatim in the
 * conversation's `settings.promptConcepts` for reuse across turns.
 */
export interface CachedConcepts {
  /** Multi-workspace: concepts keyed by workspace slug. */
  conceptsByWorkspace?: Record<string, Record<string, unknown>[]>;
  /** Single-workspace: the flat concept list. */
  concepts?: Record<string, unknown>[];
}

export interface RunCanvasAgentOptions {
  /** NextAuth user id. Required unless `publicViewer` is set. */
  userId: string | null;
  /** Org id (SourceControlOrg.id). When set, merges the selected capabilities' org tools. */
  orgId?: string;
  /**
   * Org capability families to compose into the agent when `orgId` is
   * set — each contributes its tools, its prompt snippet (core ones
   * inline, loadable ones behind `learn_capability`), and its
   * readonly-strip names (see `src/lib/ai/capabilities.ts`). Defaults
   * to the full set, i.e. the historical canvas-agent behavior. Pass a
   * subset to run the same agent on surfaces that have no canvas —
   * e.g. `["planner"]` for the per-feature Plan page, giving the agent
   * `send_to_feature_planner` plus the per-workspace tools so it can
   * help execute an existing plan without any roadmap/propose tools.
   * Note `"roadmap"` implies `"whiteboard"`, `"research"`, and
   * `"connections"` (registry `includes`). Ignored when `orgId` is absent.
   */
  capabilities?: readonly OrgCapability[];
  /** Workspace slugs to expose to the agent. 1..20. */
  workspaceSlugs: string[];
  /** Public-viewer envelope (mutually exclusive with `userId` in practice). */
  publicViewer?: PublicViewerContext;
  /** Canvas page scope hints — only meaningful with `orgId`. */
  scope?: {
    selectedNodeIds?: string[];
    currentCanvasRef?: string;
    currentCanvasBreadcrumb?: string;
    selectedNodeId?: string;
  };
  /** User-visible chat messages, in AI SDK ModelMessage[] form. */
  messages: ModelMessage[];
  /**
   * Optional model override in `getModelValue()` "provider/name" form
   * (e.g. "anthropic/claude-opus-4-6"), sourced from the caller's
   * `User.chatAgentModel` preference. Only Anthropic models are honored
   * — the canvas agent is Anthropic-only today (provider tools, prompt
   * caching, etc. are wired to Anthropic), so a non-Anthropic selection
   * is ignored and the aieo default is used. When omitted/ignored, the
   * model resolves to aieo's default (sonnet).
   */
  modelName?: string;
  /**
   * Cached concepts from a previous turn of the SAME conversation. When
   * provided, we SKIP the slow per-workspace `listConcepts` swarm
   * round-trip (a swarm can be slow or offline, and re-fetching the
   * concept list on every message adds that latency/failure to every
   * turn) and feed these cached concepts to BOTH the prompt prefix and
   * the tools instead.
   *
   * We deliberately cache the *concepts* (the expensive swarm result),
   * NOT the rendered prefix — so the prefix is rebuilt fresh each turn,
   * keeping the per-turn-dynamic canvas scope hint (current canvas /
   * selected node) accurate. Rebuilding is pure string work; the swarm
   * call is the only thing skipped. The cheap DB work
   * (`buildWorkspaceConfigs`, for tool creds) still runs every turn.
   *
   * Shape mirrors the two code branches: `conceptsByWorkspace` (multi-
   * workspace) or `features` (single-workspace). Null/undefined → fetch
   * fresh from the swarm (and the caller should persist the returned
   * `cacheableConcepts`).
   */
  cachedConcepts?: CachedConcepts | null;
  /**
   * Pre-validated `SharedConversation.id` for the active canvas
   * conversation. Forwarded to `buildInitiativeTools` so
   * `send_to_feature_planner` can lazy-claim ownership
   * (`Feature.parentCanvasConversationId`) for features messaged from
   * this conversation. Optional — when absent, the lazy-claim
   * short-circuits and the feature stays unowned for fan-out
   * purposes. The caller MUST validate the id; see
   * `resolveTokenAttributionRowId` in `/api/ask/quick/route.ts` for
   * the precedent.
   */
  currentCanvasConversationId?: string;
  /**
   * When `true`, strip all write tools before invoking `streamText`.
   * Use this for read-only callers (e.g. plan-mode org context scout)
   * to guarantee the agent can't mutate canvas/research/connection/
   * initiative state, regardless of what the system prompt says.
   */
  readonly?: boolean;
  /**
   * Tool names to spare from the `readonly` strip. Only meaningful when
   * `readonly: true`. Lets targeted workers (e.g. the research sub-agent)
   * keep one write tool (e.g. `update_research`) while everything else is
   * stripped. Names must match the exact tool name (no namespace prefix).
   *
   * **Important:** the spared tool must be one of the *internally-wired*
   * tools (built inside `runCanvasAgent` with shared closures like
   * `capturedWebSearchResults`). Passing an external tool name here that
   * is NOT in the internal toolset is a no-op — the tool is already
   * absent; nothing is restored.
   */
  keepWriteToolNames?: string[];
  /**
   * When `true`, suppress the internal Pusher `HIGHLIGHT_NODES`
   * fan-out fired when the agent calls `learn_concept`. The HTTP
   * chat route leaves this `false` (default) so open chat clients
   * see the "researching" highlight animate. Programmatic callers
   * (no live UI subscriber) should set it `true`.
   */
  silentPusher?: boolean;
  /**
   * Extra tools merged into the assembled toolset, AFTER the
   * `readonly` strip runs — so anything here is always available to
   * the agent regardless of `readonly`. Used by the canvas-agent
   * auto-turn path (`src/services/canvas-agent-autoturn.ts`) to inject
   * `stay_silent`, a terminal no-op the agent calls when a machine-
   * driven wakeup warrants no visible response. Names here win on
   * collision with the built-in toolset (last spread wins).
   */
  additionalTools?: ToolSet;
  /**
   * Mutable collector for `dispatch_research` intents. When provided, the
   * internally-wired `dispatch_research` tool will push each dispatched
   * intent here so the caller's `after()` block can schedule workers.
   * Sibling pattern to `capturedWebSearchResults`.
   */
  dispatchedResearch?: DispatchedResearchIntent[];
  /**
   * Mutable collector for `dispatch_graph_walk` intents. When provided,
   * the internally-wired `dispatch_graph_walk` tool will push each
   * dispatched intent here so the caller's `after()` block can schedule
   * graph-walk workers. Sibling pattern to `dispatchedResearch`.
   */
  dispatchedGraphWalks?: DispatchedGraphWalkIntent[];
  /**
   * Sink for the sub-agent's synthesized graph-walk answer. Only
   * meaningful in a graph-walk sub-agent context (set by the worker);
   * absent in the parent canvas agent. When present, `finalize_graph_walk`
   * writes the answer here instead of being a no-op.
   */
  graphWalkAnswerSink?: { answer: string | null };
  /**
   * Per-step override hook, forwarded verbatim to `streamText`. Lets a
   * caller change tools / tool-choice / messages between steps (e.g. the
   * research sub-agent injecting an elapsed-time note and, past its hard
   * budget, restricting `activeTools` to `update_research` to force a
   * timely finalize). **Off by default** — the interactive canvas/dashboard
   * chat and every other caller pass nothing here, so their loop is
   * unchanged.
   */
  prepareStep?: PrepareStepFunction<ToolSet>;
  /**
   * Extra stop conditions appended to the default `[END_OF_ANSWER]`
   * end-marker condition. ANY condition stopping ends the loop. **Off by
   * default.** The research sub-agent passes `hasToolCall("update_research")`
   * so its loop ends the moment it writes the doc.
   */
  extraStopConditions?:
    | StopCondition<ToolSet>
    | Array<StopCondition<ToolSet>>;
  /** Caller-owned side effects. */
  hooks?: CanvasAgentHooks;
  /**
   * The user's stored IANA timezone preference (e.g. "America/New_York").
   * Threaded into the system prompt so Jamie uses localised time in all
   * responses. Defaults to "UTC" when absent.
   */
  userTimezone?: string;
}

export interface RunCanvasAgentResult {
  /** Raw streamText handle — call `.toUIMessageStreamResponse()` or `await .text`. */
  result: StreamTextResult<ToolSet, never>;
  /**
   * Resolved primary swarm credentials. Surface so the HTTP route's
   * `after()` enrichment block can fetch provenance from stakgraph
   * without re-resolving the workspace config.
   */
  primarySwarmUrl: string;
  primarySwarmApiKey: string;
  /**
   * Flat list of concepts across all selected workspaces. Surfaced
   * so the route can map `learn_concept` calls to ref ids for the
   * Pusher highlight (legacy code path; kept compatible).
   */
  features: Record<string, unknown>[];
  /** The primary slug — useful for Pusher channel naming in `after()`. */
  primarySlug: string;
  /**
   * Resolved primary-workspace identity. Surfaced so post-stream
   * `after()` work (e.g. the follow-up-questions `generateObject`)
   * can route its own LLM call through Bifrost via `getBifrostForLLM`
   * without re-resolving the workspace config or re-issuing a DB
   * lookup. `primaryUserId` is `PUBLIC_VIEWER_USER_ID` for
   * public-viewer requests — the orchestrator handles that case.
   */
  primaryWorkspaceId: string;
  primaryUserId: string;
  /**
   * Whether the agent had any write tools available. False when
   * `readonly` was passed; useful for logging / metrics.
   */
  readonly: boolean;
  /**
   * The prefix messages actually used this turn (system prompt + seeded
   * concepts), rebuilt fresh every turn with the current scope. Surfaced
   * so the caller can persist a snapshot for the Agent Logs detail view
   * ("what the model saw").
   */
  assembledPrefix: ModelMessage[];
  /**
   * The concepts used this turn, in cache shape. When `cacheHit` is
   * false, the caller should persist this so the next turn can pass it
   * back as `cachedConcepts` and skip the swarm fetch.
   */
  cacheableConcepts: CachedConcepts;
  /**
   * True when `cachedConcepts` was supplied and reused (the swarm fetch
   * was skipped). False when concepts were fetched fresh this turn — the
   * signal for the caller to persist `cacheableConcepts`.
   */
  cacheHit: boolean;
  /**
   * Prompt-Manager coordinates of the system prompts resolved this turn,
   * keyed by prompt name (e.g. `CANVAS_AGENT_SYSTEM_PROMPT`). The caller
   * persists this onto `SharedConversation.settings.prompts`. Empty when
   * every prompt resolved to its in-repo default (dev/mock, missing
   * config, Stakwork outage) — there is no version to attribute then.
   */
  promptResolutions: Record<
    string,
    { prompt_id: string; prompt_version_id: string | null }
  >;
}

// ---------------------------------------------------------------------------
// Internal helpers (lifted verbatim from route.ts so step processing
// behaves identically to the old in-route version)
// ---------------------------------------------------------------------------

/**
 * Extract concept IDs from a step's tool calls. Handles both bare
 * tool names (`learn_concept`) and namespaced (`{slug}__learn_concept`).
 */
function extractConceptIdsFromStep(contents: unknown): string[] {
  if (!Array.isArray(contents)) return [];
  const conceptIds: string[] = [];
  for (const content of contents) {
    if (content.type === "tool-call") {
      const toolName: string = content.toolName || "";
      if (toolName === "learn_concept" || toolName.endsWith("__learn_concept")) {
        const conceptId = content.input?.conceptId;
        if (conceptId) {
          conceptIds.push(conceptId);
        }
      }
    }
  }
  return conceptIds;
}

/**
 * Walk a step's tool-result entries for `web_search` outputs and
 * append each `{ url, title }` (in order) to `target`. Order is
 * load-bearing: Anthropic's `<cite index="N-M">` tags reference this
 * flat list 1-indexed across the whole turn.
 *
 * Tolerates two AI-SDK result shapes (`result` vs `output`) and any
 * non-array body silently — adapters vary across versions.
 */
function captureWebSearchResultsFromStep(
  contents: unknown,
  target: CapturedSearchResult[],
): void {
  if (!Array.isArray(contents)) return;
  for (const content of contents) {
    if (content?.type !== "tool-result") continue;
    const toolName: string = content.toolName || "";
    if (toolName !== "web_search") continue;
    const body = content.output ?? content.result ?? null;
    const results = Array.isArray(body) ? body : null;
    if (!results) {
      console.log(
        `[runCanvasAgent] web_search tool-result had non-array body; skipping`,
        { keys: body && typeof body === "object" ? Object.keys(body) : typeof body },
      );
      continue;
    }
    let added = 0;
    for (const r of results) {
      if (
        r &&
        typeof r === "object" &&
        typeof (r as { url?: unknown }).url === "string"
      ) {
        target.push({
          url: (r as CapturedSearchResult).url,
          title: (r as CapturedSearchResult).title,
        });
        added++;
      }
    }
    console.log(
      `[runCanvasAgent] captured ${added} web_search results from this step (total now ${target.length})`,
    );
  }
}

/**
 * Internal helper: when the agent calls `learn_concept`, fire a
 * `HIGHLIGHT_NODES` event so any open chat UI animates the node.
 * Suppressed when `silentPusher` is true (programmatic callers).
 *
 * **Fire-and-forget**: returns void synchronously; the Pusher round-
 * trip is sent off in the background via `void`. This matches the
 * pre-extraction behavior — the agent loop's `onStepFinish` MUST NOT
 * block on Pusher, or every step adds the Pusher RTT to wall-clock
 * latency (50-200ms per step adds up fast over a long turn).
 *
 * Errors are caught and logged so a Pusher outage cannot reject the
 * background promise into an unhandled-rejection warning that might
 * crash the Node process under strict modes.
 */
function maybeHighlightLearnedConcept(
  contents: unknown,
  primarySlug: string,
  features: Record<string, unknown>[],
): void {
  if (!Array.isArray(contents)) return;
  let conceptRefId: string | undefined;
  for (const content of contents) {
    if (content.type === "tool-call") {
      const toolName: string = content.toolName || "";
      if (toolName === "learn_concept" || toolName.endsWith("__learn_concept")) {
        const conceptId = content.input?.conceptId;
        const feature = features.find((f) => f.id === conceptId);
        if (feature) {
          conceptRefId = feature.ref_id as string;
        }
      }
    }
  }
  if (!conceptRefId) return;
  console.log("learned conceptRefId:", conceptRefId);
  const channelName = getWorkspaceChannelName(primarySlug);
  // Fire-and-forget: do NOT await. See doc-comment.
  void pusherServer
    .trigger(channelName, PUSHER_EVENTS.HIGHLIGHT_NODES, {
      nodeIds: [],
      workspaceId: primarySlug,
      depth: 2,
      title: "Researching...",
      timestamp: Date.now(),
      sourceNodeRefId: conceptRefId,
    })
    .then(() => {
      console.log("highlighted node:", conceptRefId);
    })
    .catch((err) => {
      console.error("[runCanvasAgent] HIGHLIGHT_NODES Pusher trigger failed:", err);
    });
}

// ---------------------------------------------------------------------------
// runCanvasAgent
// ---------------------------------------------------------------------------

/**
 * Build the tool set + prefix messages, sanitize, and kick off the
 * `streamText` agentic loop. Returns the raw stream handle so the
 * caller picks its own consumption mode (SSE wrap, await text, etc.).
 *
 * Auth is the caller's responsibility — this function trusts that
 * `userId` / `publicViewer` already reflect a validated session and
 * that `orgId` (if provided) has been membership-checked. It does
 * NOT re-validate.
 */
export async function runCanvasAgent(
  opts: RunCanvasAgentOptions,
): Promise<RunCanvasAgentResult> {
  const {
    userId,
    orgId,
    workspaceSlugs,
    publicViewer,
    scope,
    messages,
    capabilities = ALL_CAPABILITIES,
    readonly = false,
    keepWriteToolNames,
    silentPusher = false,
    hooks,
    currentCanvasConversationId,
    additionalTools,
    dispatchedResearch,
    dispatchedGraphWalks,
    graphWalkAnswerSink,
    cachedConcepts,
    prepareStep,
    extraStopConditions,
    modelName,
    userTimezone,
  } = opts;

  // When cached concepts are supplied we skip the slow per-workspace
  // `listConcepts` swarm round-trip and feed the cache to the prefix +
  // tools instead. `buildWorkspaceConfigs` still runs (DB-only; needed
  // for swarm creds), and the prefix is still rebuilt fresh each turn so
  // the canvas scope hint stays accurate — only the swarm fetch (the one
  // external/offline-prone HTTP call) is elided. Each branch checks its
  // own cache shape below (`conceptsByWorkspace` vs `features`).

  if (!Array.isArray(workspaceSlugs) || workspaceSlugs.length === 0) {
    throw new Error("runCanvasAgent: workspaceSlugs must be a non-empty array");
  }
  if (workspaceSlugs.length > 20) {
    throw new Error("runCanvasAgent: maximum 20 workspaces allowed per call");
  }

  const isMultiWorkspace = workspaceSlugs.length > 1;
  const primarySlug = workspaceSlugs[0];
  const isPublicViewer = publicViewer !== undefined;

  // Anthropic-only today; model resolution flows through `aieo` (default
  // `claude-sonnet-4-5`) or the mock model when `USE_MOCKS=true`. The
  // `getModel` call is deferred until after workspace resolution so we
  // can thread Bifrost overrides (baseUrl + `x-macaroon` headers) when
  // the rollout flag is on for the primary workspace — see the
  // `getBifrostForLLM` call below.
  const provider: Provider = "anthropic";
  const apiKey = getApiKeyForProvider(provider);

  // ------------------------------------------------------------------
  // Assemble tools + prefix per branch
  // ------------------------------------------------------------------
  let tools: ToolSet;
  let prefixMessages: ModelMessage[];
  let features: Record<string, unknown>[];
  // Concept-cache bookkeeping, assigned per branch below.
  let cacheHit = false;
  let cacheableConcepts: CachedConcepts = {};
  let primarySwarmUrl: string;
  let primarySwarmApiKey: string;
  // Workspace + user identity for the **primary** slug (slugs[0]).
  // Used to:
  //   1. Mint a Bifrost VK / macaroon for this LLM call, when the
  //      `BIFROST_ENABLED` rollout flag covers this primary slug.
  //   2. Stay `undefined` for public-viewer requests (no real user) —
  //      the orchestrator returns `undefined` for those anyway, but
  //      we elide the lookup entirely.
  //
  // Multi-workspace nuance: the agent loop touches N workspaces, but
  // there's only one LLM call. We attribute that call to the primary
  // workspace's Bifrost — mirrors the `primarySwarmUrl` convention
  // and the rollout flag's per-slug allow-list semantics.
  let primaryWorkspaceId: string | undefined;
  let primaryUserId: string | undefined;
  // Prompt-Manager coordinates of the system prompts resolved this turn,
  // keyed by prompt name (e.g. CANVAS_AGENT_SYSTEM_PROMPT). Populated in
  // the multi-workspace (org-canvas) branch; the caller persists it onto
  // `SharedConversation.settings.prompts` so each conversation records
  // which prompt versions produced its turns. Empty when the prompt
  // resolved to the in-repo default (no version to attribute).
  const promptResolutions: Record<
    string,
    { prompt_id: string; prompt_version_id: string | null }
  > = {};
  // Per-call web_search capture, used by `update_research`'s execute
  // closure to linkify Anthropic `<cite index="N-M">` tags. Empty
  // (and unused) when no org-tool branch is built.
  const capturedWebSearchResults: CapturedSearchResult[] = [];

  // Capability composition inputs, shared by both branches below.
  // `orgCapabilities` is the `includes`-expanded selection in canonical
  // order, with org-gated capabilities (e.g. `prompts`, restricted to the
  // Stakwork source-control org) filtered out for orgs that fail the gate.
  // The prompt suffix is the matching snippet concatenation.
  const orgCapabilities = await resolveOrgCapabilities(capabilities, orgId);
  const orgPromptSuffix = orgId
    ? composeCapabilityPromptSuffix(orgCapabilities)
    : undefined;

  if (isMultiWorkspace) {
    // Multi-workspace mode is auth-only — public-viewer requests are
    // rejected by the caller before reaching here. The non-null
    // assertion on `userId` is safe under that contract.
    if (!userId) {
      throw new Error(
        "runCanvasAgent: multi-workspace mode requires a userId",
      );
    }
    const workspaceConfigs = await buildWorkspaceConfigs(workspaceSlugs, userId);
    // Cache hit → reuse cached concepts and skip the swarm fetch. The
    // cached concepts still flow into `askToolsMulti` (so the 3+ workspace
    // `read_concepts_for_repo` tool keeps working) AND into the prefix
    // builder below.
    const multiCacheHit = !!cachedConcepts?.conceptsByWorkspace;
    const conceptsByWorkspace =
      cachedConcepts?.conceptsByWorkspace ??
      (await fetchConceptsForWorkspaces(workspaceConfigs));

    tools = askToolsMulti(workspaceConfigs, apiKey, conceptsByWorkspace);

    if (orgId) {
      // Merge the selected capabilities' org tool families. The caller
      // is responsible for having already validated org membership
      // before calling us. Mirrored in the single-workspace branch
      // below — keep these two sites in sync.
      tools = {
        ...tools,
        ...composeCapabilityTools(orgCapabilities, {
          orgId,
          userId,
          currentCanvasConversationId,
          chatAgentModel: modelName,
          capturedWebSearchResults,
          dispatchedResearch,
          dispatchedGraphWalks,
          graphWalkAnswerSink,
        }),
      };
    }

    features = [];
    for (const ws of workspaceConfigs) {
      features.push(...(conceptsByWorkspace[ws.slug] || []));
    }

    // Initiative scope → look up visually-linked workspaces on root
    // canvas. Only fires when the user is on `initiative:*`. Runs every
    // turn (even on a concept-cache hit) because it feeds the fresh scope
    // hint — it's a cheap DB lookup, not a swarm call.
    let linkedWorkspaces: Array<{ id: string; slug: string; name: string }> = [];
    if (
      orgId &&
      typeof scope?.currentCanvasRef === "string" &&
      scope.currentCanvasRef.startsWith("initiative:")
    ) {
      const initiativeId = scope.currentCanvasRef.slice("initiative:".length);
      if (initiativeId) {
        linkedWorkspaces = await getLinkedWorkspacesForInitiative(
          orgId,
          initiativeId,
        );
      }
    }

    // Persona/reply-style preamble, pulled from the Stakwork Prompt
    // Manager (published CANVAS_AGENT_SYSTEM_PROMPT). Bounded by a 10s
    // deadline and always falls back to the in-repo default.
    const canvasSystemPrompt = await getCanvasSystemPrompt();
    // Record the Prompt-Manager version only when it actually came from
    // the manager (default-fallback has a null promptId — nothing to
    // attribute).
    if (canvasSystemPrompt.promptId != null) {
      promptResolutions[canvasSystemPrompt.name] = {
        prompt_id: canvasSystemPrompt.promptId,
        prompt_version_id: canvasSystemPrompt.promptVersionId,
      };
    }

    // Always rebuilt fresh (cheap string work) so the scope hint reflects
    // the user's CURRENT canvas/selection, even on a concept-cache hit.
    prefixMessages = getMultiWorkspacePrefixMessages(
      workspaceConfigs,
      conceptsByWorkspace,
      [],
      orgId,
      buildScopeHint(scope, linkedWorkspaces),
      orgPromptSuffix,
      canvasSystemPrompt.value,
      userTimezone,
    );
    cacheHit = multiCacheHit;
    cacheableConcepts = { conceptsByWorkspace };
    primarySwarmUrl = workspaceConfigs[0].swarmUrl;
    primarySwarmApiKey = workspaceConfigs[0].swarmApiKey;
    primaryWorkspaceId = workspaceConfigs[0].workspaceId;
    primaryUserId = workspaceConfigs[0].userId;
  } else {
    // Single-workspace mode. Public-viewer requests use the workspace
    // owner's PAT via `buildPublicWorkspaceConfig`; members get the
    // normal per-user path.
    const ws = isPublicViewer
      ? await buildPublicWorkspaceConfig(primarySlug)
      : (await buildWorkspaceConfigs(workspaceSlugs, userId!))[0];

    tools = askTools(ws.swarmUrl, ws.swarmApiKey, ws.repoUrls, ws.pat, apiKey, {
      workspaceId: ws.workspaceId,
      workspaceSlug: ws.slug,
      userId: ws.userId,
    });

    // Best-effort: a swarm timeout/outage here must NOT kill the whole
    // turn. Degrade to an empty concept list (the agent can still call
    // list_concepts itself later, and the prompt just omits the
    // pre-seeded features) instead of throwing a 500. Mirrors the
    // multi-workspace path's `fetchConceptsForWorkspaces`, which
    // already swallows per-workspace failures.
    // Cache hit → reuse cached concepts and skip the swarm fetch.
    const singleCacheHit = !!cachedConcepts?.concepts;
    if (singleCacheHit) {
      features = cachedConcepts!.concepts!;
    } else {
      let concepts: Record<string, unknown> = {};
      try {
        concepts = await listConcepts(ws.swarmUrl, ws.swarmApiKey);
      } catch (e) {
        console.error(
          `[runCanvasAgent] Failed to pre-fetch concepts for ${ws.slug}; continuing without them:`,
          e,
        );
      }
      features = (concepts.concepts as Record<string, unknown>[]) || [];
    }
    cacheHit = singleCacheHit;
    cacheableConcepts = { concepts: features };

    // Single-workspace + orgId: an org-scope caller (e.g. the org-MCP
    // `org_agent` tool, or the org SidebarChat for an org that
    // happens to have just one workspace) gets the canvas/initiative/
    // research/connection tool overlay on top of the per-workspace
    // tools. The org-aware prompt suffixes get appended by
    // `getQuickAskPrefixMessages` below so the agent knows the tools
    // exist and how to use them.
    //
    // Public-viewer requests never carry orgId (the caller in
    // `quick/route.ts` rejects that combination), so this branch is
    // member-auth only and `userId` is non-null.
    if (orgId && userId) {
      tools = {
        ...tools,
        ...composeCapabilityTools(orgCapabilities, {
          orgId,
          userId,
          currentCanvasConversationId,
          chatAgentModel: modelName,
          capturedWebSearchResults,
          dispatchedResearch,
          dispatchedGraphWalks,
          graphWalkAnswerSink,
        }),
      };
    }

    // Always rebuilt fresh so the scope hint stays current on cache hits.
    prefixMessages = getQuickAskPrefixMessages(
      features,
      ws.repoUrls,
      [],
      ws.description,
      ws.members,
      orgId
        ? {
            orgId,
            scope: buildScopeHint(scope, []),
            promptSuffix: orgPromptSuffix,
          }
        : undefined,
      ws.currentUserGithubUsername,
      userTimezone,
    );
    primarySwarmUrl = ws.swarmUrl;
    primarySwarmApiKey = ws.swarmApiKey;
    primaryWorkspaceId = ws.workspaceId;
    // `ws.userId` is `PUBLIC_VIEWER_USER_ID` for public-viewer
    // requests; getBifrostForLLM short-circuits that case to
    // `undefined`. Member requests carry the real NextAuth user id.
    primaryUserId = ws.userId;
  }

  if (readonly) {
    // Strip set derived from the composed capabilities — a tool family
    // we never merged contributes nothing, so the strip always matches
    // what's actually present.
    tools = filterReadonly(
      tools,
      keepWriteToolNames,
      orgId ? composeWriteToolNames(orgCapabilities) : undefined,
    );
  }

  // Merge caller-supplied extra tools AFTER the readonly strip so they
  // survive it (e.g. `stay_silent` on auto-turns). Last spread wins on
  // name collision.
  if (additionalTools) {
    tools = { ...tools, ...additionalTools };
  }

  // ------------------------------------------------------------------
  // Assemble final message list + sanitize
  // ------------------------------------------------------------------
  const rawMessages: ModelMessage[] = [...prefixMessages, ...messages];
  const modelMessages = await sanitizeAndCompleteToolCalls(
    rawMessages,
    primarySwarmUrl,
    primarySwarmApiKey,
  );

  // ------------------------------------------------------------------
  // Bifrost routing for the in-process LLM call.
  //
  // When `BIFROST_ENABLED` covers the primary slug and we have a real
  // (workspaceId, userId) pair, the orchestrator returns `{ apiKey,
  // baseUrl, headers }`. We thread those into `getModel` so the
  // streamText call lands on this workspace's Bifrost VK with the
  // minted `x-macaroon` attached for cost-per-agent observability on
  // `logs.db`. When the flag is off / public viewer / mint fails, the
  // orchestrator returns `undefined` and `getModel` falls back to the
  // default key path (behavior unchanged from pre-Bifrost).
  //
  // `agentName` splits on `orgId` so operators can attribute spend to
  // the user-facing surface:
  //   - `"canvas-agent"` — org canvas SidebarChat (orgId present;
  //     canvas / initiative / research / connection tools merged in;
  //     proposal flows; typically deeper agentic loops).
  //   - `"chat-agent"` — workspace dashboard chat (no orgId; per-
  //     workspace ask tools only; typically read-only Q&A).
  // Same loop, same prompt assembly, but different cost profiles —
  // mirrors the `repo-agent` vs `diagram-agent` convention of naming
  // by user-facing purpose, not by underlying function.
  const agentName = orgId ? "canvas-agent" : "chat-agent";
  const bifrost =
    primaryWorkspaceId && primaryUserId
      ? await getBifrostForLLM(
          {
            workspaceId: primaryWorkspaceId,
            workspaceSlug: primarySlug,
            userId: primaryUserId,
          },
          { agentName },
        )
      : undefined;

  // Honor the caller's model preference only when it targets the
  // Anthropic provider (the canvas agent's only supported provider
  // today). `modelName` is in "provider/name" form; aieo strips the
  // prefix and uses the remainder as the model id. A non-Anthropic
  // selection is ignored so we never pair an OpenAI/Google id with the
  // hardcoded Anthropic provider/key/tools.
  const modelOverride =
    modelName && modelName.startsWith("anthropic/") ? modelName : undefined;

  // Pre-flight the swarm Bifrost gateway. If we can't connect to it
  // (expired cert / connection refused / timeout), discard the whole
  // Bifrost bundle and fall back to the default gateway path — the same
  // route a non-Bifrost workspace takes (default key, no baseUrl, no
  // custom headers). This rescues the turn when a single swarm is down
  // instead of failing the whole request. See `isGatewayReachable`.
  let activeBifrost = bifrost;
  if (bifrost?.baseUrl && !(await isGatewayReachable(bifrost.baseUrl))) {
    console.warn(
      "[runCanvasAgent] Bifrost gateway unreachable; falling back to default gateway",
      {
        workspaces: workspaceSlugs,
        orgId: orgId ?? null,
        baseUrl: bifrost.baseUrl,
        agentName: bifrost.agentName,
      },
    );
    activeBifrost = undefined;
  }

  const model = getModel(
    provider,
    activeBifrost?.apiKey ?? apiKey,
    primarySlug,
    modelOverride,
    activeBifrost
      ? { baseUrl: activeBifrost.baseUrl, headers: activeBifrost.headers }
      : undefined,
  );

  // ------------------------------------------------------------------
  // Provider options — enables Anthropic auto prompt caching
  // (top-level `cache_control` field, supported by @ai-sdk/anthropic
  // 3.0.75+ as bundled by aieo). Also threads `thinking` config.
  // The aieo SDK copy resolves under `node_modules/aieo/node_modules/
  // @ai-sdk/anthropic`, which is the one that actually serializes
  // these options into the API request — confirmed in the SDK source
  // (dist/index.js ~line 3246: `cache_control: anthropicOptions.cacheControl`).
  // ------------------------------------------------------------------
  // Cast: aieo bundles its own `@ai-sdk/provider` type copy, so the
  // returned union doesn't structurally match the `SharedV3ProviderOptions`
  // shape from hive's top-level `ai` package. The runtime payload is
  // identical — aieo created the model with the SDK that consumes it.
  const providerOptions = getProviderOptions(
    provider,
  ) as unknown as Parameters<typeof streamText>[0]["providerOptions"];

  console.log("[runCanvasAgent] streamText:", {
    model: (model as { modelId?: string })?.modelId,
    toolsCount: Object.keys(tools).length,
    messagesCount: modelMessages.length,
    workspaces: workspaceSlugs,
    orgId: orgId ?? null,
    readonly,
    silentPusher,
    bifrost: activeBifrost
      ? { runId: activeBifrost.runId, agentName: activeBifrost.agentName }
      : null,
    bifrostFellBack: !!bifrost && !activeBifrost,
    cacheControl: (providerOptions as { anthropic?: { cacheControl?: unknown } })
      ?.anthropic?.cacheControl ?? null,
  });

  // ------------------------------------------------------------------
  // Kick off the agentic loop
  // ------------------------------------------------------------------
  const result = streamText({
    model,
    tools,
    messages: modelMessages,
    providerOptions,
    stopWhen: [
      createHasEndMarkerCondition(),
      ...(extraStopConditions
        ? Array.isArray(extraStopConditions)
          ? extraStopConditions
          : [extraStopConditions]
        : []),
    ],
    ...(prepareStep ? { prepareStep } : {}),
    stopSequences: ["[END_OF_ANSWER]"],
    onStepFinish: async (sf) => {
      logStep(sf.content);
      // Internal bookkeeping is SYNCHRONOUS and non-awaiting on
      // Pusher — matches pre-extraction behavior where the original
      // route's `onStepFinish` was a sync arrow function. We do NOT
      // want to add the Pusher round-trip (50-200ms) to every agent
      // step's wall-clock time.
      captureWebSearchResultsFromStep(sf.content, capturedWebSearchResults);
      if (!silentPusher) {
        maybeHighlightLearnedConcept(sf.content, primarySlug, features);
      }
      // Caller hook runs LAST so it observes the internal bookkeeping
      // state. Awaited so callers can perform async work (e.g. async
      // token recording, custom logging). Callers MUST keep this fast
      // or they re-introduce the per-step latency regression we just
      // avoided above.
      if (hooks?.onStepFinish) {
        await hooks.onStepFinish(sf);
      }
    },
    onFinish: async ({ usage }) => {
      if (hooks?.onFinish) {
        await hooks.onFinish({ usage });
      }
    },
    // Surface errors that occur DURING streaming (after the 200 response
    // headers are already sent). Without this, the AI SDK silently masks
    // the failure into a generic error part and the real cause (e.g. an
    // Anthropic `invalid_request_error` from an oversized request, or a
    // tool throwing) never lands in the logs — the stream just goes quiet
    // right after the `streamText:` line above. Log the full error so
    // operators can diagnose; the message is also propagated to the client
    // via `toUIMessageStreamResponse({ onError })` in the HTTP route.
    onError: (event) => {
      const err = (event as { error?: unknown })?.error ?? event;
      console.error("[runCanvasAgent] streamText error:", {
        workspaces: workspaceSlugs,
        orgId: orgId ?? null,
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : undefined,
        stack: err instanceof Error ? err.stack : undefined,
        error: err,
      });
    },
  });

  return {
    result,
    primarySwarmUrl,
    primarySwarmApiKey,
    features,
    primarySlug,
    // Both branches above always assign these — the non-null assertion
    // reflects the invariant rather than a runtime check.
    primaryWorkspaceId: primaryWorkspaceId!,
    primaryUserId: primaryUserId!,
    readonly,
    assembledPrefix: prefixMessages,
    cacheableConcepts,
    cacheHit,
    promptResolutions,
  };
}

/**
 * Expose extractConceptIdsFromStep for callers that want to do their
 * own learnedConcepts bookkeeping (e.g. the HTTP route, which tracks
 * the set for post-stream provenance fetch).
 */
export { extractConceptIdsFromStep };

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

export function buildScopeHint(
  scope: RunCanvasAgentOptions["scope"],
  linkedWorkspaces: Array<{ id: string; slug: string; name: string }>,
): CanvasScopeHint | undefined {
  if (!scope && linkedWorkspaces.length === 0) return undefined;
  return {
    currentCanvasRef:
      typeof scope?.currentCanvasRef === "string"
        ? scope.currentCanvasRef
        : undefined,
    currentCanvasBreadcrumb:
      typeof scope?.currentCanvasBreadcrumb === "string"
        ? scope.currentCanvasBreadcrumb
        : undefined,
    selectedNodeId:
      typeof scope?.selectedNodeId === "string" ? scope.selectedNodeId : undefined,
    selectedNodeIds:
      Array.isArray(scope?.selectedNodeIds) &&
      scope.selectedNodeIds.every((s) => typeof s === "string")
        ? scope.selectedNodeIds
        : undefined,
    linkedWorkspaces:
      linkedWorkspaces.length > 0 ? linkedWorkspaces : undefined,
  };
}

function logStep(contents: unknown) {
  if (!Array.isArray(contents)) return;
  for (const content of contents) {
    if (content.type === "tool-call") {
      console.log("TOOL CALL:", content.toolName, ":", content.input);
    }
    if (content.type === "tool-result") {
      console.log("TOOL RESULT:", content.toolName);
    }
  }
}
