import { tool, ToolSet, Tool } from "ai";
import { z } from "zod";
import { createMCPClient } from "@ai-sdk/mcp";
import { withMcpTimeout, isMcpTimeout } from './mcpTimeout';
import { WorkspaceConfig } from "./types";
import { listConcepts, repoAgent } from "./askTools";
import { buildCourtlistenerTools } from "@/lib/ai/courtlistenerTools";
import { LEGAL_SLUGS } from "@/lib/eval-capture-slugs";
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

import { mcpText, capMcpResult } from "./mcpResult";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = Tool<any, any>;

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
  // When `query` is set, `read_concepts_for_repo` performs a live repo-scoped
  // relevance search via POST /gitree/search-concepts; otherwise it serves
  // directly from this in-memory cache — no extra swarm round-trip.
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
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe(
            "Optional search query. When provided, returns concepts ranked by semantic relevance via embedding search instead of the full list.",
          ),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of concepts to return. Caps payload size to reduce token usage."),
      }),
      execute: async ({ query, limit }: { query?: string; limit?: number }) => {
        try {
          return await listConcepts(ws.swarmUrl, ws.swarmApiKey, query, { limit });
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
          `scoped to a single repo. When a query is provided, performs a live ` +
          `repo-scoped relevance search via the swarm's semantic search endpoint. ` +
          `Without a query, serves directly from the in-memory cache — no extra swarm round-trip. ` +
          `Use this AFTER scanning the ID list from ` +
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
          query: z
            .string()
            .optional()
            .describe(
              "Optional search query. When provided, performs a live repo-scoped " +
                "relevance search instead of serving from the in-memory cache.",
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
          query,
          limit = 20,
        }: {
          repo: string;
          query?: string;
          limit?: number;
        }) => {
          const target = repo.toLowerCase().replace(/^\/+|\/+$/g, "");

          // Query present: live repo-scoped relevance search via swarm.
          if (query?.trim()) {
            try {
              const result = await listConcepts(ws.swarmUrl, ws.swarmApiKey, query, { limit, repo });
              const concepts = (result.concepts as Record<string, unknown>[] | undefined) ?? [];
              return concepts.map((c) => ({
                id: c.id,
                name: c.name,
                // Real GET / cache name the summary field `description`; mock uses `content`.
                description: (c.description ?? c.content) as unknown,
              }));
            } catch {
              // Fall back to cache filter on any failure so the tier-2 flow never hard-fails.
            }
          }

          // No query (or query fallback): serve from cache.
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
            `${ws.swarmUrl}/gitree/concepts/${encodeURIComponent(conceptId)}`,
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
      description: `[${ws.slug}] Execute AI agent for deep code analysis in ${ws.slug}. Also has the GitHub \`gh\` CLI for read-only GitHub inspection: reading issues/PRs (bodies, comments, review threads), checking CI / workflow / check-suite status, and looking at other repos. Prefer the lighter ${prefix}__recent_commits / ${prefix}__recent_contributions tools for plain commit or PR-by-author lookups; use repo_agent when a GitHub question needs real investigation. STRICTLY READ-ONLY: investigation only — NEVER instruct it to edit code, write/modify files, open a PR, or run/apply a database migration. Actual code changes, new features, and schema migrations must go through \`propose_feature\`, not this tool. Heavy/slow — use as LAST RESORT.`,
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
      description: `[${ws.slug}] Search ${ws.slug}'s live production application logs (indexed in Quickwit). These ARE the runtime logs emitted by the deployed app — use this for "prod"/"production"/"Vercel"/"deployed app" questions and errors users are hitting. NOTE: this only covers the Quickwit-indexed app logs; it does NOT cover AWS Lambda / CloudWatch system logs — for those (or any question mentioning a Lambda function or CloudWatch) use ${prefix}__logs_agent instead. Supports Lucene query syntax. Does not support wildcards. IMPORTANT: every term MUST include a field prefix (e.g. "message:", "level:", "path:") — there is no default search field, so a bare query like "CLN" fails with a 400 error. To search a keyword use "message:CLN".`,
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
        let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | undefined;
        const mcpSetup = async () => {
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
          return capMcpResult(
            await searchLogsTool.execute({ query, max_hits }, { toolCallId: "1", messages: [] }),
          );
        };
        try {
          return await withMcpTimeout(mcpSetup);
        } catch (e) {
          if (isMcpTimeout(e)) {
            console.warn(`search_logs: MCP client timed out for ${ws.slug}`, e);
            return `MCP tools unavailable for ${ws.slug} — the log search timed out. Proceeding without them.`;
          }
          console.error(`Error searching logs for ${ws.slug}:`, e);
          return `Could not search logs for ${ws.slug}`;
        } finally {
          if (mcpClient) await mcpClient.close().catch(() => {});
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
        description: `[${ws.slug}] Search Stakwork for workflows by keyword. Returns [{ id, workflow_id, name, description, published_version_id }].`,
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
            const workflows = (data.nodes ?? []) as Array<{
              id: string;
              properties?: { name?: string; description?: string; workflow_id?: number };
            }>;

            return await Promise.all(
              workflows.map(async (n) => {
                const wfId = n.properties?.workflow_id;
                // Guard: skip version fetch when workflow_id is absent — passing an
                // undefined value through JSON.stringify would silently drop the filter
                // key and cause the API to return all Workflow_version nodes instead of
                // an empty set.
                if (wfId == null) {
                  return {
                    id: n.id,
                    workflow_id: undefined,
                    name: n.properties?.name,
                    description: n.properties?.description,
                    published_version_id: null,
                  };
                }

                let published_version_id: string | null = null;
                try {
                  // NOTE: port-8444 Jarvis serves /graph/search/attributes (no /api prefix).
                  // Port-3355 (stakgraph) uses /api/graph/search/attributes — these are
                  // distinct services; mixing them causes silent 404s absorbed by the catch block.
                  const vRes = await fetch(`${jarvisBase}/graph/search/attributes`, {
                    method: "POST",
                    headers: { "x-api-token": ws.swarmApiKey, "Content-Type": "application/json" },
                    body: JSON.stringify({
                      node_type: ["Workflow_version"],
                      include_properties: true,
                      limit: 1,
                      skip: 0,
                      skip_cache: true,
                      search_filters: [
                        { attribute: "workflow_id", value: wfId, comparator: "=" },
                        { attribute: "published", value: true, comparator: "=" },
                      ],
                    }),
                  });
                  if (vRes.ok) {
                    const vData = await vRes.json();
                    const publishedNode = (vData.nodes ?? []).find(
                      (v: { properties?: { published?: boolean; workflow_version_id?: string | number } }) =>
                        v.properties?.published === true,
                    );
                    if (publishedNode?.properties?.workflow_version_id != null) {
                      published_version_id = String(publishedNode.properties.workflow_version_id);
                    }
                  }
                } catch {
                  // version fetch failed — leave published_version_id as null
                }
                return {
                  id: n.id,
                  workflow_id: wfId,
                  name: n.properties?.name,
                  description: n.properties?.description,
                  published_version_id,
                };
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
        `[${ws.slug}] Invoke the Logs Agent for deep, run-grounded analysis of infra, sandbox, agent execution, AND AWS CloudWatch logs in ${ws.slug}. ` +
        `It has direct access to CloudWatch and all of ${ws.slug}'s log groups (including AWS Lambda functions), and can do complex investigations — e.g. downloading thousands of log lines into local files and grepping through them. ` +
        `Use when the user asks what happened during a run, on a swarm, on a pod/sandbox, to debug agent failures, ANY question about a Lambda/CloudWatch/AWS log group, or wants a synthesised explanation backed by real log data. ` +
        `If the user mentions a Lambda function or CloudWatch, invoke this immediately — do NOT ask for permission first, and do NOT use ${prefix}__search_logs (which only covers Quickwit-indexed app logs, not CloudWatch/Lambda system logs). ` +
        `Heavier than ${prefix}__search_logs — prefer that only for simple keyword lookups against the indexed app logs. ` +
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
          if (error.type === "SCOPE_WRONG_WORKSPACE") {
            return error.message;
          }
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

    // CourtListener tools — OpenLaw workspace only
    if (LEGAL_SLUGS.includes(ws.slug)) {
      Object.assign(allTools, buildCourtlistenerTools(ws.slug));
    }
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
