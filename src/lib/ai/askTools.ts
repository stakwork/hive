import { StopCondition, tool, ToolSet } from "ai";
import { z } from "zod";
import { RepoAnalyzer } from "gitsee/server";
import { parseOwnerRepo } from "./utils";
import { getProviderTool } from "@/lib/ai/provider";

export async function listConcepts(swarmUrl: string, swarmApiKey: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${swarmUrl}/gitree/features`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": swarmApiKey,
    },
  });
  return await r.json();
}

export function askTools(swarmUrl: string, swarmApiKey: string, repoUrl: string, pat: string, apiKey: string) {
  const { owner: repoOwner, repo: repoName } = parseOwnerRepo(repoUrl);
  const web_search = getProviderTool("anthropic", apiKey, "webSearch");
  return {
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
          const res = await fetch(`${swarmUrl}/gitree/features/${encodeURIComponent(conceptId)}`, {
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
    // final_answer: tool({
    //   description: "Provide the final answer to the user. YOU **MUST** CALL THIS TOOL",
    //   inputSchema: z.object({ answer: z.string() }),
    //   execute: async ({ answer }: { answer: string }) => answer,
    // }),
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
