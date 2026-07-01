/**
 * Extracts the canonical agent role name from a raw agent string.
 * Strips any random suffix that follows "-agent".
 *
 * Examples:
 *   "plan-agent-abc123" → "plan-agent"
 *   "coding-agent-xyz"  → "coding-agent"
 *   "researcher"        → "researcher"
 *   "plan-agent"        → "plan-agent"
 */
export function extractAgentRoleName(agent: string): string {
  const match = agent.match(/^(.+?-agent)(?:-|$)/);
  return match ? match[1] : agent;
}
