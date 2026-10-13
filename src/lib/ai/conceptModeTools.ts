/**
 * Concept mode's toolset — the short, global alternative to full mode's
 * per-workspace `{slug}__tool` surface (see `RunCanvasAgentOptions.mode`).
 *
 * Every tool is global and named bare. The three that act on one workspace
 * (`repo_agent`, `logs_agent`, `search_logs`) take a required `workspace`
 * slug and delegate to the same bodies `askToolsMulti` uses (see
 * `workspaceTools.ts`). Everything else comes from the capability registry's
 * own builders, so org gates (`prompts`, `strut`, graph writes) and the
 * readonly strip behave exactly as in full mode: a capability the org
 * lacks contributes nothing.
 *
 * Not here, on purpose: the per-workspace read tools (`list_concepts`,
 * `learn_concept`, `recent_commits`, `list_features`, …), `learn_capability`,
 * Sphinx, external MCP, connections, infra, workflow explorer, graph-walk
 * dispatch, `unassign_feature_from_workspace`. `web_search` / `web_fetch`
 * are registered by `runCanvasAgent`, and `schedule_check` arrives through
 * `additionalTools`, both as in full mode.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { AskToolsContext } from "./askTools";
import { CAPABILITY_REGISTRY, pickTools, type CapabilityContext, type OrgCapability } from "./capabilities";
import type { WorkspaceConfig } from "./types";
import {
  logsAgentDescription,
  logsAgentExecute,
  logsAgentInputSchema,
  repoAgentConceptDescription,
  repoAgentExecute,
  repoAgentInputSchema,
  searchLogsDescription,
  searchLogsExecute,
  searchLogsInputSchema,
} from "./workspaceTools";

/**
 * The tools concept mode keeps from each capability. The registry builders
 * return more (e.g. `roadmap` also builds `unassign_feature_from_workspace`,
 * `graph_walker` also builds the graph-walk dispatch pair) — only these
 * names survive. Names are literals (pinned against the builders by
 * `concept-mode-tools.test.ts`) so this module never reads constants off
 * modules that tests mock wholesale.
 */
export const CONCEPT_MODE_CAPABILITY_TOOLS: Partial<Record<OrgCapability, readonly string[]>> = {
  roadmap: [
    "read_canvas",
    "read_initiative",
    "read_milestone",
    "propose_initiative",
    "propose_feature",
    "propose_milestone",
    "assign_feature_to_initiative",
    "assign_feature_to_workspace",
  ],
  planner: ["send_to_feature_planner", "cancel_feature_planner", "read_user_activity"],
  whiteboard: ["update_canvas", "patch_canvas"],
  strut: ["dispatch_strut", "check_strut_chat", "list_strut_chats", "start_job", "continue_job"],
  concepts: ["read_concept_documentation", "propose_new_concept", "propose_concept_update"],
  html_pages: ["save_html", "update_html", "get_html"],
  research: ["dispatch_research", "save_research", "update_research", "list_research", "read_research"],
  prompts: ["get_prompt", "list_prompts", "propose_new_prompt", "propose_prompt_update"],
  graph_walker: [
    "graph_get",
    "graph_neighbors",
    "graph_search",
    "graph_query",
    "graph_ontology",
    "get_ontology_type",
    // Present only when the org has graph writes enabled (the capability
    // builder gates them on `ctx.graphWriteEnabled`).
    "propose_create_node",
    "propose_node_edit",
    "propose_create_triplet",
    "propose_create_batch_triplet",
    "propose_delete_edge",
    "propose_move_node",
    "propose_delete_node",
  ],
};

/** The workspace-scoped tools concept mode exposes as global tools. */
export const CONCEPT_MODE_WORKSPACE_TOOL_NAMES = ["repo_agent", "logs_agent", "search_logs"] as const;

/** Return `tools` with its keys in name order (stable across turns → cacheable). */
export function sortToolsByName(tools: ToolSet): ToolSet {
  const out: ToolSet = {};
  for (const name of Object.keys(tools).sort()) out[name] = tools[name];
  return out;
}

/** Resolve the `workspace` argument against the org's workspaces. */
function resolveWorkspace(
  workspaceConfigs: readonly WorkspaceConfig[],
  slug: unknown,
): { ws: WorkspaceConfig } | { error: string } {
  const ws = workspaceConfigs.find((w) => w.slug === slug);
  if (ws) return { ws };
  const valid = workspaceConfigs.map((w) => w.slug).join(", ");
  return {
    error: `Unknown workspace ${JSON.stringify(slug)}. \`workspace\` must be one of: ${valid}.`,
  };
}

/**
 * `repo_agent` / `logs_agent` / `search_logs` as global tools. `workspace`
 * is a required enum of the org's slugs — except for a one-workspace org,
 * where it defaults to that slug.
 */
function buildWorkspaceScopedTools(workspaceConfigs: readonly WorkspaceConfig[], context?: AskToolsContext): ToolSet {
  const slugs = workspaceConfigs.map((w) => w.slug) as [string, ...string[]];
  const workspaceField = (() => {
    const base = z.enum(slugs);
    return slugs.length === 1
      ? base
          .default(slugs[0])
          .describe(`Workspace slug. Defaults to \`${slugs[0]}\`, this organization's only workspace.`)
      : base.describe("Workspace slug — one of the slugs in Available Workspaces.");
  })();
  const subject = "the workspace named by the `workspace` argument";
  const ref = (t: string) => `\`${t}\``;
  const workspaceNote = " Requires `workspace`: a slug from Available Workspaces.";

  // `workspace` is resolved here, then the shared per-workspace body runs
  // unchanged. `tool()` is an identity helper; the cast only sidesteps its
  // overloads, which can't infer through the generic `extend`.
  const scoped = <S extends z.ZodObject<z.ZodRawShape>>(
    description: string,
    schema: S,
    run: (ws: WorkspaceConfig, input: z.infer<S>) => Promise<unknown> | unknown,
  ) =>
    tool({
      description,
      inputSchema: schema.extend({ workspace: workspaceField }),
      execute: async (input: z.infer<S> & { workspace: string }) => {
        const resolved = resolveWorkspace(workspaceConfigs, input.workspace);
        if ("error" in resolved) return resolved.error;
        return run(resolved.ws, input);
      },
    } as never);

  return {
    repo_agent: scoped(repoAgentConceptDescription(subject) + workspaceNote, repoAgentInputSchema, (ws, input) =>
      repoAgentExecute(ws, context)(input),
    ),
    search_logs: scoped(searchLogsDescription({ subject, ref }) + workspaceNote, searchLogsInputSchema, (ws, input) =>
      searchLogsExecute(ws)(input),
    ),
    logs_agent: scoped(logsAgentDescription({ subject, ref }) + workspaceNote, logsAgentInputSchema, (ws, input) =>
      logsAgentExecute(ws)(input),
    ),
  } as ToolSet;
}

export function buildConceptModeTools(args: {
  workspaceConfigs: readonly WorkspaceConfig[];
  /** The turn's gate-resolved capabilities (`resolveOrgCapabilities`). */
  orgCapabilities: readonly OrgCapability[];
  capabilityContext: CapabilityContext;
  askContext?: AskToolsContext;
}): ToolSet {
  const { workspaceConfigs, orgCapabilities, capabilityContext, askContext } = args;
  let tools: ToolSet = buildWorkspaceScopedTools(workspaceConfigs, askContext);
  for (const cap of orgCapabilities) {
    const keep = CONCEPT_MODE_CAPABILITY_TOOLS[cap];
    if (!keep) continue;
    tools = {
      ...tools,
      ...pickTools(CAPABILITY_REGISTRY[cap].buildTools(capabilityContext), keep),
    };
  }
  return sortToolsByName(tools);
}
