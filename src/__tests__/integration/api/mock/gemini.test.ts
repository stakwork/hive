import { describe, it, expect, beforeEach } from "vitest";
import { mockGeminiState } from "@/lib/mock/gemini-state";

describe("POST /api/mock/gemini/v1/models/:model/generateContent", () => {
  beforeEach(() => {
    mockGeminiState.reset();
  });

  it("should return 401 for missing API key", async () => {
    const response = await fetch(
      "http://localhost:3000/api/mock/gemini/v1/models/gemini-2.0-flash-exp:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: "Generate an architecture diagram" }],
            },
          ],
        }),
      }
    );

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.code).toBe(401);
    expect(data.error.message).toContain("API key not valid");
    expect(data.error.status).toBe("UNAUTHENTICATED");
  });

  it("should return 401 for invalid API key format", async () => {
    const response = await fetch(
      "http://localhost:3000/api/mock/gemini/v1/models/gemini-2.0-flash-exp:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": "invalid-key-format",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: "Generate an architecture diagram" }],
            },
          ],
        }),
      }
    );

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.status).toBe("UNAUTHENTICATED");
  });

  it("should return 400 for missing contents", async () => {
    const response = await fetch(
      "http://localhost:3000/api/mock/gemini/v1/models/gemini-2.0-flash-exp:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": "mock-gemini-key-12345",
        },
        body: JSON.stringify({}),
      }
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error.code).toBe(400);
    expect(data.error.message).toContain("contents array is required");
    expect(data.error.status).toBe("INVALID_ARGUMENT");
  });

  it("should return 400 for empty contents array", async () => {
    const response = await fetch(
      "http://localhost:3000/api/mock/gemini/v1/models/gemini-2.0-flash-exp:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": "mock-gemini-key-12345",
        },
        body: JSON.stringify({
          contents: [],
        }),
      }
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error.status).toBe("INVALID_ARGUMENT");
  });

  it("should generate diagram with valid request", async () => {
    const prompt = "Frontend -> Backend -> Database";
    const response = await fetch(
      "http://localhost:3000/api/mock/gemini/v1/models/gemini-2.0-flash-exp:generateContent",
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

    expect(response.status).toBe(200);
    const data = await response.json();

    // Verify response structure matches Gemini API format
    expect(data.candidates).toBeDefined();
    expect(data.candidates).toHaveLength(1);
    expect(data.candidates[0].content.parts[0].inlineData).toBeDefined();
    expect(data.candidates[0].content.parts[0].inlineData.mimeType).toBe(
      "image/png"
    );
    expect(data.candidates[0].content.parts[0].inlineData.data).toBeDefined();

    // Verify it's valid base64
    const base64Data = data.candidates[0].content.parts[0].inlineData.data;
    expect(base64Data).toMatch(/^[A-Za-z0-9+/=]+$/);

    // Verify can be decoded to buffer
    const buffer = Buffer.from(base64Data, "base64");
    expect(buffer.length).toBeGreaterThan(0);

    // Verify PNG signature
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50);
    expect(buffer[2]).toBe(0x4e);
    expect(buffer[3]).toBe(0x47);
  });

  it("should include safety ratings in response", async () => {
    const response = await fetch(
      "http://localhost:3000/api/mock/gemini/v1/models/gemini-2.0-flash-exp:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": "mock-gemini-key-12345",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: "Test prompt" }],
            },
          ],
        }),
      }
    );

    const data = await response.json();

    expect(data.candidates[0].safetyRatings).toBeDefined();
    expect(data.candidates[0].safetyRatings).toHaveLength(4);
    expect(data.promptFeedback.safetyRatings).toBeDefined();
    expect(data.promptFeedback.safetyRatings).toHaveLength(4);

    // Verify safety rating structure
    const safetyRating = data.candidates[0].safetyRatings[0];
    expect(safetyRating.category).toBeDefined();
    expect(safetyRating.probability).toBe("NEGLIGIBLE");
  });

  it("should include usage metadata in response", async () => {
    const prompt = "Generate architecture diagram for microservices system";
    const response = await fetch(
      "http://localhost:3000/api/mock/gemini/v1/models/gemini-2.0-flash-exp:generateContent",
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

    const data = await response.json();

    expect(data.usageMetadata).toBeDefined();
    expect(data.usageMetadata.promptTokenCount).toBeGreaterThan(0);
    expect(data.usageMetadata.candidatesTokenCount).toBe(256);
    expect(data.usageMetadata.totalTokenCount).toBe(
      data.usageMetadata.promptTokenCount + 256
    );

    // Verify token count approximation (prompt.length / 4)
    const expectedPromptTokens = Math.ceil(prompt.length / 4);
    expect(data.usageMetadata.promptTokenCount).toBe(expectedPromptTokens);
  });

  it("should work with different model names", async () => {
    const models = [
      "gemini-2.0-flash-exp",
      "gemini-2.5-flash-image",
      "gemini-1.5-pro",
    ];

    for (const model of models) {
      const response = await fetch(
        `http://localhost:3000/api/mock/gemini/v1/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": "mock-gemini-key-12345",
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: "Test prompt" }],
              },
            ],
          }),
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.candidates[0].content.parts[0].inlineData).toBeDefined();
    }
  });

  it("should track diagram generation in state", async () => {
    const prompt = "System architecture";

    await fetch(
      "http://localhost:3000/api/mock/gemini/v1/models/gemini-2.0-flash-exp:generateContent",
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

    const history = mockGeminiState.getDiagramHistory();
    expect(history).toHaveLength(1);
    expect(history[0].prompt).toBe(prompt);
    expect(history[0].model).toBe("gemini-2.0-flash-exp");
    expect(history[0].timestamp).toBeInstanceOf(Date);
  });

  it("should generate consistent output for same prompt", async () => {
    const prompt = "Test architecture";

    const response1 = await fetch(
      "http://localhost:3000/api/mock/gemini/v1/models/gemini-2.0-flash-exp:generateContent",
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

    const response2 = await fetch(
      "http://localhost:3000/api/mock/gemini/v1/models/gemini-2.0-flash-exp:generateContent",
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

    const data1 = await response1.json();
    const data2 = await response2.json();

    // Both should return the same PNG (deterministic mock)
    expect(data1.candidates[0].content.parts[0].inlineData.data).toBe(
      data2.candidates[0].content.parts[0].inlineData.data
    );
  });
});
