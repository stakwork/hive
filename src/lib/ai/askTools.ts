import { StopCondition, tool, ToolSet, ModelMessage } from "ai";
import { z } from "zod";
import { RepoAnalyzer } from "gitsee/server";
import { parseOwnerRepo } from "./utils";
import {  getProviderTool} from "@/lib/ai/provider";

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
  }
): Promise<Record<string, string>> {
  const initiateResponse = await fetch(`${swarmUrl}/repo/agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": swarmApiKey,
    },
    body: JSON.stringify(params),
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
    repo_agent: tool({
      description:
        "Execute an AI agent to analyze the repository and answer the user's question about the codebase. Use this for deep code analysis, ONLY IF THE ANSWER IS NOT AVAILABLE FROM THE learn_concept TOOL. This tool should be a LAST RESORT.",
      inputSchema: z.object({
        prompt: z.string().describe("The question or prompt for the repo agent to analyze"),
      }),
      execute: async ({ prompt }: { prompt: string }) => {
        const prompt2 = `${prompt}.\n\nPLEASE BE AS FAST AS POSSIBLE! DO NOT DO A THOROUGH SEARCH OF THE REPO. TRY TO FINISH THE EXPLORATION VERY QUICKLY!`;
        try {
          const rr =  await repoAgent(swarmUrl, swarmApiKey, {
            repo_url: repoUrl,
            prompt: prompt2,
            pat,
          });
          return rr.content;
        } catch (e) {
          console.error("Error executing repo agent:", e);
          return "Could not execute repo agent";
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
  const r = await fetch(`${swarmUrl}/gitree/search-clues`, {
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