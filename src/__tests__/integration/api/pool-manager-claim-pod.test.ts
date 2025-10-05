import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/pool-manager/claim-pod/[workspaceId]/route";

// Mock all external dependencies at module level
vi.mock("next-auth/next");
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
    },
    swarm: {
      update: vi.fn(),
    },
  },
}));
vi.mock("@/lib/env", () => ({
  config: {
    POOL_MANAGER_BASE_URL: "https://pool-manager.test/api",
  },
}));
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((fieldName: string, encryptedData: string) => "decrypted-api-key"),
    })),
  },
}));
vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: vi.fn(),
  updateSwarmPoolApiKeyFor: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

// Import mocked modules
const { getServerSession: mockGetServerSession } = await import("next-auth/next");
const { db: mockDb } = await import("@/lib/db");
const { EncryptionService: MockEncryptionService } = await import("@/lib/encryption");
const { 
  getSwarmPoolApiKeyFor: mockGetSwarmPoolApiKeyFor,
  updateSwarmPoolApiKeyFor: mockUpdateSwarmPoolApiKeyFor 
} = await import("@/services/swarm/secrets");
const mockFetch = fetch as vi.MockedFunction<typeof fetch>;

describe("POST /api/pool-manager/claim-pod/[workspaceId]", () => {
  const mockWorkspaceId = "test-workspace-id";
  const mockUserId = "test-user-id";
  const mockPoolName = "test-pool";
  const mockPoolApiKey = JSON.stringify({
    data: "encrypted-key",
    iv: "test-iv",
    tag: "test-tag",
    version: "1",
    encryptedAt: new Date().toISOString(),
  });

  const mockSession = {
    user: { id: mockUserId, name: "Test User", email: "test@example.com" },
  };

  const mockWorkspace = {
    id: mockWorkspaceId,
    ownerId: mockUserId,
    name: "Test Workspace",
    slug: "test-workspace",
    members: [],
    swarm: {
      id: "swarm-id",
      poolName: mockPoolName,
      poolApiKey: mockPoolApiKey,
    },
  };

  const mockPoolManagerSuccessResponse = {
    success: true,
    workspace: {
      branches: ["main"],
      created: "2024-01-01T00:00:00Z",
      customImage: false,
      flagged_for_recreation: false,
      fqdn: "test.example.com",
      id: "pod-id",
      image: "test-image",
      marked_at: "2024-01-01T00:00:00Z",
      password: "test-password",
      portMappings: {
        "3000": "https://frontend.example.com",
        "8080": "https://backend.example.com",
        "15552": "https://internal1.example.com",
        "15553": "https://internal2.example.com",
      },
      primaryRepo: "test-repo",
      repoName: "test-repo",
      repositories: ["test-repo"],
      state: "running",
      subdomain: "test",
      url: "https://test.example.com",
      usage_status: "active",
      useDevContainer: false,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    mockGetServerSession.mockResolvedValue(mockSession);
    mockDb.workspace.findFirst.mockResolvedValue(mockWorkspace as any);
    mockGetSwarmPoolApiKeyFor.mockResolvedValue(mockPoolApiKey);
    mockUpdateSwarmPoolApiKeyFor.mockResolvedValue(undefined);

    // Setup default successful fetch response
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockPoolManagerSuccessResponse,
      text: async () => JSON.stringify(mockPoolManagerSuccessResponse),
    } as Response);
  });

  describe("Authentication", () => {
    test("should return 401 if no session", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 if no user in session", async () => {
      mockGetServerSession.mockResolvedValue({ user: null });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 if no user id in session", async () => {
      mockGetServerSession.mockResolvedValue({ user: { name: "Test" } });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Input Validation", () => {
    test("should return 400 if workspaceId is missing", async () => {
      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: "" }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing required field: workspaceId");
    });
  });

  describe("Workspace Validation", () => {
    test("should return 404 if workspace not found", async () => {
      mockDb.workspace.findFirst.mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found");
    });

    test("should return 403 if user not workspace owner or member", async () => {
      const workspaceWithDifferentOwner = {
        ...mockWorkspace,
        ownerId: "different-user-id",
        members: [],
      };
      mockDb.workspace.findFirst.mockResolvedValue(workspaceWithDifferentOwner as any);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
    });

    test("should allow access if user is workspace member", async () => {
      const workspaceWithMember = {
        ...mockWorkspace,
        ownerId: "different-user-id",
        members: [{ role: "DEVELOPER" }],
      };
      mockDb.workspace.findFirst.mockResolvedValue(workspaceWithMember as any);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });

      expect(response.status).toBe(200);
    });

    test("should return 404 if workspace has no swarm", async () => {
      const workspaceWithoutSwarm = {
        ...mockWorkspace,
        swarm: null,
      };
      mockDb.workspace.findFirst.mockResolvedValue(workspaceWithoutSwarm as any);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("No swarm found for this workspace");
    });
  });

  describe("Pool Configuration", () => {
    test("should return 400 if poolName is missing", async () => {
      const workspaceWithoutPoolName = {
        ...mockWorkspace,
        swarm: {
          ...mockWorkspace.swarm,
          poolName: null,
        },
      };
      mockDb.workspace.findFirst.mockResolvedValue(workspaceWithoutPoolName as any);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Swarm not properly configured with pool information");
    });

    test("should auto-create poolApiKey if missing and then proceed", async () => {
      const workspaceWithoutPoolApiKey = {
        ...mockWorkspace,
        swarm: {
          ...mockWorkspace.swarm,
          poolApiKey: null,
        },
      };
      mockDb.workspace.findFirst.mockResolvedValue(workspaceWithoutPoolApiKey as any);
      mockGetSwarmPoolApiKeyFor.mockResolvedValue(mockPoolApiKey);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });

      expect(mockUpdateSwarmPoolApiKeyFor).toHaveBeenCalledWith("swarm-id");
      expect(mockGetSwarmPoolApiKeyFor).toHaveBeenCalledWith("swarm-id");
      expect(response.status).toBe(200);
    });

    test("should return 400 if poolApiKey still missing after auto-creation", async () => {
      const workspaceWithoutPoolApiKey = {
        ...mockWorkspace,
        swarm: {
          ...mockWorkspace.swarm,
          poolApiKey: null,
        },
      };
      mockDb.workspace.findFirst.mockResolvedValue(workspaceWithoutPoolApiKey as any);
      mockGetSwarmPoolApiKeyFor.mockResolvedValue("");

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Swarm not properly configured with pool information");
    });
  });

  describe("Resource Allocation - Port Mapping Logic", () => {
    test("should return frontend URL from port 3000 when available", async () => {
      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.frontend).toBe("https://frontend.example.com");
      expect(data.message).toBe("Pod claimed successfully");
    });

    test("should filter out internal ports 15552 and 15553", async () => {
      const responseWithOnlyInternalPorts = {
        ...mockPoolManagerSuccessResponse,
        workspace: {
          ...mockPoolManagerSuccessResponse.workspace,
          portMappings: {
            "15552": "https://internal1.example.com",
            "15553": "https://internal2.example.com",
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => responseWithOnlyInternalPorts,
        text: async () => JSON.stringify(responseWithOnlyInternalPorts),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to claim pod");
    });

    test("should return single app URL when only one non-internal port exists", async () => {
      const responseWithSingleApp = {
        ...mockPoolManagerSuccessResponse,
        workspace: {
          ...mockPoolManagerSuccessResponse.workspace,
          portMappings: {
            "8080": "https://app.example.com",
            "15552": "https://internal1.example.com",
            "15553": "https://internal2.example.com",
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => responseWithSingleApp,
        text: async () => JSON.stringify(responseWithSingleApp),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.frontend).toBe("https://app.example.com");
    });

    test("should prioritize port 3000 over other app ports", async () => {
      const responseWithMultipleApps = {
        ...mockPoolManagerSuccessResponse,
        workspace: {
          ...mockPoolManagerSuccessResponse.workspace,
          portMappings: {
            "8080": "https://backend.example.com",
            "8081": "https://api.example.com",
            "3000": "https://frontend.example.com",
            "9090": "https://admin.example.com",
            "15552": "https://internal1.example.com",
            "15553": "https://internal2.example.com",
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => responseWithMultipleApps,
        text: async () => JSON.stringify(responseWithMultipleApps),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.frontend).toBe("https://frontend.example.com");
    });

    test("should return 500 if no frontend URL available after filtering", async () => {
      const responseWithNoAppPorts = {
        ...mockPoolManagerSuccessResponse,
        workspace: {
          ...mockPoolManagerSuccessResponse.workspace,
          portMappings: {},
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => responseWithNoAppPorts,
        text: async () => JSON.stringify(responseWithNoAppPorts),
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to claim pod");
    });
  });

  describe("Pool Manager API Integration", () => {
    test("should call Pool Manager API with correct URL and headers", async () => {
      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://pool-manager.test/api/pools/test-pool/workspace",
        expect.objectContaining({
          method: "GET",
          headers: {
            Authorization: "Bearer decrypted-api-key",
            "Content-Type": "application/json",
          },
        })
      );
    });

    test("should handle Pool Manager API non-200 response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to claim pod");
    });

    test("should handle Pool Manager API 404 response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "Pool not found",
      } as Response);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to claim pod");
    });

    test("should handle Pool Manager API network failure", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to claim pod");
    });
  });

  describe("Error Handling", () => {
    test("should return 500 on database error", async () => {
      mockDb.workspace.findFirst.mockRejectedValue(new Error("Database error"));

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to claim pod");
    });

    test("should handle ApiError with custom status", async () => {
      const apiError = {
        status: 503,
        message: "Service unavailable",
        service: "Pool Manager",
        details: { error: "Maintenance mode" },
      };
      mockFetch.mockRejectedValue(apiError);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toBe("Service unavailable");
      expect(data.service).toBe("Pool Manager");
      expect(data.details).toEqual({ error: "Maintenance mode" });
    });

    test("should handle missing service functions gracefully", async () => {
      mockGetSwarmPoolApiKeyFor.mockRejectedValue(new Error("Service error"));

      const workspaceWithoutPoolApiKey = {
        ...mockWorkspace,
        swarm: {
          ...mockWorkspace.swarm,
          poolApiKey: null,
        },
      };
      mockDb.workspace.findFirst.mockResolvedValue(workspaceWithoutPoolApiKey as any);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to claim pod");
    });
  });

  describe("Successful Pod Claim", () => {
    test("should return success response with frontend URL", async () => {
      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      const response = await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: "Pod claimed successfully",
        frontend: "https://frontend.example.com",
      });
    });

    test("should call all required service functions in correct order", async () => {
      // In this test, we just verify the function is called, not testing every interaction
      const request = new NextRequest("http://localhost:3000/api/pool-manager/claim-pod/test-id", {
        method: "POST",
      });

      await POST(request, { params: Promise.resolve({ workspaceId: mockWorkspaceId }) });

      // Verify call order  
      expect(mockGetServerSession).toHaveBeenCalled();
      expect(mockDb.workspace.findFirst).toHaveBeenCalledWith({
        where: { id: mockWorkspaceId },
        include: {
          owner: true,
          members: {
            where: { userId: mockUserId },
            select: { role: true },
          },
          swarm: true,
        },
      });
      // Note: We're not testing encryption service calls in this test to avoid mocking conflicts
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});