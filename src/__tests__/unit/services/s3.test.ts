import { describe, it, expect, beforeAll, vi } from "vitest";
import { getS3Service } from "@/services/s3";

describe("S3 Service", () => {
  let s3Service: ReturnType<typeof getS3Service>;

  beforeAll(() => {
    // Mock AWS environment variables for testing
    vi.stubEnv("AWS_ROLE_ARN", "arn:aws:iam::123456789012:role/test-role");
    vi.stubEnv("S3_BUCKET_NAME", "test-bucket");
    vi.stubEnv("AWS_REGION", "us-east-1");
    s3Service = getS3Service();
  });

  describe("validateImageBuffer", () => {
    it("should validate JPEG magic numbers", () => {
      // JPEG magic numbers: FF D8 FF
      const jpegBuffer = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
      ]);

      expect(s3Service.validateImageBuffer(jpegBuffer, "image/jpeg")).toBe(true);
    });

    it("should validate PNG magic numbers", () => {
      // PNG magic numbers: 89 50 4E 47 0D 0A 1A 0A
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]);

      expect(s3Service.validateImageBuffer(pngBuffer, "image/png")).toBe(true);
    });

    it("should validate GIF magic numbers", () => {
      // GIF magic numbers: 47 49 46 38 (GIF8)
      const gifBuffer = Buffer.from([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04,
      ]);

      expect(s3Service.validateImageBuffer(gifBuffer, "image/gif")).toBe(true);
    });

    it("should validate WebP magic numbers", () => {
      // WebP magic numbers: RIFF....WEBP
      const webpBuffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
      ]);

      expect(s3Service.validateImageBuffer(webpBuffer, "image/webp")).toBe(true);
    });

    it("should reject buffer with mismatched MIME type", () => {
      // JPEG magic numbers but claiming to be PNG
      const jpegBuffer = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
      ]);

      expect(s3Service.validateImageBuffer(jpegBuffer, "image/png")).toBe(false);
    });

    it("should reject buffer that is too short", () => {
      const shortBuffer = Buffer.from([0xff, 0xd8]);

      expect(s3Service.validateImageBuffer(shortBuffer, "image/jpeg")).toBe(false);
    });

    it("should reject unsupported MIME type", () => {
      const buffer = Buffer.from([0, 1, 2, 3, 4]);

      expect(s3Service.validateImageBuffer(buffer, "image/svg+xml")).toBe(false);
    });

    it("should handle empty buffer", () => {
      const emptyBuffer = Buffer.from([]);

      expect(s3Service.validateImageBuffer(emptyBuffer, "image/jpeg")).toBe(false);
    });
  });

  describe("validateFileType", () => {
    it("should accept supported image types", () => {
      expect(s3Service.validateFileType("image/jpeg")).toBe(true);
      expect(s3Service.validateFileType("image/png")).toBe(true);
      expect(s3Service.validateFileType("image/gif")).toBe(true);
      expect(s3Service.validateFileType("image/webp")).toBe(true);
    });

    it("should reject unsupported types", () => {
      expect(s3Service.validateFileType("image/svg+xml")).toBe(false);
      expect(s3Service.validateFileType("application/pdf")).toBe(false);
      expect(s3Service.validateFileType("text/plain")).toBe(false);
    });
  });

  describe("validateFileSize", () => {
    it("should accept file size under default limit (10MB)", () => {
      const size = 5 * 1024 * 1024; // 5MB
      expect(s3Service.validateFileSize(size)).toBe(true);
    });

    it("should accept file size exactly at default limit (10MB)", () => {
      const size = 10 * 1024 * 1024; // 10MB
      expect(s3Service.validateFileSize(size)).toBe(true);
    });

    it("should reject file size over default limit (10MB)", () => {
      const size = 11 * 1024 * 1024; // 11MB
      expect(s3Service.validateFileSize(size)).toBe(false);
    });

    it("should accept file size under custom limit", () => {
      const size = 500 * 1024; // 500KB
      const customLimit = 1024 * 1024; // 1MB
      expect(s3Service.validateFileSize(size, customLimit)).toBe(true);
    });

    it("should reject file size over custom limit", () => {
      const size = 2 * 1024 * 1024; // 2MB
      const customLimit = 1024 * 1024; // 1MB
      expect(s3Service.validateFileSize(size, customLimit)).toBe(false);
    });
  });

  describe("generateWorkspaceLogoPath", () => {
    it("should generate valid S3 path for workspace logo", () => {
      const workspaceId = "workspace-123";
      const filename = "logo.png";

      const path = s3Service.generateWorkspaceLogoPath(workspaceId, filename);

      expect(path).toContain("workspace-logos/");
      expect(path).toContain(workspaceId);
      expect(path).toMatch(/\.png$/);
    });

    it("should sanitize filename with special characters", () => {
      const workspaceId = "workspace-123";
      const filename = "my logo!@#$.png";

      const path = s3Service.generateWorkspaceLogoPath(workspaceId, filename);

      expect(path).not.toContain("!");
      expect(path).not.toContain("@");
      expect(path).not.toContain("#");
      expect(path).not.toContain("$");
    });
  });
});
