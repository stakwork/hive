import z from "zod";
import { generateObject } from "ai";
import { getApiKeyForProvider, getModel, Provider } from "@/lib/ai/provider";
import { db } from "@/lib/db";

export async function generateCommitMessage(taskId: string, baseUrl?: string) {
  // Load conversation history from the task and get workspace slug
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      workspace: {
        select: {
          slug: true,
        },
      },
    },
  });

  if (!task) {
    throw new Error("Task not found");
  }

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

  // Append the Hive task link to the commit message
  // Use provided baseUrl or fall back to NEXTAUTH_URL or localhost
  const origin = baseUrl || process.env.NEXTAUTH_URL || "http://localhost:3000";
  const hiveTaskUrl = `${origin}/w/${task.workspace.slug}/task/${taskId}`;
  const commitMessageWithLink = `${result.object.commit_message}\n\nPR was created and opened at ${hiveTaskUrl}`;

  return {
    commit_message: commitMessageWithLink,
    branch_name: result.object.branch_name,
  };
}
