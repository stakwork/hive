import { tool } from "ai";
import { z } from "zod";

export function getQuickAskTools<T = unknown>(fetchLearnings: (question: string) => Promise<T[]>) {
  return {
    get_learnings: tool({
      description: "Fetch previous learnings from the Knowledge base.",
      inputSchema: z.object({
        question: z.string().describe("The user's query"),
      }),
      execute: async ({ question }: { question: string }) => {
        return await fetchLearnings(question);
      },
    }),
    final_answer: tool({
      description: "Provide the final answer to the user. YOU **MUST** CALL THIS TOOL",
      inputSchema: z.object({ answer: z.string() }),
      execute: async ({ answer }: { answer: string }) => answer,
    }),
  };
}
