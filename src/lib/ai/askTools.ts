import { tool } from "ai";
import { z } from "zod";
import { RepoAnalyzer } from "gitsee/server";
import { parseOwnerRepo } from "./utils";

async function fetchLearnings(swarmUrl: string, swarmApiKey: string, q: string) {
  const res = await fetch(`${swarmUrl}/learnings?limit=3&question=${encodeURIComponent(q)}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": swarmApiKey,
    },
  });
  return res.ok ? await res.json() : [];
}

export function askTools(swarmUrl: string, swarmApiKey: string, repoUrl: string, pat: string) {
  const { owner: repoOwner, repo: repoName } = parseOwnerRepo(repoUrl);
  return {
    get_learnings: tool({
      description: "Fetch previous learnings from the knowledge base.",
      inputSchema: z.object({
        question: z.string().describe("The user's query"),
      }),
      execute: async ({ question }: { question: string }) => {
        try {
          return await fetchLearnings(swarmUrl, swarmApiKey, question);
        } catch (e) {
          console.error("Error retrieving learnings:", e);
          return "Could not retrieve learnings";
        }
      },
    }),
    final_answer: tool({
      description: "Provide the final answer to the user. YOU **MUST** CALL THIS TOOL",
      inputSchema: z.object({ answer: z.string() }),
      execute: async ({ answer }: { answer: string }) => answer,
    }),
    recent_commits: tool({
      description: "Query a repo for recent commits. The output is a list of recent commits.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const analyzer = new RepoAnalyzer({
            githubToken: pat,
          });
          const coms = await analyzer.getRecentCommitsWithFiles(repoOwner, repoName, {
            limit: 7,
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
      inputSchema: z.object({ user: z.string() }),
      execute: async ({ user }: { user: string }) => {
        try {
          const analyzer = new RepoAnalyzer({
            githubToken: pat,
          });
          const output = await analyzer.getContributorPRs(repoOwner, repoName, user, 5);
          return output;
        } catch (e) {
          console.error("Error retrieving recent contributions:", e);
          return "Could not retrieve repository map";
        }
      },
    }),
  };
}
