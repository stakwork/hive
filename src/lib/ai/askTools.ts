import { StopCondition, tool, ToolSet, ModelMessage } from "ai";
import { z } from "zod";
import { RepoAnalyzer } from "gitsee/server";
import { parseOwnerRepo } from "./utils";
import { getProviderTool } from "@/lib/ai/provider";
import { createMCPClient } from "@ai-sdk/mcp";
import {
  mcpListFeatures,
  mcpReadFeature,
  mcpListTasks,
  mcpReadTask,
  mcpCheckStatus,
  findWorkspaceUser,
  type WorkspaceAuth,
} from "@/lib/mcp/mcpTools";
// Deep import — see comment in services/task-workflow.ts.
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import { swarmFetch } from "./concepts";

export async function listConcepts(swarmUrl: string, swarmApiKey: string): Promise<Record<string, unknown>> {
  const r = await swarmFetch(`${swarmUrl}/gitree/features`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": swarmApiKey,
    },
  });
  return await r.json();
}

export interface SubAgent {
  name?: string;
  description?: string;
  url: string;
  apiToken: string;
  repoUrl?: string;
  model?: string;
  toolsConfig?: Record<string, unknown>;
  timeoutSeconds?: number;
}

export async function repoAgent(
  swarmUrl: string,
  swarmApiKey: string,
  params: {
    repo_url: string;
    prompt: string;
    username?: string;
    pat?: string;
    commit?: string;
    branch?: string;
    toolsConfig?: unknown;
    jsonSchema?: Record<string, unknown>;
    model?: string;
    skills?: Record<string, boolean>;
    subAgents?: SubAgent[];
  },
  /**
   * Optional Bifrost routing. When provided, the swarm-side `repo/agent`
   * uses `bifrost.apiKey` as the LLM bearer token, `bifrost.baseUrl`
   * as the LLM base URL, and forwards `bifrost.headers` (today: the
   * `x-macaroon` minted by the orchestrator for cost-per-agent
   * observability) onto the outbound LLM call. Plumbed via
   * `params.apiKey` / `params.baseUrl` / `params.headers` on the body
   * per the stakgraph protocol.
   *
   * `baseUrl` is already the fully-formed per-provider URL — the
   * reconciler resolves it for you (see `getBifrostForLLM` in
   * `@/services/bifrost`). Pass it through verbatim; no
   * normalization here.
   *
   * `headers` can be an empty map when the orchestrator's macaroon
   * mint failed; that's an accepted degraded state (shadow mode —
   * no `x-macaroon`, no dim on `logs.db`, but the LLM call still
   * runs). Passed through to the swarm verbatim either way.
   *
   * The accepted shape is a structural subset of `BifrostInvocation`
   * from `@/services/bifrost/orchestrator` so callers can pass the
   * orchestrator return value verbatim. The shape is duck-typed
   * (`{ apiKey, baseUrl, headers? }`) so legacy callers that hand-
   * roll a `{ apiKey, baseUrl }` object still type-check.
   */
  bifrost?: {
    apiKey: string;
    baseUrl: string;
    headers?: Record<string, string>;
  },
): Promise<Record<string, string>> {
  const body: Record<string, unknown> = { ...params };
  if (bifrost) {
    body.apiKey = bifrost.apiKey;
    body.baseUrl = bifrost.baseUrl;
    // Forwarded as a plain object alongside apiKey/baseUrl; the
    // swarm-side `/repo/agent` handler reads `body.headers` and
    // attaches each entry to the outbound LLM HTTP call.
    body.headers = bifrost.headers ?? {};
  }

  const initiateResponse = await fetch(`${swarmUrl}/repo/agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": swarmApiKey,
    },
    body: JSON.stringify(body),
  });

  if (!initiateResponse.ok) {
    const errorText = await initiateResponse.text();
    console.error(`Repo agent initiation error: ${initiateResponse.status} - ${errorText}`);
    throw new Error("Failed to initiate repo agent");
  }

  const initiateData = await initiateResponse.json();
  const requestId = initiateData.request_id;

  if (!requestId) {
    throw new Error("No request_id returned from repo agent");
  }

  const maxAttempts = 120;
  const pollInterval = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const progressUrl = `${swarmUrl}/progress?request_id=${encodeURIComponent(requestId)}`;
    const progressResponse = await fetch(progressUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": swarmApiKey,
      },
    });

    if (!progressResponse.ok) {
      console.error(`Progress check failed: ${progressResponse.status}`);
      continue;
    }

    const progressData = await progressResponse.json();

    if (progressData.status === "completed") {
      return progressData.result || {};
    } else if (progressData.status === "failed") {
      throw new Error(progressData.error || "Repo agent execution failed");
    }
  }

  throw new Error("Repo agent execution timed out. Please try again.");
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

export function askTools(swarmUrl: string, swarmApiKey: string, repoUrls: string[], pat: string, apiKey: string, workspaceAuth?: WorkspaceAuth) {
  // Build a map of repo URLs to their parsed owner/repo for multi-repo support
  const repoMap = repoUrls.map((url) => ({
    url,
    ...parseOwnerRepo(url),
  }));
  const isMultiRepo = repoUrls.length > 1;

  const web_search = getProviderTool("anthropic", apiKey, "webSearch");
  const baseTools = {
    list_concepts: tool({
      description:
        "Fetch a list of features/concepts from the codebase knowledge base. Returns features with metadata including name, description, PR/commit counts, last updated time, and whether documentation exists.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await listConcepts(swarmUrl, swarmApiKey);
        } catch (e) {
          console.error("Error retrieving features:", e);
          return "Could not retrieve features";
        }
      },
    }),
    learn_concept: tool({
      description:
        "Fetch detailed documentation for a specific feature by ID. Returns complete feature details including documentation, related PRs, and commits.",
      inputSchema: z.object({
        conceptId: z.string().describe("The ID of the feature to retrieve documentation for"),
      }),
      execute: async ({ conceptId }: { conceptId: string }) => {
        try {
          const res = await swarmFetch(`${swarmUrl}/gitree/features/${encodeURIComponent(conceptId)}`, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "x-api-token": swarmApiKey,
            },
          });
          if (!res.ok) return { error: "Feature not found" };
          const data = await res.json();
          return data;
        } catch (e) {
          console.error("Error retrieving feature documentation:", e);
          return "Could not retrieve feature documentation";
        }
      },
    }),
    recent_commits: tool({
      description: isMultiRepo
        ? "Query a repo for recent commits. The output is a list of recent commits. Use the 'repo' parameter to specify which repository (owner/repo format, e.g., 'facebook/react')."
        : "Query a repo for recent commits. The output is a list of recent commits.",
      inputSchema: isMultiRepo
        ? z.object({
            repo: z.string().describe("Repository in owner/repo format (e.g., 'facebook/react')"),
            limit: z.number().optional().default(10),
          })
        : z.object({ limit: z.number().optional().default(10) }),
      execute: async (params: { repo?: string; limit?: number }) => {
        try {
          const { owner, repo } = resolveRepo(repoMap, params.repo);
          const analyzer = new RepoAnalyzer({ githubToken: pat });
          const coms = await analyzer.getRecentCommitsWithFiles(owner, repo, {
            limit: params.limit || 10,
          });
          return coms;
        } catch (e) {
          console.error("Error retrieving recent commits:", e);
          return "Could not retrieve recent commits";
        }
      },
    }),
    recent_contributions: tool({
      description: isMultiRepo
        ? "Query a repo for recent PRs by a specific contributor. Input is the contributor's GitHub login. Use the 'repo' parameter to specify which repository (owner/repo format). The output is a list of their most recent contributions, including PR titles, issue titles, commit messages, and code review comments."
        : "Query a repo for recent PRs by a specific contributor. Input is the contributor's GitHub login. The output is a list of their most recent contributions, including PR titles, issue titles, commit messages, and code review comments.",
      inputSchema: isMultiRepo
        ? z.object({
            user: z.string(),
            repo: z.string().describe("Repository in owner/repo format (e.g., 'facebook/react')"),
            limit: z.number().optional().default(5),
          })
        : z.object({ user: z.string(), limit: z.number().optional().default(5) }),
      execute: async (params: { user: string; repo?: string; limit?: number }) => {
        try {
          const { owner, repo } = resolveRepo(repoMap, params.repo);
          const analyzer = new RepoAnalyzer({ githubToken: pat });
          const output = await analyzer.getContributorPRs(owner, repo, params.user, params.limit || 5);
          return output;
        } catch (e) {
          console.error("Error retrieving recent contributions:", e);
          return "Could not retrieve repository map";
        }
      },
    }),
    repo_agent: tool({
      description:
        "Execute an AI agent to analyze the repository and answer the user's question about the codebase. Use this for deep code analysis, ONLY IF THE ANSWER IS NOT AVAILABLE FROM THE learn_concept TOOL. This tool should be a LAST RESORT.",
      inputSchema: z.object({
        prompt: z.string().describe("The question or prompt for the repo agent to analyze"),
      }),
      execute: async ({ prompt }: { prompt: string }) => {
        const prompt2 = `${prompt}.\n\nPLEASE BE AS FAST AS POSSIBLE! DO NOT DO A THOROUGH SEARCH OF THE REPO. TRY TO FINISH THE EXPLORATION VERY QUICKLY!`;
        try {
          // Master Bifrost reconciler — see `services/bifrost/orchestrator.ts`.
          // Routes LLM calls through this workspace's Bifrost when we
          // have a `(workspaceId, userId)` pair and the rollout flag
          // is on; otherwise returns undefined and we fall back to
          // the swarm's default LLM key.
          //
          // `agentName: "repo-agent"` is what shows up as the
          // `agent-name` dim on the gateway's `logs.db`, driving the
          // cost-per-agent rollups operators care about.
          const bifrost = await getBifrostForLLM(workspaceAuth, {
            agentName: "repo-agent",
          });
          // Pass comma-separated repo URLs for multi-repo support
          const rr = await repoAgent(
            swarmUrl,
            swarmApiKey,
            {
              repo_url: repoUrls.join(","),
              prompt: prompt2,
              pat,
            },
            bifrost,
          );
          return rr.content;
        } catch (e) {
          console.error("Error executing repo agent:", e);
          return "Could not execute repo agent";
        }
      },
    }),
    search_logs: tool({
      description: `Search application logs using Quickwit. Supports Lucene query syntax. Does not support wildcards.
IMPORTANT: every term MUST include a field prefix (e.g. "message:", "level:", "path:"). There is no default search field, so a bare query like "CLN" will fail with a 400 error ("query requires a default search field"). To search for a keyword, use "message:CLN".
Example queries:
- "path:pool AND path:status" (for searching endpoint like /api/pool/[slug]/status)
- "message:AuthenticationError"
- "message:CLN AND level:ERROR"
- "level:ERROR"
`,
      inputSchema: z.object({
        query: z.string().describe("Lucene query string"),
        max_hits: z.number().optional().default(10).describe("Maximum number of log entries to return"),
      }),
      execute: async ({ query, max_hits = 10 }: { query: string; max_hits?: number }) => {
        let mcpClient;
        try {
          mcpClient = await createMCPClient({
            transport: {
              type: 'http',
              url: `${swarmUrl}/mcp`,
              headers: {
                Authorization: `Bearer ${swarmApiKey}`,
              },
            },
          });

          const tools = await mcpClient.tools();
          const searchLogsTool = tools['search_logs'];
          
          if (!searchLogsTool || !searchLogsTool.execute) {
            return "search_logs tool not found on MCP server";
          }

          const result = await searchLogsTool.execute(
            { query, max_hits },
            { toolCallId: '1', messages: [] }
          );
          
          return result;
        } catch (e) {
          console.error("Error searching logs:", e);
          return "Could not search logs";
        } finally {
          if (mcpClient) {
            await mcpClient.close();
          }
        }
      },
    }),
    web_search,
  };
  return { ...baseTools, ...buildWorkspaceTools(swarmUrl, swarmApiKey, workspaceAuth) };
}

/** Extract text from an McpToolResult for use as a tool return value. */
function mcpText(result: { content: { type: string; text: string }[] }): string {
  return result.content.map((c) => c.text).join("\n");
}

/**
 * Build feature/task read-only tools + logs_agent when workspace auth is available.
 * swarmUrl/swarmApiKey are passed so logs_agent can be registered alongside search_logs.
 */
function buildWorkspaceTools(
  _swarmUrl: string,
  _swarmApiKey: string,
  auth?: WorkspaceAuth,
): ToolSet {
  if (!auth) return {};
  return {
    list_features: tool({
      description: "List roadmap features for this workspace (up to 40, most recently updated first).",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return mcpText(await mcpListFeatures(auth));
        } catch (e) {
          console.error("Error listing features:", e);
          return "Could not list features";
        }
      },
    }),
    read_feature: tool({
      description: "Read a feature's details, brief, requirements, architecture, and chat history.",
      inputSchema: z.object({
        featureId: z.string().describe("The ID of the feature to read"),
      }),
      execute: async ({ featureId }: { featureId: string }) => {
        try {
          return mcpText(await mcpReadFeature(auth, featureId));
        } catch (e) {
          console.error("Error reading feature:", e);
          return "Could not read feature";
        }
      },
    }),
    list_tasks: tool({
      description: "List tasks for this workspace (up to 40, most recently updated first).",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return mcpText(await mcpListTasks(auth));
        } catch (e) {
          console.error("Error listing tasks:", e);
          return "Could not list tasks";
        }
      },
    }),
    read_task: tool({
      description: "Read a task's details, status, and chat history.",
      inputSchema: z.object({
        taskId: z.string().describe("The ID of the task to read"),
      }),
      execute: async ({ taskId }: { taskId: string }) => {
        try {
          return mcpText(await mcpReadTask(auth, taskId));
        } catch (e) {
          console.error("Error reading task:", e);
          return "Could not read task";
        }
      },
    }),
    check_status: tool({
      description: "Check the status of active features and tasks (updated in the last 7 days, items needing attention first).",
      inputSchema: z.object({
        user: z
          .string()
          .optional()
          .describe("Optional user name to filter by (fuzzy matched against workspace members)"),
      }),
      execute: async ({ user }: { user?: string }) => {
        try {
          let filterUserId: string | undefined;
          if (user) {
            filterUserId = await findWorkspaceUser(auth.workspaceId, user);
          }
          return mcpText(await mcpCheckStatus(auth, filterUserId));
        } catch (e) {
          console.error("Error checking status:", e);
          return "Could not check status";
        }
      },
    }),
    logs_agent: tool({
      description:
        "Invoke the Logs Agent to perform deep, run-grounded analysis of agent execution logs for this workspace. " +
        "Use this when the user asks about what happened during a run, debugging agent failures, or wants a synthesised explanation backed by real log data. " +
        "Heavier than `search_logs` (which does a quick Lucene keyword search) — prefer `search_logs` for simple keyword lookups. " +
        "Optionally narrow the analysis to a specific feature or task by supplying featureId/taskId.",
      inputSchema: z.object({
        prompt: z.string().describe("The question or debugging query to send to the Logs Agent"),
        featureId: z
          .string()
          .optional()
          .describe("Optional feature ID to scope the analysis to runs attached to this feature"),
        taskId: z
          .string()
          .optional()
          .describe("Optional task ID to scope the analysis to runs attached to this task"),
      }),
      execute: async ({
        prompt,
        featureId,
        taskId,
      }: {
        prompt: string;
        featureId?: string;
        taskId?: string;
      }) => {
        const scope = {
          featureIds: featureId ? [featureId] : undefined,
          taskIds: taskId ? [taskId] : undefined,
        };

        try {
          // Lazy imports — these modules pull in heavy deps (Prisma, EncryptionService,
          // swarm-access). Dynamic import keeps them out of every test worker that
          // touches askTools, avoiding ERR_WORKER_OUT_OF_MEMORY in CI.
          const [{ runLogsAgent }, { logger }] = await Promise.all([
            import("@/services/logs-agent"),
            import("@/lib/logger"),
          ]);

          logger.info("[LogsAgent] logs_agent tool invoked from dashboard chat", "LogsAgent", {
            workspace: auth.workspaceSlug,
            workspaceId: auth.workspaceId,
            userId: auth.userId,
            hasFeatureScope: !!featureId,
            hasTaskScope: !!taskId,
          });

          const result = await runLogsAgent({
            slug: auth.workspaceSlug,
            userId: auth.userId,
            prompt,
            scope,
          });

          if (result.success) {
            return result.data.answer;
          }

          const { error } = result;
          if (error.type === "TIMEOUT") {
            return "The Logs Agent timed out before returning a result. Please try again or narrow your query to a specific feature or task.";
          }
          if (error.type === "AGENT_FAILED") {
            return `The Logs Agent encountered an error: ${error.message}`;
          }
          if (error.type === "ACCESS_DENIED") {
            return "Access denied to the Logs Agent for this workspace.";
          }
          if (error.type === "WORKSPACE_NOT_FOUND") {
            return "Workspace not found — the Logs Agent could not be invoked.";
          }
          if (error.type === "SWARM_NOT_ACTIVE" || error.type === "SWARM_NOT_CONFIGURED") {
            return "The workspace swarm is not active. The Logs Agent is unavailable.";
          }
          return "The Logs Agent encountered an unexpected error. Please try again.";
        } catch (e) {
          console.error("[LogsAgent] logs_agent tool unexpected error", String(e));
          return "Could not invoke the Logs Agent. Please try again.";
        }
      },
    }),
  };
}

export function createHasEndMarkerCondition<T extends ToolSet>(): StopCondition<T> {
  return ({ steps }) => {
    for (const step of steps) {
      for (const item of step.content) {
        if (item.type === "text" && item.text?.includes("[END_OF_ANSWER]")) {
          return true;
        }
      }
    }
    return false;
  };
}

export interface ClueResult {
  clue: Clue;
  score: number;
  relevanceBreakdown:{
    vector: number;
    content: number;
    centrality: number;
  }
}
interface Clue {
  id: string;
  content: string;
}


export async function searchClues(swarmUrl: string, swarmApiKey: string, query: string, minScore: number = 0.73): Promise<ClueResult[]> {
  const r = await swarmFetch(`${swarmUrl}/gitree/search-clues`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": swarmApiKey,
    },
    body: JSON.stringify({ query }),
  });
  const data = await r.json();
  const res = data.results as ClueResult[];
  return res.filter((result) => result.relevanceBreakdown.vector >= minScore);
}

export async function clueToolMsgs(swarmUrl: string, swarmApiKey: string, query: string): Promise<ModelMessage[] | null> {
  try {
    const relevantClues = await searchClues(swarmUrl, swarmApiKey, query, 0.73);
    if (relevantClues.length === 0) return null;
    const limitedClues = relevantClues.slice(0, 10);
    const arr = [];
    arr.push({
      role: "assistant" as const,
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "select-1",
          toolName: "search_relevant_clues",
          input: {
            query,
          },
        },
      ],
    });
    arr.push({
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: "select-1",
          toolName: "search_relevant_clues",
          output: {
            type: "json" as const,
             
            value: limitedClues as unknown as any,
          },
        },
      ],
    });
    return arr;
  } catch (e) {
    console.error("Error searching clues:", e);
    return null;
  }
}
