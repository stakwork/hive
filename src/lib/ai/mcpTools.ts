import { listConcepts } from "@/lib/ai/askTools";

export interface SwarmCredentials {
  swarmUrl: string;
  swarmApiKey: string;
}

export interface McpToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/**
 * List all concepts/features from the codebase knowledge base
 */
export async function mcpListConcepts(
  credentials: SwarmCredentials,
): Promise<McpToolResult> {
  try {
    const result = await listConcepts(
      credentials.swarmUrl,
      credentials.swarmApiKey,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    console.error("Error listing concepts:", error);
    return {
      content: [{ type: "text", text: "Error: Could not retrieve concepts" }],
      isError: true,
    };
  }
}

/**
 * Fetch documentation for a specific concept by ID
 */
export async function mcpLearnConcept(
  credentials: SwarmCredentials,
  conceptId: string,
): Promise<McpToolResult> {
  try {
    const res = await fetch(
      `${credentials.swarmUrl}/gitree/features/${encodeURIComponent(conceptId)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-api-token": credentials.swarmApiKey,
        },
      },
    );

    if (!res.ok) {
      return {
        content: [{ type: "text", text: "Error: Concept not found" }],
        isError: true,
      };
    }

    const data = await res.json();
    // Return just the documentation content for efficient context usage
    const documentation =
      data.feature?.documentation || "No documentation available";
    return {
      content: [{ type: "text", text: documentation }],
    };
  } catch (error) {
    console.error("Error fetching concept:", error);
    return {
      content: [
        {
          type: "text",
          text: "Error: Could not retrieve concept documentation",
        },
      ],
      isError: true,
    };
  }
}
