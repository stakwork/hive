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
import type { StreamTextResult } from "ai";
import {
  getMultiWorkspacePrefixMessages,
  getQuickAskPrefixMessages,
} from "@/lib/constants/prompt";
import type { CanvasScopeHint } from "@/lib/constants/prompt";
import { askTools, listConcepts, createHasEndMarkerCondition } from "@/lib/ai/askTools";
import { askToolsMulti } from "@/lib/ai/askToolsMulti";
import {
  buildWorkspaceConfigs,
  buildPublicWorkspaceConfig,
  fetchConceptsForWorkspaces,
} from "@/lib/ai/workspaceConfig";
import { buildConnectionTools } from "@/lib/ai/connectionTools";
import { buildCanvasTools } from "@/lib/ai/canvasTools";
import { buildInitiativeTools } from "@/lib/ai/initiativeTools";
import { buildResearchTools, type CapturedSearchResult } from "@/lib/ai/researchTools";
import {
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_MILESTONE_TOOL,
} from "@/lib/proposals/types";
import { getLinkedWorkspacesForInitiative } from "@/lib/canvas/linkedWorkspaces";
import { sanitizeAndCompleteToolCalls } from "@/lib/ai/message-sanitizer";
import { getModel, getApiKeyForProvider, type Provider } from "@/lib/ai/provider";
import { getWorkspaceChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";

// ---------------------------------------------------------------------------
// Write-mode tool names — stripped when `readonly: true` is requested.
//
// All entries are bare names (no `{slug}__` namespace). When askToolsMulti
// namespaces a single-WS tool, we never strip those — every name in this
// set is an org-scoped tool produced by buildCanvasTools / buildResearchTools
// / buildConnectionTools / buildInitiativeTools, which are NOT namespaced.
// ---------------------------------------------------------------------------

const READONLY_STRIP_TOOL_NAMES: ReadonlySet<string> = new Set([
  // canvasTools
  "update_canvas",
  "patch_canvas",
  // researchTools
  "save_research",
  "update_research",
  // connectionTools
  "save_connection",
  "update_connection",
  // initiativeTools — DB writes
  "assign_feature_to_initiative",
  "assign_feature_to_workspace",
  "unassign_feature_from_workspace",
  // initiativeTools — proposals (emit cards; user approves)
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_FEATURE_TOOL,
  PROPOSE_MILESTONE_TOOL,
]);

function filterReadonly(tools: ToolSet): ToolSet {
  const out: ToolSet = {};
  for (const [name, def] of Object.entries(tools)) {
    if (READONLY_STRIP_TOOL_NAMES.has(name)) continue;
    out[name] = def;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Code-research tool names — stripped when `stripCodeResearchTools: true` is
// requested.
//
// Use case: the plan-mode org-context scout (`scoutOrgContext`) only wants
// canvas/initiative/research/connection context, not deep codebase research.
// Without this filter the scout will reach for `learn_concept` /
// `read_concepts_for_repo` / `repo_agent` and end up reporting on code
// architecture instead of org-level information (initiatives, notes,
// decisions, research docs).
//
// Stripping happens by base name (after the `{slug}__` prefix in multi-WS
// mode). `web_search` is also stripped because the scout should not be
// doing external research.
//
// Tools that are NOT stripped — they're org-context-shaped, not code:
//   - list_features / read_feature / list_tasks / read_task / check_status
//     (MCP-backed workspace meta — useful for "what's this workspace
//     working on" without diving into code)
//   - everything in the canvas/initiative/research/connection toolsets.
// ---------------------------------------------------------------------------

const CODE_RESEARCH_BASE_NAMES: ReadonlySet<string> = new Set([
  "list_concepts",
  "learn_concept",
  "recent_commits",
  "recent_contributions",
  "repo_agent",
  "search_logs",
  "read_concepts_for_repo",
]);

/**
 * Strip the multi-workspace `{slug}__` prefix so we can compare a tool
 * name against the base-name list. For single-WS mode (no namespace)
 * the input is already the base name.
 */
function baseToolName(name: string): string {
  const idx = name.indexOf("__");
  return idx === -1 ? name : name.slice(idx + 2);
}

function filterCodeResearch(tools: ToolSet): ToolSet {
  const out: ToolSet = {};
  for (const [name, def] of Object.entries(tools)) {
    if (name === "web_search") continue; // shared, not namespaced
    if (CODE_RESEARCH_BASE_NAMES.has(baseToolName(name))) continue;
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

export interface RunCanvasAgentOptions {
  /** NextAuth user id. Required unless `publicViewer` is set. */
  userId: string | null;
  /** Org id (SourceControlOrg.id). When set, merges canvas/connection/initiative/research tools. */
  orgId?: string;
  /** Workspace slugs to expose to the agent. 1..20. */
  workspaceSlugs: string[];
  /** Public-viewer envelope (mutually exclusive with `userId` in practice). */
  publicViewer?: PublicViewerContext;
  /** Canvas page scope hints — only meaningful with `orgId`. */
  scope?: {
    currentCanvasRef?: string;
    currentCanvasBreadcrumb?: string;
    selectedNodeId?: string;
  };
  /** User-visible chat messages, in AI SDK ModelMessage[] form. */
  messages: ModelMessage[];
  /**
   * When `true`, strip all write tools before invoking `streamText`.
   * Use this for read-only callers (e.g. plan-mode org context scout)
   * to guarantee the agent can't mutate canvas/research/connection/
   * initiative state, regardless of what the system prompt says.
   */
  readonly?: boolean;
  /**
   * When `true`, suppress the internal Pusher `HIGHLIGHT_NODES`
   * fan-out fired when the agent calls `learn_concept`. The HTTP
   * chat route leaves this `false` (default) so open chat clients
   * see the "researching" highlight animate. Programmatic callers
   * (no live UI subscriber) should set it `true`.
   */
  silentPusher?: boolean;
  /**
   * When `true`, strip codebase-research tools (`learn_concept`,
   * `read_concepts_for_repo`, `repo_agent`, `recent_commits`,
   * `recent_contributions`, `search_logs`, `list_concepts`) and the
   * shared `web_search` tool, leaving only canvas/initiative/
   * research/connection tools plus MCP-backed workspace meta
   * (`list_features`, `read_feature`, `list_tasks`, etc.).
   *
   * Use for callers that want org-level context only — the plan-mode
   * org-context scout sets this so the agent doesn't wander into
   * code exploration when it should be summarizing canvas notes,
   * initiatives, decisions, and research docs.
   */
  stripCodeResearchTools?: boolean;
  /** Caller-owned side effects. */
  hooks?: CanvasAgentHooks;
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
   * Whether the agent had any write tools available. False when
   * `readonly` was passed; useful for logging / metrics.
   */
  readonly: boolean;
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
    readonly = false,
    silentPusher = false,
    stripCodeResearchTools = false,
    hooks,
  } = opts;

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
  // `claude-sonnet-4-5`) or the mock model when `USE_MOCKS=true`.
  const provider: Provider = "anthropic";
  const apiKey = getApiKeyForProvider(provider);
  const model = getModel(provider, apiKey, primarySlug);

  // ------------------------------------------------------------------
  // Assemble tools + prefix per branch
  // ------------------------------------------------------------------
  let tools: ToolSet;
  let prefixMessages: ModelMessage[];
  let features: Record<string, unknown>[];
  let primarySwarmUrl: string;
  let primarySwarmApiKey: string;
  // Per-call web_search capture, used by `update_research`'s execute
  // closure to linkify Anthropic `<cite index="N-M">` tags. Empty
  // (and unused) when no org-tool branch is built.
  const capturedWebSearchResults: CapturedSearchResult[] = [];

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
    const conceptsByWorkspace = await fetchConceptsForWorkspaces(workspaceConfigs);

    tools = askToolsMulti(workspaceConfigs, apiKey, conceptsByWorkspace);

    if (orgId) {
      // Merge org-scoped tool families. The caller is responsible for
      // having already validated org membership before calling us.
      tools = {
        ...tools,
        ...buildConnectionTools(orgId, userId),
        ...buildCanvasTools(orgId),
        ...buildInitiativeTools(orgId, userId),
        ...buildResearchTools(orgId, userId, capturedWebSearchResults),
      };
    }

    features = [];
    for (const ws of workspaceConfigs) {
      features.push(...(conceptsByWorkspace[ws.slug] || []));
    }

    // Initiative scope → look up visually-linked workspaces on root
    // canvas. Only fires when the user is on `initiative:*`.
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

    prefixMessages = getMultiWorkspacePrefixMessages(
      workspaceConfigs,
      conceptsByWorkspace,
      [],
      orgId,
      buildScopeHint(scope, linkedWorkspaces),
    );
    primarySwarmUrl = workspaceConfigs[0].swarmUrl;
    primarySwarmApiKey = workspaceConfigs[0].swarmApiKey;
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

    const concepts = await listConcepts(ws.swarmUrl, ws.swarmApiKey);
    features = (concepts.features as Record<string, unknown>[]) || [];

    prefixMessages = getQuickAskPrefixMessages(
      features,
      ws.repoUrls,
      [],
      ws.description,
      ws.members,
    );
    primarySwarmUrl = ws.swarmUrl;
    primarySwarmApiKey = ws.swarmApiKey;
  }

  if (readonly) {
    tools = filterReadonly(tools);
  }
  if (stripCodeResearchTools) {
    tools = filterCodeResearch(tools);
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

  console.log("[runCanvasAgent] streamText:", {
    model: (model as { modelId?: string })?.modelId,
    toolsCount: Object.keys(tools).length,
    messagesCount: modelMessages.length,
    workspaces: workspaceSlugs,
    orgId: orgId ?? null,
    readonly,
    stripCodeResearchTools,
    silentPusher,
  });

  // ------------------------------------------------------------------
  // Kick off the agentic loop
  // ------------------------------------------------------------------
  const result = streamText({
    model,
    tools,
    messages: modelMessages,
    stopWhen: createHasEndMarkerCondition(),
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
  });

  return {
    result,
    primarySwarmUrl,
    primarySwarmApiKey,
    features,
    primarySlug,
    readonly,
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

function buildScopeHint(
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
