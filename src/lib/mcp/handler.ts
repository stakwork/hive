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
  mcpSendMessage,
  resolveWorkspaceUser,
  type SwarmCredentials,
  type WorkspaceAuth,
  type McpToolResult,
} from "@/lib/ai/mcpTools";

// Available tools registry
const AVAILABLE_TOOLS = [
  "list_concepts",
  "learn_concept",
  "list_features",
  "read_feature",
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
      userId,
    },
  };
}

// Create a fresh McpServer with tools registered
function createServer(): McpServer {
  const server = new McpServer(
    { name: "hive", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

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
    "send_message",
    {
      title: "Send Message",
      description:
        "Send a message in a feature's planning chat. This triggers the AI planning workflow, which will update the feature's plan asynchronously.",
      inputSchema: {
        featureId: z
          .string()
          .describe("The ID of the feature to send a message to"),
        message: z
          .string()
          .describe("The message text to send"),
        user: z
          .string()
          .optional()
          .describe(
            "Username of the sender (matched against name or alias). Falls back to workspace owner if not found.",
          ),
      },
    },
    async (
      {
        featureId,
        message,
        user,
      }: { featureId: string; message: string; user?: string },
      extra,
    ) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "send_message", user);
      if (result.error) return result.error;
      return mcpSendMessage(result.auth!, featureId, message);
    },
  );

  return server;
}

// Verify a short-lived JWT (signed by generate-link) and resolve workspace
async function verifyJwt(
  token: string,
  url: URL,
): Promise<AuthInfo | undefined> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return undefined;

  try {
    const payload = jwt.verify(token, jwtSecret) as { slug?: string };
    if (!payload.slug) return undefined;

    const workspace = await db.workspace.findFirst({
      where: { slug: payload.slug, deleted: false },
      select: { id: true, slug: true, name: true },
    });
    if (!workspace) {
      console.log("[MCP] JWT workspace not found:", payload.slug);
      return undefined;
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
    return undefined;
  }
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

  // Fresh server + stateless transport per request
  const server = createServer();
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
