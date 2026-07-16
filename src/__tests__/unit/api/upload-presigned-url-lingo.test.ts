/**
 * Unit tests for POST /api/upload/presigned-url — lingo context branch
 *
 * Focuses on file validation (400 for disallowed MIME / oversized) and correct
 * dispatch to generateLingoIconPath when context === "lingo".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGenerateLingoIconPath = vi.fn(() => "uploads/ws-1/lingo-icons/ts_abc_logo.png");
const mockGenerateCanvasUploadPath = vi.fn(() => "uploads/ws-1/canvas/ts_abc_logo.png");
const mockGeneratePresignedUploadUrl = vi.fn(async () => "https://s3.example.com/presigned");
const mockValidateFileType = vi.fn(() => true);
const mockValidateFileSize = vi.fn(() => true);

vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => ({
    validateFileType: mockValidateFileType,
    validateFileSize: mockValidateFileSize,
    generateLingoIconPath: mockGenerateLingoIconPath,
    generateCanvasUploadPath: mockGenerateCanvasUploadPath,
    generatePresignedUploadUrl: mockGeneratePresignedUploadUrl,
  })),
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccessById: vi.fn(async () => ({ hasAccess: true, canRead: true, canWrite: true })),
  validateUserBelongsToOrg: vi.fn(async () => true),
}));

vi.mock("@/lib/db", () => ({
  db: {},
}));

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({})),
  requireAuth: vi.fn(() => ({ id: "user-1", email: "u@test.com", name: "User" })),
}));

import { POST } from "@/app/api/upload/presigned-url/route";

function makePostRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/upload/presigned-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/upload/presigned-url — lingo branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateFileType.mockReturnValue(true);
    mockValidateFileSize.mockReturnValue(true);
    mockGeneratePresignedUploadUrl.mockResolvedValue("https://s3.example.com/presigned");
    mockGenerateLingoIconPath.mockReturnValue("uploads/ws-1/lingo-icons/ts_abc_logo.png");
    mockGenerateCanvasUploadPath.mockReturnValue("uploads/ws-1/canvas/ts_abc_logo.png");
  });

  it("returns 400 for disallowed MIME type", async () => {
    mockValidateFileType.mockReturnValue(false);

    const response = await POST(
      makePostRequest({
        workspaceId: "ws-1",
        filename: "file.pdf",
        contentType: "application/pdf",
        size: 1024,
        context: "lingo",
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/invalid file type/i);
    expect(mockGeneratePresignedUploadUrl).not.toHaveBeenCalled();
  });

  it("returns 400 for oversized file", async () => {
    mockValidateFileType.mockReturnValue(true);
    mockValidateFileSize.mockReturnValue(false);

    const response = await POST(
      makePostRequest({
        workspaceId: "ws-1",
        filename: "large.jpg",
        contentType: "image/jpeg",
        size: 11 * 1024 * 1024,
        context: "lingo",
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/10mb/i);
    expect(mockGeneratePresignedUploadUrl).not.toHaveBeenCalled();
  });

  it("calls generateLingoIconPath when context is lingo", async () => {
    const response = await POST(
      makePostRequest({
        workspaceId: "ws-1",
        filename: "logo.png",
        contentType: "image/png",
        size: 1024,
        context: "lingo",
      }),
    );

    expect(response.status).toBe(200);
    expect(mockGenerateLingoIconPath).toHaveBeenCalledWith("ws-1", "logo.png");
    expect(mockGenerateCanvasUploadPath).not.toHaveBeenCalled();

    const body = await response.json();
    expect(body.s3Path).toBe("uploads/ws-1/lingo-icons/ts_abc_logo.png");
  });

  it("falls back to generateCanvasUploadPath when no context is provided", async () => {
    const response = await POST(
      makePostRequest({
        workspaceId: "ws-1",
        filename: "photo.jpg",
        contentType: "image/jpeg",
        size: 2048,
      }),
    );

    expect(response.status).toBe(200);
    expect(mockGenerateCanvasUploadPath).toHaveBeenCalledWith("ws-1", "photo.jpg");
    expect(mockGenerateLingoIconPath).not.toHaveBeenCalled();

    const body = await response.json();
    expect(body.s3Path).toBe("uploads/ws-1/canvas/ts_abc_logo.png");
  });

  it("returns presignedUrl and s3Path on success", async () => {
    const response = await POST(
      makePostRequest({
        workspaceId: "ws-1",
        filename: "icon.webp",
        contentType: "image/webp",
        size: 512,
        context: "lingo",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.presignedUrl).toBe("https://s3.example.com/presigned");
    expect(body.s3Path).toContain("uploads/ws-1/lingo-icons/");
  });
});
