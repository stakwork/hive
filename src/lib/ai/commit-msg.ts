import z from "zod";
import { generateObject } from "ai";
import { getApiKeyForProvider, getModel, Provider } from "@/lib/ai/provider";
import { db } from "@/lib/db";

export async function generateCommitMessage(taskId: string) {
  // Load conversation history from the task
  const chatMessages = await db.chatMessage.findMany({
    where: { taskId },
    orderBy: { timestamp: "asc" },
    select: {
      role: true,
      message: true,
      timestamp: true,
    },
  });

  if (chatMessages.length === 0) {
    throw new Error("No conversation history found for this task");
  }

  // Build conversation prompt for AI
  const conversationPrompt = chatMessages
    .map((msg) => {
      const role = msg.role === "USER" ? "User" : "Assistant";
      return `${role}: ${msg.message}`;
    })
    .join("\n\n");

  const prompt = `Based on the following conversation between a user and an AI assistant working on a coding task, generate a concise git commit message and branch name:

${conversationPrompt}

Generate a commit message that describes the changes made and a branch name that follows the format: category/brief-description (e.g., feat/add-commit-button, fix/auth-bug, refactor/improve-performance)`;

  const provider: Provider = "anthropic";
  const apiKey = getApiKeyForProvider(provider);
  const model = await getModel(provider, apiKey);
  const schema = z.object({
    commit_message: z.string(),
    branch_name: z.string(),
  });
  const result = await generateObject({
    model,
    prompt,
    schema,
  });
  return result.object;
}
