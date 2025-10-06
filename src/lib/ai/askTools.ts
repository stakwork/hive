import { tool } from "ai";
import { z } from "zod";
import { RepoAnalyzer } from "gitsee/server";
import { parseOwnerRepo } from "./utils";
import { getProviderTool } from "aieo";

async function fetchLearnings(swarmUrl: string, swarmApiKey: string, q: string, limit: number = 3) {
  const res = await fetch(`${swarmUrl}/learnings?limit=${limit}&question=${encodeURIComponent(q)}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": swarmApiKey,
    },
  });
  return res.ok ? await res.json() : [];
}

export function askTools(swarmUrl: string, swarmApiKey: string, repoUrl: string, pat: string, apiKey: string) {
  const { owner: repoOwner, repo: repoName } = parseOwnerRepo(repoUrl);
  const web_search = getProviderTool("anthropic", apiKey, "webSearch");
  return {
    get_learnings: tool({
      description: "Fetch previous learnings from the knowledge base.",
      inputSchema: z.object({
        question: z.string().describe("The user's query"),
        limit: z.number().optional().default(3),
      }),
      execute: async ({ question, limit }: { question: string; limit?: number }) => {
        try {
          return await fetchLearnings(swarmUrl, swarmApiKey, question, limit || 3);
        } catch (e) {
          console.error("Error retrieving learnings:", e);
          return "Could not retrieve learnings";
        }
      },
    }),
    recent_commits: tool({
      description: "Query a repo for recent commits. The output is a list of recent commits.",
      inputSchema: z.object({ limit: z.number().optional().default(10) }),
      execute: async ({ limit }: { limit?: number }) => {
        try {
          const analyzer = new RepoAnalyzer({
            githubToken: pat,
          });
          const coms = await analyzer.getRecentCommitsWithFiles(repoOwner, repoName, {
            limit: limit || 10,
          });
          return coms;
        } catch (e) {
          console.error("Error retrieving recent commits:", e);
          return "Could not retrieve recent commits";
        }
      },
    }),
    recent_contributions: tool({
      description:
        "Query a repo for recent PRs by a specific contributor. Input is the contributor's GitHub login. The output is a list of their most recent contributions, including PR titles, issue titles, commit messages, and code review comments.",
      inputSchema: z.object({ user: z.string(), limit: z.number().optional().default(5) }),
      execute: async ({ user, limit }: { user: string; limit?: number }) => {
        try {
          const analyzer = new RepoAnalyzer({
            githubToken: pat,
          });
          const output = await analyzer.getContributorPRs(repoOwner, repoName, user, limit || 5);
          return output;
        } catch (e) {
          console.error("Error retrieving recent contributions:", e);
          return "Could not retrieve repository map";
        }
      },
    }),
    web_search,
    final_answer: tool({
      description: "Provide the final answer to the user. YOU **MUST** CALL THIS TOOL",
      inputSchema: z.object({ answer: z.string() }),
      execute: async ({ answer }: { answer: string }) => answer,
    }),
  };
}
