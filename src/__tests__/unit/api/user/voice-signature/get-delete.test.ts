import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, DELETE } from "@/app/api/user/voice-signature/route";
import { NextRequest } from "next/server";
import * as auth from "next-auth";
import { db } from "@/lib/db";

vi.mock("next-auth");
vi.mock("@/lib/db", () => ({
  db: {
    voiceSignature: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe("GET /api/user/voice-signature", () => {
  const mockUserId = "user-123";
  const mockSession = {
    user: {
      id: mockUserId,
      email: "test@example.com",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 if user is not authenticated", async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/user/voice-signature");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("should return exists: false if user has no voice signature", async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue(mockSession as any);
    vi.mocked(db.voiceSignature.findUnique).mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/user/voice-signature");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.exists).toBe(false);
    expect(data.sampleCount).toBe(0);
    expect(data.lastUpdatedAt).toBe(null);
  });

  it("should return voice signature metadata without embedding data", async () => {
    const mockDate = new Date();
    vi.mocked(auth.getServerSession).mockResolvedValue(mockSession as any);
    vi.mocked(db.voiceSignature.findUnique).mockResolvedValue({
      id: "vs-123",
      sampleCount: 5,
      lastUpdatedAt: mockDate,
      createdAt: mockDate,
    } as any);

    const request = new NextRequest("http://localhost:3000/api/user/voice-signature");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.exists).toBe(true);
    expect(data.sampleCount).toBe(5);
    expect(new Date(data.lastUpdatedAt)).toEqual(mockDate);
    expect(data.voiceEmbedding).toBeUndefined();
  });

  it("should handle database errors gracefully", async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue(mockSession as any);
    vi.mocked(db.voiceSignature.findUnique).mockRejectedValue(
      new Error("Database error")
    );

    const request = new NextRequest("http://localhost:3000/api/user/voice-signature");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to fetch voice signature");
  });
});

describe("DELETE /api/user/voice-signature", () => {
  const mockUserId = "user-123";
  const mockSession = {
    user: {
      id: mockUserId,
      email: "test@example.com",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 if user is not authenticated", async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/user/voice-signature", {
      method: "DELETE",
    });
    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("should successfully delete voice signature", async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue(mockSession as any);
    vi.mocked(db.voiceSignature.delete).mockResolvedValue({} as any);

    const request = new NextRequest("http://localhost:3000/api/user/voice-signature", {
      method: "DELETE",
    });
    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toBe("Voice signature deleted successfully");
    expect(db.voiceSignature.delete).toHaveBeenCalledWith({
      where: { userId: mockUserId },
    });
  });

  it("should return 404 if voice signature does not exist", async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue(mockSession as any);
    vi.mocked(db.voiceSignature.delete).mockRejectedValue({
      code: "P2025",
      message: "Record not found",
    });

    const request = new NextRequest("http://localhost:3000/api/user/voice-signature", {
      method: "DELETE",
    });
    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Voice signature not found");
  });

  it("should handle other database errors", async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue(mockSession as any);
    vi.mocked(db.voiceSignature.delete).mockRejectedValue(
      new Error("Database error")
    );

    const request = new NextRequest("http://localhost:3000/api/user/voice-signature", {
      method: "DELETE",
    });
    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to delete voice signature");
  });
});
