import { createHash } from "crypto";

import { db } from "@/lib/db";

import {
  AGENT_CATALOG_SOURCE,
  DEFAULT_AGENT_MODEL,
} from "./constants";
import { BIFROST_AGENT_NAMES, type BifrostAgentName } from "./agent-names";
import type {
  AgentCatalogManifest,
  AgentCatalogManifestAgent,
} from "./types";

/**
 * The default agent catalog Hive seeds into each swarm's gateway.
 *
 * This is the bridge between Hive's compile-time `BIFROST_AGENT_NAMES`
 * (the source of truth for *which* agents exist — every LLM call site
 * is typed against it) and the gateway's neo4j catalog (the source of
 * truth for what each agent *is*). The two join by `name` — the same
 * string the `x-bf-dim-agent-name` header carries.
 *
 * Each agent declares its identity + default model, plus the names of
 * the `:Prompt` nodes it uses. Those prompt names come from Hive's
 * `Prompt.agentNames` column and link `HiveAgent-[:HAS_PROMPT]->Prompt`
 * in the graph (the gateway skips any name with no matching node).
 * Tools / skills are left empty and authored later in the gateway UI.
 *
 * Adding a new call site means adding it to `BIFROST_AGENT_NAMES`; give
 * it an entry here too so it shows up in the catalog with a sensible
 * display name (the `display` fallback covers the case where someone
 * forgets).
 */
export interface DefaultAgentSpec {
  displayName: string;
  description: string;
  /** Override `DEFAULT_AGENT_MODEL` for this agent (none do yet). */
  defaultModel?: string;
  /**
   * Skill names this agent *can* load — the palette Hive seeds into the
   * catalog. Names must exist in `SKILL_DESCRIPTIONS`.
   */
  skills?: string[];
  /** Tool names this agent *can* call — seeded as a palette. */
  tools?: string[];
}

/**
 * The palette of skills / tools the repo-oriented agents seed into the
 * catalog. Both are just names Hive pushes; which of them are actually
 * active is a per-swarm boolean toggle in the gateway UI, and the
 * gateway preserves that toggle across re-seeds (Hive never sends the
 * enabled/disabled state, only the palette). Order is fixed so the
 * manifest hash stays stable.
 */
export const SKILL_DESCRIPTIONS = {
  "frontend-design": "Produces polished, production-grade frontend UI.",
  "code-simplifier": "Refactors code for clarity while preserving behavior.",
  "security-review": "Reviews code for security vulnerabilities (OWASP).",
  mermaid: "Authors and edits Mermaid diagrams.",
} as const satisfies Record<string, string>;

export type SkillName = keyof typeof SKILL_DESCRIPTIONS;

const REPO_AGENT_SKILLS: SkillName[] = Object.keys(
  SKILL_DESCRIPTIONS,
) as SkillName[];

const REPO_AGENT_TOOLS = [
  "repo_overview", "file_summary", "recent_commits", "recent_contributions",
  "fulltext_search", "web_search", "bash", "final_answer",
  "ask_clarifying_questions", "list_concepts", "learn_concept",
  "learn_concepts", "list_workflows", "learn_workflow", "read_workflow_json",
  "vector_search", "stakgraph_search", "stakgraph_map", "stakgraph_code",
  "str_replace_based_edit_tool", "apply_patch",
];

export const DEFAULT_AGENT_SPECS: Record<BifrostAgentName, DefaultAgentSpec> = {
  "repo-agent": {
    displayName: "Repo Agent",
    description: "Answers questions about a repository's code.",
    skills: REPO_AGENT_SKILLS,
    tools: REPO_AGENT_TOOLS,
  },
  "chat-agent": {
    displayName: "Chat Agent",
    description: "General conversational assistant.",
  },
  "canvas-agent": {
    displayName: "Canvas Agent",
    description: "Drives the visual canvas surface.",
  },
  "diagram-agent": {
    displayName: "Diagram Agent",
    description: "Generates and edits architecture diagrams.",
    skills: REPO_AGENT_SKILLS,
    tools: REPO_AGENT_TOOLS,
  },
  "logs-agent": {
    displayName: "Logs Agent",
    description: "Investigates logs and runtime output.",
  },
  "plan-agent": {
    displayName: "Plan Agent",
    description: "Breaks work into an actionable plan.",
    skills: REPO_AGENT_SKILLS,
    tools: REPO_AGENT_TOOLS,
  },
  "wfe-plan-agent": {
    displayName: "Workflow Editor Plan Agent",
    description: "Plans changes within the workflow editor.",
    skills: REPO_AGENT_SKILLS,
    tools: REPO_AGENT_TOOLS,
  },
  "coding-agent": {
    displayName: "Coder Agent",
    description: "Writes and modifies code.",
  },
  "test-agent": {
    displayName: "Test Agent",
    description: "Runs tests and fixes test failures.",
  },
  "build-agent": {
    displayName: "Build Agent",
    description: "Runs the project build and fixes build errors.",
  },
  "browser-agent": {
    displayName: "Browser Agent",
    description: "Takes screenshots and validates UI changes in the browser.",
  },
  "security-review-agent": {
    displayName: "Security Review Agent",
    description: "Reviews the code for security vulnerabilities.",
  },
};

/**
 * Prompt names linked to each agent, keyed by agent name. Sourced from
 * the `Prompt.agentNames` column; a prompt may fan out to several
 * agents. Only agents with at least one prompt appear as keys.
 */
export type AgentPromptNames = Record<string, string[]>;

/** The two prompt slots the catalog distinguishes. */
export type PromptRole = "SYSTEM" | "USER";

/**
 * Infer a prompt's role from its name. Prompt names are
 * UPPERCASE_UNDERSCORE (see the `Prompt.name` schema comment), so a
 * `SYSTEM` token delimited by underscores or string boundaries marks
 * the system prompt (e.g. `REPO_AGENT_SYSTEM`, `SYSTEM_PROMPT`).
 * Everything else is the main/user prompt. Word-boundary matching
 * avoids false hits like `SUBSYSTEM`.
 */
export function inferPromptRole(name: string): PromptRole {
  return /(^|_)SYSTEM(_|$)/i.test(name) ? "SYSTEM" : "USER";
}

/**
 * Load the prompt-name links for every agent from `Prompt.agentNames`.
 * One indexed read; the result feeds `buildAgentCatalogManifest`. Names
 * are sorted per agent so the manifest (and its content hash) is stable
 * regardless of row order.
 */
export async function loadAgentPromptNames(): Promise<AgentPromptNames> {
  const prompts = await db.prompt.findMany({
    where: { agentNames: { isEmpty: false } },
    select: { name: true, agentNames: true },
  });
  const byAgent: AgentPromptNames = {};
  for (const prompt of prompts) {
    for (const agent of prompt.agentNames) {
      (byAgent[agent] ??= []).push(prompt.name);
    }
  }
  for (const names of Object.values(byAgent)) names.sort();
  return byAgent;
}

/**
 * Build the seed manifest for `POST /_plugin/agents`. Deterministic:
 * agents are emitted in `BIFROST_AGENT_NAMES` order (and each agent's
 * prompt names are pre-sorted by `loadAgentPromptNames`) so the
 * manifest hash is stable across calls — the content-addressed seed
 * cache relies on this.
 *
 * `promptsByAgent` is passed in (rather than queried here) so this stays
 * pure and the exact bytes hashed are the exact bytes pushed.
 */
export function buildAgentCatalogManifest(
  promptsByAgent: AgentPromptNames = {},
): AgentCatalogManifest {
  const agents: AgentCatalogManifestAgent[] = BIFROST_AGENT_NAMES.map(
    (name) => {
      const spec = DEFAULT_AGENT_SPECS[name];
      const promptNames = promptsByAgent[name] ?? [];
      const agent: AgentCatalogManifestAgent = {
        name,
        display_name: spec.displayName,
        description: spec.description,
        default_model: spec.defaultModel ?? DEFAULT_AGENT_MODEL,
      };
      if (promptNames.length > 0) {
        agent.prompts = promptNames.map((promptName) => ({
          name: promptName,
          role: inferPromptRole(promptName),
        }));
      }
      const skillNames = spec.skills ?? [];
      if (skillNames.length > 0) {
        agent.skills = skillNames.map((skillName) => ({
          name: skillName,
          description: SKILL_DESCRIPTIONS[skillName as SkillName],
        }));
      }
      const toolNames = spec.tools ?? [];
      if (toolNames.length > 0) {
        agent.tools = toolNames.map((toolName) => ({ name: toolName }));
      }
      return agent;
    },
  );
  return { source: AGENT_CATALOG_SOURCE, agents };
}

/**
 * Content hash of a manifest — the cache key stamped on
 * `Swarm.bifrostAgentsSeedHash`. A change to any agent's name,
 * display, description, or default model flips the hash and triggers a
 * re-seed on the next LLM call. The manifest is already
 * deterministically ordered, so a plain `JSON.stringify` is a stable
 * canonical form.
 */
export function agentCatalogManifestHash(
  manifest: AgentCatalogManifest,
): string {
  return createHash("sha256")
    .update(JSON.stringify(manifest))
    .digest("hex");
}
