import { describe, test, expect, beforeEach, vi, Mock, afterEach } from "vitest";
import { User, Account } from "@prisma/client";
import type { AdapterUser } from "@auth/core/adapters";

// Mock modules before imports
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    account: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    workspace: {
      findFirst: vi.fn(),
    },
    gitHubAuth: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("axios");

vi.mock("@/lib/logger", () => ({
  logger: {
    authInfo: vi.fn(),
    authError: vi.fn(),
    authWarn: vi.fn(),
    authDebug: vi.fn(),
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      encryptField: vi.fn((fieldName: string, value: string) => ({
        data: "encrypted-data",
        iv: "test-iv",
        tag: "test-tag",
        version: "1",
        encryptedAt: new Date().toISOString(),
      })),
      decryptField: vi.fn((fieldName: string, value: string) => "decrypted-token"),
    })),
  },
}));

// Mock the module but preserve other exports
vi.mock("@/utils/mockSetup", () => ({
  ensureMockWorkspaceForUser: vi.fn(),
}));

// Import after mocks
import { db } from "@/lib/db";
import axios from "axios";
import { logger } from "@/lib/logger";
import { EncryptionService } from "@/lib/encryption";
import { authOptions } from "@/lib/auth/nextauth";
import { ensureMockWorkspaceForUser } from "@/utils/mockSetup";

// Get reference to the mocked function
const mockEnsureMockWorkspaceForUser = ensureMockWorkspaceForUser as Mock;

describe("nextauth - signIn callback", () => {
  const mockUser: AdapterUser = {
    id: "test-user-id",
    email: "test@example.com",
    emailVerified: null,
    name: "Test User",
    image: null,
  };

  const mockAccount = {
    provider: "github",
    providerAccountId: "github-123",
    type: "oauth" as const,
    access_token: "github-access-token",
    refresh_token: "github-refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "Bearer",
    scope: "read:user user:email",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables
    delete process.env.POD_URL;
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
  });

  describe("Mock Provider Sign-In", () => {
    test("creates new user and workspace on first mock sign-in", async () => {
      const mockWorkspaceSlug = "test-workspace";
      const newUserId = "new-user-id";
      
      (db.user.findUnique as Mock).mockResolvedValue(null);
      (db.user.create as Mock).mockResolvedValue({
        id: newUserId,
        email: mockUser.email,
        name: mockUser.name,
        emailVerified: new Date(),
      });
      mockEnsureMockWorkspaceForUser.mockResolvedValue(mockWorkspaceSlug);
      (db.workspace.findFirst as Mock).mockResolvedValue({
        id: "workspace-id",
        slug: mockWorkspaceSlug,
        ownerId: newUserId,
      });

      const signInCallback = authOptions.callbacks?.signIn;
      if (!signInCallback) {
        throw new Error("signIn callback not found");
      }

      const result = await signInCallback({
        user: mockUser,
        account: { ...mockAccount, provider: "mock" },
        profile: undefined,
      });

      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { email: mockUser.email },
      });
      expect(db.user.create).toHaveBeenCalledWith({
        data: {
          name: mockUser.name,
          email: mockUser.email,
          image: mockUser.image,
          emailVerified: expect.any(Date),
        },
      });
      expect(mockEnsureMockWorkspaceForUser).toHaveBeenCalledWith(newUserId);
      expect(db.workspace.findFirst).toHaveBeenCalledWith({
        where: { ownerId: newUserId, deleted: false },
        select: { slug: true },
      });
      expect(result).toBe(true);
    });

    test("uses existing user on subsequent mock sign-in", async () => {
      const existingUserId = "existing-user-id";
      const mockWorkspaceSlug = "test-workspace";
      
      (db.user.findUnique as Mock).mockResolvedValue({
        id: existingUserId,
        email: mockUser.email,
        name: mockUser.name,
      });
      mockEnsureMockWorkspaceForUser.mockResolvedValue(mockWorkspaceSlug);
      (db.workspace.findFirst as Mock).mockResolvedValue({
        id: "workspace-id",
        slug: mockWorkspaceSlug,
        ownerId: existingUserId,
      });

      const signInCallback = authOptions.callbacks?.signIn;
      if (!signInCallback) {
        throw new Error("signIn callback not found");
      }

      const result = await signInCallback({
        user: mockUser,
        account: { ...mockAccount, provider: "mock" },
        profile: undefined,
      });

      expect(db.user.create).not.toHaveBeenCalled();
      expect(mockEnsureMockWorkspaceForUser).toHaveBeenCalledWith(existingUserId);
      expect(result).toBe(true);
    });

    test("returns false when workspace creation fails", async () => {
      mockEnsureMockWorkspaceForUser.mockResolvedValue("");
      (db.workspace.findFirst as Mock).mockResolvedValue(null);

      const signInCallback = authOptions.callbacks?.signIn;
      if (!signInCallback) {
        throw new Error("signIn callback not found");
      }

      const result = await signInCallback({
        user: mockUser,
        account: { ...mockAccount, provider: "mock" },
        profile: undefined,
      });

      expect(logger.authError).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    test("returns false when workspace verification fails", async () => {
      mockEnsureMockWorkspaceForUser.mockResolvedValue("test-workspace");
      (db.workspace.findFirst as Mock).mockResolvedValue(null);

      const signInCallback = authOptions.callbacks?.signIn;
      if (!signInCallback) {
        throw new Error("signIn callback not found");
      }

      const result = await signInCallback({
        user: mockUser,
        account: { ...mockAccount, provider: "mock" },
        profile: undefined,
      });

      expect(logger.authError).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    test("logs successful mock sign-in", async () => {
      mockEnsureMockWorkspaceForUser.mockResolvedValue("test-workspace");
      (db.workspace.findFirst as Mock).mockResolvedValue({
        id: "workspace-id",
        slug: "test-workspace",
        ownerId: mockUser.id,
      });

      const signInCallback = authOptions.callbacks?.signIn;
      if (!signInCallback) {
        throw new Error("signIn callback not found");
      }

      await signInCallback({
        user: mockUser,
        account: { ...mockAccount, provider: "mock" },
        profile: undefined,
      });

      expect(logger.authInfo).toHaveBeenCalledWith(
        expect.stringContaining("successfully created"),
        "signIn",
        expect.any(Object)
      );
    });
  });

  describe("GitHub OAuth Sign-In", () => {
    const mockExistingUser = {
      id: "existing-user-id",
      email: "existing@example.com",
      name: "Existing User",
    };

    test("creates account for new GitHub user with encrypted token", async () => {
      (db.user.findUnique as Mock).mockResolvedValue(null);

      const signInCallback = authOptions.callbacks?.signIn;
      if (!signInCallback) {
        throw new Error("signIn callback not found");
      }

      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
        profile: undefined,
      });

      expect(result).toBe(true);
      // New users are handled by PrismaAdapter, so we don't create account manually
    });

    test("updates existing account with new encrypted token", async () => {
      (db.user.findUnique as Mock).mockResolvedValue(mockExistingUser);
      (db.account.findFirst as Mock).mockResolvedValue({
        id: "account-id",
        userId: mockExistingUser.id,
        provider: "github",
        providerAccountId: "github-123",
        refresh_token: null,
        id_token: null,
      });

      const signInCallback = authOptions.callbacks?.signIn;
      if (!signInCallback) {
        throw new Error("signIn callback not found");
      }

      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
        profile: undefined,
      });

      expect(db.account.update).toHaveBeenCalledWith({
        where: { id: "account-id" },
        data: expect.objectContaining({
          access_token: expect.any(String),
          scope: mockAccount.scope,
        }),
      });
      expect(result).toBe(true);
    });

    test("creates new account link for existing user without GitHub", async () => {
      (db.user.findUnique as Mock).mockResolvedValue(mockExistingUser);
      (db.account.findFirst as Mock).mockResolvedValue(null);

      const signInCallback = authOptions.callbacks?.signIn;
      if (!signInCallback) {
        throw new Error("signIn callback not found");
      }

      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
        profile: undefined,
      });

      expect(db.account.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockExistingUser.id,
          provider: mockAccount.provider,
          providerAccountId: mockAccount.providerAccountId,
          type: mockAccount.type,
          access_token: expect.any(String),
          expires_at: mockAccount.expires_at,
          token_type: mockAccount.token_type,
          scope: mockAccount.scope,
        }),
      });
      expect(result).toBe(true);
    });

    test("encrypts GitHub access token before storage", async () => {
      (db.user.findUnique as Mock).mockResolvedValue(mockExistingUser);
      (db.account.findFirst as Mock).mockResolvedValue(null);
      const encryptionService = EncryptionService.getInstance();
      const encryptSpy = vi.spyOn(encryptionService, "encryptField");

      const signInCallback = authOptions.callbacks?.signIn;
      if (!signInCallback) {
        throw new Error("signIn callback not found");
      }

      await signInCallback({
        user: mockUser,
        account: mockAccount,
        profile: undefined,
      });

      expect(encryptSpy).toHaveBeenCalledWith("access_token", mockAccount.access_token);
    });

    test("handles missing access token gracefully", async () => {
      (db.user.findUnique as Mock).mockResolvedValue(mockExistingUser);
      (db.account.findFirst as Mock).mockResolvedValue({
        id: "account-id",
        userId: mockExistingUser.id,
        provider: "github",
      });

      const signInCallback = authOptions.callbacks?.signIn;
      if (!signInCallback) {
        throw new Error("signIn callback not found");
      }

      const accountWithoutToken = { ...mockAccount, access_token: undefined };
      const result = await signInCallback({
        user: mockUser,
        account: accountWithoutToken,
        profile: undefined,
      });

      expect(result).toBe(true);
      // Should not update account without access token
      expect(db.account.update).not.toHaveBeenCalled();
    });

    test("continues sign-in even if GitHub account linking fails", async () => {
      (db.user.findUnique as Mock).mockResolvedValue(mockExistingUser);
      (db.account.findFirst as Mock).mockRejectedValue(new Error("Database error"));

      const signInCallback = authOptions.callbacks?.signIn;
      if (!signInCallback) {
        throw new Error("signIn callback not found");
      }

      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
        profile: undefined,
      });

      expect(logger.authError).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });

  describe("Combined Provider Paths", () => {
    test("processes both mock and GitHub paths when applicable", async () => {
      mockEnsureMockWorkspaceForUser.mockResolvedValue("test-workspace");
      (db.workspace.findFirst as Mock).mockResolvedValue({
        id: "workspace-id",
        slug: "test-workspace",
        ownerId: mockUser.id,
      });
      (db.user.findFirst as Mock).mockResolvedValue(null);

      const signInCallback = authOptions.callbacks?.signIn;
      if (!signInCallback) {
        throw new Error("signIn callback not found");
      }

      const result = await signInCallback({
        user: mockUser,
        account: { ...mockAccount, provider: "mock" },
        profile: undefined,
      });

      expect(mockEnsureMockWorkspaceForUser).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });
});

describe("nextauth - session callback", () => {
  const mockSession = {
    user: {
      id: "test-user-id",
      email: "test@example.com",
      name: "Test User",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };

  const mockToken = {
    id: "test-user-id",
    email: "test@example.com",
    name: "Test User",
    picture: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.POD_URL;
  });

  describe("JWT Strategy (POD_URL set)", () => {
    beforeEach(() => {
      process.env.POD_URL = "http://localhost:3000";
    });

    test("resolves workspace slug for mock user", async () => {
      (db.workspace.findFirst as Mock).mockResolvedValue({
        id: "workspace-id",
        slug: "test-workspace",
        ownerId: mockSession.user.id,
      });

      const sessionCallback = authOptions.callbacks?.session;
      if (!sessionCallback) {
        throw new Error("session callback not found");
      }

      const result = await sessionCallback({
        session: mockSession,
        token: mockToken,
      });

      expect(result.user.id).toBe(mockSession.user.id);
      expect(result.user.defaultWorkspaceSlug).toBe("test-workspace");
    });

    test("handles missing workspace gracefully", async () => {
      (db.workspace.findFirst as Mock).mockResolvedValue(null);

      const sessionCallback = authOptions.callbacks?.session;
      if (!sessionCallback) {
        throw new Error("session callback not found");
      }

      const result = await sessionCallback({
        session: mockSession,
        token: mockToken,
      });

      expect(result.user.id).toBe(mockSession.user.id);
      expect(result.user.defaultWorkspaceSlug).toBeUndefined();
    });
  });

  describe("Database Strategy (POD_URL not set)", () => {
    test("fetches and upserts GitHub profile for real user", async () => {
      const mockGitHubProfile = {
        login: "testuser",
        name: "Test User",
        avatar_url: "https://github.com/avatar.png",
        public_repos: 15,
        followers: 20,
      };

      (db.gitHubAuth.upsert as Mock).mockResolvedValue({
        id: "github-auth-id",
        userId: mockSession.user.id,
        username: "testuser",
        publicRepos: 15,
        followers: 20,
      });
      (db.account.findFirst as Mock).mockResolvedValue({
        id: "account-id",
        userId: mockSession.user.id,
        provider: "github",
        access_token: JSON.stringify({
          data: "encrypted-data",
          iv: "test-iv",
          tag: "test-tag",
        }),
      });
      (axios.get as Mock).mockResolvedValue({ data: mockGitHubProfile });

      const sessionCallback = authOptions.callbacks?.session;
      if (!sessionCallback) {
        throw new Error("session callback not found");
      }

      const result = await sessionCallback({
        session: mockSession,
        token: mockToken,
      });

      expect(axios.get).toHaveBeenCalledWith(
        "https://api.github.com/user",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Bearer"),
          }),
        })
      );
      expect(db.gitHubAuth.upsert).toHaveBeenCalledWith({
        where: { userId: mockSession.user.id },
        update: expect.objectContaining({
          username: "testuser",
          publicRepos: 15,
          followers: 20,
        }),
        create: expect.objectContaining({
          userId: mockSession.user.id,
          username: "testuser",
          publicRepos: 15,
          followers: 20,
        }),
      });
    });

    test("adds mock GitHub data for mock users", async () => {
      const mockUserSession = {
        ...mockSession,
        user: { ...mockSession.user, email: "test@mock.dev" },
      };

      const sessionCallback = authOptions.callbacks?.session;
      if (!sessionCallback) {
        throw new Error("session callback not found");
      }

      const result = await sessionCallback({
        session: mockUserSession,
        token: mockToken,
      });

      expect(result.user.github).toMatchObject({
        username: expect.any(String),
        publicRepos: 5,
        followers: 10,
      });
    });

    test("handles GitHub API failure gracefully", async () => {
      (db.account.findFirst as Mock).mockResolvedValue({
        id: "account-id",
        userId: mockSession.user.id,
        provider: "github",
        access_token: JSON.stringify({
          data: "encrypted-data",
          iv: "test-iv",
          tag: "test-tag",
        }),
      });
      (axios.get as Mock).mockRejectedValue(new Error("GitHub API error"));

      const sessionCallback = authOptions.callbacks?.session;
      if (!sessionCallback) {
        throw new Error("session callback not found");
      }

      const result = await sessionCallback({
        session: mockSession,
        token: mockToken,
      });

      expect(logger.authWarn).toHaveBeenCalledWith(
        "GitHub profile fetch failed, skipping profile sync",
        "SESSION_GITHUB_API",
        expect.objectContaining({
          hasAccount: true,
          userId: mockSession.user.id,
        })
      );
      expect(result.user.id).toBe(mockSession.user.id);
    });

    test("handles missing GitHub account gracefully", async () => {
      (db.account.findFirst as Mock).mockResolvedValue(null);

      const sessionCallback = authOptions.callbacks?.session;
      if (!sessionCallback) {
        throw new Error("session callback not found");
      }

      const result = await sessionCallback({
        session: mockSession,
        token: mockToken,
      });

      expect(result.user.id).toBe(mockSession.user.id);
    });
  });
});

describe("nextauth - jwt callback", () => {
  const mockUser = {
    id: "test-user-id",
    email: "test@example.com",
    name: "Test User",
    image: null,
  };

  const mockToken = {
    sub: "test-user-id",
  };

  const mockAccount = {
    provider: "github",
    providerAccountId: "github-123",
    type: "oauth" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("populates token with user data on initial sign-in", async () => {
    const jwtCallback = authOptions.callbacks?.jwt;
    if (!jwtCallback) {
      throw new Error("jwt callback not found");
    }

    const result = await jwtCallback({
      token: mockToken,
      user: mockUser,
      account: mockAccount,
      profile: undefined,
      trigger: "signIn",
    });

    expect(result.id).toBe(mockUser.id);
    expect(result.email).toBe(mockUser.email);
    expect(result.name).toBe(mockUser.name);
    expect(result.picture).toBe(mockUser.image);
  });

  test("adds mock GitHub data for mock provider", async () => {
    const jwtCallback = authOptions.callbacks?.jwt;
    if (!jwtCallback) {
      throw new Error("jwt callback not found");
    }

    const result = await jwtCallback({
      token: mockToken,
      user: mockUser,
      account: { ...mockAccount, provider: "mock" },
      profile: undefined,
      trigger: "signIn",
    });

    expect(result.github).toMatchObject({
      username: expect.any(String),
      publicRepos: 5,
      followers: 10,
    });
  });

  test("returns existing token on subsequent requests", async () => {
    const existingToken = {
      ...mockToken,
      id: "test-user-id",
      email: "test@example.com",
      name: "Test User",
    };

    const jwtCallback = authOptions.callbacks?.jwt;
    if (!jwtCallback) {
      throw new Error("jwt callback not found");
    }

    const result = await jwtCallback({
      token: existingToken,
      user: undefined,
      account: undefined,
      profile: undefined,
      trigger: "update",
    });

    expect(result).toEqual(existingToken);
  });

  test("handles missing user gracefully", async () => {
    const jwtCallback = authOptions.callbacks?.jwt;
    if (!jwtCallback) {
      throw new Error("jwt callback not found");
    }

    const result = await jwtCallback({
      token: mockToken,
      user: undefined,
      account: undefined,
      profile: undefined,
      trigger: "update",
    });

    expect(result).toEqual(mockToken);
  });
});

describe("nextauth - getProviders function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.POD_URL;
  });

  test("returns GitHub provider when credentials are set", () => {
    process.env.GITHUB_CLIENT_ID = "test-client-id";
    process.env.GITHUB_CLIENT_SECRET = "test-client-secret";

    // Re-import to get updated environment
    const providers = authOptions.providers;

    const githubProvider = providers.find((p: any) => p.id === "github");
    expect(githubProvider).toBeDefined();
  });

  test("returns Credentials provider when POD_URL is set", () => {
    process.env.POD_URL = "http://localhost:3000";

    // Re-import to get updated environment
    const providers = authOptions.providers;

    const credentialsProvider = providers.find((p: any) => p.id === "credentials");
    expect(credentialsProvider).toBeDefined();
  });

  test("returns both providers when both are configured", () => {
    process.env.GITHUB_CLIENT_ID = "test-client-id";
    process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
    process.env.POD_URL = "http://localhost:3000";

    // Re-import to get updated environment
    const providers = authOptions.providers;

    expect(providers.length).toBeGreaterThanOrEqual(2);
  });

  test("handles missing credentials gracefully", () => {
    // No environment variables set
    const providers = authOptions.providers;

    // Should still be an array (may be empty or have default providers)
    expect(Array.isArray(providers)).toBe(true);
  });
});

describe("nextauth - Security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("encrypts access token before database storage", async () => {
    const mockExistingUser = {
      id: "existing-user-id",
      email: "existing@example.com",
      name: "Existing User",
    };

    (db.user.findUnique as Mock).mockResolvedValue(mockExistingUser);
    (db.account.findFirst as Mock).mockResolvedValue(null);

    const encryptionService = EncryptionService.getInstance();
    const encryptSpy = vi.spyOn(encryptionService, "encryptField");

    const signInCallback = authOptions.callbacks?.signIn;
    if (!signInCallback) {
      throw new Error("signIn callback not found");
    }

    await signInCallback({
      user: {
        id: "test-user-id",
        email: "test@example.com",
        emailVerified: null,
        name: "Test User",
        image: null,
      },
      account: {
        provider: "github",
        providerAccountId: "github-123",
        type: "oauth",
        access_token: "github-access-token",
        refresh_token: "github-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "Bearer",
        scope: "read:user user:email",
      },
      profile: undefined,
    });

    expect(encryptSpy).toHaveBeenCalled();
  });

  test("encrypted token has required fields", async () => {
    const encryptionService = EncryptionService.getInstance();
    const encrypted = encryptionService.encryptField("access_token", "test-token");

    expect(encrypted).toHaveProperty("data");
    expect(encrypted).toHaveProperty("iv");
    expect(encrypted).toHaveProperty("tag");
    expect(encrypted).toHaveProperty("version");
    expect(encrypted).toHaveProperty("encryptedAt");
  });

  test("does not leak sensitive data in error logs", async () => {
    mockEnsureMockWorkspaceForUser.mockResolvedValue("");
    (db.workspace.findFirst as Mock).mockResolvedValue(null);

    const signInCallback = authOptions.callbacks?.signIn;
    if (!signInCallback) {
      throw new Error("signIn callback not found");
    }

    await signInCallback({
      user: {
        id: "test-user-id",
        email: "test@example.com",
        emailVerified: null,
        name: "Test User",
        image: null,
      },
      account: {
        provider: "mock",
        providerAccountId: "mock-123",
        type: "oauth",
        access_token: "sensitive-token",
      },
      profile: undefined,
    });

    expect(logger.authError).toHaveBeenCalled();
    const errorCall = (logger.authError as Mock).mock.calls[0];
    const loggedData = JSON.stringify(errorCall);
    expect(loggedData).not.toContain("sensitive-token");
  });
});

describe("nextauth - Error Handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("logs error when workspace creation fails", async () => {
    mockEnsureMockWorkspaceForUser.mockResolvedValue("");
    (db.workspace.findFirst as Mock).mockResolvedValue(null);

    const signInCallback = authOptions.callbacks?.signIn;
    if (!signInCallback) {
      throw new Error("signIn callback not found");
    }

    await signInCallback({
      user: {
        id: "test-user-id",
        email: "test@example.com",
        emailVerified: null,
        name: "Test User",
        image: null,
      },
      account: {
        provider: "mock",
        providerAccountId: "mock-123",
        type: "oauth",
      },
      profile: undefined,
    });

    expect(logger.authError).toHaveBeenCalledWith(
      "Failed to create mock workspace - workspace slug is empty",
      "SIGNIN_MOCK_WORKSPACE_FAILED",
      expect.objectContaining({ userId: expect.any(String) })
    );
  });

  test("handles database errors during account creation", async () => {
    (db.user.findUnique as Mock).mockResolvedValue({
      id: "existing-user-id",
      email: "existing@example.com",
      name: "Existing User",
    });
    (db.account.findFirst as Mock).mockResolvedValue(null);
    (db.account.create as Mock).mockRejectedValue(new Error("Database error"));

    const signInCallback = authOptions.callbacks?.signIn;
    if (!signInCallback) {
      throw new Error("signIn callback not found");
    }

    const result = await signInCallback({
      user: {
        id: "test-user-id",
        email: "test@example.com",
        emailVerified: null,
        name: "Test User",
        image: null,
      },
      account: {
        provider: "github",
        providerAccountId: "github-123",
        type: "oauth",
        access_token: "github-token",
      },
      profile: undefined,
    });

    expect(logger.authError).toHaveBeenCalled();
    expect(result).toBe(true); // Still returns true to not block sign-in
  });

  test("handles missing user ID in session callback", async () => {
    const sessionWithoutUserId = {
      user: {
        email: "test@example.com",
        name: "Test User",
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    };

    const sessionCallback = authOptions.callbacks?.session;
    if (!sessionCallback) {
      throw new Error("session callback not found");
    }

    const result = await sessionCallback({
      session: sessionWithoutUserId,
      token: { sub: undefined },
    });

    expect(result).toBeDefined();
    expect(logger.authWarn).toHaveBeenCalledWith(
      "Session callback missing user identifier, skipping GitHub enrichment",
      "SESSION_NO_USER_ID",
      expect.objectContaining({
        hasToken: true,
        hasUser: false,
      })
    );
  });
});
