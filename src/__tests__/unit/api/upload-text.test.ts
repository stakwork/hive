import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockGetObject = vi.fn();
vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(() => ({ getObject: mockGetObject })),
}));

const mockCanReadKey = vi.fn();
vi.mock("@/lib/ai/resolveMessageAttachments", () => ({
  canReadKey: (key: string, userId: string) => mockCanReadKey(key, userId),
}));

const mockRequireAuth = vi.fn();
vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({})),
  requireAuth: (ctx: unknown) => mockRequireAuth(ctx),
}));

import { GET } from "@/app/api/upload/text/route";

const KEY = "uploads/ws-1/canvas/1793047587113_bpdfbe47e1w_transcript-1.txt";

function get(s3Key?: string): Promise<Response> {
  const url = new URL("http://localhost/api/upload/text");
  if (s3Key !== undefined) url.searchParams.set("s3Key", s3Key);
  return GET(new NextRequest(url));
}

describe("GET /api/upload/text", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue({ id: "user-1", email: "u@test.com", name: "User" });
    mockCanReadKey.mockResolvedValue(true);
    mockGetObject.mockResolvedValue(Buffer.from("Call transcript\n[14:03] Alice: make the button blue", "utf8"));
  });

  it("returns a readable text file's contents as JSON", async () => {
    const res = await get(KEY);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      text: "Call transcript\n[14:03] Alice: make the button blue",
      truncated: false,
    });
    expect(mockCanReadKey).toHaveBeenCalledWith(KEY, "user-1");
    expect(mockGetObject).toHaveBeenCalledWith(KEY);
  });

  it("requires a session", async () => {
    mockRequireAuth.mockReturnValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const res = await get(KEY);
    expect(res.status).toBe(401);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it("is a 404 for a key the caller cannot read, and reads nothing", async () => {
    mockCanReadKey.mockResolvedValue(false);
    const res = await get(KEY);
    expect(res.status).toBe(404);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it("refuses a file that is not text", async () => {
    const res = await get("uploads/ws-1/canvas/123_abc_photo.png");
    expect(res.status).toBe(415);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it("requires s3Key", async () => {
    const res = await get();
    expect(res.status).toBe(400);
  });

  it("cuts a very long file and says so", async () => {
    mockGetObject.mockResolvedValue(Buffer.from("x".repeat(200_001), "utf8"));
    const body = await (await get(KEY)).json();
    expect(body.truncated).toBe(true);
    expect(body.text).toHaveLength(200_000);
  });

  it("answers 500 when S3 fails", async () => {
    mockGetObject.mockRejectedValue(new Error("NoSuchKey"));
    const res = await get(KEY);
    expect(res.status).toBe(500);
  });
});
