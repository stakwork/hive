import { generateText } from "ai";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import { WAKE_WORD } from "@/lib/constants/voice";

type Provider = "anthropic" | "google" | "openai" | "claude_code";

const INTENT_CLASSIFICATION_PROMPT = `You are a voice command classifier. Analyze the following speech transcript and determine if the user is requesting to create a feature or build something.

Look for commands like:
- "${WAKE_WORD}, make a feature from this"
- "${WAKE_WORD}, create a feature"
- "${WAKE_WORD}, build this"
- "${WAKE_WORD}, can you create a feature for..."
- Similar variations

Respond with ONLY "yes" or "no" (lowercase, no punctuation).

Transcript: {transcript}`;

/**
 * Detects if a transcript chunk is a feature creation request using AI
 * Note: Assumes wake word has already been detected by caller
 * @param chunk - The transcript text to analyze (should contain wake word)
 * @param workspaceSlug - Workspace identifier for model context (optional)
 * @returns Promise<boolean> - True if this is a feature request
 */
export async function detectFeatureRequest(
  chunk: string,
  workspaceSlug?: string
): Promise<boolean> {
  try {
    // Use LLM to classify intent
    const provider: Provider = "anthropic";
    const apiKey = getApiKeyForProvider(provider);
    const model = await getModel(provider, apiKey, workspaceSlug, "haiku"); // Use haiku for speed

    const prompt = INTENT_CLASSIFICATION_PROMPT.replace("{transcript}", chunk);

    const result = await generateText({
      model,
      prompt,
      temperature: 0.1, // Low temperature for consistent classification
    });

    const response = result.text.trim().toLowerCase();
    const isFeatureRequest = response === "yes";

    console.log("🤖 Intent classification result:", {
      chunk,
      response,
      isFeatureRequest,
    });

    return isFeatureRequest;
  } catch (error) {
    console.error("❌ Error detecting feature request:", error);
    return false; // Fail gracefully
  }
}
