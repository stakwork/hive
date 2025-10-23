import { useState } from "react";

interface UseAIGenerateResult<T> {
  generating: boolean;
  suggestions: T[];
  error: string | null;
  generate: (params?: Record<string, unknown>) => Promise<{ request_id?: string; status?: string } | null>;
  setSuggestions: React.Dispatch<React.SetStateAction<T[]>>;
  clearSuggestions: () => void;
}

export function useAIGenerate<T>(endpoint: string): UseAIGenerateResult<T> {
  const [generating, setGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function generate(params?: Record<string, unknown>): Promise<{ request_id?: string; status?: string } | null> {
    setGenerating(true);
    setError(null);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params || {}),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Generation failed");
      }

      const text = await response.text();
      const data = JSON.parse(text);

      // Check if this is a polling-based response (architecture generation)
      if (data.request_id && data.status === "pending") {
        // Don't start polling here - let the component handle it via store
        setGenerating(false);
        return { request_id: data.request_id, status: data.status };
      }

      // Parse the structured output response for other generation types
      try {
        // The response is a series of JSON objects, we want the last complete one
        const lines = text.trim().split('\n').filter(line => line.trim());

        if (lines.length === 0) {
          throw new Error("Empty response from AI");
        }

        const lastLine = lines[lines.length - 1];
        const parsedData = JSON.parse(lastLine);

        // Handle structured output formats
        if (parsedData.stories && Array.isArray(parsedData.stories)) {
          // User stories format: { stories: [...] }
          setSuggestions(parsedData.stories);
        } else if (parsedData.phases && Array.isArray(parsedData.phases)) {
          // Phases and tickets format: { phases: [...] }
          setSuggestions([parsedData as T]);
        } else if (Array.isArray(parsedData)) {
          // Fallback for simple array format
          setSuggestions(parsedData);
        } else if (typeof parsedData === 'object' && parsedData !== null) {
          // Handle single object response (e.g., { content: "..." })
          // Wrap it in an array for consistent handling
          setSuggestions([parsedData as T]);
        } else {
          throw new Error("Unexpected response format");
        }

        // Keep generating=true until suggestions are consumed by parent
        // (AIButton's useEffect will call clearSuggestions which sets generating=false)
      } catch (parseError) {
        console.error("Failed to parse AI response:", text);
        console.error("Parse error details:", parseError);
        setGenerating(false);
        throw new Error("Failed to parse AI response");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      console.error("AI generation error:", err);
      setGenerating(false);
      return null;
    }

    return null;
  }

  const clearSuggestions = () => {
    setSuggestions([]);
    setError(null);
    setGenerating(false); // Turn off spinner after suggestions are consumed
  };

  return {
    generating,
    suggestions,
    error,
    generate,
    setSuggestions,
    clearSuggestions,
  };
}
