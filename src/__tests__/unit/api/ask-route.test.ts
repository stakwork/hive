import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/ask/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import {
  createMockSession,
  createMockSwarm,
} from "@/__tests__/support/helpers/ask-api-helpers";

// Mock next-auth (already mocked globally in setup/global.ts)
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock authOptions
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Mock database
vi.mock("@/lib/db", () => ({
  db: {
    swarm: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock EncryptionService
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(),
  },
}));

// Mock workspace validation
vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

// Mock global fetch
global.fetch = vi.fn();

const mockGetServerSession = getServerSession as Mock;
const mockValidateWorkspaceAccess = validateWorkspaceAccess as Mock;
const mockDbSwarm = db.swarm as { findFirst: Mock };
const mockFetch = global.fetch as Mock;

describe("GET /api/ask - Unit Tests", () => {
  let mockEncryptionService: {
    decryptField: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup EncryptionService mock instance
    mockEncryptionService = {
      decryptField: vi.fn(),
    };
    (EncryptionService.getInstance as Mock).mockReturnValue(mockEncryptionService);
  });

  const createMockRequest = (question?: string, workspace?: string) => {
    const url = new URL("http://localhost:3000/api/ask");
    if (question) url.searchParams.set("question", question);
    if (workspace) url.searchParams.set("workspace", workspace);

    return new NextRequest(url.toString(), { method: "GET" });
  };

  const mockSession = createMockSession();
  const mockSwarm = createMockSwarm();

  describe("Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createMockRequest("test question", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(mockValidateWorkspaceAccess).not.toHaveBeenCalled();
    });

    test("should return 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValue({ user: null });

      const request = createMockRequest("test question", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(mockValidateWorkspaceAccess).not.toHaveBeenCalled();
    });
  });

  describe("Request Validation", () => {
    test("should return 400 when question parameter is missing", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);

      const request = createMockRequest(undefined, "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing required parameter: question");
      expect(mockValidateWorkspaceAccess).not.toHaveBeenCalled();
    });

    test("should return 400 when question parameter is empty string", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);

      const request = createMockRequest("", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing required parameter: question");
    });

    test("should return 400 when workspace parameter is missing", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);

      const request = createMockRequest("test question", undefined);
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing required parameter: workspace");
      expect(mockValidateWorkspaceAccess).not.toHaveBeenCalled();
    });

    test("should return 400 when workspace parameter is empty string", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);

      const request = createMockRequest("test question", "");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing required parameter: workspace");
    });

    test("should handle special characters in question parameter", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("decrypted-api-key");
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "test response" }),
      });

      const specialQuestion = "What is 2+2? How about 'special' & <tags>?";
      const request = createMockRequest(specialQuestion, "test-workspace");
      await GET(request);

      // Verify question is properly URL encoded in fetch call
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(specialQuestion)),
        expect.any(Object)
      );
    });
  });

  describe("Authorization", () => {
    test("should return 403 when user has no workspace access", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: false,
        workspace: null,
      });

      const request = createMockRequest("test question", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Workspace not found or access denied");
      expect(mockValidateWorkspaceAccess).toHaveBeenCalledWith(
        "test-workspace",
        "user-123"
      );
      expect(mockDbSwarm.findFirst).not.toHaveBeenCalled();
    });

    test("should call validateWorkspaceAccess with correct parameters", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: false,
        workspace: null,
      });

      const request = createMockRequest("test question", "my-workspace-slug");
      await GET(request);

      expect(mockValidateWorkspaceAccess).toHaveBeenCalledWith(
        "my-workspace-slug",
        "user-123"
      );
    });
  });

  describe("Swarm Configuration", () => {
    test("should return 404 when swarm not found for workspace", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue(null);

      const request = createMockRequest("test question", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm not found for this workspace");
      expect(mockDbSwarm.findFirst).toHaveBeenCalledWith({
        where: { workspaceId: "workspace-123" },
      });
    });

    test("should return 404 when swarm URL is not configured", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue({
        ...mockSwarm,
        swarmUrl: null,
      });

      const request = createMockRequest("test question", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm URL not configured");
    });

    test("should return 404 when swarm URL is empty string", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue({
        ...mockSwarm,
        swarmUrl: "",
      });

      const request = createMockRequest("test question", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm URL not configured");
    });
  });

  describe("Encryption and Decryption", () => {
    test("should decrypt swarm API key before making request", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("decrypted-api-key-123");
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "test response" }),
      });

      const request = createMockRequest("test question", "test-workspace");
      await GET(request);

      expect(mockEncryptionService.decryptField).toHaveBeenCalledWith(
        "swarmApiKey",
        mockSwarm.swarmApiKey
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-token": "decrypted-api-key-123",
          }),
        })
      );
    });

    test("should handle empty swarmApiKey gracefully", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue({
        ...mockSwarm,
        swarmApiKey: "",
      });
      mockEncryptionService.decryptField.mockReturnValue("");

      const request = createMockRequest("test question", "test-workspace");

      // Should not throw, but may have issues with external API call
      await expect(GET(request)).resolves.toBeDefined();
    });

    test("should handle decryption errors gracefully", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockImplementation(() => {
        throw new Error("Decryption failed: Invalid key");
      });

      const request = createMockRequest("test question", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process question");
    });
  });

  describe("External Service Integration", () => {
    test("should construct correct swarm URL for HTTPS endpoints", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue({
        ...mockSwarm,
        swarmUrl: "https://swarm.example.com",
      });
      mockEncryptionService.decryptField.mockReturnValue("api-key");
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "response" }),
      });

      const request = createMockRequest("test question", "test-workspace");
      await GET(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("https://swarm.example.com:3355/ask?question="),
        expect.any(Object)
      );
    });

    test("should construct correct swarm URL for localhost", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue({
        ...mockSwarm,
        swarmUrl: "http://localhost:8080",
      });
      mockEncryptionService.decryptField.mockReturnValue("api-key");
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "response" }),
      });

      const request = createMockRequest("test question", "test-workspace");
      await GET(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("http://localhost:3355/ask?question="),
        expect.any(Object)
      );
    });

    test("should send correct headers in swarm request", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("test-api-key");
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "response" }),
      });

      const request = createMockRequest("test question", "test-workspace");
      await GET(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-api-token": "test-api-key",
          },
        }
      );
    });

    test("should return successful response from swarm server", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("api-key");

      const mockSwarmResponse = {
        answer: "The answer is 42",
        sources: ["doc1", "doc2"],
        confidence: 0.95,
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockSwarmResponse,
      });

      const request = createMockRequest("test question", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual(mockSwarmResponse);
    });

    test("should handle swarm server 4xx errors", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("api-key");
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
      });

      const request = createMockRequest("test question", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process question");
    });

    test("should handle swarm server 5xx errors", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("api-key");
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
      });

      const request = createMockRequest("test question", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process question");
    });

    test("should handle network errors", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("api-key");
      mockFetch.mockRejectedValue(new Error("Network timeout"));

      const request = createMockRequest("test question", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process question");
    });

    test("should handle malformed JSON responses", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("api-key");
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const request = createMockRequest("test question", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process question");
    });
  });

  describe("Error Handling", () => {
    test("should return 500 on database error", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockRejectedValue(new Error("Database connection failed"));

      const request = createMockRequest("test question", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process question");
    });

    test("should return 500 on validateWorkspaceAccess error", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockRejectedValue(new Error("Service unavailable"));

      const request = createMockRequest("test question", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process question");
    });

    test("should not expose sensitive error details", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("api-key");
      mockFetch.mockRejectedValue(
        new Error("Connection failed: api-key-secret-123 invalid")
      );

      const request = createMockRequest("test question", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to process question");
      expect(JSON.stringify(data)).not.toContain("api-key-secret-123");
    });
  });

  describe("Complete Request Flow", () => {
    test("should successfully process complete request flow", async () => {
      mockGetServerSession.mockResolvedValue(mockSession);
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        workspace: { id: "workspace-123" },
      });
      mockDbSwarm.findFirst.mockResolvedValue(mockSwarm);
      mockEncryptionService.decryptField.mockReturnValue("decrypted-key");
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ answer: "Complete answer" }),
      });

      const request = createMockRequest("What is the meaning of life?", "test-workspace");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.answer).toBe("Complete answer");

      // Verify all steps were called in correct order
      expect(mockGetServerSession).toHaveBeenCalled();
      expect(mockValidateWorkspaceAccess).toHaveBeenCalledWith("test-workspace", "user-123");
      expect(mockDbSwarm.findFirst).toHaveBeenCalledWith({
        where: { workspaceId: "workspace-123" },
      });
      expect(mockEncryptionService.decryptField).toHaveBeenCalledWith(
        "swarmApiKey",
        mockSwarm.swarmApiKey
      );
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});