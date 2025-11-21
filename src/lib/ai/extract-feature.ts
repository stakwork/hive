import { generateObject } from "ai";
import { z } from "zod";
import { getModel, getApiKeyForProvider } from "aieo";

type Provider = "anthropic" | "google" | "openai" | "claude_code";

// Schema for feature extraction from voice transcript
const featureExtractionSchema = z.object({
  title: z.string().describe("Clear, concise feature title (3-8 words) describing what will be built"),
  brief: z.string().describe("2-3 sentence summary explaining the feature purpose and high-level approach"),
  requirements: z
    .string()
    .describe(
      "List of functional requirements, user needs, acceptance criteria, and technical constraints discussed in the conversation",
    ),
});

const FEATURE_EXTRACTION_SYSTEM_PROMPT = `You are a product manager extracting feature specifications from voice conversations.

Your task:
1. Analyze the conversation transcript to understand what feature is being discussed
2. Extract a clear title that captures the core functionality
3. Write a brief summary that explains the purpose and approach
4. List detailed requirements based on the discussion, including:
   - Functional requirements (what it should do)
   - User needs and use cases mentioned
   - Technical constraints or preferences discussed
   - Acceptance criteria if mentioned
   - Any specific implementation details

Be comprehensive but focused. Only include information explicitly mentioned or clearly implied in the conversation.

IMPORTANT: This transcript might contain multiple discussions about features or separate aspects of the project. ONLY FOCUS ON THAT LAST FEATURE DISCUSSED! Just before the user asked "hive" to create the feature.`;

export interface ExtractedFeature {
  title: string;
  brief: string;
  requirements: string;
}

/**
 * Extracts feature specifications from a voice transcript
 * @param transcript - The conversation transcript to analyze (typically last hour)
 * @param workspaceSlug - Workspace identifier for model context (optional)
 * @returns Promise<ExtractedFeature> - Structured feature data with title, brief, and requirements
 */
export async function extractFeatureFromTranscript(
  transcript: string,
  workspaceSlug?: string,
): Promise<ExtractedFeature> {
  try {
    console.log("🎯 Extracting feature from transcript:", {
      transcriptLength: transcript.length,
      workspaceSlug,
    });

    const provider: Provider = "anthropic";
    const apiKey = getApiKeyForProvider(provider);
    const model = await getModel(provider, apiKey, workspaceSlug); // Use default model for quality

    const result = await generateObject({
      model,
      schema: featureExtractionSchema,
      prompt: `Here is the conversation transcript to analyze:\n\n${transcript}`,
      system: FEATURE_EXTRACTION_SYSTEM_PROMPT,
      temperature: 0.8,
    });

    const feature = result.object as ExtractedFeature;

    console.log("✅ Feature extracted successfully:", {
      title: feature.title,
      briefLength: feature.brief.length,
      requirementsLength: feature.requirements.length,
    });

    return feature;
  } catch (error) {
    console.error("❌ Error extracting feature from transcript:", error);
    throw new Error("Failed to extract feature from transcript");
  }
}
