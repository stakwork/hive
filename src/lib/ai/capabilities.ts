/**
 * Org-agent capability registry.
 *
 * A **capability** is a composable unit of agent behavior: a tool
 * family, and the subset of tool names that count as writes (stripped
 * in readonly mode). `runCanvasAgent` composes its org toolset +
 * readonly strip set from a selected capability list, so the same
 * agent loop can run on surfaces without a canvas (e.g. planner-only).
 *
 * There is no code-built prompt text at all: Jamie gets ONE system
 * prompt (`CANVAS_AGENT_SYSTEM_PROMPT` from the prompt library, the
 * Available Workspaces section, and the canvas-scope pointer) for
 * every caller — user turns, planner/strut wake turns, and sub-agent
 * workers alike, so they share the Anthropic prompt cache. How to use
 * each capability's tools lives in the tools' own descriptions, and in
 * graph concepts under "Jamie Capabilities" (under `Jamie`) that Jamie
 * reaches by walking the graph from Glimmer. There is no on-demand,
 * agent-triggered loader anymore; every capability's tools are simply
 * registered whenever the capability is selected.
 *
 * Capabilities are defined by INTENT, not by the `buildXTools` factory
 * boundaries — `buildInitiativeTools` in particular spans two
 * capabilities (everything that authors/organizes roadmap structure —
 * the initiative/milestone tools AND `propose_feature` — belongs to
 * `roadmap`; only `send_to_feature_planner` + `read_user_activity`
 * belong to `planner`), so those entries pick the relevant keys out of
 * the factory's output. Likewise `buildCanvasTools`' output is split:
 * `read_canvas` is a `roadmap` tool (you read the canvas to find
 * anchors before proposing); `update_canvas` / `patch_canvas` are
 * `whiteboard` tools.
 *
 * ## Core vs the rest
 *
 * Each capability is still tagged `core: true | false`, but the
 * distinction is now purely organizational (which ones are always
 * selected together via `includes`) — it no longer gates any prompt
 * text or an on-demand instructions menu, since neither exists anymore.
 *
 * ## Org-gated capabilities
 *
 * A capability may carry an async `orgGate`. Gated capabilities are
 * composed (tools only) ONLY for orgs the gate approves; every other
 * org's agent never sees the tools or even learns they exist. Today
 * only `prompts` is gated — the shared prompt library is globally
 * scoped (the `Prompt` model has no org FK), so its read/propose
 * tools are restricted to the Stakwork source-control org (see
 * `capabilityGates.ts`). The gate is applied by the async
 * `resolveOrgCapabilities`; gated capabilities must never appear in an
 * `includes` list (the sync resolver can't run the gate).
 *
 * The five capabilities:
 *   - `roadmap` (CORE) — propose/organize roadmap structure
 *     (initiatives/milestones/features) + `read_canvas`. Folds the rest
 *     of the canvas set in via `includes` so their tools are present
 *     whenever roadmap is selected.
 *   - `planner` (CORE) — driving an EXISTING feature's per-feature
 *     planning agent via `send_to_feature_planner`. Usable without
 *     `roadmap`: the motivating surface is the per-feature Plan page.
 *   - `whiteboard` — free-form canvas drawing/annotation:
 *     `update_canvas` / `patch_canvas`, notes/decisions, edges, layout.
 *   - `research` — Research documents (web-search writeups).
 *   - `connections` — Connection documents (integration writeups).
 */

import { type ToolSet } from "ai";
import { buildCanvasTools } from "@/lib/ai/canvasTools";
import { buildConnectionTools } from "@/lib/ai/connectionTools";
import {
  buildGraphWalkDispatchTools,
  type DispatchedGraphWalkIntent,
} from "@/lib/ai/graphWalkDispatchTools";
import { buildGraphWalkerTools } from "@/lib/ai/graphWalkerTools";
import { buildGraphWriteTools } from "@/lib/ai/graphWriteTools";
import { buildInfraTools } from "@/lib/ai/infraTools";
import { buildInitiativeTools } from "@/lib/ai/initiativeTools";
import { buildPromptTools } from "@/lib/ai/promptTools";
import { buildConceptTools } from "@/lib/ai/conceptTools";
import { buildWorkflowExplorerTools } from "@/lib/ai/workflowExplorerTools";
import {
  isPromptsCapabilityEnabledForOrg,
  isCodeChangeCapabilityEnabledForOrg,
  isStrutCapabilityEnabledForOrg,
} from "@/lib/ai/capabilityGates";
import {
  buildStrutTools,
  DISPATCH_STRUT_TOOL,
  START_JOB_TOOL,
  CONTINUE_JOB_TOOL,
} from "@/lib/ai/strutTools";
import { buildCodeChangeTools } from "@/lib/ai/codeChangeTools";
import { buildHtmlArtifactTools } from "@/lib/ai/htmlArtifactTools";
import {
  buildResearchTools,
  type DispatchedResearchIntent,
} from "@/lib/ai/researchTools";
import type { WebSearchHandle } from "@/lib/ai/provider";
import {
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_MILESTONE_TOOL,
  PROPOSE_NEW_PROMPT_TOOL,
  PROPOSE_PROMPT_UPDATE_TOOL,
  PROPOSE_NEW_CONCEPT_TOOL,
  PROPOSE_CONCEPT_UPDATE_TOOL,
  PROPOSE_CREATE_NODE_TOOL,
  PROPOSE_NODE_EDIT_TOOL,
  PROPOSE_CREATE_TRIPLET_TOOL,
  PROPOSE_CREATE_BATCH_TRIPLET_TOOL,
  PROPOSE_DELETE_EDGE_TOOL,
  PROPOSE_MOVE_NODE_TOOL,
  PROPOSE_DELETE_NODE_TOOL,
  PROPOSE_CODE_CHANGE_TOOL,
} from "@/lib/proposals/types";

export type OrgCapability =
  | "roadmap"
  | "planner"
  | "whiteboard"
  | "research"
  | "connections"
  | "html_pages"
  | "graph_walker"
  | "infra"
  | "prompts"
  | "concepts"
  | "stakwork_workflows"
  | "code_change"
  | "strut";

/**
 * Everything a capability's `buildTools` may need. Mirrors the
 * arguments `runCanvasAgent` used to thread into the four factories
 * directly; the mutable collectors (`webSearch.results`,
 * `dispatchedResearch`) are per-call closures owned by the caller.
 */
export interface CapabilityContext {
  orgId: string;
  userId: string;
  currentCanvasConversationId?: string;
  /**
   * Swarm-reachable public base URL for this Hive deployment (e.g.
   * `https://hive.example.com`). Captured from the request `host` header at
   * the API route level — NEVER derived inside a tool closure via
   * `getBaseUrl()`, which returns `localhost:3000` when there is no host
   * header. Forwarded to `buildWorkflowExplorerTools` so it can build
   * `webhookUrl` for the fan-back safety net without relying on env vars.
   */
  publicBaseUrl?: string;
  /**
   * The user's `chatAgentModel` preference (e.g. `"anthropic/claude-opus-4-6"`).
   * Forwarded to `buildInitiativeTools` so `send_to_feature_planner` can pass
   * it as the `model` arg to `sendFeatureChatMessage`, covering features whose
   * `Feature.model` is not already set (e.g. features not created via canvas).
   */
  chatAgentModel?: string;
  /**
   * The run's `web_search` handle (from `createWebSearch`). Carries the
   * ordered result list `update_research` cites into and the citation
   * treatment for written-up text — which differs by backend, so tools
   * must go through the handle rather than formatting text themselves.
   */
  webSearch: WebSearchHandle;
  dispatchedResearch?: DispatchedResearchIntent[];
  dispatchedGraphWalks?: DispatchedGraphWalkIntent[];
  graphWalkAnswerSink?: { answer: string | null };
  /**
   * Set to `true` when the calling org has been granted the graph-write
   * propose tools (checked via `isGraphWriteCapabilityEnabledForOrg` by
   * the caller before composing the capability context). Defaults to
   * `false` / absent — graph writes are off unless explicitly enabled.
   */
  graphWriteEnabled?: boolean;
}

// Re-export so callers can import from a single location.
export type { DispatchedGraphWalkIntent };

interface CapabilityDefinition {
  buildTools(ctx: CapabilityContext): ToolSet;
  /**
   * Purely organizational now: which capabilities are bundled together
   * via `includes` when `roadmap` is selected. No prompt text or tool
   * hangs off this distinction anymore — how to use a capability's
   * tools lives in the tools' own descriptions, and in graph concepts
   * under "Jamie Capabilities" (under `Jamie`) that Jamie reaches by
   * walking the graph from Glimmer.
   */
  core: boolean;
  /**
   * Bare tool names (no `{slug}__` namespace) that mutate state and
   * are stripped in readonly mode. Proposal tools count: they emit
   * cards rather than writing rows, but a readonly caller wants
   * neither.
   */
  writeToolNames: readonly string[];
  /**
   * Capabilities this one implies. Expanded (transitively) by
   * `resolveCapabilities`, so selecting `roadmap` also pulls in
   * `whiteboard` + `research` + `connections` without listing them.
   *
   * NOTE: a capability carrying an `orgGate` MUST NOT appear in any
   * `includes` list. `includes` is expanded by the sync `resolveCapabilities`
   * (used inside the sync `compose*` helpers), which cannot run an async
   * gate — so an implied gated capability would slip past the gate. Gated
   * capabilities are only ever reached by explicit selection, then filtered
   * by the async `resolveOrgCapabilities`.
   */
  includes?: readonly OrgCapability[];
  /**
   * Optional async org-level access gate. When present, the capability's
   * tools are composed ONLY for orgs where this resolves `true`; every
   * other org never sees them. Absent → available to every org (the
   * default). Applied by `resolveOrgCapabilities`; the sync
   * `resolveCapabilities` ignores it (see the `includes` caveat above).
   * Today only `prompts` is gated (to the Stakwork source-control org).
   */
  orgGate?: (orgId: string | undefined) => Promise<boolean>;
}

function pickTools(tools: ToolSet, names: readonly string[]): ToolSet {
  const out: ToolSet = {};
  for (const name of names) {
    if (tools[name]) out[name] = tools[name];
  }
  return out;
}

// Intent-based split of buildInitiativeTools' output (see module doc).
// All the roadmap-authoring/organizing tools — including
// `propose_feature` — are `roadmap`; `send_to_feature_planner` (drive an
// existing feature's planner) + `read_user_activity` are `planner`.
const ROADMAP_INITIATIVE_TOOL_NAMES = [
  "read_initiative",
  "read_milestone",
  "assign_feature_to_initiative",
  "assign_feature_to_workspace",
  "unassign_feature_from_workspace",
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_FEATURE_TOOL,
  PROPOSE_MILESTONE_TOOL,
] as const;

const PLANNER_TOOL_NAMES = [
  "send_to_feature_planner",
  "cancel_feature_planner",
  "read_user_activity",
] as const;

// `read_canvas` is a roadmap tool (used to find anchors before
// proposing / placing). `update_canvas` + `patch_canvas` are the
// whiteboard draw tools.
const WHITEBOARD_CANVAS_TOOL_NAMES = ["update_canvas", "patch_canvas"] as const;

/** Canonical composition order — also the prompt snippet order. */
export const ALL_CAPABILITIES: readonly OrgCapability[] = [
  "roadmap",
  "planner",
  "whiteboard",
  "research",
  "connections",
  "html_pages",
  "graph_walker",
  "infra",
  "prompts",
  "concepts",
  "stakwork_workflows",
  "code_change",
  "strut",
];

export const CAPABILITY_REGISTRY: Record<OrgCapability, CapabilityDefinition> =
  {
    roadmap: {
      // Both `roadmap` and `planner` call buildInitiativeTools and pick
      // their keys — the factory is a pure ToolSet builder (no I/O at
      // build time), so constructing it twice when both capabilities
      // are selected is cheap and keeps the entries independent.
      // `read_canvas` comes from buildCanvasTools (the only canvas tool
      // roadmap needs; update/patch are whiteboard).
      buildTools: (ctx) => ({
        ...pickTools(buildCanvasTools(ctx.orgId), ["read_canvas"]),
        ...pickTools(
          buildInitiativeTools(
            ctx.orgId,
            ctx.userId,
            ctx.currentCanvasConversationId,
            ctx.chatAgentModel,
          ),
          ROADMAP_INITIATIVE_TOOL_NAMES,
        ),
      }),
      core: true,
      writeToolNames: [
        "assign_feature_to_initiative",
        "assign_feature_to_workspace",
        "unassign_feature_from_workspace",
        PROPOSE_INITIATIVE_TOOL,
        PROPOSE_FEATURE_TOOL,
        PROPOSE_MILESTONE_TOOL,
      ],
      // Pull the rest of the canvas set in so their tools are registered
      // whenever roadmap is selected (the org canvas surface always
      // carried all of these). `prompts` is deliberately NOT included:
      // it's org-gated (see its `orgGate`), and `includes` is expanded by
      // the sync resolver which can't run the gate — so it must stay
      // explicitly-selected-only.
      includes: ["whiteboard", "research", "connections", "html_pages", "graph_walker", "infra", "concepts"],
    },
    planner: {
      buildTools: (ctx) =>
        pickTools(
          buildInitiativeTools(
            ctx.orgId,
            ctx.userId,
            ctx.currentCanvasConversationId,
            ctx.chatAgentModel,
          ),
          PLANNER_TOOL_NAMES,
        ),
      core: true,
      // send_to_feature_planner survives readonly mode — it messages an
      // agent rather than mutating org state directly. cancel_feature_planner
      // does mutate run + feature status, so it is stripped in readonly.
      writeToolNames: ["cancel_feature_planner"],
    },
    whiteboard: {
      buildTools: (ctx) =>
        pickTools(buildCanvasTools(ctx.orgId), WHITEBOARD_CANVAS_TOOL_NAMES),
      core: false,
      writeToolNames: ["update_canvas", "patch_canvas"],
    },
    research: {
      buildTools: (ctx) =>
        buildResearchTools(
          ctx.orgId,
          ctx.userId,
          ctx.webSearch,
          ctx.dispatchedResearch,
          ctx.currentCanvasConversationId,
        ),
      core: false,
      // dispatch_research creates a Research row, so it's a write tool and
      // MUST be stripped in readonly mode. Critically, the research
      // sub-agent (`canvas-research-worker.ts`) runs readonly with only
      // `update_research` kept — if dispatch_research survived, the
      // sub-agent (whose prompt hands it the slug) could re-dispatch
      // itself, colliding on the unique (org_id, slug) constraint (P2002).
      writeToolNames: ["save_research", "dispatch_research", "update_research"],
    },
    connections: {
      buildTools: (ctx) => buildConnectionTools(ctx.orgId, ctx.userId),
      core: false,
      writeToolNames: ["save_connection", "update_connection"],
    },
    html_pages: {
      buildTools: (ctx) => buildHtmlArtifactTools(ctx.orgId, ctx.userId),
      core: false,
      // "Write" here really means "strip in readonly mode" (see the
      // `writeToolNames` field comment above) — `get_html` returns the
      // full page body, so a readonly sub-agent must not keep it: without
      // this a readonly run could read a page via `get_html` and launder
      // it into Postgres through e.g. `update_research`'s `content`
      // field, defeating the S3-pointer-only guarantee.
      writeToolNames: ["save_html", "update_html", "get_html"],
    },
    graph_walker: {
      buildTools: (ctx) => ({
        ...buildGraphWalkerTools(ctx.orgId, ctx.userId),
        ...buildGraphWalkDispatchTools(ctx),
        ...(ctx.graphWriteEnabled
          ? buildGraphWriteTools(ctx.orgId, ctx.userId)
          : {}),
      }),
      // CORE: graph traversal is a hot path (walking roadmap→code, URN
      // dereference from other tools) — its rules live in its tools'
      // own descriptions.
      core: true,
      // dispatch_graph_walk and finalize_graph_walk are stripped in readonly mode
      // to prevent sub-agents from re-dispatching themselves. The graph-write
      // propose tools are also stripped in readonly mode.
      writeToolNames: [
        "dispatch_graph_walk",
        "finalize_graph_walk",
        PROPOSE_CREATE_NODE_TOOL,
        PROPOSE_NODE_EDIT_TOOL,
        PROPOSE_CREATE_TRIPLET_TOOL,
        PROPOSE_CREATE_BATCH_TRIPLET_TOOL,
        PROPOSE_DELETE_EDGE_TOOL,
        PROPOSE_MOVE_NODE_TOOL,
        PROPOSE_DELETE_NODE_TOOL,
      ],
    },
    infra: {
      buildTools: (ctx) => buildInfraTools(ctx.orgId, ctx.userId),
      core: false,
      writeToolNames: [],
    },
    prompts: {
      buildTools: (ctx) => buildPromptTools(ctx.userId),
      core: false,
      writeToolNames: [PROPOSE_NEW_PROMPT_TOOL, PROPOSE_PROMPT_UPDATE_TOOL],
      // Org-gated: the shared prompt library is globally scoped (no org FK),
      // so its read + propose tools are composed ONLY for allow-listed orgs
      // (default: Stakwork). Every other org's agent never sees them.
      // See `capabilityGates.ts`.
      orgGate: isPromptsCapabilityEnabledForOrg,
    },
    concepts: {
      // Workspace-scoped tools (like `propose_feature`): the agent passes a
      // `workspaceSlug`, the tool resolves it under `orgId` and reaches that
      // workspace's swarm. Adds `read_concept_documentation` (raw markdown,
      // no approval) plus the two propose/write tools; concept discovery is
      // still covered by the per-workspace `list_concepts` tool that
      // runCanvasAgent composes.
      buildTools: (ctx) => buildConceptTools(ctx.orgId, ctx.userId),
      // CORE: "remember this" / "note this down" is a common, low-ceremony
      // ask — its rules now live in the propose/read tool descriptions
      // and in graph concepts under `Jamie`, not a prompt snippet.
      core: true,
      // Not gated: unlike the global prompt library, concepts are per-workspace
      // and every workspace already exposes concept read tools to the agent.
      writeToolNames: [PROPOSE_NEW_CONCEPT_TOOL, PROPOSE_CONCEPT_UPDATE_TOOL],
    },
    stakwork_workflows: {
      // Not per-workspace: the tool always targets the hardcoded `stakwork`
      // workspace's swarm, whose Jarvis graph holds the canonical Stakwork
      // Workflow/Skill/Script library (see workflowExplorerTools.ts).
      // Pass the full context so workflowExplorerTools can wire up the
      // webhook fan-back safety net when a canvas conversation is active.
      buildTools: (ctx) => buildWorkflowExplorerTools(ctx),
      core: false,
      // Research tool, read-only by default. Its `run_step` param can launch
      // a single (billable) step execution, but only on explicit user
      // request per the prompt policy — not listed in writeToolNames because
      // stripping it in readonly mode would also remove all research.
      writeToolNames: [],
      // Org-gated to the Stakwork source-control org: the tool exposes the
      // stakwork workspace's workflow graph, so it reuses the same allow-list
      // gate as the global prompt library. Like `prompts`, it must never
      // appear in an `includes` list (the sync resolver can't run the gate).
      orgGate: isPromptsCapabilityEnabledForOrg,
    },
    code_change: {
      // `propose_code_change` — preview diff → approvable PR card. The
      // diff is generated by a DETACHED strut run (`code-change-propose`
      // on the org's swarm; `services/strut-runs.ts`): the tool returns a
      // pending card at once and strut's callback fills it in. (The
      // synchronous swarm repo_agent poll survives behind
      // CODE_CHANGE_VIA_STRUT=false for one release.) The actual PR lands
      // via the createPr adapter in `src/services/swarm/createPr.ts`.
      //
      // NOT in any `includes` list: org-gated via orgGate below, and the
      // sync resolver can't run async gates.
      buildTools: (ctx) => buildCodeChangeTools(ctx),
      core: false,
      // `propose_code_change` is a write tool (emits a proposal card that,
      // when approved, opens a real PR). Strip in readonly mode.
      writeToolNames: [PROPOSE_CODE_CHANGE_TOOL],
      // Org-gated: exposure control only. Real write authorization is
      // enforced at approval time by the createPr adapter.
      // Like `prompts` and `stakwork_workflows`, must never appear in `includes`.
      orgGate: isCodeChangeCapabilityEnabledForOrg,
    },
    strut: {
      // The org strut (its default swarm) as a background sub-agent:
      // `dispatch_strut` (start / continue a builder chat; replies land via
      // strut's turn-end callback — see strutTools.ts) + two thin read
      // tools, and `start_job` / `continue_job` (a job: an agent iterating
      // a plan / document / page in one directory with one memory; replies
      // land via the `job_turn` StrutRun handler, with artifact cards).
      buildTools: (ctx) => buildStrutTools(ctx),
      core: false,
      // Strut has a shell and publishes + runs code on the swarm — a write
      // tool in every sense; a job launches a run there. The two read tools
      // survive readonly mode.
      writeToolNames: [DISPATCH_STRUT_TOOL, START_JOB_TOOL, CONTINUE_JOB_TOOL],
      // Org-gated, opt-in. Like the other gated capabilities, must never
      // appear in an `includes` list.
      orgGate: isStrutCapabilityEnabledForOrg,
    },
  };

/**
 * Expand `includes` transitively and return the resulting set in
 * canonical order. `["roadmap", "planner"]` resolves to all five.
 */
export function resolveCapabilities(
  selected: readonly OrgCapability[],
): OrgCapability[] {
  const resolved = new Set<OrgCapability>();
  const visit = (cap: OrgCapability) => {
    if (resolved.has(cap)) return;
    resolved.add(cap);
    for (const included of CAPABILITY_REGISTRY[cap].includes ?? []) {
      visit(included);
    }
  };
  selected.forEach(visit);
  return ALL_CAPABILITIES.filter((cap) => resolved.has(cap));
}

/**
 * `resolveCapabilities` + per-capability `orgGate` filtering — the async,
 * org-aware entry point `runCanvasAgent` uses to pick the final capability
 * set for a turn.
 *
 * Expands `includes`, then drops any resolved capability whose `orgGate`
 * denies this `orgId` (e.g. `prompts` outside the Stakwork org). Ungated
 * capabilities always survive. The result feeds the sync `compose*`
 * helpers; because gated capabilities never appear in any `includes`, the
 * helpers' internal re-resolution can't re-introduce a filtered-out gated
 * capability.
 *
 * Gates run in parallel; a gate that throws is treated as a denial by the
 * gate implementation (see `capabilityGates.ts`), so this never rejects.
 */
export async function resolveOrgCapabilities(
  selected: readonly OrgCapability[],
  orgId: string | undefined,
): Promise<OrgCapability[]> {
  const resolved = resolveCapabilities(selected);
  const allowed = await Promise.all(
    resolved.map(async (cap) => {
      const gate = CAPABILITY_REGISTRY[cap].orgGate;
      return gate ? await gate(orgId) : true;
    }),
  );
  return resolved.filter((_cap, i) => allowed[i]);
}

/**
 * Merge the selected capabilities' toolsets. Tool names are disjoint
 * across capabilities, so spread order doesn't matter; we still
 * compose in canonical order for determinism. Every capability's tools
 * are registered directly, with no on-demand gate in front of them —
 * how to use them lives in the tools' own descriptions and in graph
 * concepts under "Jamie Capabilities".
 */
export function composeCapabilityTools(
  selected: readonly OrgCapability[],
  ctx: CapabilityContext,
): ToolSet {
  const resolved = resolveCapabilities(selected);
  let tools: ToolSet = {};
  for (const cap of resolved) {
    tools = { ...tools, ...CAPABILITY_REGISTRY[cap].buildTools(ctx) };
  }
  return tools;
}

/**
 * Union of the selected capabilities' write-tool names — the readonly
 * strip set for an agent composed from them.
 */
export function composeWriteToolNames(
  selected: readonly OrgCapability[],
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const cap of resolveCapabilities(selected)) {
    for (const name of CAPABILITY_REGISTRY[cap].writeToolNames) {
      names.add(name);
    }
  }
  return names;
}
