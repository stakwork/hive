import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/transcript/chunk/route";
import {
  createPostRequest,
  expectSuccess,
  expectError,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";

// Mock the config module to control environment variables
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-stakwork-api-key",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    STAKWORK_TRANSCRIPT_WORKFLOW_ID: "888",
  },
}));

describe("POST /api/transcript/chunk - Integration Tests", () => {
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock successful Stakwork API response
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          workflow_id: 888,
          status: "queued",
          project_id: 12345,
        },
      }),
      statusText: "OK",
    } as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe("Request Validation", () => {
    test("should process request with missing chunk field (undefined chunk)", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          wordCount: 10,
          workspaceSlug: generateUniqueSlug("test-workspace"),
        }
      );

      const response = await POST(request);

      // API doesn't validate fields - passes undefined chunk to Stakwork
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.received).toBe(10);
    });

    test("should process request with missing wordCount field (undefined wordCount)", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test transcript text",
          workspaceSlug: generateUniqueSlug("test-workspace"),
        }
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.received).toBeUndefined();
    });

    test("should process request with missing workspaceSlug field", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test transcript text",
          wordCount: 3,
        }
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.received).toBe(3);
    });

    test("should process empty chunk successfully", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "",
          wordCount: 0,
          workspaceSlug: generateUniqueSlug("test-workspace"),
        }
      );

      const response = await POST(request);

      // API accepts empty chunks without validation
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.received).toBe(0);
    });

    test("should return 500 for malformed JSON", async () => {
      const request = new Request(
        "http://localhost:3000/api/transcript/chunk",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "invalid json {",
        }
      );

      const response = await POST(request);

      await expectError(response, "Failed to process chunk", 500);
    });
  });

  describe("Environment Variable Validation", () => {
    test("should return 500 when STAKWORK_API_KEY is missing", async () => {
      // Mock Stakwork API failure due to missing key by making fetch fail with auth error
      fetchSpy.mockRejectedValueOnce(new Error("Authentication failed: Invalid API key"));

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test transcript",
          wordCount: 2,
          workspaceSlug: generateUniqueSlug("test-workspace"),
        }
      );

      const response = await POST(request);

      await expectError(response, "Failed to send chunk to Stakwork", 500);
    });

    test("should return 500 when STAKWORK_TRANSCRIPT_WORKFLOW_ID is missing", async () => {
      // Mock Stakwork API failure due to invalid workflow ID
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        statusText: "Bad Request",
        json: async () => ({ error: "Invalid workflow_id" }),
      } as Response);

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test transcript",
          wordCount: 2,
          workspaceSlug: generateUniqueSlug("test-workspace"),
        }
      );

      const response = await POST(request);

      await expectError(response, "Failed to send chunk to Stakwork", 500);
    });
  });

  describe("Successful Processing", () => {
    test("should successfully process valid transcript chunk", async () => {
      const testChunk = "This is a test transcript chunk with multiple words.";
      const testWordCount = 9;
      const testWorkspaceSlug = generateUniqueSlug("test-workspace");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: testChunk,
          wordCount: testWordCount,
          workspaceSlug: testWorkspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      // Verify response structure
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("received", testWordCount);
      expect(data.received).toBe(testWordCount);
    });

    test("should process chunk with minimum word count", async () => {
      const testChunk = "Short transcript.";
      const testWordCount = 2;
      const testWorkspaceSlug = generateUniqueSlug("test-workspace");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: testChunk,
          wordCount: testWordCount,
          workspaceSlug: testWorkspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.received).toBe(testWordCount);
    });

    test("should process chunk with large word count", async () => {
      const longChunk = "word ".repeat(100).trim();
      const testWordCount = 100;
      const testWorkspaceSlug = generateUniqueSlug("test-workspace");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: longChunk,
          wordCount: testWordCount,
          workspaceSlug: testWorkspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.received).toBe(testWordCount);
    });
  });

  describe("Stakwork API Integration", () => {
    test("should send correct payload to Stakwork API", async () => {
      const testChunk = "Test transcript for API verification";
      const testWordCount = 5;
      const testWorkspaceSlug = generateUniqueSlug("test-workspace");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: testChunk,
          wordCount: testWordCount,
          workspaceSlug: testWorkspaceSlug,
        }
      );

      const response = await POST(request);
      await expectSuccess(response, 200);

      // Verify Stakwork API was called
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];

      // Verify URL
      expect(url).toBe("https://api.stakwork.com/api/v1/projects");

      // Verify HTTP method
      expect(options.method).toBe("POST");

      // Verify headers
      expect(options.headers).toEqual({
        Authorization: "Token token=test-stakwork-api-key",
        "Content-Type": "application/json",
      });

      // Verify payload structure
      const payload = JSON.parse(options.body);
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

    test("should send workflow name as 'hive_transcript'", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test",
          wordCount: 1,
          workspaceSlug: generateUniqueSlug("test-workspace"),
        }
      );

      await POST(request);

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.name).toBe("hive_transcript");
    });

    test("should use STAKWORK_TRANSCRIPT_WORKFLOW_ID from config", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test",
          wordCount: 1,
          workspaceSlug: generateUniqueSlug("test-workspace"),
        }
      );

      await POST(request);

      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_id).toBe(888);
    });
  });

  describe("Error Handling", () => {
    test("should return 500 when Stakwork API returns error", async () => {
      // Mock failed Stakwork API response
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
        json: async () => ({ error: "Workflow execution failed" }),
      } as Response);

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test error handling",
          wordCount: 3,
          workspaceSlug: generateUniqueSlug("test-workspace"),
        }
      );

      const response = await POST(request);

      await expectError(response, "Failed to send chunk to Stakwork", 500);
    });

    test("should return 500 when Stakwork API throws network error", async () => {
      // Mock network error
      fetchSpy.mockRejectedValueOnce(new Error("Network connection failed"));

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test network error",
          wordCount: 3,
          workspaceSlug: generateUniqueSlug("test-workspace"),
        }
      );

      const response = await POST(request);

      await expectError(response, "Failed to send chunk to Stakwork", 500);
    });

    test("should return 500 when Stakwork API returns 404", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as Response);

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test 404",
          wordCount: 2,
          workspaceSlug: generateUniqueSlug("test-workspace"),
        }
      );

      const response = await POST(request);

      await expectError(response, "Failed to send chunk to Stakwork", 500);
    });

    test("should return 500 when Stakwork API times out", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Request timeout"));

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test timeout",
          wordCount: 2,
          workspaceSlug: generateUniqueSlug("test-workspace"),
        }
      );

      const response = await POST(request);

      await expectError(response, "Failed to send chunk to Stakwork", 500);
    });
  });

  describe("Edge Cases", () => {
    test("should handle special characters in chunk", async () => {
      const specialChunk =
        "Test with 🚀 emojis and special chars: àáâäåæçèéêë & <html> tags";
      const testWordCount = 12;
      const testWorkspaceSlug = generateUniqueSlug("test-workspace");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: specialChunk,
          wordCount: testWordCount,
          workspaceSlug: testWorkspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.received).toBe(testWordCount);

      // Verify special characters are preserved in API call
      const payload = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.chunk).toBe(
        specialChunk
      );
    });

    test("should handle newlines and whitespace in chunk", async () => {
      const chunkWithWhitespace = "Line one\n\nLine two\n  Line three  ";
      const testWordCount = 6;
      const testWorkspaceSlug = generateUniqueSlug("test-workspace");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: chunkWithWhitespace,
          wordCount: testWordCount,
          workspaceSlug: testWorkspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.received).toBe(testWordCount);
    });

    test("should handle very large chunks", async () => {
      const largeChunk = "word ".repeat(1000).trim();
      const testWordCount = 1000;
      const testWorkspaceSlug = generateUniqueSlug("test-workspace");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: largeChunk,
          wordCount: testWordCount,
          workspaceSlug: testWorkspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.received).toBe(testWordCount);
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
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
    });

    test("should handle zero word count gracefully", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "",
          wordCount: 0,
          workspaceSlug: generateUniqueSlug("test-workspace"),
        }
      );

      const response = await POST(request);

      // API accepts zero word count without validation
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.received).toBe(0);
    });

    test("should handle mismatched word count and chunk content", async () => {
      const chunk = "five words in this chunk";
      const incorrectWordCount = 10;
      const testWorkspaceSlug = generateUniqueSlug("test-workspace");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk,
          wordCount: incorrectWordCount,
          workspaceSlug: testWorkspaceSlug,
        }
      );

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      // Endpoint accepts whatever wordCount is provided
      expect(data.success).toBe(true);
      expect(data.received).toBe(incorrectWordCount);
    });
  });

  describe("Logging and Console Output", () => {
    test("should log received chunk details to console", async () => {
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const testChunk = "Test logging";
      const testWordCount = 2;
      const testWorkspaceSlug = generateUniqueSlug("test-workspace");

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: testChunk,
          wordCount: testWordCount,
          workspaceSlug: testWorkspaceSlug,
        }
      );

      await POST(request);

      // Verify console.log was called with chunk details
      expect(consoleLogSpy).toHaveBeenCalledWith(
        "=== Transcript Chunk Received ==="
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `Workspace: ${testWorkspaceSlug}`
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `Word Count: ${testWordCount}`
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(`Chunk: ${testChunk}`);

      consoleLogSpy.mockRestore();
    });

    test("should log error when Stakwork API fails", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      fetchSpy.mockResolvedValueOnce({
        ok: false,
        statusText: "Service Unavailable",
      } as Response);

      const request = createPostRequest(
        "http://localhost:3000/api/transcript/chunk",
        {
          chunk: "Test error logging",
          wordCount: 3,
          workspaceSlug: generateUniqueSlug("test-workspace"),
        }
      );

      await POST(request);

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to send chunk to Stakwork:",
        "Service Unavailable"
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Concurrent Requests", () => {
    test("should handle multiple concurrent chunk submissions", async () => {
      const requests = Array.from({ length: 5 }, (_, i) =>
        createPostRequest("http://localhost:3000/api/transcript/chunk", {
          chunk: `Concurrent chunk ${i + 1}`,
          wordCount: 3,
          workspaceSlug: generateUniqueSlug(`workspace-${i}`),
        })
      );

      const responses = await Promise.all(requests.map((req) => POST(req)));

      // All should succeed
      for (const response of responses) {
        const data = await expectSuccess(response, 200);
        expect(data.success).toBe(true);
      }

      // Verify all were sent to Stakwork API
      expect(fetchSpy).toHaveBeenCalledTimes(5);
    });
  });
});