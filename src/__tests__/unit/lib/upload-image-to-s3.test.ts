// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ── Import under test ──────────────────────────────────────────────────────

import { uploadFileToS3 } from "@/lib/upload-image-to-s3";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeFile(name = "photo.jpg", type = "image/jpeg", size = 1024): File {
  const blob = new Blob(["x".repeat(size)], { type });
  return new File([blob], name, { type });
}

function mockPresignedSuccess(s3Path: string, presignedUrl: string) {
  mockFetch
    // First call: POST to get presigned URL
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ presignedUrl, s3Path }),
    })
    // Second call: PUT to S3
    .mockResolvedValueOnce({ ok: true });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("uploadFileToS3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("{ workspaceId } context", () => {
    it("POSTs to /api/upload/presigned-url with workspaceId in body", async () => {
      const file = makeFile("canvas-photo.png", "image/png");
      mockPresignedSuccess("uploads/ws-123/canvas/ts_abc_canvas-photo.png", "https://s3.example.com/presigned");

      await uploadFileToS3(file, { workspaceId: "ws-123" });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/upload/presigned-url");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.workspaceId).toBe("ws-123");
      expect(body.filename).toBe("canvas-photo.png");
      expect(body.contentType).toBe("image/png");
      expect(body).not.toHaveProperty("taskId");
      expect(body).not.toHaveProperty("featureId");
    });

    it("PUTs the file to the presigned URL returned", async () => {
      const file = makeFile("test.jpg");
      const presignedUrl = "https://s3.example.com/presigned-upload?sig=xyz";
      mockPresignedSuccess("uploads/ws-abc/canvas/123_abc_test.jpg", presignedUrl);

      await uploadFileToS3(file, { workspaceId: "ws-abc" });

      const [putUrl, putInit] = mockFetch.mock.calls[1];
      expect(putUrl).toBe(presignedUrl);
      expect(putInit?.method).toBe("PUT");
      expect(putInit?.headers?.["Content-Type"]).toBe("image/jpeg");
    });

    it("returns UploadedFileResult with correct fields", async () => {
      const file = makeFile("pic.webp", "image/webp", 2048);
      mockPresignedSuccess("uploads/ws-xyz/canvas/ts_rand_pic.webp", "https://s3.example.com/p");

      const result = await uploadFileToS3(file, { workspaceId: "ws-xyz" });

      expect(result).toEqual({
        path: "uploads/ws-xyz/canvas/ts_rand_pic.webp",
        filename: "pic.webp",
        mimeType: "image/webp",
        size: file.size,
      });
    });

    it("throws when the presigned-url endpoint returns a non-OK response", async () => {
      const file = makeFile();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Forbidden" }),
      });

      await expect(uploadFileToS3(file, { workspaceId: "ws-bad" })).rejects.toThrow("Forbidden");
    });

    it("throws when the S3 PUT fails", async () => {
      const file = makeFile();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ presignedUrl: "https://s3.example.com/p", s3Path: "some/path" }),
        })
        .mockResolvedValueOnce({ ok: false });

      await expect(uploadFileToS3(file, { workspaceId: "ws-123" })).rejects.toThrow(
        "Failed to upload file to S3",
      );
    });
  });

  describe("{ taskId } context (regression — existing path unchanged)", () => {
    it("POSTs to /api/upload/presigned-url with taskId in body", async () => {
      const file = makeFile();
      mockPresignedSuccess("uploads/ws/swarm/task-1/ts_abc_photo.jpg", "https://s3.example.com/p");

      await uploadFileToS3(file, { taskId: "task-1" });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/upload/presigned-url");
      const body = JSON.parse(init?.body as string);
      expect(body.taskId).toBe("task-1");
      expect(body).not.toHaveProperty("workspaceId");
    });
  });

  describe("{ featureId } context (regression — existing path unchanged)", () => {
    it("POSTs to /api/upload/image with featureId in body", async () => {
      const file = makeFile();
      mockPresignedSuccess("features/feat-1/ts_abc_photo.jpg", "https://s3.example.com/p");

      await uploadFileToS3(file, { featureId: "feat-1" });

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/upload/image");
      const body = JSON.parse(init?.body as string);
      expect(body.featureId).toBe("feat-1");
      expect(body).not.toHaveProperty("workspaceId");
      expect(body).not.toHaveProperty("taskId");
    });
  });
});
