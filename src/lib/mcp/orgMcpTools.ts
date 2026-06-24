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
import { createSharedOrgAgentConversation } from "@/services/org-canvas-conversation";
import type { OrgPermission } from "@/lib/mcp/orgPermissions";

/**
 * Token purposes for which `org_agent` persists the exchange as a
 * shareable org conversation and returns a link to it. Call/voice
 * agents (minted by the calls `generate-link` route with
 * `purpose: "call-link"`) want a durable, linkable record to hand back
 * to a human. Other callers — notably plan-mode (`purpose: "plan-mode"`
 * / `"feature:<id>"`) — only consume the prose inline and should not
 * litter the org with one shared conversation per context lookup, so
 * they keep the original text-only behavior.
 */
const LINK_RETURNING_PURPOSES: ReadonlySet<string> = new Set(["call-link"]);

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
 *
 * `orgName` is the human-readable identifier the agent will see
 * interpolated into the tool's title and description (e.g. "Stakwork").
 * Passing the org's actual name here — instead of the generic word
 * "this" — gives the LLM a concrete anchor for when to reach for the
 * tool, especially in multi-org agent contexts. The tool's *id* stays
 * `org_agent` regardless: other code (toolFilter on the swarm side,
 * grep targets, log prefixes) hardcodes that literal, and we don't
 * want a rename to cascade.
 */
export function registerOrgTools(
  server: McpServer,
  options: { orgName?: string } = {},
): void {
  // Description language is intentionally generic. The caller is a
  // planning/coding agent that has no model for Hive's internal
  // surfaces (canvases, initiatives, research, etc.) — and shouldn't
  // need one. What it needs is a clear signal of *when* to reach for
  // this tool: high-level, cross-cutting, organizational context that
  // it can't reconstruct from its own narrow tool surface. So the
  // description describes the *kind of question* the tool answers,
  // not the underlying data model.
  //
  // The org name is interpolated when known so the LLM has a concrete
  // anchor (e.g. "Ask Stakwork…"), but the wording stays natural when
  // it isn't ("Ask the organization…").
  const orgLabel = options.orgName?.trim() || "";
  const titleLabel = orgLabel ? `${orgLabel} Org Agent` : "Org Agent";
  const subject = orgLabel || "the organization";

  server.registerTool(
    "org_agent",
    {
      title: titleLabel,
      description:
        `Ask ${subject} a question and get a written answer back. ` +
        "Use this when you need broader context that goes beyond the specific " +
        "task or repository you're working on — things like overall direction " +
        "and priorities, how different efforts across the company relate, prior " +
        "decisions and the reasoning behind them, ongoing work in other areas, " +
        "or background research and notes. " +
        "Especially worth calling when a request you've been given is " +
        "ambiguous or open-ended and you want to understand where it fits " +
        "before committing to an approach — for example, checking whether " +
        "related work already exists, what the surrounding priorities are, " +
        "or why the request might be coming up now. " +
        "Good fit: strategic, cross-cutting, \"why are we doing this\", or " +
        "\"how does this fit in\" questions. Not a good fit: narrow lookups " +
        "you can answer with your own tools (single files, single PRs, " +
        "syntax questions). " +
        "This agent can also take action, not just answer: it can propose " +
        "new features for the organization. So if the user asks you to " +
        "create or draft a feature (or something equivalent — \"add\", " +
        "\"build\", \"spec out\", \"file a feature for…\"), call this tool " +
        "and ask it to propose that feature, describing what the user wants " +
        "in your prompt. " +
        "The answer comes back as prose, not structured data — phrase your " +
        "question (or request) the way you would ask a knowledgeable teammate.",
      inputSchema: {
        prompt: z
          .string()
          .min(1)
          .describe(
            "The question to ask, in plain language. Two shapes both work " +
              "well: (1) a targeted question when you know what you need — " +
              "e.g. \"Is anyone else working on rate limiting, and what " +
              "approach did they take?\"; (2) an orienting question when " +
              "you've been handed a request and want to understand where it " +
              "fits — e.g. \"I need to add SSO support to the dashboard. Is " +
              "there related work, prior discussion, or context I should " +
              "know about before designing this?\" Include enough of the " +
              "request itself for the answer to be relevant; avoid vague " +
              "prompts like \"tell me about the org\".",
          ),
        scope: z
          .string()
          .optional()
          .describe(
            "Optional hint about where to focus. Omit if unsure — the default " +
              "covers the whole organization. If you already know the question " +
              "is about a specific team or product area and you know its " +
              "workspace slug, you can pass `ws:<slug>` to start there.",
          ),
        readonly: z
          .boolean()
          .optional()
          .describe(
            "Ask in read-only mode. Defaults to whatever the token allows. " +
              "You normally don't need to set this.",
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
        const answer = cleaned || "(empty response)";

        // Call/voice contexts get a durable, shareable org conversation
        // plus a link back to it. Best-effort: a persistence failure
        // must not fail the answer the caller already has.
        let shareLink: string | undefined;
        if (LINK_RETURNING_PURPOSES.has(authExtra.purpose)) {
          try {
            const conversationId = await createSharedOrgAgentConversation({
              orgId: authExtra.orgId,
              userId: authExtra.userId,
              prompt: args.prompt,
              answer,
              workspaceSlugs: slugs,
            });
            const org = await db.sourceControlOrg.findUnique({
              where: { id: authExtra.orgId },
              select: { githubLogin: true },
            });
            if (org) {
              // `?chat=<id>` on the org page auto-loads the conversation
              // (OrgCanvasView reads the `chat` param and fetches the
              // isShared-gated row). Preferred over /chat/shared/<id> so
              // the link drops the user straight into the live org canvas
              // with the chat open.
              const path = `/org/${org.githubLogin}?chat=${conversationId}`;
              const base = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
              shareLink = base ? `${base}${path}` : path;
            }
          } catch (err) {
            console.error(
              "[orgMcpTools.org_agent] share-link persist failed:",
              err,
            );
          }
        }

        console.log(
          `[orgMcpTools.org_agent] org=${authExtra.orgId} user=${authExtra.userId} ` +
            `purpose=${authExtra.purpose} readonly=${effectiveReadonly} ` +
            `slugs=${slugs.length} chars=${cleaned.length} ` +
            `link=${shareLink ? "yes" : "no"}`,
        );

        const responseText = shareLink
          ? `${answer}\n\nView this conversation: ${shareLink}`
          : answer;

        return {
          content: [{ type: "text" as const, text: responseText }],
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
