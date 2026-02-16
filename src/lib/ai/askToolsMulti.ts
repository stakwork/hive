import { tool, ToolSet, Tool } from "ai";
import { z } from "zod";
import { createMCPClient } from "@ai-sdk/mcp";
import { WorkspaceConfig } from "./types";
import { listConcepts, repoAgent } from "./askTools";
import { RepoAnalyzer } from "gitsee/server";
import { parseOwnerRepo } from "./utils";
import { getProviderTool } from "@/lib/ai/provider";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = Tool<any, any>;

export function askToolsMulti(
  workspaces: WorkspaceConfig[],
  apiKey: string
): ToolSet {
  // Build all tools and merge at the end
  const allTools: Record<string, AnyTool> = {};

  for (const ws of workspaces) {
    const prefix = ws.slug;
    const repoMap = ws.repoUrls.map((url) => ({
      url,
      ...parseOwnerRepo(url),
    }));
    const isMultiRepo = ws.repoUrls.length > 1;

    // list_concepts
    allTools[`${prefix}:list_concepts`] = tool({
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
    allTools[`${prefix}:learn_concept`] = tool({
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
    allTools[`${prefix}:recent_commits`] = tool({
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
    allTools[`${prefix}:recent_contributions`] = tool({
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
    allTools[`${prefix}:repo_agent`] = tool({
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
    allTools[`${prefix}:search_logs`] = tool({
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
