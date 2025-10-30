import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/calls/presigned-url/route";
import { NextRequest } from "next/server";

// Mock the S3 presigner library
const mockGenerateCallPresignedUrl = vi.fn();

vi.mock("@/lib/aws/s3-presigner", () => ({
  generateCallPresignedUrl: vi.fn((...args) => mockGenerateCallPresignedUrl(...args)),
}));

describe("POST /api/calls/presigned-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_REGION = "us-east-1";
  });

  // Helper to create mock NextRequest
  function createRequest(body: Record<string, unknown>): NextRequest {
    return {
      json: vi.fn().mockResolvedValue(body),
    } as unknown as NextRequest;
  }

  describe("Input Validation Tests", () => {
    test("should return 400 when s3Key is missing", async () => {
      const request = createRequest({});
      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("S3 key is required");
      expect(mockGenerateCallPresignedUrl).not.toHaveBeenCalled();
    });

    test("should return 400 when s3Key is null", async () => {
      const request = createRequest({ s3Key: null });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("S3 key is required");
      expect(mockGenerateCallPresignedUrl).not.toHaveBeenCalled();
    });

    test("should return 400 when s3Key is empty string", async () => {
      const request = createRequest({ s3Key: "" });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("S3 key is required");
      expect(mockGenerateCallPresignedUrl).not.toHaveBeenCalled();
    });

    test("should return 400 when s3Key is undefined", async () => {
      const request = createRequest({ s3Key: undefined });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("S3 key is required");
      expect(mockGenerateCallPresignedUrl).not.toHaveBeenCalled();
    });

    test("should accept valid s3Key", async () => {
      mockGenerateCallPresignedUrl.mockResolvedValue("https://mock-presigned-url.s3.amazonaws.com/valid-key.mp4");

      const request = createRequest({ s3Key: "valid-key.mp4" });
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.presignedUrl).toBeDefined();
    });
  });

  describe("Successful Generation Tests", () => {
    test("should generate presigned URL for valid s3Key", async () => {
      const mockPresignedUrl = "https://sphinx-livekit-recordings.s3.us-east-1.amazonaws.com/test-recording.mp4?X-Amz-Signature=abc123";
      mockGenerateCallPresignedUrl.mockResolvedValue(mockPresignedUrl);

      const request = createRequest({ s3Key: "test-recording.mp4" });
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.presignedUrl).toBe(mockPresignedUrl);
    });

    test("should call generateCallPresignedUrl with correct s3Key", async () => {
      mockGenerateCallPresignedUrl.mockResolvedValue("https://mock-url.s3.amazonaws.com/test.mp4");

      const request = createRequest({ s3Key: "recordings/test.mp4" });
      await POST(request);

      expect(mockGenerateCallPresignedUrl).toHaveBeenCalledWith("recordings/test.mp4");
    });

    test("should handle s3Key with special characters", async () => {
      mockGenerateCallPresignedUrl.mockResolvedValue("https://mock-url.s3.amazonaws.com/encoded-key.mp4");

      const specialKey = "recordings/2024-01-15/meeting #123.mp4";
      const request = createRequest({ s3Key: specialKey });
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockGenerateCallPresignedUrl).toHaveBeenCalledWith(specialKey);
    });

    test("should handle s3Key with nested path", async () => {
      mockGenerateCallPresignedUrl.mockResolvedValue("https://mock-url.s3.amazonaws.com/nested-path.mp4");

      const nestedKey = "workspace-123/swarm-456/calls/recording.mp4";
      const request = createRequest({ s3Key: nestedKey });
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockGenerateCallPresignedUrl).toHaveBeenCalledWith(nestedKey);
    });
  });

  describe("Error Handling Tests", () => {
    test("should return 500 when generateCallPresignedUrl fails", async () => {
      mockGenerateCallPresignedUrl.mockRejectedValue(new Error("AWS SDK Error: Invalid credentials"));

      const request = createRequest({ s3Key: "test-key.mp4" });
      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to generate presigned URL");
    });

    test("should return 500 when S3 service is unavailable", async () => {
      mockGenerateCallPresignedUrl.mockRejectedValue(new Error("Service Unavailable"));

      const request = createRequest({ s3Key: "test-key.mp4" });
      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to generate presigned URL");
    });

    test("should return 500 when bucket does not exist", async () => {
      mockGenerateCallPresignedUrl.mockRejectedValue(new Error("NoSuchBucket: The specified bucket does not exist"));

      const request = createRequest({ s3Key: "test-key.mp4" });
      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to generate presigned URL");
    });

    test("should return 500 when s3Key does not exist in bucket", async () => {
      mockGenerateCallPresignedUrl.mockRejectedValue(new Error("NoSuchKey: The specified key does not exist"));

      const request = createRequest({ s3Key: "non-existent-key.mp4" });
      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to generate presigned URL");
    });

    test("should handle request.json() parsing errors", async () => {
      const request = {
        json: vi.fn().mockRejectedValue(new Error("Invalid JSON")),
      } as unknown as NextRequest;

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to generate presigned URL");
    });
  });

  describe("Response Structure Tests", () => {
    test("should return response with presignedUrl field", async () => {
      const mockUrl = "https://sphinx-livekit-recordings.s3.amazonaws.com/test.mp4?signature=abc";
      mockGenerateCallPresignedUrl.mockResolvedValue(mockUrl);

      const request = createRequest({ s3Key: "test.mp4" });
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("presignedUrl");
      expect(typeof data.presignedUrl).toBe("string");
    });

    test("should return only presignedUrl field (no extra fields)", async () => {
      mockGenerateCallPresignedUrl.mockResolvedValue("https://mock-url.s3.amazonaws.com/test.mp4");

      const request = createRequest({ s3Key: "test.mp4" });
      const response = await POST(request);

      const data = await response.json();
      const keys = Object.keys(data);
      expect(keys).toEqual(["presignedUrl"]);
    });

    test("should return presigned URL as string", async () => {
      mockGenerateCallPresignedUrl.mockResolvedValue("https://mock-url.s3.amazonaws.com/test.mp4");

      const request = createRequest({ s3Key: "test.mp4" });
      const response = await POST(request);

      const data = await response.json();
      expect(typeof data.presignedUrl).toBe("string");
      expect(data.presignedUrl).toMatch(/^https:\/\//);
    });

    test("error response should have error field", async () => {
      const request = createRequest({ s3Key: "" });
      const response = await POST(request);

      const data = await response.json();
      expect(data).toHaveProperty("error");
      expect(typeof data.error).toBe("string");
    });
  });

  describe("Edge Cases", () => {
    test("should handle very long s3Key", async () => {
      mockGenerateCallPresignedUrl.mockResolvedValue("https://mock-url.s3.amazonaws.com/long-key.mp4");

      const longKey = "a".repeat(1000) + ".mp4";
      const request = createRequest({ s3Key: longKey });
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockGenerateCallPresignedUrl).toHaveBeenCalledWith(longKey);
    });

    test("should handle s3Key with unicode characters", async () => {
      mockGenerateCallPresignedUrl.mockResolvedValue("https://mock-url.s3.amazonaws.com/unicode-key.mp4");

      const unicodeKey = "recordings/会議-録音.mp4";
      const request = createRequest({ s3Key: unicodeKey });
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockGenerateCallPresignedUrl).toHaveBeenCalledWith(unicodeKey);
    });

    test("should handle multiple concurrent requests", async () => {
      mockGenerateCallPresignedUrl.mockResolvedValue("https://mock-url.s3.amazonaws.com/test.mp4");

      const requests = Array.from({ length: 5 }, (_, i) =>
        POST(createRequest({ s3Key: `recording-${i}.mp4` }))
      );

      const responses = await Promise.all(requests);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });

      expect(mockGenerateCallPresignedUrl).toHaveBeenCalledTimes(5);
    });
  });
});
