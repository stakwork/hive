import { tool } from "ai";
import { z } from "zod";
import { GitSeeHandler, CommitsResource, GitSeeCache } from "gitsee/server";
import { Octokit } from "@octokit/rest";
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
          const octokit = new Octokit({
            auth: pat,
          });
          const cache = new GitSeeCache();
          const commitsResource = new CommitsResource(octokit, cache);
          const commits = await commitsResource.getCommits(repoOwner, repoName);
          return commits.slice(0, 7);
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
          // For now, just return a placeholder as we need to implement proper PR fetching with the new gitsee API
          return "Recent contributions feature is not implemented yet with the new gitsee API.";
        } catch (e) {
          console.error("Error retrieving recent contributions:", e);
          return "Could not retrieve repository map";
        }
      },
    }),
  };
}
