/**
 * Gemini Mock Wrapper
 * 
 * Wraps the @google/generative-ai SDK to route requests to mock endpoints
 * when USE_MOCKS=true. Mimics the real SDK interface for seamless integration.
 */

import { config } from '@/config/env';

export interface MockGeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        inlineData?: {
          data: string; // base64 image data
          mimeType: string;
        };
        text?: string;
      }>;
    };
  }>;
}

export class MockGoogleGenerativeAI {
  private apiKey: string;
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  
  getGenerativeModel({ model }: { model: string }) {
    return {
      generateContent: async (prompt: string): Promise<{ response: MockGeminiResponse }> => {
        // Call our mock endpoint
        const response = await fetch(`${config.MOCK_BASE}/api/mock/gemini/v1/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
          },
          body: JSON.stringify({
            model,
            prompt,
          }),
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to generate content');
        }
        
        const data = await response.json();
        
        return {
          response: data,
        };
      },
    };
  }
}

/**
 * Factory function that returns real or mock SDK based on USE_MOCKS
 */
export async function getGoogleGenerativeAI(apiKey: string) {
  if (config.USE_MOCKS) {
    return new MockGoogleGenerativeAI(apiKey);
  }
  
  // Return real SDK
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  return new GoogleGenerativeAI(apiKey);
}