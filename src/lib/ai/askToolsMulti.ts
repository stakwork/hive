import { tool, ToolSet, Tool } from "ai";
import { z } from "zod";
import { createMCPClient } from "@ai-sdk/mcp";
import { WorkspaceConfig } from "./types";
import { listConcepts, repoAgent } from "./askTools";
// Deep import — see comment in services/task-workflow.ts.
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import { shouldTrimConceptsToIds } from "./concepts";
import { RepoAnalyzer } from "gitsee/server";
import { parseOwnerRepo } from "./utils";
import { getProviderTool } from "@/lib/ai/provider";
import {
  mcpListFeatures,
  mcpReadFeature,
  mcpListTasks,
  mcpReadTask,
  mcpCheckStatus,
  findWorkspaceUser,
  type WorkspaceAuth,
} from "@/lib/mcp/mcpTools";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = Tool<any, any>;

/** Extract text from an McpToolResult for use as a tool return value. */
function mcpText(result: { content: { type: string; text: string }[] }): string {
  return result.content.map((c) => c.text).join("\n");
}

export function askToolsMulti(
  workspaces: WorkspaceConfig[],
  apiKey: string,
  /**
   * Pre-fetched concepts per workspace (keyed by slug). When provided AND
   * we're in the trim-to-IDs regime (3+ workspaces), we expose a
   * `{slug}__read_concepts_for_repo` tool that serves `{id,name,description}`
   * directly from this in-memory cache — no extra swarm round-trip. The
   * route always fetches concepts to pre-seed `list_concepts`, so reusing
   * that fetch here is free.
   */
  conceptsByWorkspace?: Record<string, Record<string, unknown>[]>,
): ToolSet {
  // Build all tools and merge at the end
  const allTools: Record<string, AnyTool> = {};

  // Only register the summary tool when the prompt is also trimming concepts
  // to IDs — otherwise the agent already has the full descriptions seeded
  // and a "read summaries" tool is just noise.
  const trimmed = shouldTrimConceptsToIds(workspaces) && !!conceptsByWorkspace;

  for (const ws of workspaces) {
    const prefix = ws.slug;
    const repoMap = ws.repoUrls.map((url) => ({
      url,
      ...parseOwnerRepo(url),
    }));
    const isMultiRepo = ws.repoUrls.length > 1;

    // list_concepts
    allTools[`${prefix}__list_concepts`] = tool({
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

    // read_concepts_for_repo — only when we're in trim-to-IDs mode.
    // Tier 2 of the 3-tier concept-browsing flow:
    //   1. {slug}__list_concepts pre-seed → IDs only (repo-prefixed)
    //   2. {slug}__read_concepts_for_repo → {id,name,description} for one repo
    //   3. {slug}__learn_concept           → full docs/PRs/commits for one id
    if (trimmed) {
      const conceptsForWs = conceptsByWorkspace![ws.slug] || [];
      allTools[`${prefix}__read_concepts_for_repo`] = tool({
        description:
          `[${ws.slug}] Get {id, name, description} for concepts in this workspace ` +
          `scoped to a single repo. Use this AFTER scanning the ID list from ` +
          `${prefix}__list_concepts — the IDs are repo-prefixed (e.g. "owner/repo/slug"), ` +
          `so pick a repo and fetch human-readable summaries before deciding which ` +
          `concepts to learn in full via ${prefix}__learn_concept.`,
        inputSchema: z.object({
          repo: z
            .string()
            .describe(
              "Repository in 'owner/repo' format (e.g. 'stakwork/hive'). Matched " +
                "against each concept's `repo` field; falls back to the first two " +
                "segments of the concept `id` for legacy entries.",
            ),
          limit: z
            .number()
            .int()
            .positive()
            .optional()
            .default(20)
            .describe(
              "Max concepts to return. Concepts come back most-recent-first; " +
                "default 20.",
            ),
        }),
        execute: async ({
          repo,
          limit = 20,
        }: {
          repo: string;
          limit?: number;
        }) => {
          const target = repo.toLowerCase().replace(/^\/+|\/+$/g, "");
          const matches = conceptsForWs.filter((c) => {
            const r = typeof c.repo === "string" ? c.repo.toLowerCase() : "";
            if (r === target) return true;
            // Legacy fallback: id is "owner/repo/slug" for older concepts
            // that pre-date the explicit `repo` field.
            const id = typeof c.id === "string" ? c.id.toLowerCase() : "";
            const parts = id.split("/");
            return (
              parts.length >= 3 && `${parts[0]}/${parts[1]}` === target
            );
          });
          // Server returns recent-first; we preserve that order.
          return matches.slice(0, limit).map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
          }));
        },
      });
    }

    // learn_concept
    allTools[`${prefix}__learn_concept`] = tool({
      description: `[${ws.slug}] Fetch detailed documentation for a feature in the ${ws.slug} codebase.`,
      inputSchema: z.object({
        conceptId: z.string().describe("The ID of the feature to retrieve"),
      }),
      execute: async ({ conceptId }: { conceptId: string }) => {
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
    allTools[`${prefix}__recent_commits`] = tool({
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
    allTools[`${prefix}__recent_contributions`] = tool({
      description: isMultiRepo
        ? `[${ws.slug}] Query PRs by contributor. Use 'repo' param for multi-repo workspace.`
        : `[${ws.slug}] Query PRs by contributor in the ${ws.slug} codebase.`,
      inputSchema: isMultiRepo
        ? z.object({
            user: z.string(),
            repo: z.string().describe("Repository in owner/repo format"),
            limit: z.number().optional().default(5),
          })
        : z.object({
            user: z.string(),
            limit: z.number().optional().default(5),
          }),
      execute: async (params: {
        user: string;
        repo?: string;
        limit?: number;
      }) => {
        try {
          const { owner, repo } = resolveRepo(repoMap, params.repo);
          const analyzer = new RepoAnalyzer({ githubToken: ws.pat });
          return await analyzer.getContributorPRs(
            owner,
            repo,
            params.user,
            params.limit || 5
          );
        } catch (e) {
          console.error(
            `Error retrieving contributions from ${ws.slug}:`,
            e
          );
          return `Could not retrieve contributions from ${ws.slug}`;
        }
      },
    });

    // repo_agent (deep code analysis)
    allTools[`${prefix}__repo_agent`] = tool({
      description: `[${ws.slug}] Execute AI agent for deep code analysis in ${ws.slug}. Use as LAST RESORT.`,
      inputSchema: z.object({
        prompt: z.string().describe("The question for the repo agent"),
      }),
      execute: async ({ prompt }: { prompt: string }) => {
        const prompt2 = `${prompt}.\n\nPLEASE BE AS FAST AS POSSIBLE!`;
        try {
          // Per-workspace Bifrost VK so each workspace's spend gets
          // attributed to its own Customer/VK on its own Bifrost.
          // `agentName: "repo-agent"` matches the single-workspace
          // call site so cost-per-agent rollups aggregate across
          // both flows.
          const bifrost = await getBifrostForLLM(
            {
              workspaceId: ws.workspaceId,
              workspaceSlug: ws.slug,
              userId: ws.userId,
            },
            { agentName: "repo-agent" },
          );
          const rr = await repoAgent(
            ws.swarmUrl,
            ws.swarmApiKey,
            {
              repo_url: ws.repoUrls.join(","),
              prompt: prompt2,
              pat: ws.pat,
            },
            bifrost,
          );
          return rr.content;
        } catch (e) {
          console.error(`Error executing repo agent for ${ws.slug}:`, e);
          return `Could not execute repo agent for ${ws.slug}`;
        }
      },
    });

    // search_logs (via MCP)
    allTools[`${prefix}__search_logs`] = tool({
      description: `[${ws.slug}] Search application logs for ${ws.slug} using Quickwit. Supports Lucene query syntax. Does not support wildcards. IMPORTANT: every term MUST include a field prefix (e.g. "message:", "level:", "path:") — there is no default search field, so a bare query like "CLN" fails with a 400 error. To search a keyword use "message:CLN".`,
      inputSchema: z.object({
        query: z.string().describe("Lucene query string"),
        max_hits: z
          .number()
          .optional()
          .default(10)
          .describe("Maximum number of log entries to return"),
      }),
      execute: async ({
        query,
        max_hits = 10,
      }: {
        query: string;
        max_hits?: number;
      }) => {
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
          return await searchLogsTool.execute(
            { query, max_hits },
            { toolCallId: "1", messages: [] }
          );
        } catch (e) {
          console.error(`Error searching logs for ${ws.slug}:`, e);
          return `Could not search logs for ${ws.slug}`;
        } finally {
          if (mcpClient) await mcpClient.close();
        }
      },
    });

    // ------------------------------------------------------------------
    // Feature & Task tools (read-only, DB-direct via mcpTools)
    // ------------------------------------------------------------------
    const auth: WorkspaceAuth = {
      workspaceId: ws.workspaceId,
      workspaceSlug: ws.slug,
      userId: ws.userId,
    };

    // list_features
    allTools[`${prefix}__list_features`] = tool({
      description: `[${ws.slug}] List roadmap features for the ${ws.slug} workspace (up to 40, most recently updated first).`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return mcpText(await mcpListFeatures(auth));
        } catch (e) {
          console.error(`Error listing features for ${ws.slug}:`, e);
          return `Could not list features for ${ws.slug}`;
        }
      },
    });

    // read_feature
    allTools[`${prefix}__read_feature`] = tool({
      description: `[${ws.slug}] Read a feature's details, brief, requirements, architecture, and chat history for ${ws.slug}.`,
      inputSchema: z.object({
        featureId: z.string().describe("The ID of the feature to read"),
      }),
      execute: async ({ featureId }: { featureId: string }) => {
        try {
          return mcpText(await mcpReadFeature(auth, featureId));
        } catch (e) {
          console.error(`Error reading feature for ${ws.slug}:`, e);
          return `Could not read feature for ${ws.slug}`;
        }
      },
    });

    // list_tasks
    allTools[`${prefix}__list_tasks`] = tool({
      description: `[${ws.slug}] List tasks for the ${ws.slug} workspace (up to 40, most recently updated first).`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return mcpText(await mcpListTasks(auth));
        } catch (e) {
          console.error(`Error listing tasks for ${ws.slug}:`, e);
          return `Could not list tasks for ${ws.slug}`;
        }
      },
    });

    // read_task
    allTools[`${prefix}__read_task`] = tool({
      description: `[${ws.slug}] Read a task's details, status, and chat history for ${ws.slug}.`,
      inputSchema: z.object({
        taskId: z.string().describe("The ID of the task to read"),
      }),
      execute: async ({ taskId }: { taskId: string }) => {
        try {
          return mcpText(await mcpReadTask(auth, taskId));
        } catch (e) {
          console.error(`Error reading task for ${ws.slug}:`, e);
          return `Could not read task for ${ws.slug}`;
        }
      },
    });

    // check_status
    allTools[`${prefix}__check_status`] = tool({
      description: `[${ws.slug}] Check the status of active features and tasks in ${ws.slug} (updated in the last 7 days, items needing attention first).`,
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
            filterUserId = await findWorkspaceUser(ws.workspaceId, user);
          }
          return mcpText(await mcpCheckStatus(auth, filterUserId));
        } catch (e) {
          console.error(`Error checking status for ${ws.slug}:`, e);
          return `Could not check status for ${ws.slug}`;
        }
      },
    });

    // search_workflows — gated to the "stakwork" workspace only.
    if (ws.slug === "stakwork") {
      const swarmHost = new URL(ws.swarmUrl).hostname;
      const jarvisBase = `https://${swarmHost}:8444`;
      allTools[`${prefix}__search_workflows`] = tool({
        description: `[${ws.slug}] Search Stakwork for workflows by keyword. Returns [{ id, name, description }].`,
        inputSchema: z.object({
          query: z.string().describe("Workflow search term"),
        }),
        execute: async ({ query }: { query: string }) => {
          try {
            const res = await fetch(
              `${jarvisBase}/v2/nodes?q=${encodeURIComponent(query)}&type=Workflow&domains=workflow`,
              { headers: { "x-api-token": ws.swarmApiKey, "Content-Type": "application/json" } },
            );
            if (!res.ok) return `Could not search workflows for ${ws.slug}`;
            const data = await res.json();
            return (data.nodes ?? []).map(
              (n: { id: string; properties?: { name?: string; description?: string } }) => ({
                id: n.id,
                name: n.properties?.name,
                description: n.properties?.description,
              }),
            );
          } catch (e) {
            console.error(`Error searching workflows for ${ws.slug}:`, e);
            return `Could not search workflows for ${ws.slug}`;
          }
        },
      });
    }

    // logs_agent — deep, run-grounded analysis of agent execution logs.
    // Heavier than `${prefix}__search_logs` (a quick Lucene keyword
    // search); prefer search_logs for simple lookups.
    allTools[`${prefix}__logs_agent`] = tool({
      description:
        `[${ws.slug}] Invoke the Logs Agent for deep, run-grounded analysis of agent execution logs in ${ws.slug}. ` +
        `Use when the user asks what happened during a run, on a swarm, to debug agent failures, or wants a synthesised explanation backed by real log data. ` +
        `Heavier than ${prefix}__search_logs — prefer that for simple keyword lookups. ` +
        `Optionally narrow to a specific feature or task via featureId/taskId.`,
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
          // Lazy imports — these modules pull in heavy deps (Prisma,
          // EncryptionService, swarm-access). Dynamic import keeps them
          // out of every test worker that touches askToolsMulti.
          const [{ runLogsAgent }, { logger }] = await Promise.all([
            import("@/services/logs-agent"),
            import("@/lib/logger"),
          ]);

          logger.info("[LogsAgent] logs_agent tool invoked from dashboard chat", "LogsAgent", {
            workspace: ws.slug,
            workspaceId: ws.workspaceId,
            userId: ws.userId,
            hasFeatureScope: !!featureId,
            hasTaskScope: !!taskId,
          });

          const result = await runLogsAgent({
            slug: ws.slug,
            userId: ws.userId,
            prompt,
            scope,
          });

          if (result.success) {
            return result.data.answer;
          }

          const { error } = result;
          if (error.type === "TIMEOUT") {
            return `The Logs Agent timed out before returning a result for ${ws.slug}. Please try again or narrow your query to a specific feature or task.`;
          }
          if (error.type === "AGENT_FAILED") {
            return `The Logs Agent encountered an error for ${ws.slug}: ${error.message}`;
          }
          if (error.type === "ACCESS_DENIED") {
            return `Access denied to the Logs Agent for ${ws.slug}.`;
          }
          if (error.type === "WORKSPACE_NOT_FOUND") {
            return `Workspace ${ws.slug} not found — the Logs Agent could not be invoked.`;
          }
          if (error.type === "SWARM_NOT_ACTIVE" || error.type === "SWARM_NOT_CONFIGURED") {
            return `The ${ws.slug} swarm is not active. The Logs Agent is unavailable.`;
          }
          return `The Logs Agent encountered an unexpected error for ${ws.slug}. Please try again.`;
        } catch (e) {
          console.error(`[LogsAgent] logs_agent tool unexpected error for ${ws.slug}`, String(e));
          return `Could not invoke the Logs Agent for ${ws.slug}. Please try again.`;
        }
      },
    });
  }

  // Shared tools (not workspace-specific)
  const web_search = getProviderTool("anthropic", apiKey, "webSearch");
  if (web_search) {
    allTools["web_search"] = web_search;
  }

  return allTools as ToolSet;
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
