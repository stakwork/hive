import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/transcript/chunk/route";
import { createPostRequest } from "@/__tests__/support/helpers";

// Mock environment config
vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-stakwork-key",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    STAKWORK_TRANSCRIPT_WORKFLOW_ID: "888",
  },
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("POST /api/transcript/chunk - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock successful Stakwork API response by default
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { project_id: 12345 },
      }),
      statusText: "OK",
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Successful Requests", () => {
    test("should successfully process transcript chunk with valid payload", async () => {
      const testChunk = "This is a test transcript chunk with several words.";
      const testWordCount = 9;
      const testWorkspaceSlug = "test-workspace";

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: testChunk,
          wordCount: testWordCount,
          workspaceSlug: testWorkspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        received: testWordCount,
      });

      // Verify Stakwork API was called
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.com/api/v1/projects",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Token token=test-stakwork-key",
            "Content-Type": "application/json",
          },
        })
      );

      // Verify payload structure
      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1].body);

      expect(payload).toMatchObject({
        name: "hive_transcript",
        workflow_id: 888,
        workflow_params: {
          set_var: {
            attributes: {
              vars: {
                chunk: testChunk,
              },
            },
          },
        },
      });
    });

    test("should handle large payload (100+ words) correctly", async () => {
      // Generate a large chunk with 150 words
      const words = Array.from({ length: 150 }, (_, i) => `word${i}`);
      const largeChunk = words.join(" ");
      const wordCount = 150;

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: largeChunk,
          wordCount: wordCount,
          workspaceSlug: "large-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.received).toBe(wordCount);

      // Verify large chunk was sent to Stakwork
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.chunk).toBe(
        largeChunk
      );
      expect(payload.workflow_params.set_var.attributes.vars.chunk.length).toBeGreaterThan(500);
    });

    test("should handle streaming scenario with multiple sequential chunks", async () => {
      const chunks = [
        { chunk: "First chunk of the transcript.", wordCount: 5 },
        { chunk: "Second chunk continues the conversation.", wordCount: 5 },
        { chunk: "Third chunk finishes the thought.", wordCount: 5 },
      ];

      const workspaceSlug = "streaming-workspace";

      for (const chunkData of chunks) {
        const request = createPostRequest(
          "http://localhost:3000/api/transcript/chunk",
          {
            ...chunkData,
            workspaceSlug,
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.received).toBe(chunkData.wordCount);
      }

      // Verify all chunks were sent to Stakwork
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify each chunk was sent independently
      const payloads = mockFetch.mock.calls.map((call) =>
        JSON.parse(call[1].body)
      );
      expect(payloads[0].workflow_params.set_var.attributes.vars.chunk).toBe(
        chunks[0].chunk
      );
      expect(payloads[1].workflow_params.set_var.attributes.vars.chunk).toBe(
        chunks[1].chunk
      );
      expect(payloads[2].workflow_params.set_var.attributes.vars.chunk).toBe(
        chunks[2].chunk
      );
    });

    test("should handle special characters and unicode in transcript", async () => {
      const specialChunk =
        "Test with émojis 🚀 and special chars: àáâäåæçèéêë & <html>";
      const wordCount = 10;

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: specialChunk,
          wordCount: wordCount,
          workspaceSlug: "special-chars-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify special characters are preserved
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.chunk).toBe(
        specialChunk
      );
    });

    test("should handle empty chunk gracefully", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "",
          wordCount: 0,
          workspaceSlug: "empty-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.received).toBe(0);

      // Verify empty chunk was still sent to Stakwork
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.chunk).toBe("");
    });
  });

  describe("Environment Variable Validation", () => {
    test("should return 500 when STAKWORK_API_KEY is missing", async () => {
      // Temporarily remove API key by mocking the config import
      const { config } = await import("@/config/env");
      const originalApiKey = config.STAKWORK_API_KEY;
      (config as any).STAKWORK_API_KEY = undefined;

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk",
          wordCount: 2,
          workspaceSlug: "test-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to send chunk to Stakwork");

      // Restore
      (config as any).STAKWORK_API_KEY = originalApiKey;
    });

    test("should return 500 when STAKWORK_TRANSCRIPT_WORKFLOW_ID is missing", async () => {
      const { config } = await import("@/config/env");
      const originalWorkflowId = config.STAKWORK_TRANSCRIPT_WORKFLOW_ID;
      (config as any).STAKWORK_TRANSCRIPT_WORKFLOW_ID = undefined;

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk",
          wordCount: 2,
          workspaceSlug: "test-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to send chunk to Stakwork");

      // Restore
      (config as any).STAKWORK_TRANSCRIPT_WORKFLOW_ID = originalWorkflowId;
    });

    test("should return 500 when STAKWORK_TRANSCRIPT_WORKFLOW_ID is empty string", async () => {
      const { config } = await import("@/config/env");
      const originalWorkflowId = config.STAKWORK_TRANSCRIPT_WORKFLOW_ID;
      (config as any).STAKWORK_TRANSCRIPT_WORKFLOW_ID = "";

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk",
          wordCount: 2,
          workspaceSlug: "test-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to send chunk to Stakwork");

      // Restore
      (config as any).STAKWORK_TRANSCRIPT_WORKFLOW_ID = originalWorkflowId;
    });
  });

  describe("Stakwork API Error Handling", () => {
    test("should return 500 when Stakwork API returns error response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
        json: async () => ({}),
      } as Response);

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk",
          wordCount: 2,
          workspaceSlug: "error-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to send chunk to Stakwork");
    });

    test("should handle network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk",
          wordCount: 2,
          workspaceSlug: "network-error-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to send chunk to Stakwork");
    });

    test("should handle 404 from Stakwork API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
      } as Response);

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk",
          wordCount: 2,
          workspaceSlug: "not-found-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to send chunk to Stakwork");
    });

    test("should handle 401 unauthorized from Stakwork API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({}),
      } as Response);

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk",
          wordCount: 2,
          workspaceSlug: "unauthorized-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to send chunk to Stakwork");
    });

    test("should handle 503 service unavailable from Stakwork API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({}),
      } as Response);

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk",
          wordCount: 2,
          workspaceSlug: "unavailable-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to send chunk to Stakwork");
    });

    test("should handle timeout errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk",
          wordCount: 2,
          workspaceSlug: "timeout-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to send chunk to Stakwork");
    });
  });

  describe("Request Body Validation", () => {
    test("should handle missing chunk field", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          wordCount: 5,
          workspaceSlug: "test-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      // Implementation does not validate required fields - it will send undefined to Stakwork
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.received).toBe(5);
    });

    test("should handle missing wordCount field", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk",
          workspaceSlug: "test-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      // Implementation does not validate required fields - wordCount will be undefined
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.received).toBeUndefined();
    });

    test("should handle missing workspaceSlug field", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk",
          wordCount: 2,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      // Implementation does not validate required fields - workspaceSlug will be undefined
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.received).toBe(2);
    });

    test("should handle null chunk value", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: null,
          wordCount: 0,
          workspaceSlug: "null-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      // Implementation does not validate chunk value - null will be sent to Stakwork
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.received).toBe(0);
    });

    test("should handle malformed JSON in request body", async () => {
      const request = new Request(
        "http://localhost:3000/api/transcript/chunk",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "invalid json{",
        }
      );

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process chunk");
    });
  });

  describe("Payload Construction", () => {
    test("should construct correct StakworkWorkflowPayload structure", async () => {
      const testChunk = "Verify payload structure";
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: testChunk,
          wordCount: 3,
          workspaceSlug: "payload-workspace",
        }
      );

      await POST(request);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1].body);

      // Verify all required fields
      expect(payload).toHaveProperty("name", "hive_transcript");
      expect(payload).toHaveProperty("workflow_id");
      expect(payload.workflow_id).toBe(888);
      expect(payload).toHaveProperty("workflow_params");
      expect(payload.workflow_params).toHaveProperty("set_var");
      expect(payload.workflow_params.set_var).toHaveProperty("attributes");
      expect(payload.workflow_params.set_var.attributes).toHaveProperty("vars");
      expect(payload.workflow_params.set_var.attributes.vars).toHaveProperty(
        "chunk",
        testChunk
      );
    });

    test("should include Authorization header with API key", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test authorization",
          wordCount: 2,
          workspaceSlug: "auth-workspace",
        }
      );

      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Token token=test-stakwork-key",
          }),
        })
      );
    });

    test("should include Content-Type header as application/json", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test content type",
          wordCount: 3,
          workspaceSlug: "content-type-workspace",
        }
      );

      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("should use correct Stakwork API endpoint", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test endpoint",
          wordCount: 2,
          workspaceSlug: "endpoint-workspace",
        }
      );

      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.com/api/v1/projects",
        expect.any(Object)
      );
    });

    test("should use POST method for Stakwork API call", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test method",
          wordCount: 2,
          workspaceSlug: "method-workspace",
        }
      );

      await POST(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
        })
      );
    });
  });

  describe("Edge Cases", () => {
    test("should handle very long transcript chunk (1000+ words)", async () => {
      const words = Array.from({ length: 1000 }, (_, i) => `word${i}`);
      const veryLargeChunk = words.join(" ");
      const wordCount = 1000;

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: veryLargeChunk,
          wordCount: wordCount,
          workspaceSlug: "very-large-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.received).toBe(wordCount);

      // Verify very large chunk was sent to Stakwork
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.chunk).toBe(
        veryLargeChunk
      );
    });

    test("should handle single-word chunk", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Hello",
          wordCount: 1,
          workspaceSlug: "single-word-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.received).toBe(1);
    });

    test("should handle chunk with only whitespace", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "   \n\t  ",
          wordCount: 0,
          workspaceSlug: "whitespace-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.received).toBe(0);
    });

    test("should handle rapid sequential chunks (stress test)", async () => {
      const chunks = Array.from({ length: 10 }, (_, i) => ({
        chunk: `Rapid chunk number ${i}`,
        wordCount: 4,
      }));

      const promises = chunks.map((chunkData) =>
        POST(
          createPostRequest("http://localhost:3000/api/transcript/chunk", {
            ...chunkData,
            workspaceSlug: "stress-workspace",
          })
        )
      );

      const responses = await Promise.all(promises);

      responses.forEach(async (response) => {
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
      });

      expect(mockFetch).toHaveBeenCalledTimes(10);
    });

    test("should handle chunks with line breaks and newlines", async () => {
      const chunkWithNewlines = "First line.\nSecond line.\nThird line.";
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: chunkWithNewlines,
          wordCount: 6,
          workspaceSlug: "newlines-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify newlines are preserved
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.chunk).toBe(
        chunkWithNewlines
      );
    });

    test("should handle negative wordCount gracefully", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk",
          wordCount: -5,
          workspaceSlug: "negative-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.received).toBe(-5);
    });

    test("should handle zero wordCount", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "",
          wordCount: 0,
          workspaceSlug: "zero-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.received).toBe(0);
    });
  });

  describe("Workspace Scoping", () => {
    test("should handle different workspace slugs independently", async () => {
      const workspace1 = "workspace-alpha";
      const workspace2 = "workspace-beta";

      const request1 = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Alpha workspace chunk",
          wordCount: 3,
          workspaceSlug: workspace1,
        }
      );

      const request2 = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Beta workspace chunk",
          wordCount: 3,
          workspaceSlug: workspace2,
        }
      );

      const response1 = await POST(request1);
      const response2 = await POST(request2);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("should handle workspace slugs with special characters", async () => {
      const specialSlug = "workspace-with-dashes_and_underscores-123";

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test special slug",
          wordCount: 3,
          workspaceSlug: specialSlug,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test("should handle very long workspace slug", async () => {
      const longSlug = "a".repeat(200);

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test long slug",
          wordCount: 3,
          workspaceSlug: longSlug,
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe("Response Format", () => {
    test("should return success response with correct structure", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test response format",
          wordCount: 3,
          workspaceSlug: "format-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("received");
      expect(typeof data.success).toBe("boolean");
      expect(typeof data.received).toBe("number");
    });

    test("should return error response with correct structure on failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Bad Request",
        json: async () => ({}),
      } as Response);

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test error format",
          wordCount: 3,
          workspaceSlug: "error-format-workspace",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data).toHaveProperty("error");
      expect(typeof data.error).toBe("string");
    });
  });
});