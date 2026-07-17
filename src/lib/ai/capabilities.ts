/**
 * Org-agent capability registry.
 *
 * A **capability** is a composable unit of agent behavior: a tool
 * family, the prompt snippet that teaches those tools, and the subset
 * of tool names that count as writes (stripped in readonly mode).
 * `runCanvasAgent` composes its org toolset + prompt suffix + readonly
 * strip set from a selected capability list, so the same agent loop
 * can run on surfaces without a canvas (e.g. planner-only).
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
 * ## Core vs loadable (progressive disclosure)
 *
 * Each capability is tagged `core: true | false`.
 *   - **Core** capabilities' prompt snippets are emitted up-front in
 *     the agent's system prompt every turn. These are the hot path:
 *     `roadmap` (propose a feature / organize the roadmap), `planner`
 *     (drive it with `send_to_feature_planner`), and `graph_walker`
 *     (walk the knowledge graph / dereference URNs — common enough that
 *     its snippet rides up-front rather than behind `learn_capability`;
 *     ephemeral prompt caching makes the marginal cost a cached read).
 *   - **Loadable** capabilities (`whiteboard`, `research`,
 *     `connections`, `infra`) are NOT in the up-front prompt. Instead the core
 *     suffix carries a one-line menu, and the agent calls the
 *     `learn_capability` tool to pull a loadable snippet on demand. The
 *     tools themselves are always registered (the AI SDK fixes the
 *     toolset at call start), so the gate is the prompt: the agent is
 *     told to `learn_capability(...)` before using a loadable tool.
 *
 * This keeps the always-on prompt small (~roadmap + planner) while the
 * heavy canvas-drawing / connection / research-doc instructions only
 * cost tokens on the rarer turns that actually need them.
 *
 * ## Org-gated capabilities
 *
 * A capability may carry an async `orgGate`. Gated capabilities are
 * composed (tools + prompt snippet + menu) ONLY for orgs the gate
 * approves; every other org's agent never sees the tools or even learns
 * they exist. Today only `prompts` is gated — the shared prompt library is
 * globally scoped (the `Prompt` model has no org FK), so its read/propose
 * tools are restricted to the Stakwork source-control org (see
 * `capabilityGates.ts`). The gate is applied by the async
 * `resolveOrgCapabilities`; gated capabilities must never appear in an
 * `includes` list (the sync resolver can't run the gate).
 *
 * The five capabilities:
 *   - `roadmap` (CORE) — propose/organize roadmap structure
 *     (initiatives/milestones/features) + `read_canvas`. Folds in the
 *     loadable trio via `includes` so their tools + the menu are
 *     present whenever roadmap is selected.
 *   - `planner` (CORE) — driving an EXISTING feature's per-feature
 *     planning agent via `send_to_feature_planner`. Usable without
 *     `roadmap`: the motivating surface is the per-feature Plan page.
 *   - `whiteboard` (LOADABLE) — free-form canvas drawing/annotation:
 *     `update_canvas` / `patch_canvas`, notes/decisions, edges, layout.
 *   - `research` (LOADABLE) — Research documents (web-search writeups).
 *   - `connections` (LOADABLE) — Connection documents (integration
 *     writeups).
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { buildCanvasTools } from "@/lib/ai/canvasTools";
import { buildConnectionTools } from "@/lib/ai/connectionTools";
import {
  buildGraphWalkDispatchTools,
  type DispatchedGraphWalkIntent,
} from "@/lib/ai/graphWalkDispatchTools";
import { buildGraphWalkerTools } from "@/lib/ai/graphWalkerTools";
import { buildInfraTools } from "@/lib/ai/infraTools";
import { buildInitiativeTools } from "@/lib/ai/initiativeTools";
import { buildPromptTools } from "@/lib/ai/promptTools";
import { buildConceptTools } from "@/lib/ai/conceptTools";
import { buildWorkflowExplorerTools } from "@/lib/ai/workflowExplorerTools";
import { isPromptsCapabilityEnabledForOrg } from "@/lib/ai/capabilityGates";
import {
  buildResearchTools,
  type CapturedSearchResult,
  type DispatchedResearchIntent,
} from "@/lib/ai/researchTools";
import {
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_MILESTONE_TOOL,
  PROPOSE_NEW_PROMPT_TOOL,
  PROPOSE_PROMPT_UPDATE_TOOL,
  PROPOSE_NEW_CONCEPT_TOOL,
  PROPOSE_CONCEPT_UPDATE_TOOL,
} from "@/lib/proposals/types";
import {
  getConceptsCapabilitySnippet,
  getConnectionsCapabilitySnippet,
  getGraphWalkerCapabilitySnippet,
  getInfraCapabilitySnippet,
  getPlannerCapabilitySnippet,
  getPromptsCapabilitySnippet,
  getResearchCapabilitySnippet,
  getRoadmapCapabilitySnippet,
  getWhiteboardCapabilitySnippet,
  getWorkflowsCapabilitySnippet,
} from "@/lib/constants/prompt";

export type OrgCapability =
  | "roadmap"
  | "planner"
  | "whiteboard"
  | "research"
  | "connections"
  | "graph_walker"
  | "infra"
  | "prompts"
  | "concepts"
  | "workflows";

/**
 * Everything a capability's `buildTools` may need. Mirrors the
 * arguments `runCanvasAgent` used to thread into the four factories
 * directly; the mutable collectors (`capturedWebSearchResults`,
 * `dispatchedResearch`) are per-call closures owned by the caller.
 */
export interface CapabilityContext {
  orgId: string;
  userId: string;
  currentCanvasConversationId?: string;
  /**
   * The user's `chatAgentModel` preference (e.g. `"anthropic/claude-opus-4-6"`).
   * Forwarded to `buildInitiativeTools` so `send_to_feature_planner` can pass
   * it as the `model` arg to `sendFeatureChatMessage`, covering features whose
   * `Feature.model` is not already set (e.g. features not created via canvas).
   */
  chatAgentModel?: string;
  capturedWebSearchResults: CapturedSearchResult[];
  dispatchedResearch?: DispatchedResearchIntent[];
  dispatchedGraphWalks?: DispatchedGraphWalkIntent[];
  graphWalkAnswerSink?: { answer: string | null };
}

// Re-export so callers can import from a single location.
export type { DispatchedGraphWalkIntent };

interface CapabilityDefinition {
  buildTools(ctx: CapabilityContext): ToolSet;
  promptSnippet(): string;
  /**
   * Core capabilities are taught up-front in the system prompt every
   * turn; loadable ones (`core: false`) are taught only when the agent
   * calls `learn_capability`. See the module doc.
   */
  core: boolean;
  /**
   * One-line "what this lets you do / when to load it" blurb, shown in
   * the loadable-capability menu appended to the core prompt suffix.
   * Only consumed for loadable capabilities.
   */
  menuBlurb?: string;
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
   * Optional async org-level access gate. When present, the capability is
   * composed (tools + prompt snippet + menu) ONLY for orgs where this
   * resolves `true`; every other org never sees it. Absent → available to
   * every org (the default). Applied by `resolveOrgCapabilities`; the sync
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

const PLANNER_TOOL_NAMES = ["send_to_feature_planner", "read_user_activity"] as const;

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
  "graph_walker",
  "infra",
  "prompts",
  "concepts",
  "workflows",
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
      promptSnippet: getRoadmapCapabilitySnippet,
      core: true,
      writeToolNames: [
        "assign_feature_to_initiative",
        "assign_feature_to_workspace",
        "unassign_feature_from_workspace",
        PROPOSE_INITIATIVE_TOOL,
        PROPOSE_FEATURE_TOOL,
        PROPOSE_MILESTONE_TOOL,
      ],
      // Pull the loadable set in so their tools are registered and the
      // learn_capability menu lists them whenever roadmap is selected
      // (the org canvas surface always carried all of these). `prompts` is
      // deliberately NOT included: it's org-gated (see its `orgGate`), and
      // `includes` is expanded by the sync resolver which can't run the
      // gate — so it must stay explicitly-selected-only.
      includes: ["whiteboard", "research", "connections", "graph_walker", "infra", "concepts"],
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
      promptSnippet: getPlannerCapabilitySnippet,
      core: true,
      // No write tools to strip: send_to_feature_planner survives
      // readonly mode (matches the pre-registry strip set — it messages
      // an agent rather than mutating org state directly).
      writeToolNames: [],
    },
    whiteboard: {
      buildTools: (ctx) =>
        pickTools(buildCanvasTools(ctx.orgId), WHITEBOARD_CANVAS_TOOL_NAMES),
      promptSnippet: getWhiteboardCapabilitySnippet,
      core: false,
      menuBlurb:
        "**whiteboard** — draw/diagram on the canvas: notes, decisions, " +
        "service cards, edges, and full re-layouts (`update_canvas` / " +
        "`patch_canvas`). Load before drawing/annotating or laying out " +
        "the canvas freehand.",
      writeToolNames: ["update_canvas", "patch_canvas"],
    },
    research: {
      buildTools: (ctx) =>
        buildResearchTools(
          ctx.orgId,
          ctx.userId,
          ctx.capturedWebSearchResults,
          ctx.dispatchedResearch,
          ctx.currentCanvasConversationId,
        ),
      promptSnippet: getResearchCapabilitySnippet,
      core: false,
      menuBlurb:
        "**research** — create saved Research documents (markdown " +
        "writeups from web search, projected as canvas cards): " +
        "`dispatch_research` / `save_research` / `update_research`. Load " +
        "when the user asks you to research a topic and save the writeup. " +
        "(Plain `web_search` to inform an answer does NOT need this.)",
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
      promptSnippet: getConnectionsCapabilitySnippet,
      core: false,
      menuBlurb:
        "**connections** — author Connection documents describing how two " +
        "or more systems integrate (with mermaid diagrams): " +
        "`save_connection` / `update_connection`. Load when documenting an " +
        "integration between systems/workspaces.",
      writeToolNames: ["save_connection", "update_connection"],
    },
    graph_walker: {
      buildTools: (ctx) => ({
        ...buildGraphWalkerTools(ctx.orgId, ctx.userId),
        ...buildGraphWalkDispatchTools(ctx),
      }),
      promptSnippet: getGraphWalkerCapabilitySnippet,
      // CORE: graph traversal is a hot path (walking roadmap→code, URN
      // dereference from other tools), so its snippet rides in the
      // up-front prompt every turn rather than behind `learn_capability`.
      // With ephemeral prompt caching the marginal cost is a cached read.
      // No menuBlurb: core capabilities are inlined, not menu-listed.
      core: true,
      // dispatch_graph_walk and finalize_graph_walk are stripped in readonly mode
      // to prevent sub-agents from re-dispatching themselves.
      writeToolNames: ["dispatch_graph_walk", "finalize_graph_walk"],
    },
    infra: {
      buildTools: (ctx) => buildInfraTools(ctx.orgId, ctx.userId),
      promptSnippet: getInfraCapabilitySnippet,
      core: false,
      menuBlurb:
        "**infra** — read a workspace's stored pod config files " +
        "(Dockerfile, pm2.config.js, docker-compose.yml, devcontainer.json) via " +
        "`read_pod_infra`; env values masked. Load when the user asks about a " +
        "workspace's pod/Docker/build setup.",
      writeToolNames: [],
    },
    prompts: {
      buildTools: (ctx) => buildPromptTools(ctx.userId),
      promptSnippet: getPromptsCapabilitySnippet,
      core: false,
      menuBlurb:
        "**prompts** — read and propose changes to shared prompts in the Hive prompt library: " +
        "`get_prompt` / `list_prompts` (read, no approval) and `propose_new_prompt` / " +
        "`propose_prompt_update` (write via human approval). Load when the user asks about " +
        "prompts, wants to view or update a prompt, or needs to create a new one.",
      writeToolNames: [PROPOSE_NEW_PROMPT_TOOL, PROPOSE_PROMPT_UPDATE_TOOL],
      // Org-gated: the shared prompt library is globally scoped (no org FK),
      // so its read + propose tools are composed ONLY for allow-listed orgs
      // (default: Stakwork). Every other org's agent never sees the tools,
      // the menu entry, or the prompt content. See `capabilityGates.ts`.
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
      promptSnippet: getConceptsCapabilitySnippet,
      core: false,
      menuBlurb:
        "**concepts** — read, capture, and update workspace knowledge-base " +
        "concepts: `read_concept_documentation` (read raw markdown, no " +
        "approval) plus `propose_new_concept` (create from documentation you " +
        "provide, no codebase analysis) and `propose_concept_update` (edit a " +
        "concept's documentation, shown as a diff) via human approval. Load " +
        'when the user says things like "remember this", "note this down", or ' +
        "asks to create/update a concept.",
      // Not gated: unlike the global prompt library, concepts are per-workspace
      // and every workspace already exposes concept read tools to the agent.
      writeToolNames: [PROPOSE_NEW_CONCEPT_TOOL, PROPOSE_CONCEPT_UPDATE_TOOL],
    },
    workflows: {
      // Not per-workspace: the tool always targets the hardcoded `stakwork`
      // workspace's swarm, whose Jarvis graph holds the canonical Stakwork
      // Workflow/Skill/Script library (see workflowExplorerTools.ts).
      buildTools: () => buildWorkflowExplorerTools(),
      promptSnippet: getWorkflowsCapabilitySnippet,
      core: false,
      menuBlurb:
        "**workflows** — research the Stakwork workflow library via " +
        "`workflow_explorer_agent`: find existing Workflows/Skills/Scripts " +
        "by what they take as input and produce as output, read proven step " +
        "orderings, and spot gaps. Load when designing or discussing a new " +
        "Stakwork workflow.",
      // Read-only research tool — nothing to strip in readonly mode.
      writeToolNames: [],
      // Org-gated to the Stakwork source-control org: the tool exposes the
      // stakwork workspace's workflow graph, so it reuses the same allow-list
      // gate as the global prompt library. Like `prompts`, it must never
      // appear in an `includes` list (the sync resolver can't run the gate).
      orgGate: isPromptsCapabilityEnabledForOrg,
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

/** Loadable (non-core) capabilities within a resolved selection. */
function loadableCapabilities(
  resolved: readonly OrgCapability[],
): OrgCapability[] {
  return resolved.filter((cap) => !CAPABILITY_REGISTRY[cap].core);
}

/**
 * The `learn_capability` tool. Returns a loadable capability's full
 * prompt snippet on demand, so the heavy whiteboard / research /
 * connection instructions stay out of the always-on system prompt
 * (progressive disclosure — see module doc). Only the loadable
 * capabilities present in `resolved` are accepted; passing a core or
 * unavailable name returns guidance rather than throwing.
 *
 * The capability's tools are already registered (the AI SDK fixes the
 * toolset at call start); this tool only injects the instructions the
 * agent needs to use them correctly.
 */
function buildLearnCapabilityTool(resolved: readonly OrgCapability[]): ToolSet {
  const loadable = loadableCapabilities(resolved);
  if (loadable.length === 0) return {};
  return {
    learn_capability: tool({
      description:
        "Load the detailed instructions for an advanced capability " +
        "before you use its tools. Available capabilities: " +
        loadable.join(", ") +
        ". Call this FIRST whenever the user wants to: draw / diagram / " +
        "annotate / re-lay-out the canvas (`whiteboard`), create a saved " +
        "research writeup (`research`), document a system integration " +
        "(`connections`), or remember / note / create / update a workspace " +
        "knowledge-base concept (`concepts`). " +
        "You MUST load a capability before calling any of its tools; if you " +
        "find yourself about to call one of those tools without having loaded " +
        "its capability this turn, call `learn_capability` first. Returns the " +
        "full rules for that capability.",
      inputSchema: z.object({
        capability: z
          .enum(loadable as [OrgCapability, ...OrgCapability[]])
          .describe("Which capability's instructions to load."),
      }),
      execute: async ({ capability }: { capability: OrgCapability }) => {
        const def = CAPABILITY_REGISTRY[capability];
        if (!def || def.core || !loadable.includes(capability)) {
          return {
            error:
              "Unknown or unavailable capability. Available: " +
              loadable.join(", "),
          };
        }
        return { capability, instructions: def.promptSnippet() };
      },
    }),
  };
}

/**
 * Merge the selected capabilities' toolsets. Tool names are disjoint
 * across capabilities, so spread order doesn't matter; we still
 * compose in canonical order for determinism. When any loadable
 * capability is present, a `learn_capability` tool is added so the
 * agent can pull its instructions on demand.
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
  tools = { ...tools, ...buildLearnCapabilityTool(resolved) };
  return tools;
}

/**
 * Build the system-prompt suffix for the selected capabilities.
 *
 * Core capabilities' snippets are emitted inline, in canonical order.
 * Loadable capabilities are NOT inlined; instead a short menu lists
 * them and tells the agent to call `learn_capability` before using
 * their tools (progressive disclosure — keeps the always-on prompt
 * small). With the full set this is roadmap + planner inline + a
 * three-item menu, NOT the full `getCanvasPromptSuffix()`.
 */
export function composeCapabilityPromptSuffix(
  selected: readonly OrgCapability[],
): string {
  const resolved = resolveCapabilities(selected);
  const core = resolved
    .filter((cap) => CAPABILITY_REGISTRY[cap].core)
    .map((cap) => CAPABILITY_REGISTRY[cap].promptSnippet())
    .join("");

  const loadable = loadableCapabilities(resolved);
  if (loadable.length === 0) return core;

  const menu = loadable
    .map((cap) => `- ${CAPABILITY_REGISTRY[cap].menuBlurb}`)
    .join("\n");

  return (
    core +
    `

## More capabilities (load on demand)

These advanced capabilities are available but their detailed rules are NOT loaded yet. Before using ANY of their tools, you MUST call \`learn_capability(<name>)\` first to load the instructions — do not call a capability's tools until you have loaded it this session:

${menu}

Only load a capability when the user's request actually calls for it; for the common "propose a feature, then send it to its planner" flow you don't need any of these.`
  );
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
