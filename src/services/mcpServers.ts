/**
 * Wire-format types for MCP server config passed from Hive to the
 * swarm-side `repo/agent`.
 *
 * `repo/agent` accepts an array of these on its workflow vars (as
 * `mcpServers`) and exposes them to the plan/task agent as tool
 * sources. The shape here is the contract — keep it in sync with the
 * `McpServer` interface in repo/agent.
 *
 * Hive callers (plan-mode dispatch, future voice agent, etc.) build
 * `McpServer[]` arrays and forward them verbatim through
 * `callStakworkAPI({ mcpServers })`. The stakwork workflow does no
 * reshaping — it lands on `vars.mcpServers` and repo/agent picks it
 * up directly.
 */
export interface McpServer {
  /** Display name used by repo/agent for logging/UX. */
  name: string;
  /** Fully-qualified MCP endpoint URL. */
  url: string;
  /**
   * Shorthand for `Authorization: Bearer <token>`. Mutually
   * informative with `headers` — repo/agent merges both, with
   * `headers` winning on conflict.
   */
  token?: string;
  /** Full headers for custom auth schemes. */
  headers?: Record<string, string>;
  /**
   * Optional allow-list of tool names. When set, only these tools
   * from the MCP server are exposed to the agent. Empty/undefined =
   * all tools. Use this even when the server itself already exposes
   * a single tool, as a belt-and-suspenders guard against future
   * surface expansion.
   */
  toolFilter?: string[];
}
