import { describe, it, expect, beforeEach } from "vitest";
import { mockAnthropicState } from "@/lib/mock/anthropic-state";
import {
  makeMockEndpointRequest,
  createAnthropicMessageRequest,
  parseSSEResponse,
  extractStreamedText,
} from "@/__tests__/support/helpers/mock-endpoint-helpers";

describe("POST /api/mock/anthropic/v1/messages", () => {
  const endpoint = "/api/mock/anthropic/v1/messages";

  beforeEach(() => {
    mockAnthropicState.reset();
  });

  describe("Non-streaming responses", () => {
    it("should return a valid response for a basic message request", async () => {
      const requestBody = createAnthropicMessageRequest("Hello, Claude!");

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toMatchObject({
        id: expect.stringMatching(/^msg_/),
        type: "message",
        role: "assistant",
        model: "claude-3-5-sonnet-20241022",
        content: expect.arrayContaining([
          expect.objectContaining({
            type: "text",
            text: expect.any(String),
          }),
        ]),
        stop_reason: "end_turn",
        usage: expect.objectContaining({
          input_tokens: expect.any(Number),
          output_tokens: expect.any(Number),
        }),
      });

      expect(data.content[0].text.length).toBeGreaterThan(0);
    });

    it("should handle multi-turn conversation history", async () => {
      const conversationId = "test-conversation-multi-turn";
      const requestBody = createAnthropicMessageRequest("What about 3+3?", {
        conversationId,
        messages: [
          { role: "user", content: "What is 2+2?" },
          { role: "assistant", content: "2+2 equals 4." },
          { role: "user", content: "What about 3+3?" },
        ],
      });

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.content[0].text).toBeTruthy();
      expect(data.stop_reason).toBe("end_turn");
    });

    it("should generate context-aware response for feature extraction", async () => {
      const requestBody = createAnthropicMessageRequest(
        "Extract features from this text: User wants to login with email"
      );

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.content[0].text).toBeTruthy();
      expect(data.content[0].text.length).toBeGreaterThan(20);
    });

    it("should generate context-aware response for user story creation", async () => {
      const requestBody = createAnthropicMessageRequest(
        "Create a user story for authentication feature"
      );

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.content[0].text).toContain("user story");
    });
  });

  describe("Streaming responses", () => {
    it("should return a streaming response with proper SSE format", async () => {
      const requestBody = createAnthropicMessageRequest("Hello, Claude!", {
        stream: true,
      });

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(response.headers.get("cache-control")).toBe("no-cache");
      expect(response.headers.get("connection")).toBe("keep-alive");

      const text = await response.text();
      const { events, dataLines } = parseSSEResponse(text);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toBe("message_start");
      expect(events).toContain("content_block_start");
      expect(events).toContain("content_block_delta");
      expect(events).toContain("content_block_stop");
      expect(events[events.length - 1]).toBe("message_stop");

      const messageStartData = JSON.parse(dataLines[0]);
      expect(messageStartData).toMatchObject({
        type: "message_start",
        message: expect.objectContaining({
          id: expect.stringMatching(/^msg_/),
          type: "message",
          role: "assistant",
          model: "claude-3-5-sonnet-20241022",
        }),
      });
    });

    it("should stream content deltas with text chunks", async () => {
      const requestBody = createAnthropicMessageRequest(
        "Write a short sentence",
        { stream: true }
      );

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(200);

      const text = await response.text();
      const { parsedData } = parseSSEResponse(text);

      const accumulatedText = extractStreamedText(parsedData);

      const hasContentDelta = parsedData.some(
        (data: any) => data.type === "content_block_delta"
      );

      expect(hasContentDelta).toBe(true);
      expect(accumulatedText.length).toBeGreaterThan(0);
    });

    it("should include usage information in message_delta event", async () => {
      const requestBody = createAnthropicMessageRequest("Hello", {
        stream: true,
      });

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      const text = await response.text();
      const { parsedData } = parseSSEResponse(text);

      const messageDelta = parsedData.find(
        (data: any) => data.type === "message_delta"
      );

      expect(messageDelta).toBeDefined();
      expect(messageDelta).toHaveProperty("usage");
      expect((messageDelta as any).usage.output_tokens).toBeGreaterThan(0);
    });
  });

  describe("Request validation", () => {
    it("should return 400 for missing model field", async () => {
      const requestBody = {
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
      };

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain("model");
    });

    it("should return 400 for missing messages field", async () => {
      const requestBody = {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
      };

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain("messages");
    });

    it("should return 400 for empty messages array", async () => {
      const requestBody = {
        model: "claude-3-5-sonnet-20241022",
        messages: [],
        max_tokens: 1024,
      };

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain("messages");
    });

    it("should return 400 for missing max_tokens field", async () => {
      const requestBody = {
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "Hello" }],
      };

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain("max_tokens");
    });

    it("should return 400 for invalid message role", async () => {
      const requestBody = {
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "invalid_role", content: "Hello" }],
        max_tokens: 1024,
      };

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain("role");
    });

    it("should return 400 for invalid JSON body", async () => {
      const response = await makeMockEndpointRequest(endpoint, {
        body: "invalid json{" as any,
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it("should return 401 for missing API key", async () => {
      const requestBody = createAnthropicMessageRequest("Hello");

      // Use fetch directly to avoid default API key header from helper
      const response = await fetch(
        `${process.env.NEXTAUTH_URL}${endpoint}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            // Explicitly not including x-api-key
          },
          body: JSON.stringify(requestBody),
        }
      );

      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toMatch(/API key/i);
    });
  });

  describe("Conversation history management", () => {
    it("should track conversation history across multiple requests", async () => {
      const conversationId = "test-conversation-tracking";

      const firstRequest = createAnthropicMessageRequest("My name is Alice", {
        conversationId,
      });

      const firstResponse = await makeMockEndpointRequest(endpoint, {
        body: firstRequest,
      });

      expect(firstResponse.status).toBe(200);
      const firstData = await firstResponse.json();

      const secondRequest = createAnthropicMessageRequest(
        "What is my name?",
        {
          conversationId,
          messages: [
            { role: "user", content: "My name is Alice" },
            { role: "assistant", content: firstData.content[0].text },
            { role: "user", content: "What is my name?" },
          ],
        }
      );

      const secondResponse = await makeMockEndpointRequest(endpoint, {
        body: secondRequest,
      });

      expect(secondResponse.status).toBe(200);
      const secondData = await secondResponse.json();
      expect(secondData.content[0].text).toBeTruthy();
    });

    it("should maintain separate conversation contexts", async () => {
      const request1 = createAnthropicMessageRequest("I like pizza", {
        conversationId: "test-conversation-1",
      });

      const request2 = createAnthropicMessageRequest("I like burgers", {
        conversationId: "test-conversation-2",
      });

      const response1 = await makeMockEndpointRequest(endpoint, {
        body: request1,
      });

      const response2 = await makeMockEndpointRequest(endpoint, {
        body: request2,
      });

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      const data1 = await response1.json();
      const data2 = await response2.json();

      expect(data1.content[0].text).toBeTruthy();
      expect(data2.content[0].text).toBeTruthy();
    });
  });

  describe("Model configuration", () => {
    it("should accept valid Claude 3.5 Sonnet model", async () => {
      const requestBody = createAnthropicMessageRequest("Test");

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.model).toBe("claude-3-5-sonnet-20241022");
    });

    it("should accept valid Claude 3 Opus model", async () => {
      const requestBody = createAnthropicMessageRequest("Test", {
        model: "claude-3-opus-20240229",
      });

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.model).toBe("claude-3-opus-20240229");
    });

    it("should respect max_tokens parameter", async () => {
      const requestBody = createAnthropicMessageRequest(
        "Write a very long response",
        { max_tokens: 50 }
      );

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.usage.output_tokens).toBeLessThanOrEqual(50);
    });
  });

  describe("Error handling", () => {
    it("should handle unsupported model gracefully", async () => {
      const requestBody = createAnthropicMessageRequest("Test", {
        model: "unsupported-model-v1",
      });

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain("model");
    });

    it("should handle method other than POST", async () => {
      const response = await makeMockEndpointRequest(endpoint, {
        method: "GET",
      });

      expect(response.status).toBe(405);
    });
  });

  describe("Context-aware generation", () => {
    it("should generate appropriate response for commit message request", async () => {
      const requestBody = createAnthropicMessageRequest(
        "Generate a commit message for: Added user authentication"
      );

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.content[0].text).toBeTruthy();
      expect(data.content[0].text.length).toBeGreaterThan(10);
    });

    it("should generate appropriate response for code assistance request", async () => {
      const requestBody = createAnthropicMessageRequest(
        "Help me write a function that validates email addresses"
      );

      const response = await makeMockEndpointRequest(endpoint, {
        body: requestBody,
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.content[0].text).toBeTruthy();
      expect(data.content[0].text.length).toBeGreaterThan(20);
    });
  });
});
