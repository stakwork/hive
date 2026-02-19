import { generateText } from "ai";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { WAKE_WORD } from "@/lib/constants/voice";

type Provider = "anthropic" | "google" | "openai" | "claude_code";

export type DetectionMode = "feature" | "task";

export interface DetectionResult {
  isRequest: boolean;
  mode: DetectionMode | null;
}

const INTENT_CLASSIFICATION_PROMPT = `You are a voice command classifier. Analyze the following speech transcript and determine if the user is requesting to create a FEATURE or a TASK.

FEATURE requests (for product planning, new functionality):
- "${WAKE_WORD}, make a feature from this"
- "${WAKE_WORD}, create a feature"
- "${WAKE_WORD}, build this"
- "${WAKE_WORD}, can you create a feature for..."
- Similar variations about features or building new functionality

TASK requests (for specific work items, bugs, or actionable tickets):
- "${WAKE_WORD}, create a task from this"
- "${WAKE_WORD}, make a task"
- "${WAKE_WORD}, add a task for this"
- "${WAKE_WORD}, can you create a task"
- Similar variations that EXPLICITLY mention "task"

IMPORTANT: Only classify as "task" if the user EXPLICITLY says "task". If they say "build this" or "create this" without mentioning "task", classify as "feature".

Respond with ONLY one of these three words (lowercase, no punctuation):
- "feature" - if this is a feature request
- "task" - if this is explicitly a task request
- "none" - if this is neither

Transcript: {transcript}`;

/**
 * Detects if a transcript chunk is a feature or task creation request using AI
 * Note: Assumes wake word has already been detected by caller
 * @param chunk - The transcript text to analyze (should contain wake word)
 * @param workspaceSlug - Workspace identifier for model context (optional)
 * @returns Promise<DetectionResult> - Contains isRequest boolean and mode ("feature" | "task" | null)
 */
export async function detectRequestType(chunk: string, workspaceSlug?: string): Promise<DetectionResult> {
  try {
    // Use LLM to classify intent
    const provider: Provider = "anthropic";
    const apiKey = getApiKeyForProvider(provider);
    const model = getModel(provider, apiKey, workspaceSlug, "haiku"); // Use haiku for speed

    const prompt = INTENT_CLASSIFICATION_PROMPT.replace("{transcript}", chunk);

    const result = await generateText({
      model,
      prompt,
      temperature: 0.1, // Low temperature for consistent classification
    });

    const response = result.text.trim().toLowerCase();

    let isRequest = false;
    let mode: DetectionMode | null = null;

    if (response === "feature") {
      isRequest = true;
      mode = "feature";
    } else if (response === "task") {
      isRequest = true;
      mode = "task";
    }

    console.log("🤖 Intent classification result:", {
      chunk,
      response,
      isRequest,
      mode,
    });

    return { isRequest, mode };
  } catch (error) {
    console.error("❌ Error detecting request type:", error);
    return { isRequest: false, mode: null }; // Fail gracefully
  }
}

/**
 * Detects if a transcript chunk is a feature creation request using AI
 * Note: Assumes wake word has already been detected by caller
 * @param chunk - The transcript text to analyze (should contain wake word)
 * @param workspaceSlug - Workspace identifier for model context (optional)
 * @returns Promise<boolean> - True if this is a feature request
 * @deprecated Use detectRequestType instead for more detailed classification
 */
export async function detectFeatureRequest(chunk: string, workspaceSlug?: string): Promise<boolean> {
  const result = await detectRequestType(chunk, workspaceSlug);
  return result.isRequest && result.mode === "feature";
}
