/**
 * Gemini Client Wrapper
 *
 * Provides centralized configuration for Google Gemini API.
 * Automatically routes to mock endpoint when USE_MOCKS=true.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiApiKey, config } from '@/config/env';
import { serviceConfigs } from '@/config/services';

/**
 * Interface matching the subset of GoogleGenerativeAI SDK we use
 */
interface GeminiClient {
  getGenerativeModel(params: { model: string }): {
    generateContent(prompt: string): Promise<{
      response: {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              inlineData?: {
                mimeType: string;
                data: string;
              };
            }>;
          };
        }>;
      };
    }>;
  };
}

/**
 * Mock Gemini client that calls our local mock endpoint
 */
function createMockGeminiClient(): GeminiClient {
  const baseUrl = serviceConfigs.gemini.baseURL;
  const apiKey = getGeminiApiKey();

  return {
    getGenerativeModel({ model }: { model: string }) {
      return {
        async generateContent(prompt: string) {
          const response = await fetch(
            `${baseUrl}/v1beta/models/${model}/generateContent`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey,
              },
              body: JSON.stringify({
                contents: [
                  {
                    role: 'user',
                    parts: [{ text: prompt }],
                  },
                ],
              }),
            }
          );

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'Mock Gemini request failed');
          }

          const data = await response.json();
          return { response: data };
        },
      };
    },
  };
}

/**
 * Get configured Gemini client
 * Uses mock client when USE_MOCKS=true, real SDK otherwise
 *
 * @returns Gemini client instance
 */
export function getGeminiClient(): GeminiClient {
  if (config.USE_MOCKS) {
    return createMockGeminiClient();
  }

  const apiKey = getGeminiApiKey();
  return new GoogleGenerativeAI(apiKey);
}