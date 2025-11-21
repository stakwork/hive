import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";
import {
  resizeWorkspaceLogo,
  isSupportedImageType,
  getImageExtensionFromMimeType,
  validateImageSize,
} from "@/lib/image-processing";

describe("Image Processing Utilities", () => {
  describe("resizeWorkspaceLogo", () => {
    it("should resize and optimize a JPEG image to fit within 1200x400", async () => {
      const testImage = await sharp({
        create: {
          width: 2400,
          height: 800,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .jpeg()
        .toBuffer();

      const result = await resizeWorkspaceLogo(testImage);

      expect(result.contentType).toBe("image/jpeg");
      expect(result.width).toBeLessThanOrEqual(1200);
      expect(result.height).toBeLessThanOrEqual(400);
      expect(result.size).toBeGreaterThan(0);
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it("should resize a PNG image and convert to JPEG", async () => {
      const testImage = await sharp({
        create: {
          width: 1600,
          height: 600,
          channels: 4,
          background: { r: 0, g: 255, b: 0, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const result = await resizeWorkspaceLogo(testImage);

      expect(result.contentType).toBe("image/jpeg");
      expect(result.width).toBeLessThanOrEqual(1200);
      expect(result.height).toBeLessThanOrEqual(400);
    });

    it("should not enlarge small images", async () => {
      const testImage = await sharp({
        create: {
          width: 800,
          height: 200,
          channels: 3,
          background: { r: 0, g: 0, b: 255 },
        },
      })
        .jpeg()
        .toBuffer();

      const result = await resizeWorkspaceLogo(testImage);

      expect(result.width).toBeLessThanOrEqual(800);
      expect(result.height).toBeLessThanOrEqual(200);
    });

    it("should maintain aspect ratio when resizing", async () => {
      const testImage = await sharp({
        create: {
          width: 2400,
          height: 800,
          channels: 3,
          background: { r: 128, g: 128, b: 128 },
        },
      })
        .jpeg()
        .toBuffer();

      const result = await resizeWorkspaceLogo(testImage);

      const aspectRatio = result.width / result.height;
      expect(aspectRatio).toBeCloseTo(3, 1);
    });

    it("should throw error for corrupt image data", async () => {
      const corruptBuffer = Buffer.from("not an image");

      await expect(resizeWorkspaceLogo(corruptBuffer)).rejects.toThrow();
    });

    it("should handle WebP images", async () => {
      const testImage = await sharp({
        create: {
          width: 1200,
          height: 400,
          channels: 3,
          background: { r: 255, g: 255, b: 0 },
        },
      })
        .webp()
        .toBuffer();

      const result = await resizeWorkspaceLogo(testImage);

      expect(result.contentType).toBe("image/jpeg");
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it("should throw error for unsupported image format", async () => {
      const testImage = Buffer.from('<?xml version="1.0"?><svg></svg>');

      await expect(resizeWorkspaceLogo(testImage)).rejects.toThrow();
    });
  });

  describe("isSupportedImageType", () => {
    it("should return true for supported MIME types", () => {
      expect(isSupportedImageType("image/jpeg")).toBe(true);
      expect(isSupportedImageType("image/png")).toBe(true);
      expect(isSupportedImageType("image/gif")).toBe(true);
      expect(isSupportedImageType("image/webp")).toBe(true);
    });

    it("should return false for unsupported MIME types", () => {
      expect(isSupportedImageType("image/svg+xml")).toBe(false);
      expect(isSupportedImageType("image/bmp")).toBe(false);
      expect(isSupportedImageType("application/pdf")).toBe(false);
      expect(isSupportedImageType("text/plain")).toBe(false);
    });

    it("should handle empty string", () => {
      expect(isSupportedImageType("")).toBe(false);
    });
  });

  describe("getImageExtensionFromMimeType", () => {
    it("should extract extension from JPEG MIME type", () => {
      expect(getImageExtensionFromMimeType("image/jpeg")).toBe("jpeg");
    });

    it("should extract extension from PNG MIME type", () => {
      expect(getImageExtensionFromMimeType("image/png")).toBe("png");
    });

    it("should extract extension from GIF MIME type", () => {
      expect(getImageExtensionFromMimeType("image/gif")).toBe("gif");
    });

    it("should extract extension from WebP MIME type", () => {
      expect(getImageExtensionFromMimeType("image/webp")).toBe("webp");
    });

    it("should throw error for invalid MIME type", () => {
      expect(() => getImageExtensionFromMimeType("invalid")).toThrow("Invalid MIME type: invalid");
    });

    it("should throw error for empty MIME type", () => {
      expect(() => getImageExtensionFromMimeType("")).toThrow();
    });
  });

  describe("validateImageSize", () => {
    it("should accept file size under 1MB default limit", () => {
      const size = 500 * 1024; // 500KB

      expect(validateImageSize(size)).toBe(true);
    });

    it("should accept file size exactly at 1MB default limit", () => {
      const size = 1024 * 1024; // 1MB

      expect(validateImageSize(size)).toBe(true);
    });

    it("should reject file size over 1MB default limit", () => {
      const size = 2 * 1024 * 1024; // 2MB

      expect(validateImageSize(size)).toBe(false);
    });

    it("should accept file size under custom limit", () => {
      const size = 5 * 1024 * 1024; // 5MB
      const customLimit = 10 * 1024 * 1024; // 10MB

      expect(validateImageSize(size, customLimit)).toBe(true);
    });

    it("should reject file size over custom limit", () => {
      const size = 15 * 1024 * 1024; // 15MB
      const customLimit = 10 * 1024 * 1024; // 10MB

      expect(validateImageSize(size, customLimit)).toBe(false);
    });

    it("should reject zero byte file", () => {
      expect(validateImageSize(0)).toBe(false);
    });

    it("should reject negative file size", () => {
      expect(validateImageSize(-1)).toBe(false);
    });

    it("should accept very small file", () => {
      const size = 1; // 1 byte

      expect(validateImageSize(size)).toBe(true);
    });
  });
});
