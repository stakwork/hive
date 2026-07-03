import { BIFROST_AGENT_NAMES, type BifrostAgentName } from "@/services/bifrost/agent-names";
import { DEFAULT_AGENT_SPECS } from "@/services/bifrost/agent-catalog";
import type { EvalTriggerSource } from "@/lib/utils/eval-source";

export { DEFAULT_AGENT_SPECS };

/**
 * Capture-side allowlist: the 10 canonical Bifrost agent names plus `wfe-agent`
 * (Stakwork Workflow Engine agent — appears in real AgentLog data but is not
 * part of the Bifrost gateway catalog).
 *
 * Do NOT route validation through `isBifrostAgentName` here — it would reject
 * `wfe-agent`.  Use `isCaptureAgentName` / `CAPTURE_AGENT_NAMES` instead.
 */
export const CAPTURE_AGENT_NAMES = [...BIFROST_AGENT_NAMES, "wfe-agent"] as const;
export type CaptureAgentName = (typeof CAPTURE_AGENT_NAMES)[number];

/** Spec for `wfe-agent` (not in the Bifrost catalog). */
const WFE_AGENT_SPEC = {
  displayName: "WFE Agent",
  description: "Stakwork Workflow Engine agent.",
};

/**
 * A flattened catalog entry for UI consumption (dropdown options, etc.).
 * Includes `wfe-agent` in addition to the Bifrost catalog entries.
 */
export interface HiveAgentOption {
  name: string;
  displayName: string;
  description: string;
}

/**
 * All known canonical agents as a flat list for UI dropdowns.
 * Ordered: BIFROST_AGENT_NAMES first, then `wfe-agent`.
 */
export const HIVE_AGENT_OPTIONS: ReadonlyArray<HiveAgentOption> = [
  ...BIFROST_AGENT_NAMES.map((name) => {
    const spec = DEFAULT_AGENT_SPECS[name];
    return { name, displayName: spec.displayName, description: spec.description };
  }),
  { name: "wfe-agent", ...WFE_AGENT_SPEC },
];

/**
 * Returns the display name and description for any capture-side agent name,
 * including `wfe-agent` which is not in `DEFAULT_AGENT_SPECS`.
 */
export function getCaptureAgentSpec(name: string): { displayName: string; description: string } {
  if (name === "wfe-agent") return WFE_AGENT_SPEC;
  if (isBifrostAgentName(name)) {
    const spec = DEFAULT_AGENT_SPECS[name];
    return { displayName: spec.displayName, description: spec.description };
  }
  return { displayName: name, description: "" };
}

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
 * Validates that `value` is a member of `CAPTURE_AGENT_NAMES` (includes
 * `wfe-agent` in addition to all Bifrost names).
 */
export function isCaptureAgentName(value: unknown): value is CaptureAgentName {
  return typeof value === "string" && (CAPTURE_AGENT_NAMES as readonly string[]).includes(value);
}

/**
 * Parses the canonical agent name from an `AgentLog.agent` value.
 *
 * `AgentLog.agent` is stored as `<canonical-name>-<cuid>` (e.g.
 * `coding-agent-cmr3lw4o5…`, `wfe-agent-cmr3abc…`). This function strips the
 * trailing `-<cuid>` suffix and returns the canonical prefix, validated
 * against `CAPTURE_AGENT_NAMES`.
 *
 * Uses **longest-known-prefix match** — names contain hyphens so we cannot
 * naively split on the last dash.  Returns `undefined` when no known prefix
 * matches (caller should fall back to `resolveHiveAgentName`).
 */
export function parseCanonicalAgent(agentLogAgent: string): string | undefined {
  if (!agentLogAgent || typeof agentLogAgent !== "string") return undefined;

  // Sort descending by length so the longest prefix wins (handles any future
  // names that share a common prefix, e.g. "coding-agent" vs "coding-agent-v2").
  const sortedNames = [...CAPTURE_AGENT_NAMES].sort((a, b) => b.length - a.length);

  for (const name of sortedNames) {
    // Exact match (no suffix)
    if (agentLogAgent === name) return name;

    // Prefix match: must be followed by `-<cuid>` where the cuid is lowercase
    // alphanumeric (the cuid format used by Stakwork, e.g. `cmr3lw4o5...`).
    if (agentLogAgent.startsWith(`${name}-`)) {
      const suffix = agentLogAgent.slice(name.length + 1);
      if (suffix.length > 0 && /^[a-z0-9]+$/.test(suffix)) {
        return name;
      }
    }
  }

  return undefined;
}

/**
 * Resolves the canonical agent name from a coarse `EvalTriggerSource` bucket.
 *
 * If a more-specific `agentNameOverride` is provided (e.g. from a UI dropdown
 * or `parseCanonicalAgent`) and it is a member of `CAPTURE_AGENT_NAMES`, it
 * wins; otherwise the source-derived default (always a `BifrostAgentName`) is
 * returned.
 *
 * Returns a value always in `CAPTURE_AGENT_NAMES` — never free text.
 */
export function resolveHiveAgentName(
  source: EvalTriggerSource,
  agentNameOverride?: string | null,
): string {
  if (agentNameOverride != null && isCaptureAgentName(agentNameOverride)) {
    return agentNameOverride;
  }
  return SOURCE_TO_AGENT[source];
}
