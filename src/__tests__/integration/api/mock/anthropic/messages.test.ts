import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/mock/anthropic/v1/messages/route";
import { mockAnthropicState } from "@/lib/mock/anthropic-state";
import {
  createPostRequest,
  createRequestWithHeaders,
} from "@/__tests__/support/helpers/request-builders";
import { resetAnthropicMocks } from "@/__tests__/support/helpers/service-mocks/anthropic-mocks";

// Mock environment configuration - must be hoisted
const mockConfig = vi.hoisted(() => ({
  USE_MOCKS: true,
}));

vi.mock("@/config/env", () => ({
  config: mockConfig,
}));

describe("POST /api/mock/anthropic/v1/messages - Integration Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAnthropicState.reset();
    mockConfig.USE_MOCKS = true;
  });

  afterEach(() => {
    resetAnthropicMocks();
  });

  describe("USE_MOCKS Gating", () => {
    test("returns 404 when USE_MOCKS is false", async () => {
      mockConfig.USE_MOCKS = false;

      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Hello" }],
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error.type).toBe("not_found_error");
      expect(data.error.message).toBe("Not found");
    });
  });

  describe("Authentication", () => {
    test("returns 401 when API key is missing", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Hello" }],
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error.type).toBe("authentication_error");
      expect(data.error.message).toBe("Invalid API key");
    });

    test("returns 401 when API key does not start with mock-anthropic-key", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "invalid-key",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Hello" }],
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error.type).toBe("authentication_error");
      expect(data.error.message).toBe("Invalid API key");
    });

    test("accepts valid API key with mock-anthropic-key prefix", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test-123",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Hello" }],
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Non-Streaming Text Responses", () => {
    test("returns standard JSON response for text generation", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "How do I build a login form?" }],
          stream: false,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();

      // Verify response structure
      expect(data).toHaveProperty("id");
      expect(data).toHaveProperty("type", "message");
      expect(data).toHaveProperty("role", "assistant");
      expect(data).toHaveProperty("content");
      expect(data).toHaveProperty("model", "claude-3-5-sonnet-20241022");
      expect(data).toHaveProperty("stop_reason", "end_turn");
      expect(data).toHaveProperty("usage");

      // Verify content structure
      expect(Array.isArray(data.content)).toBe(true);
      expect(data.content).toHaveLength(1);
      expect(data.content[0]).toHaveProperty("type", "text");
      expect(data.content[0]).toHaveProperty("text");
      expect(typeof data.content[0].text).toBe("string");

      // Verify usage
      expect(data.usage).toHaveProperty("input_tokens");
      expect(data.usage).toHaveProperty("output_tokens");
      expect(typeof data.usage.input_tokens).toBe("number");
      expect(typeof data.usage.output_tokens).toBe("number");
    });

    test("calculates token counts based on content length", async () => {
      const longPrompt = "A".repeat(1000);
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: longPrompt }],
          stream: false,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      // Tokens are roughly length/4
      expect(data.usage.input_tokens).toBeGreaterThan(200);
      expect(data.usage.output_tokens).toBeGreaterThan(0);
    });

    test("handles empty messages array gracefully", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [],
          stream: false,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.content[0].text).toBeDefined();
    });
  });

  describe("Streaming Text Responses", () => {
    test("returns streaming response when stream=true", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Tell me a story" }],
          stream: true,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const contentType = response.headers.get("content-type");
      expect(contentType).toBeDefined();
    });
  });

  describe("Tool Use (Structured Generation)", () => {
    test.skip("detects feature extraction and returns tool_use response", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: "Extract features from this transcript: user wants login functionality",
            },
          ],
          system: "You are a feature extraction assistant",
          tools: [
            {
              name: "extract_feature",
              description: "Extract feature details",
            },
          ],
          stream: false,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();

      // Verify tool_use response
      expect(data.content).toHaveLength(1);
      expect(data.content[0]).toHaveProperty("type", "tool_use");
      expect(data.content[0]).toHaveProperty("id");
      expect(data.content[0]).toHaveProperty("name");
      expect(data.content[0]).toHaveProperty("input");
      expect(data.stop_reason).toBe("tool_use");

      // Verify input contains structured data
      expect(typeof data.content[0].input).toBe("object");
    });

    test("detects user story generation and returns structured response", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: "Generate user stories for authentication feature",
            },
          ],
          tools: [
            {
              name: "generate_stories",
              description: "Generate user stories",
            },
          ],
          stream: false,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.content[0].type).toBe("tool_use");
      expect(data.content[0].input).toBeDefined();
      expect(data.stop_reason).toBe("tool_use");
    });

    test("detects phase generation and returns structured response", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: "Break down the project into phases and milestones",
            },
          ],
          tools: [
            {
              name: "generate_phases",
              description: "Generate phases",
            },
          ],
          stream: false,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.content[0].type).toBe("tool_use");
      expect(data.content[0].input).toBeDefined();
    });

    test("streams tool_use response when stream=true", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: "Extract features from transcript",
            },
          ],
          tools: [
            {
              name: "extract_feature",
              description: "Extract feature",
            },
          ],
          stream: true,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Conversation History (Tool Results)", () => {
    test("handles ongoing conversation with tool results", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            { role: "user", content: "Extract features" },
            {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "tool_1",
                  name: "extract_feature",
                  input: { title: "Login" },
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "tool_1",
                  content: "Feature extracted successfully",
                },
              ],
            },
            { role: "user", content: "What's next?" },
          ],
          stream: false,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should return text response (not tool_use) when tool results are present
      expect(data.content[0].type).toBe("text");
      expect(data.stop_reason).toBe("end_turn");
    });
  });

  describe("Model Configuration", () => {
    test("accepts claude-3-haiku model", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-haiku-20240307",
          messages: [{ role: "user", content: "Hello" }],
          stream: false,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.model).toBe("claude-3-haiku-20240307");
    });

    test("accepts claude-3-opus model", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-opus-20240229",
          messages: [{ role: "user", content: "Hello" }],
          stream: false,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.model).toBe("claude-3-opus-20240229");
    });

    test("defaults to claude-3-5-sonnet when model is missing", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          messages: [{ role: "user", content: "Hello" }],
          stream: false,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.model).toBe("claude-3-5-sonnet-20241022");
    });
  });

  describe("System Prompts", () => {
    test("accepts system prompt parameter", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Explain routing" }],
          system: "You are a Next.js expert",
          stream: false,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.content[0].text).toBeDefined();
    });
  });

  describe("Request ID Generation", () => {
    test("generates unique request ID for each request", async () => {
      const request1 = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "First request" }],
          stream: false,
        }
      );

      const request2 = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Second request" }],
          stream: false,
        }
      );

      const response1 = await POST(request1);
      const response2 = await POST(request2);

      const data1 = await response1.json();
      const data2 = await response2.json();

      expect(data1.id).toBeDefined();
      expect(data2.id).toBeDefined();
      expect(data1.id).not.toBe(data2.id);
    });
  });

  describe("Error Handling", () => {
    test("returns 500 for malformed JSON", async () => {
      const request = new Request(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": "mock-anthropic-key-test",
          },
          body: "{ invalid json",
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error.type).toBe("internal_server_error");
    });

    test("handles errors gracefully and returns 500", async () => {
      // Force an error by mocking generateResponse to throw
      vi.spyOn(mockAnthropicState, "generateResponse").mockImplementation(() => {
        throw new Error("State manager error");
      });

      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: "Trigger error" }],
          stream: false,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error.type).toBe("internal_server_error");
      expect(data.error.message).toBe("Internal server error");
    });
  });

  describe("Edge Cases", () => {
    test("handles very long prompt", async () => {
      const longPrompt = "A".repeat(10000);
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [{ role: "user", content: longPrompt }],
          stream: false,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.content[0].text).toBeDefined();
    });

    test("handles special characters in prompt", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: "Special chars: émojis 🚀 símböls ñáéíóú <>&\"'",
            },
          ],
          stream: false,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.content[0].text).toBeDefined();
    });

    test("handles multiple messages in conversation", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            { role: "user", content: "What is routing?" },
            { role: "assistant", content: "Routing is..." },
            { role: "user", content: "Can you explain more?" },
          ],
          stream: false,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.content[0].text).toBeDefined();
    });

    test("handles array content in user message", async () => {
      const request = createRequestWithHeaders(
        "http://localhost:3000/api/mock/anthropic/v1/messages",
        "POST",
        {
          "Content-Type": "application/json",
          "x-api-key": "mock-anthropic-key-test",
        },
        {
          model: "claude-3-5-sonnet-20241022",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Analyze this code" },
                { type: "text", text: "function hello() { return 'world'; }" },
              ],
            },
          ],
          stream: false,
        }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.content[0].text).toBeDefined();
    });
  });
});
