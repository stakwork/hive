/**
 * Org-scope MCP tools.
 *
 * Exposes a single tool — `org_agent` — that the swarm-side plan
 * agent (or any future agent given an org-MCP token) can call back
 * into Hive to ask org-wide questions. Internally this delegates to
 * `runCanvasAgent`, the same primitive that powers the org SidebarChat
 * and the legacy `scoutOrgContext` pre-dispatch brief.
 *
 * Why a single tool instead of a fine-grained MCP surface:
 *
 *   The org canvas agent already has a coherent multi-workspace tool
 *   set (canvases, initiatives, research, connections, plus per-
 *   workspace concept/feature/task reads). Porting that surface to MCP
 *   would (a) explode to ~70+ tools for a 10-workspace org, (b) lose
 *   cross-tool state like the web_search citation linkifier in
 *   `update_research`, and (c) split reasoning across two LLM calls
 *   (orchestrator MCP-side + sub-agent in Hive) that today happens in
 *   one. The callback model that's "right" is *iterative on-demand
 *   context*, not *fine-grained tool exposure* — the agent on the
 *   swarm only needs answers, not navigation.
 *
 *   So we wrap `runCanvasAgent` as one tool. Caller sends a prompt,
 *   we run the full org agent with all the user's accessible
 *   workspaces and the org tool families, and return its final text.
 *
 * Auth & permission semantics:
 *
 *   - The org-JWT branch in `handler.ts` resolves the token's claims
 *     into `OrgMcpAuthExtra` and re-validates org membership at use
 *     time via `resolveAuthorizedOrgId`.
 *   - `permissions: ["read"]` → forces `readonly: true` inside
 *     `runCanvasAgent`. The agent can read canvases/research/etc. but
 *     cannot mutate state or emit propose_* cards.
 *   - `permissions: ["read", "write"]` → `readonly: false`. Full
 *     tool surface. Mint endpoint gates this by workspace role.
 *
 *   The tool also accepts a `readonly` arg from the caller, which can
 *   only *narrow* — a write-capable token can opt into a read-only
 *   run, but a read-only token can never produce writes regardless of
 *   what the caller asks for.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "@/lib/db";
import { runCanvasAgent } from "@/lib/ai/runCanvasAgent";
import type { OrgPermission } from "@/lib/mcp/orgPermissions";

// ---------------------------------------------------------------------------
// Permission model
// ---------------------------------------------------------------------------

// `OrgPermission`, `ORG_PERMISSIONS`, and `isOrgPermission` live in
// `orgPermissions.ts` (zero-import module). Importers that only need
// the permission vocabulary should pull from there directly — not via
// this module — so they don't drag in `runCanvasAgent`'s transitive
// graph. Re-exported here for convenience of callers that already
// import other things from this module.
export type { OrgPermission } from "@/lib/mcp/orgPermissions";
export {
  ORG_PERMISSIONS,
  isOrgPermission,
} from "@/lib/mcp/orgPermissions";

/**
 * Auth context carried on the MCP `AuthInfo.extra` for org-scope
 * tokens. Mirrors the workspace-scope `McpAuthExtra` but with org-
 * shaped fields. The handler builds this from the JWT claims after
 * verifying signature + re-checking membership.
 */
export interface OrgMcpAuthExtra {
  [key: string]: unknown;
  scope: "org";
  orgId: string;
  userId: string;
  permissions: OrgPermission[];
  purpose: string;
  /** JWT id, useful for audit logs. */
  jti?: string;
}

// ---------------------------------------------------------------------------
// Workspace resolution
// ---------------------------------------------------------------------------

/**
 * Cap on workspaces handed to `runCanvasAgent`. Mirrors the limit
 * enforced inside `runCanvasAgent` itself (and `askToolsMulti`'s
 * contract). Sorted by recency so very large orgs get the most-active
 * workspaces.
 *
 * Kept in sync with `MAX_WORKSPACES` in `orgContextScout.ts`.
 */
const MAX_WORKSPACES = 20;

/**
 * Resolve the workspace slugs visible to this user inside this org.
 * Identical filter to `scoutOrgContext`: owned-or-member, has a
 * configured swarm, has at least one repository. Anything failing
 * those would make `buildWorkspaceConfigs` throw later anyway.
 *
 * Returns an empty array if no qualifying workspaces exist. The tool
 * surfaces that to the caller rather than throwing, since an org with
 * no usable workspaces is a legitimate state (just one with nothing
 * to report).
 */
async function resolveOrgWorkspaceSlugs(
  orgId: string,
  userId: string,
): Promise<string[]> {
  const candidates = await db.workspace.findMany({
    where: {
      sourceControlOrgId: orgId,
      deleted: false,
      OR: [
        { ownerId: userId },
        { members: { some: { userId, leftAt: null } } },
      ],
      swarm: { swarmUrl: { not: null } },
      repositories: { some: {} },
    },
    select: { slug: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_WORKSPACES,
  });
  return candidates.map((w) => w.slug);
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Register the `org_agent` tool on the given MCP server. Only called
 * by the handler when the auth-info's scope is `"org"`. Workspace-
 * scope tokens never see this tool registered.
 */
export function registerOrgTools(server: McpServer): void {
  server.registerTool(
    "org_agent",
    {
      title: "Org Agent",
      description:
        "Ask the Hive org agent a question about this organization. The agent has " +
        "access to the org canvases (root + per-workspace + per-initiative), all " +
        "initiatives, research notes, connections, and every workspace's features, " +
        "tasks, and code concepts. It will explore on its own and return a text " +
        "answer. Use this whenever you need org-wide context — high-level direction, " +
        "cross-workspace relationships, prior research, planning history.",
      inputSchema: {
        prompt: z
          .string()
          .min(1)
          .describe(
            "Free-form question for the org agent. Be specific — e.g. " +
              "'Are there any active initiatives related to billing across the org?' " +
              "rather than 'tell me about the org'.",
          ),
        scope: z
          .string()
          .optional()
          .describe(
            "Optional canvas scope hint. Omit (default) to start at the org root " +
              "canvas. Pass an initiative ref like 'initiative:<id>' or a workspace " +
              "ref like 'ws:<slug>' to anchor the agent at a specific drill-down.",
          ),
        readonly: z
          .boolean()
          .optional()
          .describe(
            "Force read-only mode regardless of token permissions. Defaults to " +
              "the safest mode the token allows (read-only for read-only tokens; " +
              "writable for write-capable tokens). Pass `true` to narrow a writable " +
              "token to a read-only run.",
          ),
      },
    },
    async (
      args: { prompt: string; scope?: string; readonly?: boolean },
      extra,
    ) => {
      const authExtra = extra.authInfo?.extra as OrgMcpAuthExtra | undefined;
      if (!authExtra || authExtra.scope !== "org") {
        return {
          content: [
            { type: "text" as const, text: "Error: Org auth context missing" },
          ],
          isError: true,
        };
      }

      // Permission gate. Token-permissions are authoritative; caller's
      // `readonly` arg can only narrow.
      const tokenWritable = authExtra.permissions.includes("write");
      const effectiveReadonly = args.readonly === true || !tokenWritable;

      const slugs = await resolveOrgWorkspaceSlugs(
        authExtra.orgId,
        authExtra.userId,
      );
      if (slugs.length === 0) {
        // Surface as a normal tool result (not an error). The agent
        // can decide whether the absence is meaningful for its
        // question.
        return {
          content: [
            {
              type: "text" as const,
              text:
                "(No accessible workspaces with configured swarms in this org. " +
                "Nothing to report.)",
            },
          ],
        };
      }

      // Optional scope hint. The org canvas agent's prompt builder
      // interprets `currentCanvasRef` to seed the agent's starting
      // canvas — we forward the caller's hint verbatim. Works
      // regardless of how many workspaces the org has: `runCanvasAgent`
      // merges the org tool families into both the single- and
      // multi-workspace branches when `orgId` is set.
      const scopeHint = args.scope
        ? { currentCanvasRef: args.scope }
        : undefined;

      try {
        const { result } = await runCanvasAgent({
          userId: authExtra.userId,
          orgId: authExtra.orgId,
          workspaceSlugs: slugs,
          scope: scopeHint,
          readonly: effectiveReadonly,
          // Programmatic caller, no UI subscriber — suppress the
          // HIGHLIGHT_NODES Pusher fan-out the org chat surface
          // uses for "researching node X" animations.
          silentPusher: true,
          messages: [{ role: "user", content: args.prompt }],
        });

        // Auto-consume the stream and resolve to the final step's
        // text. The plan/voice agent consuming this only needs prose
        // — not the intermediate tool-call trace.
        const text = await result.text;
        const cleaned = text.replace(/\[END_OF_ANSWER\]/g, "").trim();

        console.log(
          `[orgMcpTools.org_agent] org=${authExtra.orgId} user=${authExtra.userId} ` +
            `purpose=${authExtra.purpose} readonly=${effectiveReadonly} ` +
            `slugs=${slugs.length} chars=${cleaned.length}`,
        );

        return {
          content: [
            { type: "text" as const, text: cleaned || "(empty response)" },
          ],
        };
      } catch (error) {
        console.error("[orgMcpTools.org_agent] runCanvasAgent failed:", error);
        return {
          content: [
            { type: "text" as const, text: "Error: org agent call failed" },
          ],
          isError: true,
        };
      }
    },
  );
}
