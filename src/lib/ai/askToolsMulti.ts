import { tool, ToolSet, Tool } from "ai";
import { z } from "zod";
import { createMCPClient } from "@ai-sdk/mcp";
import { WorkspaceConfig } from "./types";
import { listConcepts, repoAgent } from "./askTools";
import { shouldTrimConceptsToIds } from "./conceptsTrim";
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
    allTools[`${prefix}__search_logs`] = tool({
      description: `[${ws.slug}] Search application logs for ${ws.slug} using Quickwit. Supports Lucene query syntax.`,
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
