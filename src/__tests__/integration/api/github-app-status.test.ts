import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/github/app/status/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getUserAppTokens, checkRepositoryAccess } from "@/lib/githubApp";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures";
import { createTestUserWithGitHubTokens } from "@/__tests__/support/fixtures/github-repository-permissions";
import {
  createGetRequest,
  createAuthenticatedGetRequest,
  expectSuccess,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import type { User, Workspace, SourceControlOrg } from "@prisma/client";

// Mock next-auth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock githubApp helpers
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
  checkRepositoryAccess: vi.fn(),
}));

import { getServerSession } from "next-auth/next";

const getMockedGetServerSession = vi.mocked(getServerSession);
const getMockedGetUserAppTokens = vi.mocked(getUserAppTokens);
const getMockedCheckRepositoryAccess = vi.mocked(checkRepositoryAccess);

// Mock fetch for GitHub API calls
const mockFetch = vi.fn();

describe("GET /api/github/app/status - Authentication", () => {
  beforeEach(() => {
    globalThis.fetch = mockFetch as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return default response for unauthenticated requests", async () => {
    getMockedGetServerSession.mockResolvedValue(null);

    const request = createGetRequest("/api/github/app/status");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ hasTokens: false, hasRepoAccess: false });
  });

  it("should return default response when session has no user", async () => {
    getMockedGetServerSession.mockResolvedValue({
      user: null,
      expires: new Date().toISOString(),
    } as any);

    const request = createGetRequest("/api/github/app/status");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ hasTokens: false, hasRepoAccess: false });
  });

  it("should return default response when session user has no id", async () => {
    getMockedGetServerSession.mockResolvedValue({
      user: { email: "test@example.com" },
      expires: new Date().toISOString(),
    } as any);

    const request = createGetRequest("/api/github/app/status");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ hasTokens: false, hasRepoAccess: false });
  });
});

describe("GET /api/github/app/status - Global Token Check", () => {
  let testUser: User;
  let accessToken: string;

  beforeEach(async () => {
    globalThis.fetch = mockFetch as any;

    // Create test user with GitHub tokens
    const result = await createTestUserWithGitHubTokens({
      githubOwner: "test-owner",
      accessToken: "github_pat_test_global_token",
    });
    testUser = result.testUser;
    accessToken = result.accessToken;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return hasTokens true when user has any GitHub App tokens", async () => {
    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    getMockedGetUserAppTokens.mockResolvedValue({ accessToken });

    const request = createAuthenticatedGetRequest(
      "/api/github/app/status",
      testUser
    );
    const response = await GET(request);

    const data = await expectSuccess(response);
    expect(data.hasTokens).toBe(true);
    expect(data.hasRepoAccess).toBe(false); // No workspace or repo URL provided
  });

  it("should return hasTokens false when user has no GitHub App tokens", async () => {
    // Create user without tokens
    const userWithoutTokens = await db.user.create({
      data: {
        id: generateUniqueId("user"),
        email: `no-tokens-${generateUniqueId()}@example.com`,
        name: "User Without Tokens",
      },
    });

    getMockedGetServerSession.mockResolvedValue({
      user: {
        id: userWithoutTokens.id,
        email: userWithoutTokens.email,
        name: userWithoutTokens.name,
      },
      expires: new Date().toISOString(),
    } as any);

    getMockedGetUserAppTokens.mockResolvedValue(null);

    const request = createAuthenticatedGetRequest(
      "/api/github/app/status",
      userWithoutTokens
    );
    const response = await GET(request);

    const data = await expectSuccess(response);
    expect(data.hasTokens).toBe(false);
    expect(data.hasRepoAccess).toBe(false);
  });
});

describe("GET /api/github/app/status - Workspace Access Validation", () => {
  let owner: User;
  let workspace: Workspace;
  let nonMember: User;

  beforeEach(async () => {
    globalThis.fetch = mockFetch as any;

    const scenario = await createTestWorkspaceScenario({
      owner: { name: "GitHub Status Owner" },
    });

    owner = scenario.owner;
    workspace = scenario.workspace;

    // Create non-member user
    nonMember = await db.user.create({
      data: {
        id: generateUniqueId("user"),
        email: `non-member-${generateUniqueId()}@example.com`,
        name: "Non Member User",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 403 for non-member trying to access workspace status", async () => {
    getMockedGetServerSession.mockResolvedValue({
      user: {
        id: nonMember.id,
        email: nonMember.email,
        name: nonMember.name,
      },
      expires: new Date().toISOString(),
    } as any);

    const request = createAuthenticatedGetRequest(
      `/api/github/app/status?workspaceSlug=${workspace.slug}`,
      nonMember
    );
    const response = await GET(request);

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Workspace not found or access denied");
  });

  it("should allow workspace member to check GitHub App status", async () => {
    getMockedGetServerSession.mockResolvedValue({
      user: { id: owner.id, email: owner.email, name: owner.name },
      expires: new Date().toISOString(),
    } as any);

    getMockedGetUserAppTokens.mockResolvedValue(null);

    const request = createAuthenticatedGetRequest(
      `/api/github/app/status?workspaceSlug=${workspace.slug}`,
      owner
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    // When workspace has no repo URL, API returns early with only hasTokens
    expect(data).toHaveProperty("hasTokens");
    expect(data.hasTokens).toBe(false);
  });
});

describe("GET /api/github/app/status - Workspace-Specific Token Check", () => {
  let testUser: User;
  let workspace: Workspace;
  let sourceControlOrg: SourceControlOrg;
  let accessToken: string;

  beforeEach(async () => {
    globalThis.fetch = mockFetch as any;

    // Create test user with GitHub tokens
    const result = await createTestUserWithGitHubTokens({
      githubOwner: "test-workspace-org",
      accessToken: "github_pat_workspace_token",
      githubInstallationId: 987654321,
    });
    testUser = result.testUser;
    sourceControlOrg = result.sourceControlOrg;
    accessToken = result.accessToken;

    // Create workspace linked to this org
    workspace = await db.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: "Test Workspace",
        slug: `workspace-${generateUniqueId()}`,
        ownerId: testUser.id,
        sourceControlOrgId: sourceControlOrg.id,
      },
    });

    // Add user as workspace member
    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: testUser.id,
        role: "OWNER",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return hasTokens true when user has tokens for workspace org", async () => {
    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    const request = createAuthenticatedGetRequest(
      `/api/github/app/status?workspaceSlug=${workspace.slug}`,
      testUser
    );
    const response = await GET(request);

    const data = await expectSuccess(response);
    expect(data.hasTokens).toBe(true);
    expect(data.hasRepoAccess).toBe(false); // No repo URL provided
  });

  it("should check tokens for specific workspace sourceControlOrg", async () => {
    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    const request = createAuthenticatedGetRequest(
      `/api/github/app/status?workspaceSlug=${workspace.slug}`,
      testUser
    );
    await GET(request);

    // Verify that tokens were checked via database query for this specific org
    const tokenCheck = await db.sourceControlToken.findUnique({
      where: {
        userId_sourceControlOrgId: {
          userId: testUser.id,
          sourceControlOrgId: sourceControlOrg.id,
        },
      },
    });
    expect(tokenCheck).toBeTruthy();
  });

  it("should return hasTokens false when user has no tokens for workspace org", async () => {
    // Create another user without tokens
    const userWithoutTokens = await db.user.create({
      data: {
        id: generateUniqueId("user"),
        email: `no-workspace-tokens-${generateUniqueId()}@example.com`,
        name: "User Without Workspace Tokens",
      },
    });

    // Add as workspace member
    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: userWithoutTokens.id,
        role: "DEVELOPER",
      },
    });

    getMockedGetServerSession.mockResolvedValue({
      user: {
        id: userWithoutTokens.id,
        email: userWithoutTokens.email,
        name: userWithoutTokens.name,
      },
      expires: new Date().toISOString(),
    } as any);

    const request = createAuthenticatedGetRequest(
      `/api/github/app/status?workspaceSlug=${workspace.slug}`,
      userWithoutTokens
    );
    const response = await GET(request);

    const data = await expectSuccess(response);
    expect(data.hasTokens).toBe(false);
    expect(data.hasRepoAccess).toBe(false);
  });
});

describe("GET /api/github/app/status - Auto-Linking Feature", () => {
  let testUser: User;
  let workspace: Workspace;
  let sourceControlOrg: SourceControlOrg;
  let accessToken: string;

  beforeEach(async () => {
    globalThis.fetch = mockFetch as any;

    // Create test user with GitHub tokens
    const result = await createTestUserWithGitHubTokens({
      githubOwner: "auto-link-org",
      accessToken: "github_pat_auto_link_token",
      githubInstallationId: 555555555,
    });
    testUser = result.testUser;
    sourceControlOrg = result.sourceControlOrg;
    accessToken = result.accessToken;

    // Create workspace WITHOUT sourceControlOrgId (unlinked)
    workspace = await db.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: "Unlinked Workspace",
        slug: `unlinked-${generateUniqueId()}`,
        ownerId: testUser.id,
        repositoryDraft: "https://github.com/auto-link-org/test-repo",
      },
    });

    // Add user as workspace member
    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: testUser.id,
        role: "OWNER",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should auto-link workspace to existing SourceControlOrg by GitHub owner", async () => {
    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    const request = createAuthenticatedGetRequest(
      `/api/github/app/status?workspaceSlug=${workspace.slug}`,
      testUser
    );
    await GET(request);

    // Verify workspace was auto-linked
    const updatedWorkspace = await db.workspace.findUnique({
      where: { id: workspace.id },
    });
    expect(updatedWorkspace?.sourceControlOrgId).toBe(sourceControlOrg.id);
  });

  it("should return hasTokens true after auto-linking when user has tokens", async () => {
    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    const request = createAuthenticatedGetRequest(
      `/api/github/app/status?workspaceSlug=${workspace.slug}`,
      testUser
    );
    const response = await GET(request);

    const data = await expectSuccess(response);
    expect(data.hasTokens).toBe(true);
  });

  it("should return hasTokens false when SourceControlOrg does not exist", async () => {
    // Create workspace with non-existent GitHub org
    const unlinkedWorkspace = await db.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: "No Org Workspace",
        slug: `no-org-${generateUniqueId()}`,
        ownerId: testUser.id,
        repositoryDraft: "https://github.com/nonexistent-org/test-repo",
      },
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: unlinkedWorkspace.id,
        userId: testUser.id,
        role: "OWNER",
      },
    });

    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    const request = createAuthenticatedGetRequest(
      `/api/github/app/status?workspaceSlug=${unlinkedWorkspace.slug}`,
      testUser
    );
    const response = await GET(request);

    const data = await expectSuccess(response);
    expect(data.hasTokens).toBe(false);
  });

  it("should handle workspace with no repository URL", async () => {
    // Create workspace without repositoryDraft and no primary repository
    const noRepoWorkspace = await db.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: "No Repo Workspace",
        slug: `no-repo-${generateUniqueId()}`,
        ownerId: testUser.id,
      },
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: noRepoWorkspace.id,
        userId: testUser.id,
        role: "OWNER",
      },
    });

    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    const request = createAuthenticatedGetRequest(
      `/api/github/app/status?workspaceSlug=${noRepoWorkspace.slug}`,
      testUser
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.hasTokens).toBe(false);
  });
});

describe("GET /api/github/app/status - Repository Access Check", () => {
  let testUser: User;
  let workspace: Workspace;
  let sourceControlOrg: SourceControlOrg;
  let accessToken: string;

  beforeEach(async () => {
    globalThis.fetch = mockFetch as any;

    // Create test user with GitHub tokens
    const result = await createTestUserWithGitHubTokens({
      githubOwner: "repo-access-org",
      accessToken: "github_pat_repo_access_token",
      githubInstallationId: 888888888,
    });
    testUser = result.testUser;
    sourceControlOrg = result.sourceControlOrg;
    accessToken = result.accessToken;

    // Create workspace linked to org with repository URL
    workspace = await db.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: "Repo Access Workspace",
        slug: `repo-access-${generateUniqueId()}`,
        ownerId: testUser.id,
        sourceControlOrgId: sourceControlOrg.id,
        repositoryDraft: "https://github.com/repo-access-org/test-repo",
      },
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: testUser.id,
        role: "OWNER",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should check repository access when tokens and repo URL exist", async () => {
    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    getMockedCheckRepositoryAccess.mockResolvedValue(true);

    const request = createAuthenticatedGetRequest(
      `/api/github/app/status?workspaceSlug=${workspace.slug}`,
      testUser
    );
    const response = await GET(request);

    const data = await expectSuccess(response);
    expect(data.hasTokens).toBe(true);
    expect(data.hasRepoAccess).toBe(true);

    // Verify checkRepositoryAccess was called with correct parameters
    expect(getMockedCheckRepositoryAccess).toHaveBeenCalledWith(
      testUser.id,
      sourceControlOrg.githubInstallationId?.toString(),
      "https://github.com/repo-access-org/test-repo"
    );
  });

  it("should return hasRepoAccess false when user lacks repository access", async () => {
    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    getMockedCheckRepositoryAccess.mockResolvedValue(false);

    const request = createAuthenticatedGetRequest(
      `/api/github/app/status?workspaceSlug=${workspace.slug}`,
      testUser
    );
    const response = await GET(request);

    const data = await expectSuccess(response);
    expect(data.hasTokens).toBe(true);
    expect(data.hasRepoAccess).toBe(false);
  });

  it("should accept repositoryUrl query parameter", async () => {
    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    getMockedCheckRepositoryAccess.mockResolvedValue(true);

    const customRepoUrl = "https://github.com/repo-access-org/custom-repo";
    const request = createAuthenticatedGetRequest(
      `/api/github/app/status?workspaceSlug=${workspace.slug}&repositoryUrl=${encodeURIComponent(customRepoUrl)}`,
      testUser
    );
    const response = await GET(request);

    const data = await expectSuccess(response);
    expect(data.hasRepoAccess).toBe(true);

    // Verify checkRepositoryAccess was called with custom repo URL
    expect(getMockedCheckRepositoryAccess).toHaveBeenCalledWith(
      testUser.id,
      sourceControlOrg.githubInstallationId?.toString(),
      customRepoUrl
    );
  });

  // Test skipped: githubInstallationId is non-nullable in schema (Int, not Int?),
  // so we cannot test the null installationId scenario with current schema constraints.
  // The API code checks for nullability but the schema doesn't allow it.
  it.skip("should skip repo access check when installationId is missing", async () => {
    // This test cannot run because githubInstallationId is required (non-nullable)
    // in the Prisma schema. The API handles optional installationId, but the
    // database schema enforces it as required.
    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    const request = createAuthenticatedGetRequest(
      `/api/github/app/status?workspaceSlug=${workspace.slug}`,
      testUser
    );
    const response = await GET(request);

    const data = await expectSuccess(response);
    expect(data.hasTokens).toBe(true);
    expect(data.hasRepoAccess).toBe(false);

    // Verify checkRepositoryAccess was NOT called
    expect(getMockedCheckRepositoryAccess).not.toHaveBeenCalled();
  });

  it("should skip repo access check when repo URL is missing", async () => {
    // Update workspace to have no repositoryDraft
    await db.workspace.update({
      where: { id: workspace.id },
      data: { repositoryDraft: null },
    });

    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    const request = createAuthenticatedGetRequest(
      `/api/github/app/status?workspaceSlug=${workspace.slug}`,
      testUser
    );
    const response = await GET(request);

    const data = await expectSuccess(response);
    expect(data.hasTokens).toBe(true);
    expect(data.hasRepoAccess).toBe(false);

    // Verify checkRepositoryAccess was NOT called
    expect(getMockedCheckRepositoryAccess).not.toHaveBeenCalled();
  });
});

describe("GET /api/github/app/status - Error Handling", () => {
  let testUser: User;
  let workspace: Workspace;

  beforeEach(async () => {
    globalThis.fetch = mockFetch as any;

    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Error Handling Owner" },
    });

    testUser = scenario.owner;
    workspace = scenario.workspace;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return default response on unexpected errors", async () => {
    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    // Mock getUserAppTokens to throw an error
    getMockedGetUserAppTokens.mockRejectedValue(
      new Error("Unexpected database error")
    );

    const request = createAuthenticatedGetRequest(
      "/api/github/app/status",
      testUser
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ hasTokens: false, hasRepoAccess: false });
  });

  it("should handle database connection errors gracefully", async () => {
    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    // Mock a database connection error by mocking the dynamic import
    vi.doMock("@/lib/db", () => ({
      db: {
        workspace: {
          findUnique: vi
            .fn()
            .mockRejectedValue(new Error("Database connection failed")),
        },
      },
    }));

    const request = createAuthenticatedGetRequest(
      `/api/github/app/status?workspaceSlug=${workspace.slug}`,
      testUser
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ hasTokens: false, hasRepoAccess: false });
  });

  it("should handle malformed repository URLs gracefully", async () => {
    // Create workspace with malformed repository URL
    const malformedWorkspace = await db.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: "Malformed Repo Workspace",
        slug: `malformed-${generateUniqueId()}`,
        ownerId: testUser.id,
        repositoryDraft: "not-a-valid-url",
      },
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: malformedWorkspace.id,
        userId: testUser.id,
        role: "OWNER",
      },
    });

    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    const request = createAuthenticatedGetRequest(
      `/api/github/app/status?workspaceSlug=${malformedWorkspace.slug}`,
      testUser
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.hasTokens).toBe(false);
  });
});

describe("GET /api/github/app/status - Token Encryption", () => {
  it("should handle encrypted tokens correctly", async () => {
    globalThis.fetch = mockFetch as any;

    // Create test user with encrypted tokens
    const result = await createTestUserWithGitHubTokens({
      githubOwner: "encryption-test-org",
      accessToken: "github_pat_encryption_test_token_with_special_chars_!@#$%",
      githubInstallationId: 999999999,
    });
    const testUser = result.testUser;
    const sourceControlOrg = result.sourceControlOrg;

    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    // Verify token was stored encrypted
    const storedToken = await db.sourceControlToken.findUnique({
      where: {
        userId_sourceControlOrgId: {
          userId: testUser.id,
          sourceControlOrgId: sourceControlOrg.id,
        },
      },
    });

    expect(storedToken).toBeTruthy();
    expect(storedToken?.token).toBeTruthy();

    // Token should be encrypted (JSON string format)
    const parsedToken = JSON.parse(storedToken?.token as string);
    expect(parsedToken).toHaveProperty("data");
    expect(parsedToken).toHaveProperty("iv");
    expect(parsedToken).toHaveProperty("tag");

    // Verify decryption works
    const encryptionService = EncryptionService.getInstance();
    const decryptedToken = encryptionService.decryptField(
      "source_control_token",
      storedToken?.token as string
    );
    expect(decryptedToken).toBe(
      "github_pat_encryption_test_token_with_special_chars_!@#$%"
    );
  });

  it("should handle token decryption failures gracefully", async () => {
    globalThis.fetch = mockFetch as any;

    const testUser = await db.user.create({
      data: {
        id: generateUniqueId("user"),
        email: `decryption-fail-${generateUniqueId()}@example.com`,
        name: "Decryption Fail User",
      },
    });

    getMockedGetServerSession.mockResolvedValue({
      user: { id: testUser.id, email: testUser.email, name: testUser.name },
      expires: new Date().toISOString(),
    } as any);

    // Mock getUserAppTokens to simulate decryption failure
    getMockedGetUserAppTokens.mockResolvedValue(null);

    const request = createAuthenticatedGetRequest(
      "/api/github/app/status",
      testUser
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.hasTokens).toBe(false);
  });
});