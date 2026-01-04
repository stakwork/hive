import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/mock/anthropic/v1/messages/route";
import { createRequestWithHeaders } from "@/__tests__/support/helpers/request-builders";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import { resetAnthropicMocks } from "@/__tests__/support/helpers/service-mocks/anthropic-mocks";
import { mockAnthropicState } from "@/lib/mock/anthropic-state";
import { expectSuccess } from "@/__tests__/support/helpers/api-assertions";

describe("POST /api/mock/anthropic/v1/messages", () => {
  beforeEach(async () => {
    await resetDatabase();
    resetAnthropicMocks();
    vi.clearAllMocks();
  });

  describe("Request Validation", () => {
    it("should return 401 if x-api-key header is missing", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        {},
        { model: "claude-3-5-sonnet-20241022", messages: [] }
      );

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.type).toBe("authentication_error");
      expect(data.error.message).toBe("Invalid API key");
    });

    it("should return 401 if x-api-key format is invalid", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "invalid-key-format" },
        { model: "claude-3-5-sonnet-20241022", messages: [] }
      );

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.type).toBe("authentication_error");
      expect(data.error.message).toBe("Invalid API key");
    });

    it.skip("should return 404 if USE_MOCKS is disabled", async () => {
      // Note: This test is skipped because config.USE_MOCKS is loaded at module import time
      // and cannot be changed dynamically during tests. In production, this endpoint
      // returns 404 when USE_MOCKS is not set to "true" in the environment.
      const originalUseMocks = process.env.USE_MOCKS;
      process.env.USE_MOCKS = "false";

      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        { model: "claude-3-5-sonnet-20241022", messages: [] }
      );

      const response = await POST(request);

      await expectNotFound(response);

      process.env.USE_MOCKS = originalUseMocks;
    });

    it("should return 500 if request body is malformed JSON", async () => {
      const request = new Request("http://localhost/api/mock/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": "mock-anthropic-key-test",
          "Content-Type": "application/json",
        },
        body: "{ invalid json",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe("Happy Path - Non-Streaming", () => {
    it("should return 200 with valid message response", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Hello, how are you?" }],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.id).toBeDefined();
      expect(data.type).toBe("message");
      expect(data.role).toBe("assistant");
      expect(data.model).toBe("claude-3-5-sonnet-20241022");
      expect(data.stop_reason).toBe("end_turn");
      expect(Array.isArray(data.content)).toBe(true);
      expect(data.content.length).toBeGreaterThan(0);
      expect(data.content[0].type).toBe("text");
      expect(data.content[0].text).toBeDefined();
      expect(data.usage).toBeDefined();
      expect(data.usage.input_tokens).toBeGreaterThan(0);
      expect(data.usage.output_tokens).toBeGreaterThan(0);
    });

    it("should handle custom model parameter", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-haiku-20240307",
          messages: [{ role: "user", content: "Test message" }],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.model).toBe("claude-3-haiku-20240307");
    });

    it("should handle system prompt", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          system: "You are a helpful assistant.",
          messages: [{ role: "user", content: "Hello" }],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.type).toBe("message");
      expect(data.content[0].text).toBeDefined();
    });

    it("should handle empty messages array", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.type).toBe("message");
      expect(data.content).toBeDefined();
    });

    it("should handle conversation history with multiple messages", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            { role: "user", content: "What is 2+2?" },
            { role: "assistant", content: "4" },
            { role: "user", content: "What about 3+3?" },
          ],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.type).toBe("message");
      expect(data.content[0].text).toBeDefined();
    });
  });

  describe("Happy Path - Streaming", () => {
    it("should return 200 with SSE stream when stream=true", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(response.headers.get("Cache-Control")).toBe("no-cache");
      expect(response.headers.get("Connection")).toBe("keep-alive");
    });

    it("should format streaming responses with proper SSE events", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Test streaming" }],
          stream: true,
        }
      );

      const response = await POST(request);
      const text = await response.text();

      const lines = text.split("\n").filter((l) => l.trim());
      const eventLines = lines.filter((l) => l.startsWith("event: "));
      const dataLines = lines.filter((l) => l.startsWith("data: "));

      expect(dataLines.length).toBeGreaterThan(0);
      expect(eventLines.length).toBeGreaterThan(0);

      // First event should be message_start
      expect(eventLines[0]).toBe("event: message_start");
      const firstData = JSON.parse(dataLines[0].substring(6));
      expect(firstData.type).toBe("message_start");
      expect(firstData.message).toBeDefined();

      // Should contain content_block_delta events
      const deltaEvents = dataLines.filter((l) => {
        const data = JSON.parse(l.substring(6));
        return data.type === "content_block_delta";
      });
      expect(deltaEvents.length).toBeGreaterThan(0);
    });

    it("should include usage tokens in streaming message_delta event", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Short message" }],
          stream: true,
        }
      );

      const response = await POST(request);
      const text = await response.text();

      const lines = text.split("\n").filter((l) => l.trim());
      const dataLines = lines.filter((l) => l.startsWith("data: "));

      // Find the message_delta event (second to last, before message_stop)
      const messageDeltaLine = dataLines.find((l) => {
        const data = JSON.parse(l.substring(6));
        return data.type === "message_delta";
      });
      
      expect(messageDeltaLine).toBeDefined();
      const messageDelta = JSON.parse(messageDeltaLine!.substring(6));
      expect(messageDelta.usage).toBeDefined();
      expect(messageDelta.usage.output_tokens).toBeGreaterThan(0);
    });
  });

  describe("Tool Handling", () => {
    it("should return tool_use response when tools array is provided with user stories", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            { role: "user", content: "Extract user stories from this transcript" },
          ],
          tools: [
            {
              name: "extract_stories",
              description: "Extract user stories from text",
              input_schema: { type: "object", properties: {} },
            },
          ],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.type).toBe("message");
      expect(data.content).toBeDefined();
      const toolUse = data.content.find((c: any) => c.type === "tool_use");
      expect(toolUse).toBeDefined();
      expect(toolUse.id).toBeDefined();
      expect(toolUse.name).toBe("extract_stories");
      expect(toolUse.input).toBeDefined();
      expect(toolUse.input.stories).toBeDefined();
    });

    it("should detect generation type for structured responses", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: "Extract user stories from this feature description",
            },
          ],
          tools: [
            {
              name: "extract_user_stories",
              description: "Extract user stories",
              input_schema: { type: "object", properties: {} },
            },
          ],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      const toolUse = data.content.find((c: any) => c.type === "tool_use");
      expect(toolUse).toBeDefined();
      expect(toolUse.input).toBeDefined();
    });
  });

  describe("Response Format Validation", () => {
    it("should include all required Anthropic API response fields", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Hello" }],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("type");
      expect(data).toHaveProperty("role");
      expect(data).toHaveProperty("content");
      expect(data).toHaveProperty("model");
      expect(data).toHaveProperty("stop_reason");
      expect(data).toHaveProperty("usage");

      expect(data.type).toBe("message");
      expect(data.role).toBe("assistant");
      expect(Array.isArray(data.content)).toBe(true);
      expect(data.usage).toHaveProperty("input_tokens");
      expect(data.usage).toHaveProperty("output_tokens");
    });

    it("should calculate usage tokens correctly", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: "This is a longer message to test token calculation",
            },
          ],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.usage.input_tokens).toBeGreaterThan(0);
      expect(data.usage.output_tokens).toBeGreaterThan(0);
      expect(typeof data.usage.input_tokens).toBe("number");
      expect(typeof data.usage.output_tokens).toBe("number");
    });
  });

  describe("State Management", () => {
    it("should generate unique request IDs for each message", async () => {
      const request1 = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "First message" }],
          stream: false,
        }
      );

      const request2 = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Second message" }],
          stream: false,
        }
      );

      const response1 = await POST(request1);
      const data1 = await expectSuccess(response1, 200);

      const response2 = await POST(request2);
      const data2 = await expectSuccess(response2, 200);

      expect(data1.id).toBeDefined();
      expect(data2.id).toBeDefined();
      expect(data1.id).not.toBe(data2.id);
    });

    it("should reset mock state properly between tests", async () => {
      const requestIdBefore = mockAnthropicState.generateRequestId();

      resetAnthropicMocks();

      const requestIdAfter = mockAnthropicState.generateRequestId();

      expect(requestIdAfter).toBe("mock-req-1");
    });
  });

  describe("Pattern-Based Response Generation", () => {
    it("should generate feature extraction response when prompted", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: "Extract features from this transcript about user authentication",
            },
          ],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.content[0].text).toContain("Mock");
    });

    it("should generate code assistance response when prompted", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          system: "You are a code assistant",
          messages: [{ role: "user", content: "How do I write a React component?" }],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.content[0].text).toBeDefined();
      expect(typeof data.content[0].text).toBe("string");
    });
  });
});
