import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/mock/gemini/v1beta/models/[modelId]/generateContent/route";
import { mockGeminiState } from "@/lib/mock/gemini-state";
import { createPostRequest, expectSuccess, expectError } from "@/__tests__/support/helpers";

// Mock environment configuration - must be hoisted
const mockConfig = vi.hoisted(() => ({
  USE_MOCKS: true,
}));

vi.mock("@/config/env", () => ({
  config: mockConfig,
}));

describe("POST /api/mock/gemini/v1beta/models/[modelId]/generateContent - Integration Tests", () => {
  const baseUrl = "http://localhost:3000/api/mock/gemini/v1beta/models";
  const modelId = "gemini-2.5-flash-image";
  const validApiKey = "mock-gemini-key-test-12345";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGeminiState.reset();
    // Enable mock mode for tests
    mockConfig.USE_MOCKS = true;
  });

  afterEach(() => {
    mockGeminiState.reset();
    vi.restoreAllMocks();
  });

  describe("Authorization Tests", () => {
    test("returns 403 when USE_MOCKS is false", async () => {
      mockConfig.USE_MOCKS = false;

      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Generate architecture diagram" }],
            },
          ],
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Mock endpoints only available when USE_MOCKS=true");
    });

    test("allows request when USE_MOCKS is true", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Generate diagram" }],
            },
          ],
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      expect(response.status).toBe(200);
    });
  });

  describe("Authentication Tests", () => {
    test("returns 401 when API key is missing", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Generate diagram" }],
            },
          ],
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toEqual({
        code: 401,
        message: "API key not valid. Please pass a valid API key.",
        status: "UNAUTHENTICATED",
      });
    });

    test("returns 401 when API key has invalid prefix", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": "invalid-key-12345",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Generate diagram" }],
            },
          ],
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error.code).toBe(401);
      expect(data.error.status).toBe("UNAUTHENTICATED");
    });

    test("accepts valid API key with correct prefix", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Generate diagram" }],
            },
          ],
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      expect(response.status).toBe(200);
    });
  });

  describe("Request Validation Tests", () => {
    test("returns 400 when contents array is missing", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({}),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toEqual({
        code: 400,
        message: "Invalid request: contents array required",
        status: "INVALID_ARGUMENT",
      });
    });

    test("returns 400 when contents array is empty", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [],
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe(400);
      expect(data.error.status).toBe("INVALID_ARGUMENT");
    });

    test("returns 400 when contents is not an array", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: "not an array",
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe(400);
    });

    test("accepts valid contents array with user message", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Generate diagram" }],
            },
          ],
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      expect(response.status).toBe(200);
    });
  });

  describe("Content Generation Tests", () => {
    test("generates valid response with image data", async () => {
      const architectureText = "Frontend -> API Gateway -> Microservices -> Database";

      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: architectureText }],
            },
          ],
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      const data = await expectSuccess(response, 200);

      // Verify response structure
      expect(data).toHaveProperty("candidates");
      expect(data.candidates).toBeInstanceOf(Array);
      expect(data.candidates).toHaveLength(1);
    });

    test("returns properly formatted candidate with inline image data", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Generate diagram" }],
            },
          ],
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      const data = await expectSuccess(response, 200);
      const candidate = data.candidates[0];

      // Verify candidate structure
      expect(candidate).toHaveProperty("content");
      expect(candidate.content).toHaveProperty("parts");
      expect(candidate.content.parts).toBeInstanceOf(Array);
      expect(candidate.content.parts).toHaveLength(1);

      // Verify inline data
      const part = candidate.content.parts[0];
      expect(part).toHaveProperty("inlineData");
      expect(part.inlineData).toHaveProperty("mimeType", "image/png");
      expect(part.inlineData).toHaveProperty("data");
      expect(typeof part.inlineData.data).toBe("string");
      expect(part.inlineData.data.length).toBeGreaterThan(0);

      // Verify it's valid base64
      const imageBuffer = Buffer.from(part.inlineData.data, "base64");
      expect(imageBuffer.length).toBeGreaterThan(0);
    });

    test("includes correct content role", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Generate diagram" }],
            },
          ],
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.candidates[0].content.role).toBe("model");
    });

    test("includes finish reason", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Generate diagram" }],
            },
          ],
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.candidates[0].finishReason).toBe("STOP");
    });
  });

  describe("Safety Ratings Tests", () => {
    test("includes all required safety ratings", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Generate diagram" }],
            },
          ],
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      const data = await expectSuccess(response, 200);
      const safetyRatings = data.candidates[0].safetyRatings;

      expect(safetyRatings).toBeInstanceOf(Array);
      expect(safetyRatings.length).toBeGreaterThanOrEqual(4);

      const categories = safetyRatings.map((rating: any) => rating.category);
      expect(categories).toContain("HARM_CATEGORY_HATE_SPEECH");
      expect(categories).toContain("HARM_CATEGORY_DANGEROUS_CONTENT");
      expect(categories).toContain("HARM_CATEGORY_HARASSMENT");
      expect(categories).toContain("HARM_CATEGORY_SEXUALLY_EXPLICIT");
    });

    test("safety ratings have NEGLIGIBLE probability", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Generate diagram" }],
            },
          ],
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      const data = await expectSuccess(response, 200);
      const safetyRatings = data.candidates[0].safetyRatings;

      safetyRatings.forEach((rating: any) => {
        expect(rating.probability).toBe("NEGLIGIBLE");
      });
    });
  });

  describe("Usage Metadata Tests", () => {
    test("includes usage metadata with token counts", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Generate diagram" }],
            },
          ],
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      const data = await expectSuccess(response, 200);

      expect(data).toHaveProperty("usageMetadata");
      expect(data.usageMetadata).toHaveProperty("promptTokenCount");
      expect(data.usageMetadata).toHaveProperty("candidatesTokenCount");
      expect(data.usageMetadata).toHaveProperty("totalTokenCount");

      expect(typeof data.usageMetadata.promptTokenCount).toBe("number");
      expect(typeof data.usageMetadata.candidatesTokenCount).toBe("number");
      expect(typeof data.usageMetadata.totalTokenCount).toBe("number");
    });

    test("calculates token counts based on prompt length", async () => {
      const shortPrompt = "Short";
      const longPrompt = "This is a much longer prompt with more tokens to count";

      const request1 = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: shortPrompt }],
            },
          ],
        }),
      });

      const request2 = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: longPrompt }],
            },
          ],
        }),
      });

      const response1 = await POST(request1, {
        params: Promise.resolve({ modelId }),
      });
      const response2 = await POST(request2, {
        params: Promise.resolve({ modelId }),
      });

      const data1 = await response1.json();
      const data2 = await response2.json();

      expect(data2.usageMetadata.promptTokenCount).toBeGreaterThan(
        data1.usageMetadata.promptTokenCount
      );
    });
  });

  describe("State Management Tests", () => {
    test("tracks generation request in mock state", async () => {
      const promptText = "Generate architecture diagram";

      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: promptText }],
            },
          ],
        }),
      });

      await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      const allRequests = mockGeminiState.getAllRequests();
      expect(allRequests).toHaveLength(1);
      expect(allRequests[0].prompt).toBe(promptText);
      expect(allRequests[0].model).toBe(modelId);
    });

    test("tracks multiple generation requests", async () => {
      const requests = [
        "Diagram 1: Frontend -> Backend",
        "Diagram 2: API Gateway -> Microservices",
        "Diagram 3: Client -> Server -> Database",
      ];

      for (const promptText of requests) {
        const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": validApiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: promptText }],
              },
            ],
          }),
        });

        await POST(request, {
          params: Promise.resolve({ modelId }),
        });
      }

      const allRequests = mockGeminiState.getAllRequests();
      expect(allRequests).toHaveLength(3);
      expect(allRequests.map((r) => r.prompt)).toEqual(requests);
    });

    test("assigns unique IDs to each request", async () => {
      const request1 = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "First request" }],
            },
          ],
        }),
      });

      const request2 = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Second request" }],
            },
          ],
        }),
      });

      await POST(request1, {
        params: Promise.resolve({ modelId }),
      });
      await POST(request2, {
        params: Promise.resolve({ modelId }),
      });

      const allRequests = mockGeminiState.getAllRequests();
      const ids = allRequests.map((r) => r.id);

      expect(new Set(ids).size).toBe(2);
      expect(ids[0]).not.toBe(ids[1]);
    });

    test("state reset clears all requests", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Generate diagram" }],
            },
          ],
        }),
      });

      await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      expect(mockGeminiState.getAllRequests()).toHaveLength(1);

      mockGeminiState.reset();

      expect(mockGeminiState.getAllRequests()).toHaveLength(0);
    });
  });

  describe("Generation Config Tests", () => {
    test("accepts request with generationConfig", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Generate diagram" }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
          },
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      expect(response.status).toBe(200);
    });

    test("handles request without generationConfig", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Generate diagram" }],
            },
          ],
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      expect(response.status).toBe(200);
    });
  });

  describe("Error Handling Tests", () => {
    test("handles malformed JSON request", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: "{ invalid json }",
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toHaveProperty("code", 500);
      expect(data.error).toHaveProperty("status", "INTERNAL");
    });

    test("handles missing request body", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("Model ID Tests", () => {
    test("accepts different model IDs", async () => {
      const modelIds = [
        "gemini-2.5-flash-image",
        "gemini-1.5-pro",
        "gemini-1.0-pro",
      ];

      for (const testModelId of modelIds) {
        const request = new Request(`${baseUrl}/${testModelId}/generateContent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": validApiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: "Generate diagram" }],
              },
            ],
          }),
        });

        const response = await POST(request, {
          params: Promise.resolve({ modelId: testModelId }),
        });

        expect(response.status).toBe(200);
      }
    });

    test("tracks model ID in state", async () => {
      const testModelId = "gemini-custom-model";

      const request = new Request(`${baseUrl}/${testModelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: "Generate diagram" }],
            },
          ],
        }),
      });

      await POST(request, {
        params: Promise.resolve({ modelId: testModelId }),
      });

      const allRequests = mockGeminiState.getAllRequests();
      expect(allRequests[0].model).toBe(testModelId);
    });
  });

  describe("Concurrent Requests Tests", () => {
    test("handles multiple concurrent requests", async () => {
      const promises = Array(5)
        .fill(null)
        .map((_, index) => {
          const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": validApiKey,
            },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [{ text: `Concurrent request ${index}` }],
                },
              ],
            }),
          });

          return POST(request, {
            params: Promise.resolve({ modelId }),
          });
        });

      const responses = await Promise.all(promises);

      // All requests should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });

      // Verify all requests tracked in state
      const allRequests = mockGeminiState.getAllRequests();
      expect(allRequests).toHaveLength(5);
    });
  });

  describe("Content Structure Tests", () => {
    test("handles contents with multiple parts", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: "First part" },
                { text: "Second part" },
              ],
            },
          ],
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      expect(response.status).toBe(200);
    });

    test("extracts prompt from first user message", async () => {
      const expectedPrompt = "Generate architecture diagram";

      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: expectedPrompt }],
            },
          ],
        }),
      });

      await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      const allRequests = mockGeminiState.getAllRequests();
      expect(allRequests[0].prompt).toBe(expectedPrompt);
    });

    test("uses default prompt when no user message found", async () => {
      const request = new Request(`${baseUrl}/${modelId}/generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": validApiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "system",
              parts: [{ text: "System message" }],
            },
          ],
        }),
      });

      await POST(request, {
        params: Promise.resolve({ modelId }),
      });

      const allRequests = mockGeminiState.getAllRequests();
      expect(allRequests[0].prompt).toBe("Generate diagram");
    });
  });
});
