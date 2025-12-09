import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "@/config/env";

const { USE_MOCKS, MOCK_BASE } = config;

export interface GenerateContentResult {
  response: {
    candidates?: Array<{
      content: {
        parts: Array<{
          inlineData?: {
            mimeType: string;
            data: string; // base64
          };
          text?: string;
        }>;
      };
    }>;
  };
}

export interface GeminiClient {
  getGenerativeModel(config: { model: string }): {
    generateContent(prompt: string): Promise<GenerateContentResult>;
  };
}

/**
 * Creates a Gemini client that routes to mock or real API based on USE_MOCKS
 */
export function getGeminiClient(apiKey: string): GeminiClient {
  if (USE_MOCKS) {
    return createMockGeminiClient();
  }

  return new GoogleGenerativeAI(apiKey) as GeminiClient;
}

function createMockGeminiClient(): GeminiClient {
  return {
    getGenerativeModel: (config: { model: string }) => ({
      generateContent: async (prompt: string) => {
        const response = await fetch(
          `${MOCK_BASE}/api/mock/gemini/v1/models/${config.model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": "mock-gemini-key-12345",
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [{ text: prompt }],
                },
              ],
            }),
          }
        );

        if (!response.ok) {
          throw new Error(`Gemini API error: ${response.status}`);
        }

        return response.json();
      },
    }),
  };
}
