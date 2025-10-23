import { useState, useEffect, useRef } from "react";

interface UseAIGenerateResult<T> {
  generating: boolean;
  suggestions: T[];
  error: string | null;
  generate: (params?: Record<string, unknown>) => Promise<void>;
  setSuggestions: React.Dispatch<React.SetStateAction<T[]>>;
  clearSuggestions: () => void;
}

interface UseAIGenerateOptions {
  pollEndpoint?: string;
  onPollingComplete?: (result: string) => void;
}

export function useAIGenerate<T>(
  endpoint: string,
  options?: UseAIGenerateOptions
): UseAIGenerateResult<T> {
  const [generating, setGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  async function startPolling() {
    if (!options?.pollEndpoint) return;

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(options.pollEndpoint!);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Polling failed");
        }

        const data = await response.json();

        if (data.status === "completed") {
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          setGenerating(false);

          // Call the completion callback with the result
          if (options.onPollingComplete && data.architecture) {
            options.onPollingComplete(data.architecture);
          }

          // Set suggestions with the completed result
          setSuggestions([{ content: data.architecture } as T]);
        } else if (data.status === "failed") {
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          setGenerating(false);
          setError(data.error || "Architecture generation failed");
        }
        // If status is "pending", keep polling
      } catch (err) {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        setGenerating(false);
        const errorMessage = err instanceof Error ? err.message : "Polling error";
        setError(errorMessage);
        console.error("Polling error:", err);
      }
    }, 3000); // Poll every 3 seconds
  }

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

      const text = await response.text();
      const data = JSON.parse(text);

      // Check if this is a polling-based response (architecture generation)
      if (data.request_id && data.status === "pending") {
        // Start polling for completion
        startPolling();
        return;
      }

      // Read streaming response for other generation types

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
        } else if (data.phases && Array.isArray(data.phases)) {
          // Phases and tickets format: { phases: [...] }
          setSuggestions([data as T]);
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
