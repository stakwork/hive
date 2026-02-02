import {
  createMcpHandler,
  experimental_withMcpAuth as withMcpAuth,
} from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateApiKey } from "@/lib/api-keys";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import {
  mcpListConcepts,
  mcpLearnConcept,
  type SwarmCredentials,
} from "@/lib/ai/mcpTools";

// Available tools registry
const AVAILABLE_TOOLS = ["list_concepts", "learn_concept"] as const;
type ToolName = (typeof AVAILABLE_TOOLS)[number];

interface McpAuthExtra {
  [key: string]: unknown;
  workspaceId: string;
  workspaceSlug: string;
  apiKeyId: string;
  swarmUrl?: string;
  swarmApiKey?: string;
  toolsFilter?: string[]; // Serialized as array for authInfo
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

const handler = createMcpHandler(
  (server: McpServer) => {
    // Register list_concepts tool
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

    // Register learn_concept tool
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
  },
  {
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: "hive",
      version: "1.0.0",
    },
  },
  {
    basePath: "/api/mcp",
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV === "development",
  },
);

const verifyToken = async (
  req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> => {
  const url = new URL(req.url);

  console.log("[MCP] verifyToken called", {
    url: req.url,
    bearerToken: !!bearerToken,
  });

  const apiKey = url.searchParams.get("apiKey") || bearerToken;

  if (!apiKey) {
    console.log("[MCP] No API key provided");
    return undefined;
  }

  const result = await validateApiKey(apiKey);
  if (!result) {
    console.log("[MCP] API key validation failed");
    return undefined;
  }
  console.log("[MCP] API key validated for workspace:", result.workspace.slug);

  // Get swarm access for this workspace
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

  // Parse tools filter
  const toolsFilter = parseToolsFilter(url);

  // Pass credentials through authInfo.extra (works in serverless)
  return {
    token: apiKey,
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
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
});

export { authHandler as GET, authHandler as POST };
