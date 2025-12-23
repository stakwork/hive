import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/mock/anthropic/v1/messages/route";
import {
  createPostRequest,
  createRequestWithHeaders,
} from "@/__tests__/support/helpers/request-builders";
import {
  setupAnthropicMocks,
  resetAnthropicMocks,
} from "@/__tests__/support/helpers/service-mocks/anthropic-mocks";
import { mockAnthropicState } from "@/lib/mock/anthropic-state";

describe("POST /api/mock/anthropic/v1/messages", () => {
  beforeEach(() => {
    resetAnthropicMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    test("returns 401 when API key is missing", async () => {
      const request = createPostRequest("/api/mock/anthropic/v1/messages", {
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "Hello" }],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error.type).toBe("authentication_error");
      expect(data.error.message).toBe("Invalid API key");
    });

    test("returns 401 when API key format is invalid", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "invalid-key-format" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Hello" }],
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error.type).toBe("authentication_error");
    });

    test("accepts valid API key with correct prefix", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Hello" }],
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Non-Streaming Responses", () => {
    test("returns proper JSON structure for non-streaming request", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Tell me about testing" }],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("type", "message");
      expect(data).toHaveProperty("role", "assistant");
      expect(data).toHaveProperty("content");
      expect(data).toHaveProperty("model", "claude-3-5-sonnet-20241022");
      expect(data).toHaveProperty("stop_reason");
      expect(data).toHaveProperty("usage");
      expect(data.usage).toHaveProperty("input_tokens");
      expect(data.usage).toHaveProperty("output_tokens");
      expect(Array.isArray(data.content)).toBe(true);
      expect(data.content[0]).toHaveProperty("type", "text");
      expect(data.content[0]).toHaveProperty("text");
    });

    test("generates unique request IDs for each request", async () => {
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
      const response2 = await POST(request2);
      const data1 = await response1.json();
      const data2 = await response2.json();

      expect(data1.id).not.toBe(data2.id);
      expect(data1.id).toMatch(/^mock-req-\d+$/);
      expect(data2.id).toMatch(/^mock-req-\d+$/);
    });
  });

  describe("Streaming Responses", () => {
    test("returns streaming response for stream=true", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Hello streaming" }],
          stream: true,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(response.headers.get("cache-control")).toBe("no-cache");
      expect(response.headers.get("connection")).toBe("keep-alive");
    });

    test("streaming response contains valid SSE events", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Test streaming format" }],
          stream: true,
        }
      );

      const response = await POST(request);
      const text = await response.text();

      expect(text).toContain("event: message_start");
      expect(text).toContain("event: content_block_start");
      expect(text).toContain("event: content_block_delta");
      expect(text).toContain("event: content_block_stop");
      expect(text).toContain("event: message_stop");
      expect(text).toContain("data: ");

      const dataLines = text.split("\n").filter((line) => line.startsWith("data: "));
      expect(dataLines.length).toBeGreaterThan(0);

      dataLines.forEach((line) => {
        const jsonStr = line.replace("data: ", "");
        expect(() => JSON.parse(jsonStr)).not.toThrow();
      });
    });
  });

  describe("Context-Aware Response Generation", () => {
    test("generates feature extraction response for feature-related prompts", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: "Extract features from this transcript: User wants login functionality",
            },
          ],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      const responseText = data.content[0].text;
      const parsedResponse = JSON.parse(responseText);

      expect(parsedResponse).toHaveProperty("title");
      expect(parsedResponse).toHaveProperty("brief");
      expect(parsedResponse).toHaveProperty("requirements");
      expect(parsedResponse.title).toContain("Mock Generated Feature");
    });

    test("generates user stories for user story prompts", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: "Generate user stories with acceptance criteria",
            },
          ],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      const responseText = data.content[0].text;
      const parsedResponse = JSON.parse(responseText);

      expect(parsedResponse).toHaveProperty("userStories");
      expect(Array.isArray(parsedResponse.userStories)).toBe(true);
      expect(parsedResponse.userStories[0]).toHaveProperty("title");
      expect(parsedResponse.userStories[0]).toHaveProperty("acceptanceCriteria");
    });

    test("generates code assistance response for code-related prompts", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: "How do I implement authentication in React?",
            },
          ],
          system: "You are a helpful code assistant",
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.content[0].type).toBe("text");
      expect(data.content[0].text).toContain("mock response");
      expect(data.content[0].text).toContain("code");
    });

    test("generates commit message for commit-related prompts", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: "Generate a commit message for this diff: Added login feature",
            },
          ],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      const responseText = data.content[0].text;
      const parsedResponse = JSON.parse(responseText);

      expect(parsedResponse).toHaveProperty("message");
      expect(parsedResponse).toHaveProperty("description");
      expect(parsedResponse.message).toContain("feat:");
    });
  });

  describe("Tool Use Support", () => {
    test("returns tool_use response for structured generation with tools", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: "Generate implementation phases for this feature",
            },
          ],
          tools: [
            {
              name: "generate_phases",
              description: "Generate phases and tasks for implementation",
              input_schema: {
                type: "object",
                properties: {
                  phases: { type: "array" },
                },
              },
            },
          ],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.stop_reason).toBe("tool_use");
      expect(data.content[0].type).toBe("tool_use");
      expect(data.content[0]).toHaveProperty("id");
      expect(data.content[0]).toHaveProperty("name", "generate_phases");
      expect(data.content[0]).toHaveProperty("input");
    });

    test("returns streaming tool_use response when stream=true with tools", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: "Generate user stories",
            },
          ],
          tools: [
            {
              name: "generate_stories",
              description: "Generate user stories",
            },
          ],
          stream: true,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");

      const text = await response.text();
      expect(text).toContain("event: message_start");
      expect(text).toContain("content_block_start");
      expect(text).toContain('"type":"tool_use"');
    });
  });

  describe("Request Validation", () => {
    test("handles missing model field gracefully", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          messages: [{ role: "user", content: "Hello" }],
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.model).toBe("claude-3-5-sonnet-20241022");
    });

    test("handles empty messages array", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [],
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    test("handles complex message content formats", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "First part" },
                { type: "text", text: "Second part" },
              ],
            },
          ],
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe("State Management", () => {
    test("mock state manager maintains request counter", async () => {
      const initialCounter = mockAnthropicState["requestCounter"];

      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Test" }],
        }
      );

      await POST(request);

      const afterCounter = mockAnthropicState["requestCounter"];
      expect(afterCounter).toBeGreaterThan(initialCounter);
    });

    test("state resets properly between test runs", async () => {
      mockAnthropicState.reset();

      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Test" }],
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.id).toMatch(/^mock-req-\d+$/);
    });

    test("conversation history can be tracked via state manager", () => {
      const conversationId = "test-conv-123";
      const conversation = mockAnthropicState.createConversation(conversationId);

      expect(conversation).toHaveProperty("id", conversationId);
      expect(conversation).toHaveProperty("messages");
      expect(conversation).toHaveProperty("createdAt");
      expect(Array.isArray(conversation.messages)).toBe(true);

      mockAnthropicState.addMessage(conversationId, "user", "Hello");
      mockAnthropicState.addMessage(conversationId, "assistant", "Hi there");

      expect(conversation.messages).toHaveLength(2);
    });
  });

  describe("Error Handling", () => {
    test("handles invalid JSON in request body", async () => {
      const request = new Request("http://localhost/api/mock/anthropic/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": "mock-anthropic-key-test",
          "content-type": "application/json",
        },
        body: "invalid json{",
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error.type).toBe("internal_server_error");
    });

    test("returns 500 on unexpected errors", async () => {
      vi.spyOn(mockAnthropicState, "generateResponse").mockImplementationOnce(() => {
        throw new Error("Unexpected error");
      });

      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Test error" }],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error.type).toBe("internal_server_error");
    });
  });

  describe("Model Configuration", () => {
    test("supports different model types", async () => {
      const models = [
        "claude-3-haiku-20240307",
        "claude-3-5-sonnet-20241022",
        "claude-3-opus-20240229",
      ];

      for (const model of models) {
        const request = createRequestWithHeaders(
          "/api/mock/anthropic/v1/messages",
          "POST",
          { "x-api-key": "mock-anthropic-key-test" },
          {
            model,
            messages: [{ role: "user", content: "Test model" }],
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.model).toBe(model);
      }
    });

    test("returns appropriate token usage estimates", async () => {
      const request = createRequestWithHeaders(
        "/api/mock/anthropic/v1/messages",
        "POST",
        { "x-api-key": "mock-anthropic-key-test" },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: "This is a longer prompt that should result in more tokens",
            },
          ],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.usage.input_tokens).toBeGreaterThan(0);
      expect(data.usage.output_tokens).toBeGreaterThan(0);
      expect(typeof data.usage.input_tokens).toBe("number");
      expect(typeof data.usage.output_tokens).toBe("number");
    });
  });
});
