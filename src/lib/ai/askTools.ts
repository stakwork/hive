import { StopCondition, tool, ToolSet, ModelMessage } from "ai";
import { z } from "zod";
import { RepoAnalyzer } from "gitsee/server";
import { parseOwnerRepo } from "./utils";
import { getProviderTool } from "@/lib/ai/provider";
import { createMCPClient } from "@ai-sdk/mcp";
import { withMcpTimeout, isMcpTimeout } from './mcpTimeout';
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

export async function listConcepts(
  swarmUrl: string,
  swarmApiKey: string,
  query?: string,
  opts?: { limit?: number; repo?: string },
): Promise<Record<string, unknown>> {
  if (query?.trim()) {
    const body: Record<string, unknown> = { query };
    if (opts?.limit !== undefined) body.limit = opts.limit;
    if (opts?.repo !== undefined) body.repo = opts.repo;
    const r = await swarmFetch(`${swarmUrl}/gitree/search-concepts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": swarmApiKey,
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`search-concepts returned ${r.status}`);
    const parsed = await r.json();
    return { concepts: parsed.concepts ?? [] };
  }
  const r = await swarmFetch(`${swarmUrl}/gitree/concepts`, {
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

/**
 * Sentinel value returned (never thrown) when the user cancels a run via the
 * Stop control.  Callers should surface this as a normal, non-error completion.
 */
export const REPO_AGENT_CANCELLED = "REPO_AGENT_CANCELLED" as const;
export type RepoAgentCancelledMarker = typeof REPO_AGENT_CANCELLED;

/**
 * Number of poll cycles to wait after `isAbortRequested` returns `true`
 * before giving up and returning the cancelled marker locally (grace window).
 * At the default 5-second poll interval this is ~10-15 seconds.
 */
const ABORT_GRACE_POLL_CYCLES = 3;

export async function repoAgent(
  swarmUrl: string,
  swarmApiKey: string,
  params: {
    /**
     * Optional for graph/workflow-mode calls: when omitted, the swarm-side
     * agent falls back to the repos already ingested in its graph.
     */
    repo_url?: string;
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
    /**
     * Swarm-side system-prompt persona. "graph" = generalized knowledge-graph
     * walker; "workflow" = Workflow/Skill/Script research agent over the
     * Jarvis workflow library. Omitted = the code-focused default.
     */
    mode?: "graph" | "workflow";
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
  hooks?: {
    /**
     * Fired immediately after the initiate POST returns `request_id`.
     * DB-free: the caller supplies this; `repoAgent` itself has no Prisma dep.
     */
    onRequestId?: (id: string) => Promise<void>;
    /**
     * Called each poll cycle.  When it returns `true`, the run is treated as
     * aborted by the user (see grace-window logic below).
     * DB-free: supplied by the caller.
     */
    isAbortRequested?: () => Promise<boolean>;
  },
): Promise<Record<string, string> | RepoAgentCancelledMarker> {
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
    console.error(`[repoAgent] Repo agent initiation error: ${initiateResponse.status} - ${errorText}`);
    throw new Error("Failed to initiate repo agent");
  }

  const initiateData = await initiateResponse.json();
  const requestId = initiateData.request_id;

  if (!requestId) {
    throw new Error("No request_id returned from repo agent");
  }

  // Notify caller so it can persist the run entry and check for pending-abort intent.
  if (hooks?.onRequestId) {
    await hooks.onRequestId(requestId);
  }

  const maxAttempts = 120;
  const pollInterval = 5000;

  let abortDetectedCycles = 0; // how many cycles since we first saw abortRequested

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    // ── Check abort flag ──────────────────────────────────────────
    const abortRequested =
      hooks?.isAbortRequested ? await hooks.isAbortRequested() : false;

    if (abortRequested) {
      abortDetectedCycles++;
    }

    const progressUrl = `${swarmUrl}/progress?request_id=${encodeURIComponent(requestId)}`;
    const progressResponse = await fetch(progressUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": swarmApiKey,
      },
    });

    if (!progressResponse.ok) {
      console.error(`[repoAgent] Progress check failed: ${progressResponse.status}`);
      // Still check grace-window even on poll failure.
      if (abortRequested && abortDetectedCycles >= ABORT_GRACE_POLL_CYCLES) {
        console.warn(`[repoAgent] Grace window elapsed after abort (requestId=${requestId}); returning cancelled marker`);
        return REPO_AGENT_CANCELLED;
      }
      continue;
    }

    const progressData = await progressResponse.json();

    // ── Completed ─────────────────────────────────────────────────
    if (progressData.status === "completed") {
      // Requirement 5: a run that truly completes — even microseconds after
      // Stop — returns its real result, not the cancelled marker.
      const result = progressData.result;
      if (result && Object.keys(result).length > 0) {
        return result;
      }
      // completed but no usable result — if aborting, treat as cancelled.
      if (abortRequested) {
        console.warn(`[repoAgent] Run completed without result after abort (requestId=${requestId}); returning cancelled marker`);
        return REPO_AGENT_CANCELLED;
      }
      return result || {};
    }

    // ── Failed / aborted ─────────────────────────────────────────
    if (progressData.status === "failed" || progressData.status === "aborted") {
      if (abortRequested) {
        // cancelled ≠ error: non-throwing marker.
        console.warn(`[repoAgent] Run ${progressData.status} after abort request (requestId=${requestId}); returning cancelled marker`);
        return REPO_AGENT_CANCELLED;
      }
      throw new Error(progressData.error || "Repo agent execution failed");
    }

    // ── Grace-window exit ─────────────────────────────────────────
    // Swarm is neither completing nor acknowledging the abort — exit locally
    // rather than waiting up to 120×5s.
    if (abortRequested && abortDetectedCycles >= ABORT_GRACE_POLL_CYCLES) {
      console.warn(`[repoAgent] Grace window elapsed after abort (requestId=${requestId}); returning cancelled marker`);
      return REPO_AGENT_CANCELLED;
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
          return await listConcepts(swarmUrl, swarmApiKey, query, { limit });
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
          const res = await swarmFetch(`${swarmUrl}/gitree/concepts/${encodeURIComponent(conceptId)}`, {
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
        "Execute an AI agent to analyze the repository and answer the user's question about the codebase. Use this for deep code analysis, ONLY IF THE ANSWER IS NOT AVAILABLE FROM THE learn_concept TOOL. " +
        "It also has the GitHub `gh` CLI, so it can do read-only GitHub inspection that goes beyond the source itself: read issues and PRs (titles, bodies, comments, review threads), check CI / workflow run / check-suite status, and look at other GitHub repos beyond this one. " +
        "Prefer the lighter `recent_commits` / `recent_contributions` tools for plain 'recent commits' or 'PRs by <author>' lookups; reach for `repo_agent` when the GitHub question needs investigation (why is CI failing, what's in this issue/PR thread, compare against another repo). " +
        "STRICTLY READ-ONLY: this is for investigation only. NEVER instruct it to edit code, write/modify files, open a PR, or run/apply a database migration. If the user wants an actual code change, a new feature, or a schema migration, do NOT do it here — propose a feature with `propose_feature` and let the plan/coding pipeline execute it. " +
        "This tool is heavy/slow — treat it as a LAST RESORT.",
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
          if (rr === REPO_AGENT_CANCELLED) return "Agent run was cancelled";
          return rr.content;
        } catch (e) {
          console.error("Error executing repo agent:", e);
          return "Could not execute repo agent";
        }
      },
    }),
    search_logs: tool({
      description: `Search the deployed application's live production logs (indexed in Quickwit). These ARE the runtime logs emitted by the user's running app — so use this for "prod"/"production"/"Vercel"/"the deployed app" log questions and any errors users are hitting. NOTE: this only covers the Quickwit-indexed app logs; it does NOT cover AWS Lambda / CloudWatch system logs — for those (or any question mentioning a Lambda function or CloudWatch) use the \`logs_agent\` tool instead. Supports Lucene query syntax. Does not support wildcards.
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
        let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | undefined;
        const mcpSetup = async () => {
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
          if (!searchLogsTool?.execute) return 'search_logs tool not found on MCP server';
          return capMcpResult(
            await searchLogsTool.execute({ query, max_hits }, { toolCallId: '1', messages: [] }),
          );
        };
        try {
          return await withMcpTimeout(mcpSetup);
        } catch (e) {
          if (isMcpTimeout(e)) {
            console.warn('search_logs: MCP client timed out', e);
            return 'MCP tools unavailable — the log search timed out. Proceeding without them.';
          }
          console.error('Error searching logs:', e);
          return 'Could not search logs';
        } finally {
          if (mcpClient) await mcpClient.close().catch(() => {});
        }
      },
    }),
    web_search,
  };
  // Gated to the "stakwork" workspace only — searches Jarvis Workflow nodes.
  const isStakwork = workspaceAuth?.workspaceSlug === "stakwork";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stakworkSearchWorkflowsTool: ReturnType<typeof tool<any, any>> | undefined;
  if (isStakwork) {
    const swarmHost = new URL(swarmUrl).hostname;
    const jarvisBase = `https://${swarmHost}:8444`;
    stakworkSearchWorkflowsTool = tool({
      description: "Search Stakwork for workflows by keyword. Returns [{ id, workflow_id, name, description, published_version_id }].",
      inputSchema: z.object({
        query: z.string().describe("Workflow search term"),
      }),
      execute: async ({ query }: { query: string }) => {
        try {
          const res = await fetch(
            `${jarvisBase}/v2/nodes?q=${encodeURIComponent(query)}&type=Workflow&domains=workflow`,
            { headers: { "x-api-token": swarmApiKey, "Content-Type": "application/json" } },
          );
          if (!res.ok) return "Could not search workflows";
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
                  headers: { "x-api-token": swarmApiKey, "Content-Type": "application/json" },
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
          console.error("Error searching workflows:", e);
          return "Could not search workflows";
        }
      },
    });
  }

  return {
    ...baseTools,
    ...buildWorkspaceTools(swarmUrl, swarmApiKey, workspaceAuth),
    ...(isStakwork && stakworkSearchWorkflowsTool
      ? { stakwork__search_workflows: stakworkSearchWorkflowsTool }
      : {}),
  };
}

import { mcpText, capMcpResult } from "./mcpResult";

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
        "Invoke the Logs Agent to perform deep, run-grounded analysis of infra, sandbox, agent execution, AND AWS CloudWatch logs for this workspace. " +
        "It has direct access to CloudWatch and all of the workspace's log groups (including AWS Lambda functions), and can do complex investigations — e.g. downloading thousands of log lines into local files and grepping through them. " +
        "Use this when the user asks about what happened during a run, on a swarm, on a pod/sandbox, debugging agent failures, ANY question about a Lambda/CloudWatch/AWS log group, or wants a synthesised explanation backed by real log data. " +
        "If the user mentions a Lambda function or CloudWatch, invoke this immediately — do NOT ask for permission first, and do NOT use `search_logs` (which only covers Quickwit-indexed app logs, not CloudWatch/Lambda system logs). " +
        "Heavier than `search_logs` — prefer `search_logs` only for simple Lucene keyword lookups against the indexed app logs. " +
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
          if (error.type === "SCOPE_WRONG_WORKSPACE") {
            return error.message;
          }
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
