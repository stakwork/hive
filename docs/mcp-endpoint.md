# MCP Endpoint

This document describes the plan for implementing an MCP (Model Context Protocol) server endpoint that exposes Hive's codebase knowledge tools to AI coding assistants.

## Overview

The MCP endpoint allows AI coding assistants (Cursor, Claude Desktop, Windsurf, etc.) to access workspace-specific codebase knowledge through standardized MCP tools. Authentication is handled via workspace API keys (see `docs/workspace-api-keys.md`).

## Endpoint

```
GET/POST /api/mcp/[transport]?apiKey={key}&tools={tool1,tool2}
```

### Query Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `apiKey` | Yes | Workspace API key for authentication |
| `tools` | No | Comma-separated list of tools to expose. If omitted, all tools are available. |

### Examples

```
# All tools
/api/mcp/mcp?apiKey=hive_cm5x_...

# Only list_concepts
/api/mcp/mcp?apiKey=hive_cm5x_...&tools=list_concepts

# Multiple specific tools
/api/mcp/mcp?apiKey=hive_cm5x_...&tools=list_concepts,learn_concept
```

## Initial Tools

### `list_concepts`

Fetch a list of features/concepts from the codebase knowledge base.

**Input Schema:**
```json
{}
```

**Output:** Array of concepts with metadata including:
- `id` - Unique concept identifier
- `name` - Human-readable name
- `description` - Brief description
- `prCount` - Number of related PRs
- `commitCount` - Number of related commits
- `lastUpdated` - Last update timestamp
- `hasDocumentation` - Whether documentation exists

**Example Response:**
```json
{
  "features": [
    {
      "id": "auth-system",
      "name": "Authentication System",
      "description": "OAuth and session management",
      "prCount": 12,
      "commitCount": 45,
      "lastUpdated": "2025-01-30T10:00:00Z",
      "hasDocumentation": true
    }
  ]
}
```

### `learn_concept`

Fetch documentation for a specific concept by ID. Returns just the documentation content for efficient context usage.

**Input Schema:**
```json
{
  "conceptId": "string (required) - The ID of the concept to retrieve"
}
```

**Output:** The documentation string for the concept.

**Example Response:**
```
# Authentication System

This module handles user authentication via OAuth providers...

## Overview
...
```
```

## Implementation

### Dependencies

```bash
npm install mcp-handler
```

### Route Handler

```typescript
// src/app/api/mcp/[transport]/route.ts
import { createMcpHandler, experimental_withMcpAuth as withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { validateApiKey } from "@/lib/api-keys";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { listConcepts } from "@/lib/ai/askTools";
import { z } from "zod";

// Available tools registry
const AVAILABLE_TOOLS = ["list_concepts", "learn_concept"] as const;
type ToolName = typeof AVAILABLE_TOOLS[number];

// Parse tools filter from URL
function parseToolsFilter(url: URL): Set<ToolName> | null {
  const toolsParam = url.searchParams.get("tools");
  if (!toolsParam) return null; // null means all tools
  
  const requested = toolsParam.split(",").map(t => t.trim().toLowerCase());
  const valid = new Set<ToolName>();
  
  for (const tool of requested) {
    if (AVAILABLE_TOOLS.includes(tool as ToolName)) {
      valid.add(tool as ToolName);
    }
  }
  
  return valid.size > 0 ? valid : null;
}

const handler = createMcpHandler(
  (server, { extra }) => {
    const { swarmUrl, swarmApiKey, toolsFilter } = extra as {
      swarmUrl: string;
      swarmApiKey: string;
      toolsFilter: Set<ToolName> | null;
    };

    // Helper to check if tool should be registered
    const shouldRegister = (name: ToolName) => 
      toolsFilter === null || toolsFilter.has(name);

    // Register list_concepts tool
    if (shouldRegister("list_concepts")) {
      server.tool(
        "list_concepts",
        "Fetch a list of features/concepts from the codebase knowledge base. Returns features with metadata including name, description, PR/commit counts, last updated time, and whether documentation exists.",
        {},
        async () => {
          try {
            const result = await listConcepts(swarmUrl, swarmApiKey);
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: "Error: Could not retrieve concepts" }],
              isError: true,
            };
          }
        }
      );
    }

    // Register learn_concept tool
    if (shouldRegister("learn_concept")) {
      server.tool(
        "learn_concept",
        "Fetch documentation for a specific concept by ID. Returns the documentation content for the concept.",
        {
          conceptId: z.string().describe("The ID of the concept to retrieve documentation for"),
        },
        async ({ conceptId }) => {
          try {
            const res = await fetch(
              `${swarmUrl}/gitree/features/${encodeURIComponent(conceptId)}`,
              {
                method: "GET",
                headers: {
                  "Content-Type": "application/json",
                  "x-api-token": swarmApiKey,
                },
              }
            );
            
            if (!res.ok) {
              return {
                content: [{ type: "text", text: "Error: Concept not found" }],
                isError: true,
              };
            }
            
            const data = await res.json();
            // Return just the documentation content for efficient context usage
            const documentation = data.feature?.documentation || "No documentation available";
            return {
              content: [{ type: "text", text: documentation }],
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: "Error: Could not retrieve concept documentation" }],
              isError: true,
            };
          }
        }
      );
    }
  },
  {
    capabilities: {
      tools: {},
    },
  },
  {
    basePath: "/api/mcp",
  }
);

const verifyToken = async (
  req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> => {
  const url = new URL(req.url);
  const apiKey = url.searchParams.get("apiKey") || bearerToken;

  if (!apiKey) return undefined;

  const result = await validateApiKey(apiKey);
  if (!result) return undefined;

  // Get swarm access for this workspace
  const swarmAccess = await getSwarmAccessByWorkspaceId(result.workspace.id);
  if (!swarmAccess.success) return undefined;

  // Parse tools filter
  const toolsFilter = parseToolsFilter(url);

  return {
    token: apiKey,
    clientId: result.workspace.id,
    extra: {
      workspaceId: result.workspace.id,
      workspaceSlug: result.workspace.slug,
      apiKeyId: result.apiKey.id,
      swarmUrl: swarmAccess.data.swarmUrl,
      swarmApiKey: swarmAccess.data.swarmApiKey,
      toolsFilter,
    },
  };
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
});

export { authHandler as GET, authHandler as POST };
```

### Helper Function

Add to `src/lib/helpers/swarm-access.ts`:

```typescript
/**
 * Gets workspace swarm configuration by workspace ID (for internal use)
 * Does not validate user access - caller must ensure authorization
 */
export async function getSwarmAccessByWorkspaceId(
  workspaceId: string
): Promise<SwarmAccessResult> {
  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: {
      name: true,
      status: true,
      swarmUrl: true,
      swarmApiKey: true,
    },
  });

  if (!swarm) {
    return { success: false, error: { type: "SWARM_NOT_CONFIGURED" } };
  }

  if (swarm.status !== "ACTIVE") {
    return { success: false, error: { type: "SWARM_NOT_ACTIVE", status: swarm.status } };
  }

  if (!swarm.swarmUrl || !swarm.swarmApiKey) {
    return { success: false, error: { type: "SWARM_NOT_CONFIGURED" } };
  }

  const encryptionService = EncryptionService.getInstance();
  const decryptedApiKey = encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);

  return {
    success: true,
    data: {
      workspaceId,
      swarmName: swarm.name || "",
      swarmUrl: swarm.swarmUrl,
      swarmApiKey: decryptedApiKey,
      swarmStatus: swarm.status,
    },
  };
}
```

## Client Configuration

### Claude Desktop / Cursor / Windsurf (Streamable HTTP)

```json
{
  "mcpServers": {
    "hive": {
      "url": "https://app.hive.com/api/mcp/mcp?apiKey=hive_cm5x_..."
    }
  }
}
```

### With Tool Filtering

```json
{
  "mcpServers": {
    "hive-concepts": {
      "url": "https://app.hive.com/api/mcp/mcp?apiKey=hive_cm5x_...&tools=list_concepts,learn_concept"
    }
  }
}
```

### For stdio-only clients (via mcp-remote)

```json
{
  "mcpServers": {
    "hive": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://app.hive.com/api/mcp/mcp?apiKey=hive_cm5x_..."]
    }
  }
}
```

## Security Considerations

1. **API Key Validation**: Every request validates the API key before processing
2. **Workspace Scoping**: Tools only access data from the authenticated workspace
3. **Swarm Credentials**: Never exposed to clients; used server-side only
4. **HTTPS Required**: API keys should only be transmitted over HTTPS
5. **Rate Limiting**: Consider implementing per-key rate limits (future enhancement)

## Future Tools

Additional tools to consider adding:

| Tool | Description |
|------|-------------|
| `search_code` | Search code across the repository |
| `list_recent_commits` | Get recent commits with context |
| `get_file_content` | Retrieve specific file contents |
| `list_contributors` | List repository contributors |
| `get_pr_details` | Get details about a specific PR |

## Testing

### Manual Testing

```bash
# Test with curl (list tools)
curl -X POST "http://localhost:3000/api/mcp/mcp?apiKey=hive_test_..." \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Test list_concepts
curl -X POST "http://localhost:3000/api/mcp/mcp?apiKey=hive_test_..." \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_concepts","arguments":{}},"id":2}'

# Test with tool filtering
curl -X POST "http://localhost:3000/api/mcp/mcp?apiKey=hive_test_...&tools=list_concepts" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

### Integration Tests

- Verify authentication with valid/invalid API keys
- Verify tool filtering works correctly
- Verify tools return expected data format
- Verify error handling for swarm failures
- Verify workspace isolation

## Implementation Checklist

- [ ] Install `mcp-handler` package
- [ ] Add `getSwarmAccessByWorkspaceId` helper function
- [ ] Create `/api/mcp/[transport]/route.ts`
- [ ] Implement `list_concepts` tool
- [ ] Implement `learn_concept` tool
- [ ] Implement `tools` query parameter filtering
- [ ] Add integration tests
- [ ] Update API Keys UI to show MCP configuration snippet
- [ ] Add documentation to user-facing docs
