import { BIFROST_AGENT_NAMES, type BifrostAgentName } from "@/services/bifrost/orchestrator";
import { DEFAULT_AGENT_SPECS } from "@/services/bifrost/agent-catalog";
import type { EvalTriggerSource } from "@/lib/utils/eval-source";

export { DEFAULT_AGENT_SPECS };

/**
 * A flattened catalog entry for UI consumption (dropdown options, etc.).
 */
export interface HiveAgentOption {
  name: BifrostAgentName;
  displayName: string;
  description: string;
}

/**
 * All known canonical agents as a flat list, ordered by `BIFROST_AGENT_NAMES`.
 * Intended for use in dropdowns / selectors — no runtime auth needed.
 */
export const HIVE_AGENT_OPTIONS: ReadonlyArray<HiveAgentOption> =
  BIFROST_AGENT_NAMES.map((name) => {
    const spec = DEFAULT_AGENT_SPECS[name];
    return { name, displayName: spec.displayName, description: spec.description };
  });

/**
 * Source-bucket → canonical BifrostAgentName fallback table.
 *
 * These are the defaults used when the caller cannot (or does not) supply
 * an explicit `agentName`:
 *   - `repo_agent`      → the swarm coder agent that answers repo questions
 *   - `jamie_agent`     → the canvas agent (Jamie/system-canvas surface)
 *   - `provider_direct` → plan-agent is the most common provider_direct case
 *                         (workflow LLM steps executing inside a plan run)
 *
 * NOTE: full auto-detect (e.g. distinguishing coding-agent vs plan-agent
 * from `provider_direct`) is NOT achievable at the two capture routes
 * because no finer-grained signal is available there. Callers should always
 * prefer the user-override dropdown; this table is only the pre-fill default.
 */
const SOURCE_TO_AGENT: Record<EvalTriggerSource, BifrostAgentName> = {
  repo_agent: "repo-agent",
  jamie_agent: "canvas-agent",
  provider_direct: "plan-agent",
};

/**
 * Validates that `value` is a member of `BIFROST_AGENT_NAMES`.
 */
export function isBifrostAgentName(value: unknown): value is BifrostAgentName {
  return typeof value === "string" && (BIFROST_AGENT_NAMES as readonly string[]).includes(value);
}

/**
 * Resolves the canonical `BifrostAgentName` from a coarse `EvalTriggerSource`
 * bucket.  Returns one of the allowlist members — never free text.
 *
 * If a more-specific `agentName` override is provided (e.g. from a UI dropdown)
 * and it is a valid allowlist member, it wins; otherwise the source-derived
 * default is returned.
 */
export function resolveHiveAgentName(
  source: EvalTriggerSource,
  agentNameOverride?: string | null,
): BifrostAgentName {
  if (agentNameOverride != null && isBifrostAgentName(agentNameOverride)) {
    return agentNameOverride;
  }
  return SOURCE_TO_AGENT[source];
}
