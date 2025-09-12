import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/github/app/callback/route";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

// Mock dependencies
vi.mock("next-auth");
vi.mock("@/lib/db");
vi.mock("@/lib/encryption");

// Create a mock function for getAccessToken
const mockGetAccessToken = vi.fn();

const mockGetServerSession = vi.mocked(getServerSession);
const mockDb = vi.mocked(db, true);
const mockEncryptionService = {
  getInstance: vi.fn(),
  encryptField: vi.fn(),
};

// Mock the getAccessToken function by intercepting module imports
vi.doMock("@/lib/github", () => ({
  getAccessToken: mockGetAccessToken,
}));

// Mock EncryptionService
vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService);

describe("GET /api/github/app/callback", () => {
  const mockUserId = "test-user-id";
  const mockState = Buffer.from(JSON.stringify({ 
    workspaceSlug: "test-workspace",
    timestamp: Date.now() 
  })).toString("base64");
  const mockCode = "test-code";
  const mockInstallationId = "12345";
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock session
    mockGetServerSession.mockResolvedValue({
      user: { id: mockUserId },
    } as any);

    // Mock encryption service
    mockEncryptionService.encryptField.mockReturnValue({
      encryptedData: "encrypted-token",
      iv: "test-iv",
    });
  });

  describe("Database Write Operations", () => {
    it("should create new GitHub account when none exists", async () => {
      mockGetAccessToken.mockResolvedValue({
        userAccessToken: "test-access-token",
        userRefreshToken: "test-refresh-token",
      });

      // Mock database queries
      mockDb.session.findFirst.mockResolvedValue({
        userId: mockUserId,
        githubState: mockState,
      } as any);
      
      mockDb.account.findFirst.mockResolvedValue(null); // No existing account
      mockDb.account.create.mockResolvedValue({
        id: "new-account-id",
        userId: mockUserId,
        provider: "github",
      } as any);
      
      mockDb.session.updateMany.mockResolvedValue({ count: 1 });
      mockDb.swarm.updateMany.mockResolvedValue({ count: 1 });

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${mockState}&code=${mockCode}&installation_id=${mockInstallationId}&setup_action=install`
      );

      const response = await GET(request);

      // Verify account creation
      expect(mockDb.account.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockUserId,
          type: "oauth",
          provider: "github",
          providerAccountId: mockUserId,
          app_access_token: JSON.stringify({
            encryptedData: "encrypted-token",
            iv: "test-iv",
          }),
          app_refresh_token: JSON.stringify({
            encryptedData: "encrypted-token", 
            iv: "test-iv",
          }),
          app_expires_at: expect.any(Number),
        }),
      });

      // Verify session state clearing
      expect(mockDb.session.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        data: { githubState: null },
      });

      expect(response.status).toBe(302);
    });

    it("should update existing GitHub account when one exists", async () => {
      mockGetAccessToken.mockResolvedValue({
        userAccessToken: "updated-access-token",
        userRefreshToken: "updated-refresh-token",
      });

      const existingAccountId = "existing-account-id";
      
      // Mock database queries  
      mockDb.session.findFirst.mockResolvedValue({
        userId: mockUserId,
        githubState: mockState,
      } as any);
      
      mockDb.account.findFirst.mockResolvedValue({
        id: existingAccountId,
        userId: mockUserId,
        provider: "github",
      } as any);
      
      mockDb.account.update.mockResolvedValue({
        id: existingAccountId,
        userId: mockUserId,
        provider: "github",
      } as any);
      
      mockDb.session.updateMany.mockResolvedValue({ count: 1 });
      mockDb.swarm.updateMany.mockResolvedValue({ count: 1 });

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${mockState}&code=${mockCode}&installation_id=${mockInstallationId}&setup_action=install`
      );

      const response = await GET(request);

      // Verify account update
      expect(mockDb.account.update).toHaveBeenCalledWith({
        where: { id: existingAccountId },
        data: expect.objectContaining({
          app_access_token: JSON.stringify({
            encryptedData: "encrypted-token",
            iv: "test-iv",
          }),
          app_refresh_token: JSON.stringify({
            encryptedData: "encrypted-token",
            iv: "test-iv", 
          }),
          app_expires_at: expect.any(Number),
        }),
      });

      // Verify session state clearing
      expect(mockDb.session.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        data: { githubState: null },
      });

      expect(response.status).toBe(302);
    });

    it("should update swarm with GitHub installation ID on install", async () => {
      mockGetAccessToken.mockResolvedValue({
        userAccessToken: "test-access-token",
        userRefreshToken: null,
      });

      // Mock database queries
      mockDb.session.findFirst.mockResolvedValue({
        userId: mockUserId,
        githubState: mockState,
      } as any);
      
      mockDb.account.findFirst.mockResolvedValue({
        id: "account-id",
        userId: mockUserId,
        provider: "github",
      } as any);
      
      mockDb.account.update.mockResolvedValue({} as any);
      mockDb.session.updateMany.mockResolvedValue({ count: 1 });
      mockDb.swarm.updateMany.mockResolvedValue({ count: 2 }); // Updated 2 swarms

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${mockState}&code=${mockCode}&installation_id=${mockInstallationId}&setup_action=install`
      );

      const response = await GET(request);

      // Verify swarm update with installation ID
      expect(mockDb.swarm.updateMany).toHaveBeenCalledWith({
        where: {
          workspace: {
            slug: "test-workspace",
          },
        },
        data: { githubInstallationId: mockInstallationId },
      });

      expect(response.status).toBe(302);
    });

    it("should clear GitHub installation ID on uninstall", async () => {
      mockGetAccessToken.mockResolvedValue({
        userAccessToken: "test-access-token", 
        userRefreshToken: null,
      });

      // Mock database queries
      mockDb.session.findFirst.mockResolvedValue({
        userId: mockUserId,
        githubState: mockState,
      } as any);
      
      mockDb.account.findFirst.mockResolvedValue({
        id: "account-id",
        userId: mockUserId,
        provider: "github",
      } as any);
      
      mockDb.account.update.mockResolvedValue({} as any);
      mockDb.session.updateMany.mockResolvedValue({ count: 1 });
      mockDb.swarm.updateMany.mockResolvedValue({ count: 1 });

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${mockState}&code=${mockCode}&installation_id=${mockInstallationId}&setup_action=uninstall`
      );

      const response = await GET(request);

      // Verify swarm installation ID clearing
      expect(mockDb.swarm.updateMany).toHaveBeenCalledWith({
        where: {
          workspace: {
            slug: "test-workspace",
          },
        },
        data: { githubInstallationId: null },
      });

      expect(response.status).toBe(302);
    });
  });

  describe("Error Handling", () => {
    it("should redirect with error when session not found", async () => {
      mockDb.session.findFirst.mockResolvedValue(null);
      
      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${mockState}&code=${mockCode}`
      );

      const response = await GET(request);

      expect(response.status).toBeOneOf([302, 307]);
      expect(response.headers.get("location")).toContain("error=invalid_state");
    });

    it("should redirect with error when state is missing", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?code=${mockCode}`
      );

      const response = await GET(request);

      expect(response.status).toBeOneOf([302, 307]);
      expect(response.headers.get("location")).toContain("error=missing_state");
    });

    it("should redirect with error when code is missing", async () => {
      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${mockState}`
      );

      const response = await GET(request);

      expect(response.status).toBeOneOf([302, 307]); 
      expect(response.headers.get("location")).toContain("error=missing_code");
    });

    it("should redirect to auth when user not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);
      
      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${mockState}&code=${mockCode}`
      );

      const response = await GET(request);

      expect(response.status).toBeOneOf([302, 307]);
      expect(response.headers.get("location")).toContain("/auth");
    });
  });

  describe("Token Encryption", () => {
    it("should encrypt access tokens before database storage", async () => {
      const testAccessToken = "test-access-token";
      const testRefreshToken = "test-refresh-token";
      
      mockGetAccessToken.mockResolvedValue({
        userAccessToken: testAccessToken,
        userRefreshToken: testRefreshToken,
      });

      mockDb.session.findFirst.mockResolvedValue({
        userId: mockUserId,
        githubState: mockState,
      } as any);
      
      mockDb.account.findFirst.mockResolvedValue(null);
      mockDb.account.create.mockResolvedValue({} as any);
      mockDb.session.updateMany.mockResolvedValue({ count: 1 });
      mockDb.swarm.updateMany.mockResolvedValue({ count: 1 });

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${mockState}&code=${mockCode}`
      );

      await GET(request);

      // Verify tokens were encrypted before storage
      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith("app_access_token", testAccessToken);
      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith("app_refresh_token", testRefreshToken);
    });
  });

  describe("State Validation", () => {
    it("should handle expired state correctly", async () => {
      const expiredState = Buffer.from(JSON.stringify({
        workspaceSlug: "test-workspace",
        timestamp: Date.now() - (2 * 60 * 60 * 1000), // 2 hours ago
      })).toString("base64");

      mockGetAccessToken.mockResolvedValue({
        userAccessToken: "test-access-token",
        userRefreshToken: null,
      });

      mockDb.session.findFirst.mockResolvedValue({
        userId: mockUserId,
        githubState: expiredState,
      } as any);

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${expiredState}&code=${mockCode}`
      );

      const response = await GET(request);

      expect(response.status).toBeOneOf([302, 307]);
      expect(response.headers.get("location")).toContain("error=state_expired");
    });

    it("should handle malformed state gracefully", async () => {
      const malformedState = "invalid-base64-state";

      mockDb.session.findFirst.mockResolvedValue({
        userId: mockUserId,
        githubState: malformedState,
      } as any);

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${malformedState}&code=${mockCode}`
      );

      const response = await GET(request);

      expect(response.status).toBeOneOf([302, 307]);
      expect(response.headers.get("location")).toContain("error=invalid_state");
    });
  });
});