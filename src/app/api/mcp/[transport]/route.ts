import {
  createMcpHandler,
  experimental_withMcpAuth as withMcpAuth,
} from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { validateApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
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
        apiKeyId: "jwt", // no persistent key record for JWTs
        swarmUrl: swarmAccess.success ? swarmAccess.data.swarmUrl : undefined,
        swarmApiKey: swarmAccess.success
          ? swarmAccess.data.swarmApiKey
          : undefined,
        toolsFilter: toolsFilter ?? undefined,
      } as McpAuthExtra,
    };
  } catch {
    // expired / invalid signature / malformed
    return undefined;
  }
}

const verifyToken = async (
  req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> => {
  const url = new URL(req.url);

  console.log("[MCP] verifyToken called", {
    url: req.url,
    bearerToken: !!bearerToken,
  });

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
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
});

export { authHandler as GET, authHandler as POST };
