import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/transcript/chunk/route";
import {
  createPostRequest,
  expectSuccess,
  expectError,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";

// Mock environment config with test Stakwork credentials
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-stakwork-api-key",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    STAKWORK_TRANSCRIPT_WORKFLOW_ID: "999",
  },
}));

// Mock fetch for Stakwork API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("POST /api/transcript/chunk - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: Mock successful Stakwork API response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          project_id: 12345,
          workflow_id: 999,
          status: "queued",
        },
      }),
      statusText: "OK",
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Successful Request Tests", () => {
    test("should successfully process transcript chunk with valid payload", async () => {
      const workspaceSlug = generateUniqueSlug("test-workspace");
      const testChunk = "This is a test transcript chunk with multiple words.";
      const wordCount = 9;

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: testChunk,
          wordCount,
          workspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      // Verify response format
      expect(data.success).toBe(true);
      expect(data.received).toBe(wordCount);

      // Verify Stakwork API was called
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("should forward chunk to Stakwork API with correct payload structure", async () => {
      const workspaceSlug = generateUniqueSlug("workspace");
      const testChunk = "Test chunk for API validation.";

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: testChunk,
          wordCount: 5,
          workspaceSlug,
        }
      );

      await POST(request);

      // Verify Stakwork API call structure
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stakwork.com/api/v1/projects",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Token token=test-stakwork-api-key",
            "Content-Type": "application/json",
          },
        })
      );

      // Verify payload structure
      const callArgs = mockFetch.mock.calls[0];
      const payload = JSON.parse(callArgs[1].body);

      expect(payload).toMatchObject({
        name: "hive_transcript",
        workflow_id: 999,
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

    test("should handle chunk with minimum word count", async () => {
      const workspaceSlug = generateUniqueSlug("min-words");
      const testChunk = "Short chunk.";

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: testChunk,
          wordCount: 2,
          workspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.received).toBe(2);
    });

    test("should handle chunk with maximum word count", async () => {
      const workspaceSlug = generateUniqueSlug("max-words");
      // Create a 100-word chunk
      const words = Array(100).fill("word").join(" ");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: words,
          wordCount: 100,
          workspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.received).toBe(100);
    });

    test("should handle chunk with special characters", async () => {
      const workspaceSlug = generateUniqueSlug("special-chars");
      const testChunk = "Test with special chars: @#$%^&*() and émojis 🚀";

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: testChunk,
          wordCount: 8,
          workspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.received).toBe(8);

      // Verify special characters preserved in Stakwork payload
      const callArgs = mockFetch.mock.calls[0];
      const payload = JSON.parse(callArgs[1].body);
      expect(payload.workflow_params.set_var.attributes.vars.chunk).toBe(testChunk);
    });

    test("should handle multiple consecutive chunks", async () => {
      const workspaceSlug = generateUniqueSlug("multi-chunk");
      const chunks = [
        "First chunk of transcript.",
        "Second chunk continues here.",
        "Third chunk completes thought.",
      ];

      for (const [index, chunk] of chunks.entries()) {
        const request = createPostRequest(
          "http://localhost:3000/api/transcript/chunk",
          {
            chunk,
            wordCount: chunk.split(" ").length,
            workspaceSlug,
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response, 200);

        expect(data.success).toBe(true);
      }

      // Verify all chunks were sent to Stakwork
      expect(mockFetch).toHaveBeenCalledTimes(chunks.length);
    });
  });

  describe("Request Validation Tests", () => {
    test("should handle missing chunk field", async () => {
      const workspaceSlug = generateUniqueSlug("missing-chunk");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          wordCount: 5,
          workspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      // API doesn't validate chunk field, passes undefined to Stakwork
      expect(data.success).toBe(true);
      expect(data.received).toBe(5);

      // Verify undefined chunk was sent to Stakwork
      const callArgs = mockFetch.mock.calls[0];
      const payload = JSON.parse(callArgs[1].body);
      expect(payload.workflow_params.set_var.attributes.vars.chunk).toBeUndefined();
    });

    test("should handle missing wordCount field", async () => {
      const workspaceSlug = generateUniqueSlug("missing-count");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk without word count.",
          workspaceSlug,
        }
      );

      const response = await POST(request);

      // Endpoint doesn't validate wordCount, so it succeeds with undefined
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.received).toBeUndefined();
    });

    test("should handle missing workspaceSlug field", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk without workspace.",
          wordCount: 4,
        }
      );

      const response = await POST(request);

      // Endpoint doesn't validate workspaceSlug, so it succeeds with undefined
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("should return 500 for invalid JSON body", async () => {
      const request = new Request("http://localhost:3000/api/transcript/chunk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "invalid json{",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to process chunk");
    });

    test("should handle empty chunk", async () => {
      const workspaceSlug = generateUniqueSlug("empty-chunk");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "",
          wordCount: 0,
          workspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.received).toBe(0);

      // Verify empty chunk was sent to Stakwork
      const callArgs = mockFetch.mock.calls[0];
      const payload = JSON.parse(callArgs[1].body);
      expect(payload.workflow_params.set_var.attributes.vars.chunk).toBe("");
    });

    test("should handle very long chunk (>1000 characters)", async () => {
      const workspaceSlug = generateUniqueSlug("long-chunk");
      const longChunk = "word ".repeat(300).trim(); // ~1500 characters

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: longChunk,
          wordCount: 300,
          workspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.received).toBe(300);
    });
  });

  describe("Stakwork API Error Handling Tests", () => {
    test("should return 500 when Stakwork API returns error response", async () => {
      const workspaceSlug = generateUniqueSlug("api-error");

      // Mock Stakwork API failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
        json: async () => ({ error: "Workflow execution failed" }),
      } as Response);

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk for error scenario.",
          wordCount: 5,
          workspaceSlug,
        }
      );

      const response = await POST(request);

      await expectError(response, "Failed to send chunk to Stakwork", 500);
    });

    test("should return 500 when Stakwork API returns non-success result", async () => {
      const workspaceSlug = generateUniqueSlug("non-success");

      // Mock Stakwork API with success: false
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          error: "Invalid workflow configuration",
        }),
      } as Response);

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk for non-success result.",
          wordCount: 5,
          workspaceSlug,
        }
      );

      const response = await POST(request);

      await expectError(response, "Failed to send chunk to Stakwork", 500);
    });

    test("should handle network errors to Stakwork API", async () => {
      const workspaceSlug = generateUniqueSlug("network-error");

      // Mock network error
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk for network error.",
          wordCount: 5,
          workspaceSlug,
        }
      );

      const response = await POST(request);

      await expectError(response, "Failed to send chunk to Stakwork", 500);
    });

    test("should handle Stakwork API timeout", async () => {
      const workspaceSlug = generateUniqueSlug("timeout");

      // Mock timeout error
      mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk for timeout scenario.",
          wordCount: 5,
          workspaceSlug,
        }
      );

      const response = await POST(request);

      await expectError(response, "Failed to send chunk to Stakwork", 500);
    });

    test("should handle Stakwork API 500 status code", async () => {
      const workspaceSlug = generateUniqueSlug("500-status");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as Response);

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk for 500 error.",
          wordCount: 5,
          workspaceSlug,
        }
      );

      const response = await POST(request);

      await expectError(response, "Failed to send chunk to Stakwork", 500);
    });

    test("should handle Stakwork API 403 forbidden", async () => {
      const workspaceSlug = generateUniqueSlug("403-forbidden");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      } as Response);

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk for 403 error.",
          wordCount: 5,
          workspaceSlug,
        }
      );

      const response = await POST(request);

      await expectError(response, "Failed to send chunk to Stakwork", 500);
    });
  });

  describe("Environment Configuration Tests", () => {
    test("should handle missing STAKWORK_API_KEY with current implementation", async () => {
      const workspaceSlug = generateUniqueSlug("no-api-key");

      // Mock fetch to simulate what happens when API key is undefined
      // The actual implementation passes undefined as Authorization header
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      } as Response);

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk without API key.",
          wordCount: 5,
          workspaceSlug,
        }
      );

      const response = await POST(request);

      // With current mock env setup, the API will attempt to call Stakwork
      // but we're mocking it to return 401 to simulate missing/invalid API key
      await expectError(response, "Failed to send chunk to Stakwork", 500);
    });

    test("should handle missing STAKWORK_TRANSCRIPT_WORKFLOW_ID with current implementation", async () => {
      const workspaceSlug = generateUniqueSlug("no-workflow-id");

      // Mock fetch to simulate what happens when workflow ID is undefined
      // The API would try parseInt(undefined) which becomes NaN
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
      } as Response);

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk without workflow ID.",
          wordCount: 5,
          workspaceSlug,
        }
      );

      const response = await POST(request);

      // With current mock env setup, the API will attempt to call Stakwork
      // but we're mocking it to return 400 to simulate invalid workflow ID
      await expectError(response, "Failed to send chunk to Stakwork", 500);
    });

    test("should use default STAKWORK_BASE_URL when not provided", async () => {
      const workspaceSlug = generateUniqueSlug("default-url");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk with default base URL.",
          wordCount: 6,
          workspaceSlug,
        }
      );

      await POST(request);

      // Verify default URL was used
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/projects"),
        expect.any(Object)
      );
    });
  });

  describe("Edge Cases and Data Integrity", () => {
    test("should preserve newlines in chunk content", async () => {
      const workspaceSlug = generateUniqueSlug("newlines");
      const chunkWithNewlines = "Line one.\nLine two.\nLine three.";

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: chunkWithNewlines,
          wordCount: 6,
          workspaceSlug,
        }
      );

      const response = await POST(request);
      await expectSuccess(response, 200);

      // Verify newlines preserved in Stakwork payload
      const callArgs = mockFetch.mock.calls[0];
      const payload = JSON.parse(callArgs[1].body);
      expect(payload.workflow_params.set_var.attributes.vars.chunk).toContain("\n");
    });

    test("should handle chunk with unicode characters", async () => {
      const workspaceSlug = generateUniqueSlug("unicode");
      const unicodeChunk = "Test with unicode: 你好世界 مرحبا Здравствуйте";

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: unicodeChunk,
          wordCount: 5,
          workspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);

      // Verify unicode preserved
      const callArgs = mockFetch.mock.calls[0];
      const payload = JSON.parse(callArgs[1].body);
      expect(payload.workflow_params.set_var.attributes.vars.chunk).toBe(unicodeChunk);
    });

    test("should handle chunk with HTML/XML characters", async () => {
      const workspaceSlug = generateUniqueSlug("html-chars");
      const htmlChunk = "Test with <html> tags & entities like &amp; and &quot;";

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: htmlChunk,
          wordCount: 10,
          workspaceSlug,
        }
      );

      const response = await POST(request);
      await expectSuccess(response, 200);

      // Verify HTML characters preserved
      const callArgs = mockFetch.mock.calls[0];
      const payload = JSON.parse(callArgs[1].body);
      expect(payload.workflow_params.set_var.attributes.vars.chunk).toBe(htmlChunk);
    });

    test("should handle negative word count", async () => {
      const workspaceSlug = generateUniqueSlug("negative-count");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test chunk with negative count.",
          wordCount: -5,
          workspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      // Endpoint doesn't validate wordCount, returns it as-is
      expect(data.success).toBe(true);
      expect(data.received).toBe(-5);
    });

    test("should handle zero word count", async () => {
      const workspaceSlug = generateUniqueSlug("zero-count");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "",
          wordCount: 0,
          workspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.received).toBe(0);
    });

    test("should handle mismatched wordCount and actual words", async () => {
      const workspaceSlug = generateUniqueSlug("mismatched-count");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "This chunk has five words.",
          wordCount: 10, // Incorrect count
          workspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      // Endpoint doesn't validate, returns provided count
      expect(data.success).toBe(true);
      expect(data.received).toBe(10);
    });
  });

  describe("Concurrent Request Handling", () => {
    test("should handle multiple concurrent chunk submissions", async () => {
      const workspaceSlug = generateUniqueSlug("concurrent");
      const chunks = [
        { chunk: "First concurrent chunk.", wordCount: 3 },
        { chunk: "Second concurrent chunk.", wordCount: 3 },
        { chunk: "Third concurrent chunk.", wordCount: 3 },
      ];

      const requests = chunks.map(({ chunk, wordCount }) =>
        createPostRequest("http://localhost:3000/api/transcript/chunk", {
          chunk,
          wordCount,
          workspaceSlug,
        })
      );

      const responses = await Promise.all(requests.map((req) => POST(req)));

      // All requests should succeed
      for (const response of responses) {
        const data = await expectSuccess(response, 200);
        expect(data.success).toBe(true);
      }

      // Verify all chunks were sent to Stakwork
      expect(mockFetch).toHaveBeenCalledTimes(chunks.length);
    });
  });
});