import { useState } from "react";

interface UseAIGenerateResult<T> {
  generating: boolean;
  suggestions: T[];
  error: string | null;
  generate: (params?: Record<string, unknown>) => Promise<void>;
  setSuggestions: React.Dispatch<React.SetStateAction<T[]>>;
  clearSuggestions: () => void;
}

export function useAIGenerate<T>(endpoint: string): UseAIGenerateResult<T> {
  const [generating, setGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function generate(params?: Record<string, unknown>) {
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

      // Read streaming response
      const text = await response.text();

      // Parse the structured output response
      try {
        // The response is a series of JSON objects, we want the last complete one
        const lines = text.trim().split('\n').filter(line => line.trim());

        if (lines.length === 0) {
          throw new Error("Empty response from AI");
        }

        const lastLine = lines[lines.length - 1];
        const data = JSON.parse(lastLine);

        // Handle structured output formats
        if (data.stories && Array.isArray(data.stories)) {
          // User stories format: { stories: [...] }
          setSuggestions(data.stories);
        } else if (data.phases) {
          // Phases and tickets format: { phases: [...] }
          // Handle case where phases might be stringified
          const phases = typeof data.phases === 'string' ? JSON.parse(data.phases) : data.phases;
          setSuggestions([{ ...data, phases } as T]);
        } else if (Array.isArray(data)) {
          // Fallback for simple array format
          setSuggestions(data);
        } else if (typeof data === 'object' && data !== null) {
          // Handle single object response (e.g., { content: "..." })
          // Wrap it in an array for consistent handling
          setSuggestions([data as T]);
        } else {
          throw new Error("Unexpected response format");
        }
      } catch (parseError) {
        console.error("Failed to parse AI response:", text);
        console.error("Parse error details:", parseError);
        throw new Error("Failed to parse AI response");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      console.error("AI generation error:", err);
    } finally {
      setGenerating(false);
    }
  }

  const clearSuggestions = () => {
    setSuggestions([]);
    setError(null);
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
