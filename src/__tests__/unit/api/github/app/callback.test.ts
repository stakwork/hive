import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { GET } from "@/app/api/github/app/callback/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { config } from "@/lib/env";

// Mock dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    session: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    account: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    swarm: {
      updateMany: vi.fn(),
    },
    workspace: {
      updateMany: vi.fn(),
    },
    sourceControlOrg: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    sourceControlToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
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

vi.mock("@/lib/env", () => ({
  config: {
    GITHUB_APP_CLIENT_ID: "mock_client_id",
    GITHUB_APP_CLIENT_SECRET: "mock_client_secret",
  },
}));

// Mock global fetch
global.fetch = vi.fn();

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedFetch = vi.mocked(global.fetch);

describe("GitHub App OAuth Callback - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  const mockEncryptionService = {
    encryptField: vi.fn((field: string, value: string) => ({
      data: `encrypted_${value}`,
      iv: "mock_iv",
      tag: "mock_tag",
      keyId: "mock_key_id",
      version: "1",
      encryptedAt: "2024-01-01T00:00:00.000Z",
    })),
  };

  beforeEach(() => {
    (EncryptionService.getInstance as Mock).mockReturnValue(mockEncryptionService);
  });

  describe("Parameter validation", () => {
    test("should redirect with error when state parameter is missing", async () => {
      const request = new NextRequest("http://localhost:3000/api/github/app/callback?code=test_code");

      const response = await GET(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("Location")).toContain("/?error=missing_state");
    });

    test("should redirect with error when code parameter is missing", async () => {
      const request = new NextRequest("http://localhost:3000/api/github/app/callback?state=test_state");

      const response = await GET(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("Location")).toContain("/?error=missing_code");
    });

    test("should handle missing both state and code parameters", async () => {
      const request = new NextRequest("http://localhost:3000/api/github/app/callback");

      const response = await GET(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("Location")).toContain("/?error=missing_state");
    });
  });

  describe("Authentication validation", () => {
    test("should redirect to /auth when user is not authenticated", async () => {
      mockedGetServerSession.mockResolvedValue(null);
      
      const request = new NextRequest(
        "http://localhost:3000/api/github/app/callback?state=test_state&code=test_code"
      );

      const response = await GET(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("Location")).toContain("/auth");
    });

    test("should redirect to /auth when user ID is missing from session", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { email: "test@example.com" },
      });
      
      const request = new NextRequest(
        "http://localhost:3000/api/github/app/callback?state=test_state&code=test_code"
      );

      const response = await GET(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("Location")).toContain("/auth");
    });
  });

  describe("Session state validation", () => {
    test("should redirect with invalid_state error when user session is not found", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { id: "user123" },
      });

      (db.session.findFirst as Mock).mockResolvedValue(null);
      
      const request = new NextRequest(
        "http://localhost:3000/api/github/app/callback?state=test_state&code=test_code"
      );

      const response = await GET(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("Location")).toContain("/?error=invalid_state");
      expect(db.session.findFirst).toHaveBeenCalledWith({
        where: {
          userId: "user123",
          githubState: "test_state",
        },
      });
    });

    test("should proceed when valid user session is found", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { id: "user123" },
      });

      (db.session.findFirst as Mock).mockResolvedValue({
        id: "session123",
        userId: "user123",
        githubState: "test_state",
      });

      // Mock successful GitHub OAuth token exchange
      mockedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "github_access_token",
          refresh_token: "github_refresh_token",
        }),
      } as Response);

      (db.account.findFirst as Mock).mockResolvedValue(null);
      (db.account.create as Mock).mockResolvedValue({ id: "account123" });
      (db.session.updateMany as Mock).mockResolvedValue({ count: 1 });
      (db.workspace.updateMany as Mock).mockResolvedValue({ count: 1 });

      const validState = Buffer.from(JSON.stringify({
        workspaceSlug: "test-workspace",
        timestamp: Date.now(),
      })).toString("base64");
      
      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${validState}&code=test_code`
      );

      const response = await GET(request);

      expect(db.session.findFirst).toHaveBeenCalledWith({
        where: {
          userId: "user123",
          githubState: validState,
        },
      });
    });
  });

  describe("GitHub OAuth token exchange", () => {
    test("should redirect with invalid_code error when token exchange fails", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { id: "user123" },
      });

      (db.session.findFirst as Mock).mockResolvedValue({
        id: "session123",
        userId: "user123",
        githubState: "test_state",
      });

      // Mock failed GitHub OAuth token exchange
      mockedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: null,
        }),
      } as Response);

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/callback?state=test_state&code=test_code"
      );

      const response = await GET(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("Location")).toContain("/?error=invalid_code");
    });

    test("should handle GitHub API network errors", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { id: "user123" },
      });

      (db.session.findFirst as Mock).mockResolvedValue({
        id: "session123",
        userId: "user123",
        githubState: "test_state",
      });

      // Mock GitHub API network failure
      mockedFetch.mockRejectedValue(new Error("Network error"));

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/callback?state=test_state&code=test_code"
      );

      const response = await GET(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("Location")).toContain("/?error=github_app_callback_error");
    });

    test("should make correct API call to GitHub with client credentials", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { id: "user123" },
      });

      (db.session.findFirst as Mock).mockResolvedValue({
        id: "session123",
        userId: "user123",
        githubState: "test_state",
      });

      mockedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "github_access_token",
        }),
      } as Response);

      (db.account.findFirst as Mock).mockResolvedValue(null);
      (db.account.create as Mock).mockResolvedValue({ id: "account123" });
      (db.session.updateMany as Mock).mockResolvedValue({ count: 1 });
      (db.workspace.updateMany as Mock).mockResolvedValue({ count: 1 });

      const validState = Buffer.from(JSON.stringify({
        workspaceSlug: "test-workspace",
        timestamp: Date.now(),
      })).toString("base64");

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${validState}&code=test_code`
      );

      await GET(request);

      expect(mockedFetch).toHaveBeenCalledWith(
        "https://github.com/login/oauth/access_token",
        expect.objectContaining({
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: "mock_client_id",
            client_secret: "mock_client_secret",
            code: "test_code",
            state: validState,
          }),
        })
      );
    });
  });

  describe("Token encryption and storage", () => {
    test("should encrypt access tokens before storing", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { id: "user123" },
      });

      (db.session.findFirst as Mock).mockResolvedValue({
        id: "session123",
        userId: "user123",
        githubState: "test_state",
      });

      // Mock multiple API calls with different responses
      mockedFetch.mockImplementation(async (url: string) => {
        if (url === "https://github.com/login/oauth/access_token") {
          return {
            ok: true,
            json: async () => ({
              access_token: "sensitive_github_token",
              refresh_token: "sensitive_refresh_token",
            }),
          } as Response;
        } else if (url === "https://api.github.com/user") {
          return {
            ok: true,
            json: async () => ({
              id: 12345,
              login: "testuser",
              name: "Test User",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 404,
        } as Response;
      });

      (db.account.findFirst as Mock).mockResolvedValue(null);
      (db.account.create as Mock).mockResolvedValue({ id: "account123" });
      (db.session.updateMany as Mock).mockResolvedValue({ count: 1 });
      (db.workspace.updateMany as Mock).mockResolvedValue({ count: 1 });

      // Mock the new SourceControlOrg and SourceControlToken operations
      (db.sourceControlOrg.findUnique as Mock).mockResolvedValue({
        id: "sourcecontrolorg123",
        githubLogin: "testuser",
        type: "user",
      });
      (db.sourceControlToken.findUnique as Mock).mockResolvedValue(null);
      (db.sourceControlToken.create as Mock).mockResolvedValue({
        id: "sourcecontroltoken123",
      });

      const validState = Buffer.from(JSON.stringify({
        workspaceSlug: "test-workspace",
        timestamp: Date.now(),
      })).toString("base64");

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${validState}&code=test_code`
      );

      await GET(request);

      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith(
        "source_control_token",
        "sensitive_github_token"
      );
      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith(
        "source_control_refresh_token",
        "sensitive_refresh_token"
      );
    });

    test("should create SourceControlOrg and SourceControlToken with encrypted tokens", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { id: "user123" },
      });

      (db.session.findFirst as Mock).mockResolvedValue({
        id: "session123",
        userId: "user123",
        githubState: "test_state",
      });

      // Mock multiple API calls with different responses
      mockedFetch.mockImplementation(async (url: string) => {
        if (url === "https://github.com/login/oauth/access_token") {
          return {
            ok: true,
            json: async () => ({
              access_token: "github_access_token",
              refresh_token: "github_refresh_token",
            }),
          } as Response;
        } else if (url === "https://api.github.com/user") {
          return {
            ok: true,
            json: async () => ({
              id: 12345,
              login: "testuser",
              name: "Test User",
            }),
          } as Response;
        } else if (url === "https://api.github.com/user/installations") {
          return {
            ok: true,
            json: async () => ({
              installations: [{
                id: 12345,
                account: {
                  login: "testuser",
                  type: "User",
                  name: "Test User",
                  avatar_url: "https://github.com/testuser.png"
                }
              }]
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 404,
        } as Response;
      });

      (db.account.findFirst as Mock).mockResolvedValue(null);
      (db.account.create as Mock).mockResolvedValue({ id: "account123" });
      (db.session.updateMany as Mock).mockResolvedValue({ count: 1 });
      (db.workspace.updateMany as Mock).mockResolvedValue({ count: 1 });

      // Mock the new SourceControlOrg and SourceControlToken operations
      (db.sourceControlOrg.findUnique as Mock).mockResolvedValue(null);
      (db.sourceControlOrg.create as Mock).mockResolvedValue({
        id: "sourcecontrolorg123",
        githubLogin: "testuser",
        type: "user",
      });
      (db.sourceControlToken.findUnique as Mock).mockResolvedValue(null);
      (db.sourceControlToken.create as Mock).mockResolvedValue({
        id: "sourcecontroltoken123",
      });

      const validState = Buffer.from(JSON.stringify({
        workspaceSlug: "test-workspace",
        timestamp: Date.now(),
      })).toString("base64");

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${validState}&code=test_code&installation_id=12345`
      );

      await GET(request);

      // Verify SourceControlOrg creation
      expect(db.sourceControlOrg.create).toHaveBeenCalledWith({
        data: {
          type: "USER",
          githubLogin: "testuser",
          githubInstallationId: 12345,
          name: "Test User",
          avatarUrl: "https://github.com/testuser.png",
          description: null,
        },
      });

      // Verify SourceControlToken creation with encrypted tokens
      expect(db.sourceControlToken.create).toHaveBeenCalledWith({
        data: {
          userId: "user123",
          sourceControlOrgId: "sourcecontrolorg123",
          token: JSON.stringify(mockEncryptionService.encryptField("source_control_token", "github_access_token")),
          refreshToken: JSON.stringify(mockEncryptionService.encryptField("source_control_refresh_token", "github_refresh_token")),
          expiresAt: expect.any(Date),
        },
      });
    });

    test("should create SourceControlToken with encrypted tokens", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { id: "user123" },
      });

      (db.session.findFirst as Mock).mockResolvedValue({
        id: "session123",
        userId: "user123",
        githubState: "test_state",
      });

      // Mock multiple API calls with different responses
      mockedFetch.mockImplementation(async (url: string) => {
        if (url === "https://github.com/login/oauth/access_token") {
          return {
            ok: true,
            json: async () => ({
              access_token: "new_github_token",
            }),
          } as Response;
        } else if (url === "https://api.github.com/user") {
          return {
            ok: true,
            json: async () => ({
              id: 12345,
              login: "testuser",
              name: "Test User",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 404,
        } as Response;
      });

      (db.account.findFirst as Mock).mockResolvedValue(null);
      (db.account.create as Mock).mockResolvedValue({ id: "account123" });
      (db.session.updateMany as Mock).mockResolvedValue({ count: 1 });
      (db.workspace.updateMany as Mock).mockResolvedValue({ count: 1 });

      // Mock the new SourceControlOrg and SourceControlToken operations
      (db.sourceControlOrg.findUnique as Mock).mockResolvedValue({
        id: "sourcecontrolorg123",
        githubLogin: "testuser",
        type: "user",
      });
      (db.sourceControlToken.findUnique as Mock).mockResolvedValue(null);
      (db.sourceControlToken.create as Mock).mockResolvedValue({
        id: "sourcecontroltoken123",
      });

      const validState = Buffer.from(JSON.stringify({
        workspaceSlug: "test-workspace",
        timestamp: Date.now(),
      })).toString("base64");

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${validState}&code=test_code`
      );

      await GET(request);

      expect(db.sourceControlToken.create).toHaveBeenCalledWith({
        data: {
          userId: "user123",
          sourceControlOrgId: "sourcecontrolorg123",
          token: JSON.stringify(mockEncryptionService.encryptField("source_control_token", "new_github_token")),
          refreshToken: undefined,
          expiresAt: undefined,
        },
      });
    });
  });

  describe("State decoding and workspace handling", () => {
    test("should redirect with invalid_state error when state cannot be decoded", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { id: "user123" },
      });

      (db.session.findFirst as Mock).mockResolvedValue({
        id: "session123",
        userId: "user123",
        githubState: "invalid_state",
      });

      mockedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "github_access_token",
        }),
      } as Response);

      (db.account.findFirst as Mock).mockResolvedValue(null);
      (db.account.create as Mock).mockResolvedValue({ id: "account123" });

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/callback?state=invalid_state&code=test_code"
      );

      const response = await GET(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("Location")).toContain("/?error=invalid_state");
    });

    test("should redirect with state_expired error when state is too old", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { id: "user123" },
      });

      (db.session.findFirst as Mock).mockResolvedValue({
        id: "session123",
        userId: "user123",
        githubState: "expired_state",
      });

      mockedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "github_access_token",
        }),
      } as Response);

      (db.account.findFirst as Mock).mockResolvedValue(null);
      (db.account.create as Mock).mockResolvedValue({ id: "account123" });
      (db.session.updateMany as Mock).mockResolvedValue({ count: 1 });
      (db.workspace.updateMany as Mock).mockResolvedValue({ count: 1 });

      // Create state that's older than 1 hour
      const expiredState = Buffer.from(JSON.stringify({
        workspaceSlug: "test-workspace",
        timestamp: Date.now() - (2 * 60 * 60 * 1000), // 2 hours ago
      })).toString("base64");

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${expiredState}&code=test_code`
      );

      const response = await GET(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("Location")).toContain("/w/test-workspace?error=state_expired");
    });

    test("should clear GitHub state from session after successful validation", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { id: "user123" },
      });

      (db.session.findFirst as Mock).mockResolvedValue({
        id: "session123",
        userId: "user123",
        githubState: "valid_state",
      });

      // Mock multiple API calls with different responses
      mockedFetch.mockImplementation(async (url: string) => {
        if (url === "https://github.com/login/oauth/access_token") {
          return {
            ok: true,
            json: async () => ({
              access_token: "github_access_token",
            }),
          } as Response;
        } else if (url === "https://api.github.com/user") {
          return {
            ok: true,
            json: async () => ({
              id: 12345,
              login: "testuser",
              name: "Test User",
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 404,
        } as Response;
      });

      (db.account.findFirst as Mock).mockResolvedValue(null);
      (db.account.create as Mock).mockResolvedValue({ id: "account123" });
      (db.session.updateMany as Mock).mockResolvedValue({ count: 1 });
      (db.workspace.updateMany as Mock).mockResolvedValue({ count: 1 });

      // Mock the new SourceControlOrg and SourceControlToken operations
      (db.sourceControlOrg.findUnique as Mock).mockResolvedValue({
        id: "sourcecontrolorg123",
        githubLogin: "testuser",
        type: "user",
      });
      (db.sourceControlToken.findUnique as Mock).mockResolvedValue(null);
      (db.sourceControlToken.create as Mock).mockResolvedValue({
        id: "sourcecontroltoken123",
      });

      const validState = Buffer.from(JSON.stringify({
        workspaceSlug: "test-workspace",
        timestamp: Date.now(),
      })).toString("base64");

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${validState}&code=test_code`
      );

      await GET(request);

      expect(db.session.updateMany).toHaveBeenCalledWith({
        where: { userId: "user123" },
        data: { githubState: null },
      });
    });
  });

  describe("GitHub App installation handling", () => {
    test("should link workspace to SourceControlOrg for install action", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { id: "user123" },
      });

      (db.session.findFirst as Mock).mockResolvedValue({
        id: "session123",
        userId: "user123",
        githubState: "valid_state",
      });

      // Mock multiple API calls with different responses for install
      mockedFetch.mockImplementation(async (url: string) => {
        if (url === "https://github.com/login/oauth/access_token") {
          return {
            ok: true,
            json: async () => ({
              access_token: "github_access_token",
            }),
          } as Response;
        } else if (url === "https://api.github.com/user") {
          return {
            ok: true,
            json: async () => ({
              id: 12345,
              login: "testuser",
              name: "Test User",
            }),
          } as Response;
        } else if (url === "https://api.github.com/user/installations") {
          return {
            ok: true,
            json: async () => ({
              installations: [
                {
                  id: 12345,
                  account: {
                    login: "testuser",
                    type: "User",
                  },
                },
              ],
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 404,
        } as Response;
      });

      (db.account.findFirst as Mock).mockResolvedValue(null);
      (db.account.create as Mock).mockResolvedValue({ id: "account123" });
      (db.session.updateMany as Mock).mockResolvedValue({ count: 1 });
      (db.workspace.updateMany as Mock).mockResolvedValue({ count: 1 });

      // Mock the new SourceControlOrg and SourceControlToken operations for install
      (db.sourceControlOrg.findUnique as Mock).mockResolvedValue(null);
      (db.sourceControlOrg.create as Mock).mockResolvedValue({
        id: "sourcecontrolorg123",
        githubLogin: "testuser",
        type: "user",
      });
      (db.sourceControlToken.findUnique as Mock).mockResolvedValue(null);
      (db.sourceControlToken.create as Mock).mockResolvedValue({
        id: "sourcecontroltoken123",
      });

      const validState = Buffer.from(JSON.stringify({
        workspaceSlug: "test-workspace",
        timestamp: Date.now(),
      })).toString("base64");

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${validState}&code=test_code&installation_id=12345&setup_action=install`
      );

      await GET(request);

      expect(db.workspace.updateMany).toHaveBeenCalledWith({
        where: { slug: "test-workspace" },
        data: { sourceControlOrgId: "sourcecontrolorg123" },
      });
    });

    test("should clear installation ID for uninstall action", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { id: "user123" },
      });

      (db.session.findFirst as Mock).mockResolvedValue({
        id: "session123",
        userId: "user123",
        githubState: "valid_state",
      });

      // Mock multiple API calls with different responses for uninstall
      mockedFetch.mockImplementation(async (url: string) => {
        if (url === "https://github.com/login/oauth/access_token") {
          return {
            ok: true,
            json: async () => ({
              access_token: "github_access_token",
            }),
          } as Response;
        } else if (url === "https://api.github.com/user") {
          return {
            ok: true,
            json: async () => ({
              id: 12345,
              login: "testuser",
              name: "Test User",
            }),
          } as Response;
        } else if (url === "https://api.github.com/user/installations") {
          return {
            ok: true,
            json: async () => ({
              installations: [
                {
                  id: 12345,
                  account: {
                    login: "testuser",
                    type: "User",
                  },
                },
              ],
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 404,
        } as Response;
      });

      (db.account.findFirst as Mock).mockResolvedValue(null);
      (db.account.create as Mock).mockResolvedValue({ id: "account123" });
      (db.session.updateMany as Mock).mockResolvedValue({ count: 1 });
      (db.workspace.updateMany as Mock).mockResolvedValue({ count: 1 });

      // Mock the new SourceControlOrg and SourceControlToken operations for uninstall
      (db.sourceControlOrg.findUnique as Mock).mockResolvedValue({
        id: "sourcecontrolorg123",
        githubLogin: "testuser",
        type: "user",
      });
      (db.sourceControlOrg.update as Mock).mockResolvedValue({
        id: "sourcecontrolorg123",
      });
      (db.sourceControlToken.findUnique as Mock).mockResolvedValue(null);
      (db.sourceControlToken.create as Mock).mockResolvedValue({
        id: "sourcecontroltoken123",
      });

      const validState = Buffer.from(JSON.stringify({
        workspaceSlug: "test-workspace",
        timestamp: Date.now(),
      })).toString("base64");

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${validState}&code=test_code&installation_id=12345&setup_action=uninstall`
      );

      await GET(request);

      expect(db.workspace.updateMany).toHaveBeenCalledWith({
        where: { slug: "test-workspace" },
        data: { sourceControlOrgId: null },
      });
    });

    test("should not modify installation ID for other setup actions", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { id: "user123" },
      });

      (db.session.findFirst as Mock).mockResolvedValue({
        id: "session123",
        userId: "user123",
        githubState: "valid_state",
      });

      mockedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "github_access_token",
        }),
      } as Response);

      (db.account.findFirst as Mock).mockResolvedValue(null);
      (db.account.create as Mock).mockResolvedValue({ id: "account123" });
      (db.session.updateMany as Mock).mockResolvedValue({ count: 1 });
      (db.workspace.updateMany as Mock).mockResolvedValue({ count: 1 });

      const validState = Buffer.from(JSON.stringify({
        workspaceSlug: "test-workspace",
        timestamp: Date.now(),
      })).toString("base64");

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${validState}&code=test_code&installation_id=12345&setup_action=other`
      );

      await GET(request);

      expect(db.swarm.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("Successful flow and redirection", () => {
    test("should redirect to workspace with setup action on success", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { id: "user123" },
      });

      (db.session.findFirst as Mock).mockResolvedValue({
        id: "session123",
        userId: "user123",
        githubState: "valid_state",
      });

      // Mock multiple API calls with different responses
      mockedFetch.mockImplementation(async (url: string) => {
        if (url === "https://github.com/login/oauth/access_token") {
          return {
            ok: true,
            json: async () => ({
              access_token: "github_access_token",
            }),
          } as Response;
        } else if (url === "https://api.github.com/user") {
          return {
            ok: true,
            json: async () => ({
              id: 12345,
              login: "testuser",
              name: "Test User",
            }),
          } as Response;
        } else if (url === "https://api.github.com/user/installations") {
          return {
            ok: true,
            json: async () => ({
              installations: [
                {
                  id: 12345,
                  account: {
                    login: "testuser",
                    type: "User",
                  },
                },
              ],
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 404,
        } as Response;
      });

      (db.account.findFirst as Mock).mockResolvedValue(null);
      (db.account.create as Mock).mockResolvedValue({ id: "account123" });
      (db.session.updateMany as Mock).mockResolvedValue({ count: 1 });
      (db.workspace.updateMany as Mock).mockResolvedValue({ count: 1 });

      // Mock the new SourceControlOrg and SourceControlToken operations
      (db.sourceControlOrg.findUnique as Mock).mockResolvedValue(null);
      (db.sourceControlOrg.create as Mock).mockResolvedValue({
        id: "sourcecontrolorg123",
        githubLogin: "testuser",
        type: "user",
      });
      (db.sourceControlToken.findUnique as Mock).mockResolvedValue(null);
      (db.sourceControlToken.create as Mock).mockResolvedValue({
        id: "sourcecontroltoken123",
      });
      (db.sourceControlToken.upsert as Mock).mockResolvedValue({
        id: "sourcecontroltoken123",
      });

      const validState = Buffer.from(JSON.stringify({
        workspaceSlug: "test-workspace",
        timestamp: Date.now(),
      })).toString("base64");

      const request = new NextRequest(
        `http://localhost:3000/api/github/app/callback?state=${validState}&code=test_code&setup_action=install&installation_id=12345`
      );

      const response = await GET(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("Location")).toContain("/w/test-workspace?github_setup_action=install");
    });
  });

  describe("Error handling and security", () => {
    test("should handle and log general errors securely", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      mockedGetServerSession.mockRejectedValue(new Error("Session service unavailable"));

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/callback?state=test_state&code=test_code"
      );

      const response = await GET(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("Location")).toContain("/?error=github_app_callback_error");
      expect(consoleSpy).toHaveBeenCalledWith("GitHub App callback error:", expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    test("should not expose sensitive data in error responses", async () => {
      mockedGetServerSession.mockResolvedValue({
        user: { id: "user123" },
      });

      (db.session.findFirst as Mock).mockResolvedValue({
        id: "session123",
        userId: "user123",
        githubState: "valid_state",
      });

      // Mock GitHub API to return sensitive error
      mockedFetch.mockRejectedValue(new Error("Client secret invalid: sk_live_123456789"));

      const request = new NextRequest(
        "http://localhost:3000/api/github/app/callback?state=valid_state&code=test_code"
      );

      const response = await GET(request);

      // Should redirect to generic error, not expose sensitive error details
      expect(response.headers.get("Location")).toContain("/?error=github_app_callback_error");
      expect(response.headers.get("Location")).not.toContain("sk_live_123456789");
      expect(response.headers.get("Location")).not.toContain("Client secret");
    });
  });
});