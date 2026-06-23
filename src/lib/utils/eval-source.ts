import { LLM_API_PATTERNS } from "@/lib/stakwork/transitions";

export type EvalTriggerSource = "repo_agent" | "provider_direct" | "jamie_agent";

const EVAL_TRIGGER_SOURCES: ReadonlySet<string> = new Set([
  "repo_agent",
  "provider_direct",
  "jamie_agent",
]);

export function isEvalTriggerSource(value: unknown): value is EvalTriggerSource {
  return typeof value === "string" && EVAL_TRIGGER_SOURCES.has(value);
}

/**
 * Derives the EvalTrigger source discriminator from signals already present
 * in the agent-log capture path.
 *
 * Precedence:
 *  1. agentLogSource === "repo_agent"                     → "repo_agent"
 *  2. agentLogSource === "canvas_chat" | "jamie_agent"    → "jamie_agent"
 *  3. resolvedRequestUrl matches LLM_API_PATTERNS         → "provider_direct"
 *  4. fallback                                            → "repo_agent"
 */
export function deriveEvalTriggerSource(
  agentLogSource: string | null | undefined,
  resolvedRequestUrl: string | undefined,
): EvalTriggerSource {
  if (agentLogSource === "repo_agent") return "repo_agent";
  if (agentLogSource === "canvas_chat" || agentLogSource === "jamie_agent") return "jamie_agent";
  if (resolvedRequestUrl && LLM_API_PATTERNS.some((p) => resolvedRequestUrl.includes(p.pattern)))
    return "provider_direct";
  return "repo_agent";
}
