# Multi-Workspace Chat Plan

This document outlines the design for enabling AI chat sessions that span multiple workspaces, using a namespaced tool registry approach.

Core files:

- `src/app/api/ask/quick/route.ts`
- `src/lib/ai/askTools.ts`
- `src/lib/constants/prompt.ts`
- `src/components/dashboard/DashboardChat/index.tsx` (no changes here yet, frontend will be in phase 2)

## Problem Statement

Currently, chat sessions (via `/api/ask/quick`) are scoped to a single workspace:
- Tools are instantiated with one workspace's swarm credentials
- Concepts/features are fetched from one swarm's knowledge base
- The model can only query one codebase at a time

**Use cases requiring multi-workspace chat:**
- Comparing implementations across different projects
- Understanding how a shared library is used across consuming apps
- Onboarding engineers who work across multiple codebases
- Debugging cross-service issues in microservice architectures

---

## Current Architecture

```
User Request { workspaceSlug: "hive" }
    |
    v
/api/ask/quick
    |
    +-- validateWorkspaceAccess(workspaceSlug, userId)
    +-- db.swarm.findFirst({ workspaceId })
    +-- getAllRepositories(workspaceId) --> repoUrls[]
    +-- askTools(swarmUrl, swarmApiKey, repoUrls, pat, apiKey)
    |
    v
Single Tool Set (scoped to one workspace's swarm)
```

After the multi-repo changes, `askTools` now accepts `repoUrls: string[]` and conditionally adds a `repo` parameter to tools when `isMultiRepo` is true. This pattern extends naturally to multi-workspace.

---

## Proposed Architecture: Namespaced Tool Registry

Extend `/api/ask/quick` to accept either `workspaceSlug` (single) or `workspaceSlugs` (array). When multiple workspaces are provided, create workspace-prefixed tools:

```
User Request { workspaceSlugs: ["hive", "sphinx-tribes", "stakwork"] }
    |
    v
/api/ask/quick (extended)
    |
    +-- for each workspace:
    |     +-- validateWorkspaceAccess(slug, userId)
    |     +-- fetch swarm credentials
    |     +-- fetch repositories
    |
    v
askToolsMulti(workspaceConfigs[], apiKey)
    |
    v
Combined Tool Set:
  - hive:list_concepts
  - hive:learn_concept
  - hive:recent_commits
  - sphinx-tribes:list_concepts
  - sphinx-tribes:learn_concept
  - sphinx-tribes:recent_commits
  - stakwork:list_concepts
  - ...
```

**Why this approach:**
- Explicit tool names = clear provenance ("this answer came from hive workspace")
- Model can query multiple workspaces in parallel
- No hidden state or context switching
- Works naturally with existing tool execution pattern
- Easy to show which workspace is being queried in UI
- Single endpoint handles both single and multi-workspace modes

**Tradeoffs:**
- Tool count grows linearly with workspaces (N workspaces × 6 tools + 1 shared = 6N + 1)
- May hit model's tool limit for many workspaces (mitigated by capping at 5 workspaces)

---

## Implementation

### 1. New Types

**File:** `src/lib/ai/types.ts`

```typescript
export interface WorkspaceConfig {
  slug: string;
  swarmUrl: string;
  swarmApiKey: string;
  repoUrls: string[];
  pat: string;
}
```

### 2. New Tool Factory

**File:** `src/lib/ai/askToolsMulti.ts`

```typescript
import { tool, ToolSet } from "ai";
import { z } from "zod";
import { createMCPClient } from "@ai-sdk/mcp";
import { WorkspaceConfig } from "./types";
import { listConcepts, repoAgent } from "./askTools";
import { RepoAnalyzer } from "gitsee/server";
import { parseOwnerRepo } from "./utils";
import { getProviderTool } from "./provider";

export function askToolsMulti(
  workspaces: WorkspaceConfig[],
  apiKey: string
): ToolSet {
  const tools: ToolSet = {};
  
  // Add workspace-specific tools for each workspace
  for (const ws of workspaces) {
    const prefix = ws.slug;
    const repoMap = ws.repoUrls.map((url) => ({
      url,
      ...parseOwnerRepo(url),
    }));
    const isMultiRepo = ws.repoUrls.length > 1;
    
    // list_concepts
    tools[`${prefix}:list_concepts`] = tool({
      description: `[${ws.slug}] Fetch features/concepts from the ${ws.slug} codebase knowledge base.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await listConcepts(ws.swarmUrl, ws.swarmApiKey);
        } catch (e) {
          console.error(`Error retrieving features from ${ws.slug}:`, e);
          return `Could not retrieve features from ${ws.slug}`;
        }
      },
    });
    
    // learn_concept
    tools[`${prefix}:learn_concept`] = tool({
      description: `[${ws.slug}] Fetch detailed documentation for a feature in the ${ws.slug} codebase.`,
      inputSchema: z.object({
        conceptId: z.string().describe("The ID of the feature to retrieve"),
      }),
      execute: async ({ conceptId }) => {
        try {
          const res = await fetch(
            `${ws.swarmUrl}/gitree/features/${encodeURIComponent(conceptId)}`,
            {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                "x-api-token": ws.swarmApiKey,
              },
            }
          );
          if (!res.ok) return { error: "Feature not found" };
          return await res.json();
        } catch (e) {
          console.error(`Error retrieving feature from ${ws.slug}:`, e);
          return `Could not retrieve feature from ${ws.slug}`;
        }
      },
    });
    
    // recent_commits
    tools[`${prefix}:recent_commits`] = tool({
      description: isMultiRepo
        ? `[${ws.slug}] Query recent commits. Use 'repo' param (owner/repo) for multi-repo workspace.`
        : `[${ws.slug}] Query recent commits from the ${ws.slug} codebase.`,
      inputSchema: isMultiRepo
        ? z.object({
            repo: z.string().describe("Repository in owner/repo format"),
            limit: z.number().optional().default(10),
          })
        : z.object({ limit: z.number().optional().default(10) }),
      execute: async (params: { repo?: string; limit?: number }) => {
        try {
          const { owner, repo } = resolveRepo(repoMap, params.repo);
          const analyzer = new RepoAnalyzer({ githubToken: ws.pat });
          return await analyzer.getRecentCommitsWithFiles(owner, repo, {
            limit: params.limit || 10,
          });
        } catch (e) {
          console.error(`Error retrieving commits from ${ws.slug}:`, e);
          return `Could not retrieve commits from ${ws.slug}`;
        }
      },
    });
    
    // recent_contributions
    tools[`${prefix}:recent_contributions`] = tool({
      description: isMultiRepo
        ? `[${ws.slug}] Query PRs by contributor. Use 'repo' param for multi-repo workspace.`
        : `[${ws.slug}] Query PRs by contributor in the ${ws.slug} codebase.`,
      inputSchema: isMultiRepo
        ? z.object({
            user: z.string(),
            repo: z.string().describe("Repository in owner/repo format"),
            limit: z.number().optional().default(5),
          })
        : z.object({ user: z.string(), limit: z.number().optional().default(5) }),
      execute: async (params: { user: string; repo?: string; limit?: number }) => {
        try {
          const { owner, repo } = resolveRepo(repoMap, params.repo);
          const analyzer = new RepoAnalyzer({ githubToken: ws.pat });
          return await analyzer.getContributorPRs(owner, repo, params.user, params.limit || 5);
        } catch (e) {
          console.error(`Error retrieving contributions from ${ws.slug}:`, e);
          return `Could not retrieve contributions from ${ws.slug}`;
        }
      },
    });
    
    // repo_agent (deep code analysis)
    tools[`${prefix}:repo_agent`] = tool({
      description: `[${ws.slug}] Execute AI agent for deep code analysis in ${ws.slug}. Use as LAST RESORT.`,
      inputSchema: z.object({
        prompt: z.string().describe("The question for the repo agent"),
      }),
      execute: async ({ prompt }) => {
        const prompt2 = `${prompt}.\n\nPLEASE BE AS FAST AS POSSIBLE!`;
        try {
          const rr = await repoAgent(ws.swarmUrl, ws.swarmApiKey, {
            repo_url: ws.repoUrls.join(","),
            prompt: prompt2,
            pat: ws.pat,
          });
          return rr.content;
        } catch (e) {
          console.error(`Error executing repo agent for ${ws.slug}:`, e);
          return `Could not execute repo agent for ${ws.slug}`;
        }
      },
    });
    
    // search_logs (via MCP)
    tools[`${prefix}:search_logs`] = tool({
      description: `[${ws.slug}] Search application logs for ${ws.slug} using Quickwit. Supports Lucene query syntax.`,
      inputSchema: z.object({
        query: z.string().describe("Lucene query string"),
        max_hits: z.number().optional().default(10),
      }),
      execute: async ({ query, max_hits = 10 }) => {
        let mcpClient;
        try {
          mcpClient = await createMCPClient({
            transport: {
              type: "http",
              url: `${ws.swarmUrl}/mcp`,
              headers: { Authorization: `Bearer ${ws.swarmApiKey}` },
            },
          });
          const tools = await mcpClient.tools();
          const searchLogsTool = tools["search_logs"];
          if (!searchLogsTool?.execute) return "search_logs tool not found";
          return await searchLogsTool.execute({ query, max_hits }, { toolCallId: "1", messages: [] });
        } catch (e) {
          console.error(`Error searching logs for ${ws.slug}:`, e);
          return `Could not search logs for ${ws.slug}`;
        } finally {
          if (mcpClient) await mcpClient.close();
        }
      },
    });
  }
  
  // Shared tools (not workspace-specific)
  const web_search = getProviderTool("anthropic", apiKey, "webSearch");
  if (web_search) {
    tools["web_search"] = web_search;
  }
  
  return tools;
}

function resolveRepo(
  repoMap: { url: string; owner: string; repo: string }[],
  repoParam?: string
): { owner: string; repo: string } {
  if (repoParam) {
    const [owner, repo] = repoParam.split("/");
    return { owner, repo };
  }
  return { owner: repoMap[0].owner, repo: repoMap[0].repo };
}
```

### 3. Update API Endpoint

**File:** `src/app/api/ask/quick/route.ts`

Extend the existing endpoint to handle both single and multi-workspace modes:

```typescript
// In the request body parsing:
const { messages, workspaceSlug, workspaceSlugs } = body;

// Normalize to array (supports both single slug and array)
const slugs: string[] = workspaceSlugs || (workspaceSlug ? [workspaceSlug] : []);

if (slugs.length === 0) {
  throw validationError("Missing required parameter: workspaceSlug or workspaceSlugs");
}
if (slugs.length > 5) {
  throw validationError("Maximum 5 workspaces allowed per session");
}

const isMultiWorkspace = slugs.length > 1;

if (isMultiWorkspace) {
  // Multi-workspace path
  const workspaceConfigs = await buildWorkspaceConfigs(slugs, userOrResponse.id);
  const tools = askToolsMulti(workspaceConfigs, apiKey);
  const systemMessages = getMultiWorkspacePrefixMessages(workspaceConfigs);
  // ... rest of streaming logic
} else {
  // Current single-workspace path (unchanged)
  const tools = askTools(baseSwarmUrl, decryptedSwarmApiKey, repoUrls, pat, apiKey);
  // ... existing logic
}
```

Helper function to build workspace configs:

```typescript
async function buildWorkspaceConfigs(
  slugs: string[],
  userId: string
): Promise<WorkspaceConfig[]> {
  const encryptionService = EncryptionService.getInstance();
  const configs: WorkspaceConfig[] = [];

  for (const slug of slugs) {
    const access = await validateWorkspaceAccess(slug, userId);
    if (!access.hasAccess || !access.workspace) {
      throw forbiddenError(`Access denied for workspace: ${slug}`);
    }

    const swarm = await db.swarm.findFirst({
      where: { workspaceId: access.workspace.id },
    });
    if (!swarm?.swarmUrl) {
      throw notFoundError(`Swarm not configured for workspace: ${slug}`);
    }

    const repositories = await db.repository.findMany({
      where: { workspaceId: access.workspace.id },
      orderBy: { createdAt: "asc" },
    });
    if (repositories.length === 0) {
      throw notFoundError(`No repositories for workspace: ${slug}`);
    }

    const githubProfile = await getGithubUsernameAndPAT(userId, slug);
    if (!githubProfile?.token) {
      throw notFoundError(`GitHub PAT not found for workspace: ${slug}`);
    }

    const swarmUrlObj = new URL(swarm.swarmUrl);
    let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
    if (swarm.swarmUrl.includes("localhost")) {
      baseSwarmUrl = "http://localhost:3355";
    }

    configs.push({
      slug,
      swarmUrl: baseSwarmUrl,
      swarmApiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey || ""),
      repoUrls: repositories.map((r) => r.repositoryUrl),
      pat: githubProfile.token,
    });
  }

  return configs;
}
```

Fetch concepts for all workspaces (for pre-filling):

```typescript
async function fetchConceptsForWorkspaces(
  configs: WorkspaceConfig[]
): Promise<Record<string, Record<string, unknown>[]>> {
  const conceptsByWorkspace: Record<string, Record<string, unknown>[]> = {};
  
  await Promise.all(
    configs.map(async (ws) => {
      try {
        const concepts = await listConcepts(ws.swarmUrl, ws.swarmApiKey);
        conceptsByWorkspace[ws.slug] = (concepts.features as Record<string, unknown>[]) || [];
      } catch (e) {
        console.error(`Failed to fetch concepts for ${ws.slug}:`, e);
        conceptsByWorkspace[ws.slug] = [];
      }
    })
  );
  
  return conceptsByWorkspace;
}
```

### 4. System Prompt

**File:** `src/lib/constants/prompt.ts` (add new functions)

```typescript
import { WorkspaceConfig } from "@/lib/ai/types";

export function getMultiWorkspaceSystemPrompt(workspaces: WorkspaceConfig[]): string {
  const workspaceList = workspaces
    .map((ws) => {
      const repos = ws.repoUrls.join(", ");
      return `- **${ws.slug}**: ${repos}`;
    })
    .join("\n");

  return `
You are a source code learning assistant with access to multiple codebases. Your job is to provide a quick, clear, and actionable answer to the user's question, in a conversational tone. Your answer should be SHORT, like ONE paragraph: concise, practical, and easy to understand — a bullet point list is fine, but do NOT provide lengthy explanations or deep dives.

Try to match the tone of the user. If the question is highly technical (mentioning specific things in the code), then you can answer with more technical language and examples (or function names, endpoints names, etc). But if the user prompt is not technical, then you should answer in clear, plain language.

## Available Workspaces & Repositories
${workspaceList}

## Tool Naming Convention
Tools are prefixed with workspace slugs. For each workspace you have:
- \`{workspace}:list_concepts\` - List features/concepts from that codebase
- \`{workspace}:learn_concept\` - Fetch detailed documentation for a feature by ID
- \`{workspace}:recent_commits\` - Query recent commits
- \`{workspace}:recent_contributions\` - Query PRs by a contributor
- \`{workspace}:search_logs\` - Search application logs (Lucene query syntax)
- \`{workspace}:repo_agent\` - Deep code analysis (use as LAST RESORT)

If you think information about concepts might help answer the user's question, use these tools to fetch relevant data. When comparing implementations or answering questions that span multiple projects, query the relevant workspaces. Always cite which workspace information came from.

If you really can't find anything useful, or you truly do not know the answer, simply reply something like: "Sorry, I don't know the answer to that question, I'll look into it."

When you are done print "[END_OF_ANSWER]"`;
}

export function getMultiWorkspacePrefixMessages(
  workspaces: WorkspaceConfig[],
  conceptsByWorkspace: Record<string, Record<string, unknown>[]>,
  clueMsgs: ModelMessage[] | null
): ModelMessage[] {
  // Build pre-filled tool calls for each workspace's concepts
  const toolCalls: ModelMessage[] = [];
  
  for (const ws of workspaces) {
    const concepts = conceptsByWorkspace[ws.slug] || [];
    toolCalls.push({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: `list-${ws.slug}`,
          toolName: `${ws.slug}:list_concepts`,
          input: {},
        },
      ],
    });
    toolCalls.push({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: `list-${ws.slug}`,
          toolName: `${ws.slug}:list_concepts`,
          output: {
            type: "json",
            value: concepts as any,
          },
        },
      ],
    });
  }

  return [
    { role: "system", content: getMultiWorkspaceSystemPrompt(workspaces) },
    ...toolCalls,
    ...(clueMsgs || []),
  ];
}
```

### 5. Frontend Changes

The frontend requires minimal changes. The existing `DashboardChat` component already displays tool calls generically via `ToolCallIndicator`, so namespaced tool names like `hive:list_concepts` will display naturally.

**File:** `src/components/dashboard/DashboardChat/index.tsx`

For backward compatibility, continue sending `workspaceSlug` for single-workspace mode. Multi-workspace can be enabled by passing `workspaceSlugs` instead:

```typescript
// Current (single workspace) - no changes needed:
body: JSON.stringify({
  messages: [...],
  workspaceSlug: slug,  // Still works
})

// Multi-workspace mode (future enhancement):
body: JSON.stringify({
  messages: [...],
  workspaceSlugs: [slug, "other-workspace"],  // New option
})
```

**Optional future enhancement:** Add a `WorkspaceSelector` component to let users add additional workspaces to the chat session. This can be deferred until the backend is working.

---

## Security Considerations

1. **Access Validation**: Every workspace in `workspaceSlugs` must be validated independently
2. **PAT Scope**: User's GitHub PAT must have access to all repositories across workspaces
3. **Credential Isolation**: Each workspace's swarm credentials are decrypted separately

---

## Implementation Phases

### Phase 1: Backend Support
- [ ] Add `WorkspaceConfig` type to `src/lib/ai/types.ts`
- [ ] Create `askToolsMulti()` in `src/lib/ai/askToolsMulti.ts`
- [ ] Add `buildWorkspaceConfigs()` helper
- [ ] Add `getMultiWorkspaceSystemPrompt()` and `getMultiWorkspacePrefixMessages()` to prompts
- [ ] Extend `/api/ask/quick` to handle `workspaceSlugs` array (backward compatible)

**Estimated effort:** 2-3 days

### Phase 2: Frontend (Optional)
- [ ] Add `WorkspaceSelector` component to `DashboardChat`
- [ ] Allow users to select additional workspaces

**Estimated effort:** 1 day

---

## Open Questions

1. **Tool Limit**: With 5 workspaces and 6 tools each + 1 shared = 31 tools. May need to reduce max workspaces.

2. **Pusher Channel**: Use the first workspace's channel for follow-up questions and provenance.
