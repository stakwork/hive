import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/user/voice-signature/enroll/route";
import { NextRequest } from "next/server";
import * as auth from "next-auth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

vi.mock("next-auth");
vi.mock("@/lib/db", () => ({
  db: {
    voiceSignature: {
      upsert: vi.fn(),
    },
  },
}));
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      encryptField: vi.fn(),
    })),
  },
}));

describe("POST /api/user/voice-signature/enroll", () => {
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

    const request = new NextRequest("http://localhost:3000/api/user/voice-signature/enroll", {
      method: "POST",
      body: JSON.stringify({ audioBlob: "base64data" }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("should return 400 if neither audioBlob nor callRefId is provided", async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue(mockSession as any);

    const request = new NextRequest("http://localhost:3000/api/user/voice-signature/enroll", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Either audioBlob or callRefId must be provided");
  });

  it("should return 400 if callRefId is provided without timestamps", async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue(mockSession as any);

    const request = new NextRequest("http://localhost:3000/api/user/voice-signature/enroll", {
      method: "POST",
      body: JSON.stringify({ callRefId: "call-123" }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("startTimestamp and endTimestamp are required when using callRefId");
  });

  it("should successfully enroll voice signature with audio blob", async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue(mockSession as any);
    
    const mockEncryptedData = {
      data: "encrypted",
      iv: "iv",
      tag: "tag",
      version: "1",
      encryptedAt: new Date().toISOString(),
    };
    const mockEncryptionService = {
      encryptField: vi.fn().mockReturnValue(mockEncryptedData),
    };
    vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);
    
    const mockVoiceSignature = {
      id: "vs-123",
      userId: mockUserId,
      voiceEmbedding: JSON.stringify(mockEncryptedData),
      sampleCount: 1,
      lastUpdatedAt: new Date(),
      createdAt: new Date(),
    };

    vi.mocked(db.voiceSignature.upsert).mockResolvedValue(mockVoiceSignature as any);

    const request = new NextRequest("http://localhost:3000/api/user/voice-signature/enroll", {
      method: "POST",
      body: JSON.stringify({ audioBlob: "base64audiodata" }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.voiceSignature).toMatchObject({
      id: mockVoiceSignature.id,
      sampleCount: mockVoiceSignature.sampleCount,
    });
    expect(mockEncryptionService.encryptField).toHaveBeenCalledWith(
      "voiceEmbedding",
      expect.any(String)
    );
  });

  it("should successfully enroll voice signature with callRefId and timestamps", async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue(mockSession as any);
    
    const mockEncryptedData = {
      data: "encrypted",
      iv: "iv",
      tag: "tag",
      version: "1",
      encryptedAt: new Date().toISOString(),
    };
    const mockEncryptionService = {
      encryptField: vi.fn().mockReturnValue(mockEncryptedData),
    };
    vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);
    
    const mockVoiceSignature = {
      id: "vs-123",
      userId: mockUserId,
      voiceEmbedding: JSON.stringify(mockEncryptedData),
      sampleCount: 1,
      lastUpdatedAt: new Date(),
      createdAt: new Date(),
    };

    vi.mocked(db.voiceSignature.upsert).mockResolvedValue(mockVoiceSignature as any);

    const request = new NextRequest("http://localhost:3000/api/user/voice-signature/enroll", {
      method: "POST",
      body: JSON.stringify({
        callRefId: "call-123",
        startTimestamp: 0,
        endTimestamp: 30000,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.voiceSignature.sampleCount).toBe(1);
  });

  it("should increment sample count on subsequent enrollments", async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue(mockSession as any);
    
    const mockEncryptedData = {
      data: "encrypted",
      iv: "iv",
      tag: "tag",
      version: "1",
      encryptedAt: new Date().toISOString(),
    };
    const mockEncryptionService = {
      encryptField: vi.fn().mockReturnValue(mockEncryptedData),
    };
    vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);
    
    const mockVoiceSignature = {
      id: "vs-123",
      userId: mockUserId,
      voiceEmbedding: JSON.stringify(mockEncryptedData),
      sampleCount: 3,
      lastUpdatedAt: new Date(),
      createdAt: new Date(),
    };

    vi.mocked(db.voiceSignature.upsert).mockResolvedValue(mockVoiceSignature as any);

    const request = new NextRequest("http://localhost:3000/api/user/voice-signature/enroll", {
      method: "POST",
      body: JSON.stringify({ audioBlob: "base64audiodata" }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.voiceSignature.sampleCount).toBe(3);
  });

  it("should handle encryption errors", async () => {
    vi.mocked(auth.getServerSession).mockResolvedValue(mockSession as any);
    
    const mockEncryptionService = {
      encryptField: vi.fn().mockImplementation(() => {
        throw new Error("Encryption failed");
      }),
    };
    vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService as any);

    const request = new NextRequest("http://localhost:3000/api/user/voice-signature/enroll", {
      method: "POST",
      body: JSON.stringify({ audioBlob: "base64audiodata" }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to enroll voice signature");
  });
});
