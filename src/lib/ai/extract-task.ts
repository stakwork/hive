import { generateObject, type ModelMessage } from "ai";
import { z } from "zod";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { convertMessagesToTranscript } from "./extract-feature";

type Provider = "anthropic" | "google" | "openai" | "claude_code";

// Schema for task extraction from voice transcript
const taskExtractionSchema = z.object({
  title: z.string().describe("Clear, concise task title (3-10 words) describing what needs to be done"),
  description: z
    .string()
    .describe(
      "Detailed description of the task including context, requirements, and acceptance criteria from the conversation",
    ),
});

const TASK_EXTRACTION_SYSTEM_PROMPT = `You are a project manager extracting task specifications from voice conversations.

Your task:
1. Analyze the conversation transcript to understand what task is being requested
2. Extract a clear, actionable title that captures what needs to be done
3. Write a detailed description including:
   - Context from the conversation
   - Specific requirements mentioned
   - Acceptance criteria if discussed
   - Any technical details or constraints
   - Steps to complete the task if mentioned

Be comprehensive but focused. Only include information explicitly mentioned or clearly implied in the conversation.

IMPORTANT: This transcript might contain multiple discussions. ONLY FOCUS ON THE LAST TASK DISCUSSED! Just before the user asked "hive" to create the task.

The task should be actionable and specific enough for a developer to understand what needs to be done.`;

export interface ExtractedTask {
  title: string;
  description: string;
}

/**
 * Extracts task specifications from a voice transcript or message array
 * @param transcript - The conversation transcript to analyze (string or ModelMessage[])
 * @param workspaceSlug - Workspace identifier for model context (optional)
 * @returns Promise<ExtractedTask> - Structured task data with title and description
 */
export async function extractTaskFromTranscript(
  transcript: string | ModelMessage[],
  workspaceSlug?: string,
): Promise<ExtractedTask> {
  try {
    // Convert messages to transcript if needed
    const transcriptText = Array.isArray(transcript) ? convertMessagesToTranscript(transcript) : transcript;

    console.log("🎯 Extracting task from transcript:", {
      transcriptLength: transcriptText.length,
      isMessageArray: Array.isArray(transcript),
      workspaceSlug,
    });

    const provider: Provider = "anthropic";
    const apiKey = getApiKeyForProvider(provider);
    const model = await getModel(provider, apiKey, workspaceSlug); // Use default model for quality

    const result = await generateObject({
      model,
      schema: taskExtractionSchema,
      prompt: `Here is the conversation transcript to analyze:\n\n${transcriptText}`,
      system: TASK_EXTRACTION_SYSTEM_PROMPT,
      temperature: 0.8,
    });

    const task = result.object as ExtractedTask;

    console.log("✅ Task extracted successfully:", {
      title: task.title,
      descriptionLength: task.description.length,
    });

    return task;
  } catch (error) {
    console.error("❌ Error extracting task from transcript:", error);
    throw new Error("Failed to extract task from transcript");
  }
}
