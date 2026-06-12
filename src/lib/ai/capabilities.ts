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
 * capabilities (the initiative/milestone organization tools belong to
 * `canvas`; `propose_feature` + `send_to_feature_planner` belong to
 * `planner`), so those entries pick the relevant keys out of the
 * factory's output.
 *
 * The four capabilities:
 *   - `canvas` — the spatial board AND roadmap organization
 *     (initiatives/milestones). Folds in `research` + `connections`
 *     via `includes`, since the canvas surface has always carried
 *     both.
 *   - `planner` — driving the per-feature planning agents
 *     (`propose_feature`, `send_to_feature_planner`). Usable without
 *     `canvas`: its prompt snippet reads standalone (placement →
 *     `auto`, feature discovery via `<slug>__list_features`).
 *   - `research` — Research documents (web-search writeups).
 *   - `connections` — Connection documents (integration writeups).
 */

import type { ToolSet } from "ai";
import { buildCanvasTools } from "@/lib/ai/canvasTools";
import { buildConnectionTools } from "@/lib/ai/connectionTools";
import { buildInitiativeTools } from "@/lib/ai/initiativeTools";
import {
  buildResearchTools,
  type CapturedSearchResult,
  type DispatchedResearchIntent,
} from "@/lib/ai/researchTools";
import {
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_MILESTONE_TOOL,
} from "@/lib/proposals/types";
import {
  getCanvasCapabilitySnippet,
  getConnectionsCapabilitySnippet,
  getPlannerCapabilitySnippet,
  getResearchCapabilitySnippet,
} from "@/lib/constants/prompt";

export type OrgCapability = "canvas" | "planner" | "research" | "connections";

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
  capturedWebSearchResults: CapturedSearchResult[];
  dispatchedResearch?: DispatchedResearchIntent[];
}

interface CapabilityDefinition {
  buildTools(ctx: CapabilityContext): ToolSet;
  promptSnippet(): string;
  /**
   * Bare tool names (no `{slug}__` namespace) that mutate state and
   * are stripped in readonly mode. Proposal tools count: they emit
   * cards rather than writing rows, but a readonly caller wants
   * neither.
   */
  writeToolNames: readonly string[];
  /**
   * Capabilities this one implies. Expanded (transitively) by
   * `resolveCapabilities`, so selecting `canvas` also pulls in
   * `research` + `connections` without listing them.
   */
  includes?: readonly OrgCapability[];
}

function pickTools(tools: ToolSet, names: readonly string[]): ToolSet {
  const out: ToolSet = {};
  for (const name of names) {
    if (tools[name]) out[name] = tools[name];
  }
  return out;
}

// Intent-based split of buildInitiativeTools' output (see module doc).
const CANVAS_INITIATIVE_TOOL_NAMES = [
  "read_initiative",
  "read_milestone",
  "assign_feature_to_initiative",
  "assign_feature_to_workspace",
  "unassign_feature_from_workspace",
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_MILESTONE_TOOL,
] as const;

const PLANNER_TOOL_NAMES = [
  PROPOSE_FEATURE_TOOL,
  "send_to_feature_planner",
] as const;

/** Canonical composition order — also the prompt snippet order. */
export const ALL_CAPABILITIES: readonly OrgCapability[] = [
  "canvas",
  "planner",
  "research",
  "connections",
];

export const CAPABILITY_REGISTRY: Record<OrgCapability, CapabilityDefinition> =
  {
    canvas: {
      // Both `canvas` and `planner` call buildInitiativeTools and pick
      // their keys — the factory is a pure ToolSet builder (no I/O at
      // build time), so constructing it twice when both capabilities
      // are selected is cheap and keeps the entries independent.
      buildTools: (ctx) => ({
        ...buildCanvasTools(ctx.orgId),
        ...pickTools(
          buildInitiativeTools(
            ctx.orgId,
            ctx.userId,
            ctx.currentCanvasConversationId,
          ),
          CANVAS_INITIATIVE_TOOL_NAMES,
        ),
      }),
      promptSnippet: getCanvasCapabilitySnippet,
      writeToolNames: [
        "update_canvas",
        "patch_canvas",
        "assign_feature_to_initiative",
        "assign_feature_to_workspace",
        "unassign_feature_from_workspace",
        PROPOSE_INITIATIVE_TOOL,
        PROPOSE_MILESTONE_TOOL,
      ],
      includes: ["research", "connections"],
    },
    planner: {
      buildTools: (ctx) =>
        pickTools(
          buildInitiativeTools(
            ctx.orgId,
            ctx.userId,
            ctx.currentCanvasConversationId,
          ),
          PLANNER_TOOL_NAMES,
        ),
      promptSnippet: getPlannerCapabilitySnippet,
      // send_to_feature_planner survives readonly mode (matches the
      // pre-registry strip set — it messages an agent rather than
      // mutating org state directly).
      writeToolNames: [PROPOSE_FEATURE_TOOL],
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
      // dispatch_research survives readonly mode (pre-registry parity).
      writeToolNames: ["save_research", "update_research"],
    },
    connections: {
      buildTools: (ctx) => buildConnectionTools(ctx.orgId, ctx.userId),
      promptSnippet: getConnectionsCapabilitySnippet,
      writeToolNames: ["save_connection", "update_connection"],
    },
  };

/**
 * Expand `includes` transitively and return the resulting set in
 * canonical order. `["canvas", "planner"]` resolves to all four.
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
 * Merge the selected capabilities' toolsets. Tool names are disjoint
 * across capabilities, so spread order doesn't matter; we still
 * compose in canonical order for determinism.
 */
export function composeCapabilityTools(
  selected: readonly OrgCapability[],
  ctx: CapabilityContext,
): ToolSet {
  let tools: ToolSet = {};
  for (const cap of resolveCapabilities(selected)) {
    tools = { ...tools, ...CAPABILITY_REGISTRY[cap].buildTools(ctx) };
  }
  return tools;
}

/**
 * Concatenate the selected capabilities' prompt snippets in canonical
 * order. With the full set this equals `getCanvasPromptSuffix()`.
 */
export function composeCapabilityPromptSuffix(
  selected: readonly OrgCapability[],
): string {
  return resolveCapabilities(selected)
    .map((cap) => CAPABILITY_REGISTRY[cap].promptSnippet())
    .join("");
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
