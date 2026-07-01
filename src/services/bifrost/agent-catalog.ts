import { createHash } from "crypto";

import {
  AGENT_CATALOG_SOURCE,
  DEFAULT_AGENT_MODEL,
} from "./constants";
import { BIFROST_AGENT_NAMES, type BifrostAgentName } from "./orchestrator";
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
 * For now this only declares each agent's identity + default model;
 * prompts / tools / skills are left empty and authored later in the
 * gateway UI. Adding a new call site means adding it to
 * `BIFROST_AGENT_NAMES`; give it an entry here too so it shows up in
 * the catalog with a sensible display name (the `display` fallback
 * covers the case where someone forgets).
 */
interface DefaultAgentSpec {
  displayName: string;
  description: string;
  /** Override `DEFAULT_AGENT_MODEL` for this agent (none do yet). */
  defaultModel?: string;
}

const DEFAULT_AGENT_SPECS: Record<BifrostAgentName, DefaultAgentSpec> = {
  "repo-agent": {
    displayName: "Repo Agent",
    description: "Answers questions about a repository's code.",
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
  },
  "logs-agent": {
    displayName: "Logs Agent",
    description: "Investigates logs and runtime output.",
  },
  "plan-agent": {
    displayName: "Plan Agent",
    description: "Breaks work into an actionable plan.",
  },
  "coding-agent": {
    displayName: "Coder Agent",
    description: "Writes and modifies code.",
  },
  "pr-monitor": {
    displayName: "PR Monitor",
    description: "Watches and reports on pull requests.",
  },
  "task-generation": {
    displayName: "Task Generation",
    description: "Generates structured task tickets.",
  },
};

/**
 * Build the seed manifest for `POST /_plugin/agents`. Deterministic:
 * agents are emitted in `BIFROST_AGENT_NAMES` order so the manifest
 * hash is stable across calls (the content-addressed seed cache relies
 * on this).
 */
export function buildAgentCatalogManifest(): AgentCatalogManifest {
  const agents: AgentCatalogManifestAgent[] = BIFROST_AGENT_NAMES.map(
    (name) => {
      const spec = DEFAULT_AGENT_SPECS[name];
      return {
        name,
        display_name: spec.displayName,
        description: spec.description,
        default_model: spec.defaultModel ?? DEFAULT_AGENT_MODEL,
      };
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
