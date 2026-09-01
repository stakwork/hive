/**
 * External MCP servers for the org canvas agent (Jamie).
 *
 * Admins register HTTP MCP servers per source-control org (see the
 * `OrgMcpServer` model and `/api/orgs/[githubLogin]/mcp-servers`).
 * At run start `connectExternalMcpTools` connects to every enabled
 * server, discovers its tools, and returns them namespaced
 * `{serverName}_{toolName}` for merging into the agent's toolset.
 *
 * Design notes:
 *  - HTTP transport only. Hive runs on Vercel — no child processes, so
 *    there is no stdio branch (unlike stakgraph's mcpServers.ts).
 *  - Clients must OUTLIVE this function: the agent loop may call a
 *    tool many steps into the stream. The caller closes them via the
 *    returned `closeAll` (idempotent) in streamText's onFinish/onError.
 *  - Every connect rides `withMcpTimeout` so a hung server delays the
 *    turn by at most MCP_CLIENT_TIMEOUT_MS; a failed server is skipped
 *    (logged), never fatal to the turn.
 *  - Tool results are capped via `capMcpResult` before reaching the
 *    model, and `toModelOutput` is stripped (our execute returns a
 *    plain string, which the SDK serializes directly).
 *  - External tools are treated as potential writes: callers must not
 *    connect at all on readonly runs.
 */

import { createMCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { capMcpResult, MCP_TOTAL_CHAR_BUDGET, truncateField } from "@/lib/ai/mcpResult";
import { isMcpTimeout, withMcpTimeout } from "@/lib/ai/mcpTimeout";

export interface ExternalMcpToolsResult {
  tools: ToolSet;
  /** Close every connected client. Idempotent; never throws. */
  closeAll: () => Promise<void>;
}

export interface DiscoveredMcpTool {
  name: string;
  description: string | null;
}

/** Server names must survive as a tool-name prefix (`{name}_{tool}`). */
export const MCP_SERVER_NAME_RE = /^[a-zA-Z0-9_-]{1,24}$/;

type McpClient = Awaited<ReturnType<typeof createMCPClient>>;

/**
 * Decrypt an OrgMcpServer's stored headers into a plain record.
 * Returns {} for null/corrupted values (logged) — the connect then
 * proceeds unauthenticated and fails at the server if auth was needed,
 * which surfaces as a skipped server rather than a crashed turn.
 */
export function decryptMcpHeaders(encrypted: string | null, serverName: string): Record<string, string> {
  if (!encrypted) return {};
  try {
    const decrypted = EncryptionService.getInstance().decryptField("mcpHeaders", encrypted);
    const parsed = JSON.parse(decrypted);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch (e) {
    console.error(`[externalMcp] failed to decrypt headers for server "${serverName}":`, e);
  }
  return {};
}

/**
 * Connect to one HTTP MCP server and list its tools. Shared by the
 * agent path (which keeps the client open) and `probeMcpServer`
 * (which closes it immediately after listing).
 */
async function connectOne(opts: {
  url: string;
  headers: Record<string, string>;
}): Promise<{ client: McpClient; tools: ToolSet }> {
  const op = (async () => {
    const client = await createMCPClient({
      transport: {
        type: "http",
        url: opts.url,
        ...(Object.keys(opts.headers).length > 0 ? { headers: opts.headers } : {}),
      },
    });
    try {
      // The SDK types tools() with MCP-specific generics; downstream we
      // only touch description/execute, so widen to ToolSet.
      const tools = (await client.tools()) as unknown as ToolSet;
      return { client, tools };
    } catch (e) {
      await client.close().catch(() => {});
      throw e;
    }
  })();
  try {
    return await withMcpTimeout(() => op);
  } catch (e) {
    // Timeout won while the connect was still in flight — close the
    // late-arriving client so it doesn't dangle.
    if (isMcpTimeout(e)) {
      op.then(
        ({ client }) => client.close().catch(() => {}),
        () => {},
      );
    }
    throw e;
  }
}

/**
 * Probe a server for the settings UI: connect, list tool names +
 * descriptions, close. Throws on failure (the route translates to a
 * user-facing error message).
 */
export async function probeMcpServer(opts: {
  url: string;
  headers: Record<string, string>;
}): Promise<DiscoveredMcpTool[]> {
  const { client, tools } = await connectOne(opts);
  try {
    return Object.entries(tools).map(([name, tool]) => ({
      name,
      description:
        typeof (tool as { description?: unknown }).description === "string"
          ? (tool as { description: string }).description
          : null,
    }));
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Connect every enabled external MCP server for `orgId` and return the
 * merged, namespaced toolset. Never throws: a failed server is logged
 * and skipped; DB errors return an empty toolset.
 */
export async function connectExternalMcpTools(orgId: string): Promise<ExternalMcpToolsResult> {
  const clients: McpClient[] = [];
  let closed = false;
  const closeAll = async () => {
    if (closed) return;
    closed = true;
    await Promise.all(clients.map((c) => c.close().catch(() => {})));
  };

  let servers: Array<{
    name: string;
    url: string;
    headers: string | null;
    toolFilter: string[];
  }> = [];
  try {
    servers = await db.orgMcpServer.findMany({
      where: { sourceControlOrgId: orgId, enabled: true },
      select: { name: true, url: true, headers: true, toolFilter: true },
      orderBy: { createdAt: "asc" },
    });
  } catch (e) {
    console.error("[externalMcp] failed to load org MCP servers:", e);
    return { tools: {}, closeAll };
  }
  if (servers.length === 0) return { tools: {}, closeAll };

  const allTools: ToolSet = {};
  // Servers connect concurrently — a turn shouldn't pay N × handshake.
  await Promise.all(
    servers.map(async (server) => {
      try {
        const { client, tools } = await connectOne({
          url: server.url,
          headers: decryptMcpHeaders(server.headers, server.name),
        });
        clients.push(client);
        // Late-loser guard: if closeAll already ran (e.g. the turn
        // errored while this connect was in flight), close immediately.
        if (closed) {
          await client.close().catch(() => {});
          return;
        }
        for (const [toolName, tool] of Object.entries(tools)) {
          if (server.toolFilter.length > 0 && !server.toolFilter.includes(toolName)) continue;
          const prefixed = `${server.name}_${toolName}`.slice(0, 64);
          const originalExecute = (tool as { execute?: (args: unknown, opts: unknown) => Promise<unknown> }).execute;
          if (!originalExecute) continue;
          allTools[prefixed] = {
            ...tool,
            // Our execute returns a capped plain string; the MCP-shaped
            // toModelOutput would crash on it, so drop it.
            toModelOutput: undefined,
            execute: async (args: unknown, execOpts: unknown) => {
              const result = await originalExecute.call(tool, args, execOpts);
              if (result === undefined || result === null) {
                return `Tool ${prefixed} returned no result.`;
              }
              const capped = capMcpResult(result);
              // Non-text MCP results (structured content, images) cap
              // to "" — fall back to a truncated JSON dump so the
              // model sees *something* rather than an empty string.
              return capped || truncateField(JSON.stringify(result), MCP_TOTAL_CHAR_BUDGET);
            },
          } as ToolSet[string];
        }
        console.log("[externalMcp] connected", {
          orgId,
          server: server.name,
          tools: Object.keys(tools).length,
          included: Object.keys(allTools).filter((n) => n.startsWith(`${server.name}_`)).length,
        });
      } catch (e) {
        if (isMcpTimeout(e)) {
          console.warn(`[externalMcp] server "${server.name}" timed out; skipping`, { orgId });
        } else {
          console.error(`[externalMcp] server "${server.name}" failed; skipping:`, e);
        }
      }
    }),
  );

  return { tools: allTools, closeAll };
}
