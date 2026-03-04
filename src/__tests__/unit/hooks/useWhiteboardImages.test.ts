import { describe, it, expect, vi, beforeEach } from "vitest";
import { uploadNewFiles, resolveFilesForDisplay } from "@/hooks/useWhiteboardImages";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";

// Minimal base64 PNG (1x1 transparent pixel)
const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

// Helper to create a BinaryFiles entry with proper branding
function makeFile(
  id: string,
  extra?: Record<string, unknown>
): BinaryFiles[string] {
  return {
    id: id as FileId,
    dataURL: TINY_PNG_DATA_URL as BinaryFiles[string]["dataURL"],
    mimeType: "image/png",
    created: 1000,
    ...extra,
  } as BinaryFiles[string];
}

global.fetch = vi.fn();
global.atob = (str: string) => Buffer.from(str, "base64").toString("binary");

describe("useWhiteboardImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── uploadNewFiles ───────────────────────────────────────────────────────────

  describe("uploadNewFiles", () => {
    it("uploads entries with dataURL and returns them as StoredFileEntry (no dataURL)", async () => {
      vi.mocked(fetch)
        // First call: POST to get presigned upload URL
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            presignedUploadUrl: "https://s3.example.com/upload",
            s3Key: "whiteboards/ws/wb/file-1.png",
          }),
        } as Response)
        // Second call: PUT to S3
        .mockResolvedValueOnce({ ok: true } as Response);

      const files: BinaryFiles = {
        "file-1": makeFile("file-1"),
      };

      const result = await uploadNewFiles("wb-id", files);

      expect(result["file-1"]).toBeDefined();
      expect(result["file-1"].s3Key).toBe("whiteboards/ws/wb/file-1.png");
      expect(result["file-1"].mimeType).toBe("image/png");
      expect(result["file-1"].id).toBe("file-1");
      // Must not contain dataURL
      expect((result["file-1"] as unknown as Record<string, unknown>).dataURL).toBeUndefined();
    });

    it("passes through entries that already have s3Key unchanged", async () => {
      const files: BinaryFiles = {
        "file-already": makeFile("file-already", {
          s3Key: "whiteboards/ws/wb/file-already.png",
        }),
      };

      const result = await uploadNewFiles("wb-id", files);

      expect(fetch).not.toHaveBeenCalled();
      expect(result["file-already"]).toEqual({
        id: "file-already",
        s3Key: "whiteboards/ws/wb/file-already.png",
        mimeType: "image/png",
        created: 1000,
      });
    });

    it("skips entries without a dataURL starting with 'data:'", async () => {
      const files: BinaryFiles = {
        "file-no-url": {
          id: "file-no-url" as FileId,
          dataURL: "" as BinaryFiles[string]["dataURL"],
          mimeType: "image/png",
          created: 1000,
        },
      };

      const result = await uploadNewFiles("wb-id", files);

      expect(fetch).not.toHaveBeenCalled();
      expect(result["file-no-url"]).toBeUndefined();
    });

    it("skips entries when presigned URL fetch fails", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);

      const files: BinaryFiles = {
        "file-fail": makeFile("file-fail"),
      };

      const result = await uploadNewFiles("wb-id", files);

      // File not in result since upload failed
      expect(result["file-fail"]).toBeUndefined();
    });

    it("skips entries when S3 PUT fails", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            presignedUploadUrl: "https://s3.example.com/upload",
            s3Key: "whiteboards/ws/wb/file-put-fail.png",
          }),
        } as Response)
        .mockResolvedValueOnce({ ok: false } as Response);

      const files: BinaryFiles = {
        "file-put-fail": makeFile("file-put-fail"),
      };

      const result = await uploadNewFiles("wb-id", files);
      expect(result["file-put-fail"]).toBeUndefined();
    });

    it("handles multiple files — some new, some already uploaded", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            presignedUploadUrl: "https://s3.example.com/upload-new",
            s3Key: "whiteboards/ws/wb/file-new.png",
          }),
        } as Response)
        .mockResolvedValueOnce({ ok: true } as Response);

      const files: BinaryFiles = {
        "file-new": makeFile("file-new"),
        "file-existing": makeFile("file-existing", {
          mimeType: "image/jpeg",
          s3Key: "whiteboards/ws/wb/file-existing.jpg",
        }),
      };

      const result = await uploadNewFiles("wb-id", files);

      expect(result["file-new"].s3Key).toBe("whiteboards/ws/wb/file-new.png");
      expect(result["file-existing"].s3Key).toBe("whiteboards/ws/wb/file-existing.jpg");
      // Only one POST + one PUT (for the new file)
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  // ─── resolveFilesForDisplay ───────────────────────────────────────────────────

  describe("resolveFilesForDisplay", () => {
    it("returns empty object for empty storedFiles", async () => {
      const result = await resolveFilesForDisplay("wb-id", {});
      expect(result).toEqual({});
      expect(fetch).not.toHaveBeenCalled();
    });

    it("resolves s3Key entries to presigned download URLs", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          "file-s3": {
            presignedDownloadUrl: "https://s3.example.com/download/file-s3",
            mimeType: "image/png",
          },
        }),
      } as Response);

      const storedFiles = {
        "file-s3": {
          id: "file-s3",
          s3Key: "whiteboards/ws/wb/file-s3.png",
          mimeType: "image/png",
          created: 1000,
        },
      };

      const result = await resolveFilesForDisplay("wb-id", storedFiles);

      expect(result["file-s3"]).toBeDefined();
      expect(result["file-s3"].dataURL).toBe("https://s3.example.com/download/file-s3");
      expect(result["file-s3"].mimeType).toBe("image/png");
      expect(result["file-s3"].id).toBe("file-s3");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/whiteboards/wb-id/images?fileIds=file-s3")
      );
    });

    it("passes through legacy entries with dataURL unchanged (no fetch for them)", async () => {
      const storedFiles = {
        "file-legacy": {
          id: "file-legacy",
          dataURL: TINY_PNG_DATA_URL,
          mimeType: "image/png",
          created: 999,
        },
      };

      const result = await resolveFilesForDisplay("wb-id", storedFiles);

      // Legacy entry passes through without hitting the API
      expect(fetch).not.toHaveBeenCalled();
      expect(result["file-legacy"].dataURL).toBe(TINY_PNG_DATA_URL);
      expect(result["file-legacy"].mimeType).toBe("image/png");
    });

    it("handles mixed s3Key and legacy entries correctly", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          "file-s3": {
            presignedDownloadUrl: "https://s3.example.com/download/s3-file",
            mimeType: "image/jpeg",
          },
        }),
      } as Response);

      const storedFiles = {
        "file-s3": {
          id: "file-s3",
          s3Key: "whiteboards/ws/wb/file-s3.jpg",
          mimeType: "image/jpeg",
          created: 2000,
        },
        "file-legacy": {
          id: "file-legacy",
          dataURL: TINY_PNG_DATA_URL,
          mimeType: "image/png",
          created: 1000,
        },
      };

      const result = await resolveFilesForDisplay("wb-id", storedFiles);

      expect(result["file-s3"].dataURL).toBe("https://s3.example.com/download/s3-file");
      expect(result["file-legacy"].dataURL).toBe(TINY_PNG_DATA_URL);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("skips s3 entries whose key is missing/deleted (not in API response)", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}), // empty — S3 key not found
      } as Response);

      const storedFiles = {
        "file-missing": {
          id: "file-missing",
          s3Key: "whiteboards/ws/wb/file-missing.png",
          mimeType: "image/png",
          created: 1000,
        },
      };

      const result = await resolveFilesForDisplay("wb-id", storedFiles);
      // Should not crash; entry simply absent from result
      expect(result["file-missing"]).toBeUndefined();
    });

    it("returns legacy entries even when API fetch fails", async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

      const storedFiles = {
        "file-s3": {
          id: "file-s3",
          s3Key: "whiteboards/ws/wb/file-s3.png",
          mimeType: "image/png",
          created: 1000,
        },
        "file-legacy": {
          id: "file-legacy",
          dataURL: TINY_PNG_DATA_URL,
          mimeType: "image/png",
          created: 999,
        },
      };

      // Should not throw
      const result = await resolveFilesForDisplay("wb-id", storedFiles);
      // Legacy entry still present
      expect(result["file-legacy"].dataURL).toBe(TINY_PNG_DATA_URL);
      // S3 entry absent due to fetch failure
      expect(result["file-s3"]).toBeUndefined();
    });

    it("batches all s3 fileIds into a single API call", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          "file-a": { presignedDownloadUrl: "https://s3.example.com/a", mimeType: "image/png" },
          "file-b": { presignedDownloadUrl: "https://s3.example.com/b", mimeType: "image/jpeg" },
        }),
      } as Response);

      const storedFiles = {
        "file-a": { id: "file-a", s3Key: "wb/file-a.png", mimeType: "image/png", created: 1 },
        "file-b": { id: "file-b", s3Key: "wb/file-b.jpg", mimeType: "image/jpeg", created: 2 },
      };

      await resolveFilesForDisplay("wb-id", storedFiles);

      // Only one fetch call for both files
      expect(fetch).toHaveBeenCalledTimes(1);
      const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(calledUrl).toContain("file-a");
      expect(calledUrl).toContain("file-b");
    });
  });
});
