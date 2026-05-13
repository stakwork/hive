import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { validateApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import {
  mcpListConcepts,
  mcpLearnConcept,
  mcpListFeatures,
  mcpReadFeature,
  mcpCreateFeature,
  mcpListTasks,
  mcpReadTask,
  mcpCreateTask,
  mcpSendMessage,
  mcpCheckStatus,
  findWorkspaceUser,
  resolveWorkspaceUser,
  type SwarmCredentials,
  type WorkspaceAuth,
  type McpToolResult,
} from "@/lib/mcp/mcpTools";
import {
  registerOrgTools,
  isOrgPermission,
  type OrgMcpAuthExtra,
  type OrgPermission,
} from "@/lib/mcp/orgMcpTools";

// Available tools registry
const AVAILABLE_TOOLS = [
  "list_concepts",
  "learn_concept",
  "list_features",
  "read_feature",
  "create_feature",
  "list_tasks",
  "read_task",
  "create_task",
  "check_status",
  "send_message",
] as const;
type ToolName = (typeof AVAILABLE_TOOLS)[number];

interface McpAuthExtra {
  [key: string]: unknown;
  workspaceId: string;
  workspaceSlug: string;
  apiKeyId: string;
  swarmUrl?: string;
  swarmApiKey?: string;
  toolsFilter?: string[];
}

// Parse tools filter from URL
function parseToolsFilter(url: URL): string[] | null {
  const toolsParam = url.searchParams.get("tools");
  if (!toolsParam) return null; // null means all tools

  const requested = toolsParam.split(",").map((t) => t.trim().toLowerCase());
  return requested.filter((tool) =>
    AVAILABLE_TOOLS.includes(tool as ToolName),
  );
}

function getCredentialsFromAuth(
  extra: McpAuthExtra | undefined,
  toolName: ToolName,
) {
  if (!extra) {
    return {
      error: {
        content: [{ type: "text" as const, text: "Error: Not authenticated" }],
        isError: true,
      },
    };
  }

  if (!extra.swarmUrl) {
    return {
      error: {
        content: [
          {
            type: "text" as const,
            text: "Error: Swarm not configured for this workspace",
          },
        ],
        isError: true,
      },
    };
  }

  // Check if this tool should be available
  if (extra.toolsFilter && !extra.toolsFilter.includes(toolName)) {
    return {
      error: {
        content: [{ type: "text" as const, text: "Error: Tool not available" }],
        isError: true,
      },
    };
  }

  return {
    credentials: {
      swarmUrl: extra.swarmUrl,
      swarmApiKey: extra.swarmApiKey || "",
    } as SwarmCredentials,
  };
}

/**
 * Extract workspace auth for DB-direct tools (no swarm required).
 * Resolves the acting user via fuzzy name match, falling back to workspace owner.
 */
async function getWorkspaceAuth(
  extra: McpAuthExtra | undefined,
  toolName: ToolName,
  userHint?: string,
): Promise<{ error?: McpToolResult; auth?: WorkspaceAuth }> {
  if (!extra) {
    return {
      error: {
        content: [{ type: "text" as const, text: "Error: Not authenticated" }],
        isError: true,
      },
    };
  }

  if (extra.toolsFilter && !extra.toolsFilter.includes(toolName)) {
    return {
      error: {
        content: [{ type: "text" as const, text: "Error: Tool not available" }],
        isError: true,
      },
    };
  }

  const userId = await resolveWorkspaceUser(extra.workspaceId, userHint);

  return {
    auth: {
      workspaceId: extra.workspaceId,
      workspaceSlug: extra.workspaceSlug,
      userId,
    },
  };
}

// Create a fresh McpServer with tools registered.
//
// `scope` selects which tool family is exposed:
//   - "workspace" (default): all the existing workspace-scoped tools
//     keyed off a single workspace + swarm. Used by long-lived
//     hive_* API keys and the legacy workspace JWTs minted by
//     /api/livekit-token.
//   - "org": exposes only `org_agent`, the single callback tool that
//     wraps `runCanvasAgent`. Used by org-JWTs minted from
//     /api/mcp/org-token for plan-mode swarm callbacks and (future)
//     voice agents.
//
// Mutually exclusive on purpose — an org-scope token does not get
// the workspace tool surface, and a workspace-scope token does not
// get `org_agent`. Crossing the scopes would silently widen the
// authorization granted at mint time.
function createServer(scope: "workspace" | "org" = "workspace"): McpServer {
  const server = new McpServer(
    { name: "hive", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  if (scope === "org") {
    registerOrgTools(server);
    return server;
  }

  server.registerTool(
    "list_concepts",
    {
      title: "List Concepts",
      description:
        "Fetch a list of features/concepts from the codebase knowledge base. Returns features with metadata including name, description, PR/commit counts, last updated time, and whether documentation exists.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = getCredentialsFromAuth(authExtra, "list_concepts");
      if (result.error) return result.error;
      return mcpListConcepts(result.credentials);
    },
  );

  server.registerTool(
    "learn_concept",
    {
      title: "Learn Concept",
      description:
        "Fetch documentation for a specific concept by ID. Returns the documentation content for the concept.",
      inputSchema: {
        conceptId: z
          .string()
          .describe("The ID of the concept to retrieve documentation for"),
      },
    },
    async ({ conceptId }: { conceptId: string }, extra) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = getCredentialsFromAuth(authExtra, "learn_concept");
      if (result.error) return result.error;
      return mcpLearnConcept(result.credentials, conceptId);
    },
  );

  // ----- Feature tools (DB-direct) -----

  server.registerTool(
    "list_features",
    {
      title: "List Features",
      description:
        "List features in the workspace, ordered by last updated. Returns feature names, IDs, statuses, and last-updated timestamps. Maximum 40 results.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "list_features");
      if (result.error) return result.error;
      return mcpListFeatures(result.auth!);
    },
  );

  server.registerTool(
    "read_feature",
    {
      title: "Read Feature",
      description:
        "Read a feature's plan details and full chat message history. Also indicates whether the planning workflow is currently running.",
      inputSchema: {
        featureId: z
          .string()
          .describe("The ID of the feature to read"),
      },
    },
    async ({ featureId }: { featureId: string }, extra) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "read_feature");
      if (result.error) return result.error;
      return mcpReadFeature(result.auth!, featureId);
    },
  );

  server.registerTool(
    "create_feature",
    {
      title: "Create Feature",
      description:
        "Create a new feature in the workspace with a brief description and optional requirements.",
      inputSchema: {
        title: z.string().describe("The title of the feature"),
        brief: z.string().describe("A brief description of the feature"),
        requirements: z
          .string()
          .optional()
          .describe("Optional detailed requirements for the feature"),
        creator: z
          .string()
          .optional()
          .describe(
            "Name of the creator (matched against name or alias). Falls back to workspace owner if not found.",
          ),
      },
    },
    async (
      {
        title,
        brief,
        requirements,
        creator,
      }: { title: string; brief: string; requirements?: string; creator?: string },
      extra,
    ) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "create_feature", creator);
      if (result.error) return result.error;
      return mcpCreateFeature(result.auth!, title, brief, requirements);
    },
  );

  // ----- Task tools (DB-direct) -----

  server.registerTool(
    "list_tasks",
    {
      title: "List Tasks",
      description:
        "List tasks in the workspace, ordered by last updated. Returns task titles, IDs, statuses, priorities, and last-updated timestamps. Maximum 40 results.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "list_tasks");
      if (result.error) return result.error;
      return mcpListTasks(result.auth!);
    },
  );

  server.registerTool(
    "read_task",
    {
      title: "Read Task",
      description:
        "Read a task's details and full chat message history. Also indicates whether the task workflow is currently running.",
      inputSchema: {
        taskId: z
          .string()
          .describe("The ID of the task to read"),
      },
    },
    async ({ taskId }: { taskId: string }, extra) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "read_task");
      if (result.error) return result.error;
      return mcpReadTask(result.auth!, taskId);
    },
  );

  server.registerTool(
    "create_task",
    {
      title: "Create Task",
      description:
        "Create a new task in the workspace with a title and optional description and priority.",
      inputSchema: {
        title: z.string().describe("The title of the task"),
        description: z
          .string()
          .optional()
          .describe("A description of the task"),
        priority: z
          .enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
          .optional()
          .describe("Priority level (LOW, MEDIUM, HIGH, CRITICAL). Defaults to MEDIUM."),
        creator: z
          .string()
          .optional()
          .describe(
            "Name of the creator (matched against name or alias). Falls back to workspace owner if not found.",
          ),
      },
    },
    async (
      {
        title,
        description,
        priority,
        creator,
      }: { title: string; description?: string; priority?: string; creator?: string },
      extra,
    ) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "create_task", creator);
      if (result.error) return result.error;
      return mcpCreateTask(result.auth!, title, description, priority);
    },
  );

  // ----- Cross-cutting tools -----

  server.registerTool(
    "check_status",
    {
      title: "Check Status",
      description:
        "Get a unified status overview of the workspace. Returns up to 12 active features and tasks updated in the last 7 days, sorted by items needing attention first (workflowStatus COMPLETED), then by most recent. Excludes completed and cancelled items. When a creator is provided, only shows items created by or assigned to that user.",
      inputSchema: {
        creator: z
          .string()
          .optional()
          .describe(
            "Name of the user (matched against name or alias). When provided, filters to items created by or assigned to this user. Falls back to workspace owner if not found.",
          ),
      },
    },
    async ({ creator }: { creator?: string }, extra) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "check_status");
      if (result.error) return result.error;
      // Resolve the creator separately — only filter when explicitly provided.
      // If the name doesn't match anyone, return all (no filter).
      const filterUserId = creator
        ? await findWorkspaceUser(result.auth!.workspaceId, creator)
        : undefined;
      return mcpCheckStatus(result.auth!, filterUserId);
    },
  );

  // ----- Shared tools -----

  server.registerTool(
    "send_message",
    {
      title: "Send Message",
      description:
        "Send a message to a feature's planning chat or a task's agent chat. Provide exactly one of featureId or taskId. For features this triggers the AI planning workflow; for tasks it triggers the agent workflow.",
      inputSchema: {
        featureId: z
          .string()
          .optional()
          .describe("The ID of the feature to send a message to"),
        taskId: z
          .string()
          .optional()
          .describe("The ID of the task to send a message to"),
        message: z
          .string()
          .describe("The message text to send"),
        creator: z
          .string()
          .optional()
          .describe(
            "Name of the sender (matched against name or alias). Falls back to workspace owner if not found.",
          ),
      },
    },
    async ({ featureId, taskId, message, creator }: { featureId?: string; taskId?: string; message: string; creator?: string }, extra) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "send_message", creator);
      if (result.error) return result.error;
      return mcpSendMessage(result.auth!, message, featureId, taskId);
    },
  );

  return server;
}

// Verify a short-lived JWT and resolve into an AuthInfo. Dispatches
// on the `scope` claim:
//   - "org"        → org-scope tokens minted by /api/mcp/org-token,
//                    verified by `verifyOrgJwt`. Carries org-wide
//                    permissions + org membership re-check.
//   - "workspace"  → legacy workspace tokens minted by /api/livekit-
//     or absent       token. Carries a workspace slug + per-tool
//                    swarm credentials. Default for any token without
//                    a `scope` claim (back-compat).
async function verifyJwt(
  token: string,
  url: URL,
): Promise<AuthInfo | undefined> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return undefined;

  let payload: Record<string, unknown>;
  try {
    payload = jwt.verify(token, jwtSecret) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  // Org-scope branch — no workspace lookup, no swarm resolution.
  if (payload.scope === "org") {
    return verifyOrgJwt(token, payload);
  }

  // Workspace-scope branch (default). The legacy token shape carries
  // `slug` + `userId`; tokens without `slug` are rejected.
  const wsPayload = payload as { slug?: string; userId?: string };
  if (!wsPayload.slug) return undefined;

  try {
    const workspace = await db.workspace.findFirst({
      where: { slug: wsPayload.slug, deleted: false },
      select: { id: true, slug: true, name: true, ownerId: true },
    });
    if (!workspace) {
      console.log("[MCP] JWT workspace not found:", wsPayload.slug);
      return undefined;
    }

    // IDOR hardening: if the JWT carries a userId (minted by
    // /api/livekit-token), re-validate that the user is still a member of
    // the workspace at use time. Legacy JWTs without userId are rejected.
    if (!wsPayload.userId) {
      console.log("[MCP] JWT missing userId claim — rejecting legacy token");
      return undefined;
    }

    const isOwner = workspace.ownerId === wsPayload.userId;
    if (!isOwner) {
      const membership = await db.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: wsPayload.userId,
          },
        },
        select: { role: true },
      });
      if (!membership) {
        console.log(
          "[MCP] JWT user is no longer a member of workspace:",
          workspace.slug,
        );
        return undefined;
      }
    }

    console.log("[MCP] JWT verified for workspace:", workspace.slug);

    const swarmAccess = await getSwarmAccessByWorkspaceId(workspace.id);
    if (!swarmAccess.success) {
      console.log(
        "[MCP] Swarm access failed:",
        swarmAccess.error,
        "- tools will be unavailable",
      );
    } else {
      console.log("[MCP] Swarm access obtained");
    }

    const toolsFilter = parseToolsFilter(url);

    return {
      token,
      clientId: workspace.id,
      scopes: [],
      extra: {
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        apiKeyId: "jwt",
        swarmUrl: swarmAccess.success ? swarmAccess.data.swarmUrl : undefined,
        swarmApiKey: swarmAccess.success
          ? swarmAccess.data.swarmApiKey
          : undefined,
        toolsFilter: toolsFilter ?? undefined,
      } as McpAuthExtra,
    };
  } catch {
    // Preserves the original function's behavior: any DB error here
    // falls through to a 401. Refactoring to surface a 500 would be a
    // policy change worth its own discussion.
    return undefined;
  }
}

// Verify a short-lived org-scope JWT (signed by /api/mcp/org-token).
//
// Shape (see also `orgMcpTools.ts`):
//   {
//     scope: "org",
//     orgId: string,
//     userId: string,
//     permissions: ("read" | "write")[],
//     purpose: string,
//     iat, exp, jti
//   }
//
// Re-validates org membership at use time (mirrors workspace-JWT IDOR
// hardening): a user removed from every workspace in the org after
// the token was minted should not be able to drive the org agent.
async function verifyOrgJwt(
  token: string,
  payload: Record<string, unknown>,
): Promise<AuthInfo | undefined> {
  const orgId = typeof payload.orgId === "string" ? payload.orgId : undefined;
  const userId =
    typeof payload.userId === "string" ? payload.userId : undefined;
  const purpose =
    typeof payload.purpose === "string" ? payload.purpose : "unknown";
  const jti = typeof payload.jti === "string" ? payload.jti : undefined;
  const rawPermissions = Array.isArray(payload.permissions)
    ? payload.permissions
    : [];

  if (!orgId || !userId) {
    console.log("[MCP] Org JWT missing orgId or userId");
    return undefined;
  }

  // Normalize + filter to known permissions. Unknown values are
  // silently dropped rather than failing the token outright, so
  // additive future permissions don't break older verifiers in
  // mixed-version deployments.
  const permissions: OrgPermission[] = rawPermissions.filter(isOrgPermission);
  if (!permissions.includes("read")) {
    console.log("[MCP] Org JWT missing required 'read' permission");
    return undefined;
  }

  // Re-validate org membership: user must own or be an active member
  // of at least one workspace under this org. Same predicate as
  // `resolveAuthorizedOrgId` but inlined to keep the org-id known
  // (we don't need to re-resolve it from a githubLogin).
  //
  // DB errors fall through to 401 (return undefined) to match the
  // workspace-JWT branch's behavior — verification is best-effort and
  // a transient DB blip should not get distinguished from "not a
  // member" to the client.
  let membership: { id: string } | null;
  try {
    membership = await db.workspace.findFirst({
      where: {
        sourceControlOrgId: orgId,
        deleted: false,
        OR: [
          { ownerId: userId },
          { members: { some: { userId, leftAt: null } } },
        ],
      },
      select: { id: true },
    });
  } catch (err) {
    console.error("[MCP] Org JWT membership check failed:", err);
    return undefined;
  }
  if (!membership) {
    console.log(
      `[MCP] Org JWT user ${userId} no longer has membership in org ${orgId}`,
    );
    return undefined;
  }

  console.log(
    `[MCP] Org JWT verified: org=${orgId} user=${userId} perms=${permissions.join(",")} purpose=${purpose}`,
  );

  return {
    token,
    clientId: orgId,
    scopes: [],
    extra: {
      scope: "org" as const,
      orgId,
      userId,
      permissions,
      purpose,
      jti,
    } satisfies OrgMcpAuthExtra,
  };
}

async function verifyToken(req: Request): Promise<AuthInfo | undefined> {
  const url = new URL(req.url);

  // Extract bearer token from Authorization header
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : undefined;

  const token =
    url.searchParams.get("apiKey") ||
    url.searchParams.get("hiveToken") ||
    bearerToken;

  if (!token) {
    console.log("[MCP] No token provided");
    return undefined;
  }

  // Try long-lived workspace API key first
  if (token.startsWith("hive_")) {
    const result = await validateApiKey(token);
    if (!result) {
      console.log("[MCP] API key validation failed");
      return undefined;
    }
    console.log("[MCP] API key validated for workspace:", result.workspace.slug);

    const swarmAccess = await getSwarmAccessByWorkspaceId(result.workspace.id);
    if (!swarmAccess.success) {
      console.log(
        "[MCP] Swarm access failed:",
        swarmAccess.error,
        "- tools will be unavailable",
      );
    } else {
      console.log("[MCP] Swarm access obtained");
    }

    const toolsFilter = parseToolsFilter(url);

    return {
      token,
      clientId: result.workspace.id,
      scopes: [],
      extra: {
        workspaceId: result.workspace.id,
        workspaceSlug: result.workspace.slug,
        apiKeyId: result.apiKey.id,
        swarmUrl: swarmAccess.success ? swarmAccess.data.swarmUrl : undefined,
        swarmApiKey: swarmAccess.success
          ? swarmAccess.data.swarmApiKey
          : undefined,
        toolsFilter: toolsFilter ?? undefined,
      } as McpAuthExtra,
    };
  }

  // Fall back to short-lived JWT
  return verifyJwt(token, url);
}

const UNAUTHORIZED = () =>
  new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Handle an MCP request using the SDK's web-standard transport directly.
 * Each invocation gets a fresh stateless transport — no leaked state, no
 * monkey-patched globals, no fake Node.js HTTP objects.
 */
export async function handleMcpRequest(req: Request): Promise<Response> {
  // Authenticate
  const authInfo = await verifyToken(req);
  if (!authInfo) return UNAUTHORIZED();

  // Pick the tool family based on the token's scope. Org-scope tokens
  // get a server with just `org_agent`; workspace-scope tokens get the
  // full existing tool surface. The auth context is mutually
  // exclusive — see `createServer` for the rationale.
  const scope =
    (authInfo.extra as { scope?: string } | undefined)?.scope === "org"
      ? "org"
      : "workspace";

  // Fresh server + stateless transport per request
  const server = createServer(scope);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  await server.connect(transport);

  try {
    return await transport.handleRequest(req, { authInfo });
  } catch (error) {
    console.error("[MCP] Transport error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
