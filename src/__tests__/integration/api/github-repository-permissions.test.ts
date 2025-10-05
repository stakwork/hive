import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST, GET } from "@/app/api/github/repository/permissions/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectForbidden,
  expectNotFound,
  generateUniqueId,
  generateUniqueIntId,
  getMockedSession,
  createPostRequest,
  createGetRequest,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("GitHub Repository Permissions API Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  interface CreateTestUserWithGitHubTokenOptions {
    accessToken?: string;
    githubLogin?: string;
  }

  async function createTestUserWithGitHubToken(
    options?: CreateTestUserWithGitHubTokenOptions
  ) {
    const {
      accessToken = "github_app_token_test_123",
      githubLogin = "test-owner",
    } = options || {};

    return await db.$transaction(async (tx) => {
      const testUser = await tx.user.create({
        data: {
          id: generateUniqueId("test-user"),
          email: `test-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const sourceControlOrg = await tx.sourceControlOrg.create({
        data: {
          githubLogin,
          githubInstallationId: generateUniqueIntId(),
        },
      });

      const encryptedToken = encryptionService.encryptField(
        "source_control_token",
        accessToken
      );

      const sourceControlToken = await tx.sourceControlToken.create({
        data: {
          userId: testUser.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: JSON.stringify(encryptedToken),
        },
      });

      return { testUser, sourceControlOrg, sourceControlToken };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("POST /api/github/repository/permissions", () => {
    describe("Authentication scenarios", () => {
      test("should return 401 for unauthenticated request", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/owner/repo",
          }
        );

        const response = await POST(request);

        await expectUnauthorized(response);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 401 for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" },
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/owner/repo",
          }
        );

        const response = await POST(request);

        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data.error).toBe("Unauthorized");
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    describe("Input validation scenarios", () => {
      test("should return 400 for missing repository URL", async () => {
        const { testUser } = await createTestUserWithGitHubToken();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {}
        );

        const response = await POST(request);

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data.error).toBe("Repository URL is required");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 403 for invalid GitHub URL format (no tokens found)", async () => {
        // Create a test user with NO tokens - this causes 403 before URL validation
        const testUser = await createTestUser({ name: "User Without Tokens" });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://not-github.com/owner/repo",
          }
        );

        const response = await POST(request);

        // The API validates URL format after checking for tokens
        // Since no tokens exist, it returns 403 before reaching URL validation
        expect(response.status).toBe(403);
        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data.error).toBe("no_github_tokens");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should handle HTTPS repository URLs", async () => {
        const { testUser } = await createTestUserWithGitHubToken({
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            permissions: { push: true, admin: false },
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
          }),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/test-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/repos/test-owner/test-repo",
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: "Bearer github_app_token_test_123",
            }),
          })
        );
      });

      test("should handle SSH repository URLs", async () => {
        const { testUser } = await createTestUserWithGitHubToken({
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            permissions: { push: true, admin: false },
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
          }),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "git@github.com:test-owner/test-repo.git",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/repos/test-owner/test-repo",
          expect.any(Object)
        );
      });

      test("should handle repository URLs with .git extension", async () => {
        const { testUser } = await createTestUserWithGitHubToken({
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            permissions: { push: true, admin: false },
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
          }),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/test-repo.git",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
      });
    });

    describe("Token management scenarios", () => {
      test("should return 403 when no GitHub tokens found for user", async () => {
        const testUser = await createTestUser({ name: "User Without Tokens" });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/owner/repo",
          }
        );

        const response = await POST(request);

        expect(response.status).toBe(403);
        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data.error).toBe("no_github_tokens");
        expect(data.message).toContain("No GitHub App tokens found");
        expect(mockFetch).not.toHaveBeenCalled();
      });

      test("should return 403 when no tokens found for specific GitHub owner", async () => {
        await createTestUserWithGitHubToken({
          githubLogin: "different-owner",
        });

        const testUser = await createTestUser({
          name: "User With Different Org",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/target-owner/repo",
          }
        );

        const response = await POST(request);

        expect(response.status).toBe(403);
        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data.error).toBe("no_github_tokens");
      });

      test("should properly decrypt encrypted access tokens", async () => {
        const originalToken = "github_app_decrypted_token_456";
        const { testUser } = await createTestUserWithGitHubToken({
          accessToken: originalToken,
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            permissions: { push: true, admin: false },
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
          }),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/test-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/repos/test-owner/test-repo",
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: `Bearer ${originalToken}`,
            }),
          })
        );
      });

      test("should use org-scoped token retrieval", async () => {
        const testUser = await createTestUser({ name: "Multi-Org User" });

        const org1 = await db.sourceControlOrg.create({
          data: {
            githubLogin: "org-one",
            githubInstallationId: generateUniqueIntId(),
          },
        });

        const org2 = await db.sourceControlOrg.create({
          data: {
            githubLogin: "org-two",
            githubInstallationId: generateUniqueIntId(),
          },
        });

        const token1 = encryptionService.encryptField(
          "source_control_token",
          "token_for_org_one"
        );
        const token2 = encryptionService.encryptField(
          "source_control_token",
          "token_for_org_two"
        );

        await db.sourceControlToken.create({
          data: {
            userId: testUser.id,
            sourceControlOrgId: org1.id,
            token: JSON.stringify(token1),
          },
        });

        await db.sourceControlToken.create({
          data: {
            userId: testUser.id,
            sourceControlOrgId: org2.id,
            token: JSON.stringify(token2),
          },
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            permissions: { push: true, admin: false },
            name: "repo",
            full_name: "org-two/repo",
            private: false,
            default_branch: "main",
          }),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/org-two/repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/repos/org-two/repo",
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: "Bearer token_for_org_two",
            }),
          })
        );
      });
    });

    describe("GitHub API integration - success scenarios", () => {
      test("should successfully check repository permissions with push access", async () => {
        const { testUser } = await createTestUserWithGitHubToken({
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            permissions: {
              push: true,
              pull: true,
              admin: false,
              maintain: false,
            },
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
          }),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/test-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data).toMatchObject({
          hasAccess: true,
          canPush: true,
          canAdmin: false,
          permissions: {
            push: true,
            pull: true,
            admin: false,
            maintain: false,
          },
          repository: {
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
          },
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/repos/test-owner/test-repo",
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: "Bearer github_app_token_test_123",
              Accept: "application/vnd.github.v3+json",
            }),
          })
        );
      });

      test("should successfully check repository permissions with admin access", async () => {
        const { testUser } = await createTestUserWithGitHubToken({
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            permissions: {
              push: true,
              pull: true,
              admin: true,
              maintain: true,
            },
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: true,
            default_branch: "develop",
          }),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/test-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data).toMatchObject({
          hasAccess: true,
          canPush: true,
          canAdmin: true,
          permissions: {
            admin: true,
          },
        });
      });

      test("should successfully check repository permissions with maintain access", async () => {
        const { testUser } = await createTestUserWithGitHubToken({
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            permissions: {
              push: false,
              pull: true,
              admin: false,
              maintain: true,
            },
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
          }),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/test-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data).toMatchObject({
          hasAccess: true,
          canPush: true,
          canAdmin: false,
          permissions: {
            maintain: true,
          },
        });
      });

      test("should successfully check repository permissions with read-only access", async () => {
        const { testUser } = await createTestUserWithGitHubToken({
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            permissions: {
              push: false,
              pull: true,
              admin: false,
              maintain: false,
            },
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
          }),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/test-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data).toMatchObject({
          hasAccess: true,
          canPush: false,
          canAdmin: false,
        });
      });
    });

    describe("Permission logic verification", () => {
      test.each([
        {
          name: "push permission grants canPush",
          permissions: { push: true, admin: false, maintain: false },
          expectedCanPush: true,
          expectedCanAdmin: false,
        },
        {
          name: "admin permission grants both canPush and canAdmin",
          permissions: { push: false, admin: true, maintain: false },
          expectedCanPush: true,
          expectedCanAdmin: true,
        },
        {
          name: "maintain permission grants canPush but not canAdmin",
          permissions: { push: false, admin: false, maintain: true },
          expectedCanPush: true,
          expectedCanAdmin: false,
        },
        {
          name: "no push/admin/maintain permissions denies canPush and canAdmin",
          permissions: { push: false, admin: false, maintain: false },
          expectedCanPush: false,
          expectedCanAdmin: false,
        },
        {
          name: "all permissions grant both canPush and canAdmin",
          permissions: { push: true, admin: true, maintain: true },
          expectedCanPush: true,
          expectedCanAdmin: true,
        },
        {
          name: "push and maintain grant canPush but not canAdmin",
          permissions: { push: true, admin: false, maintain: true },
          expectedCanPush: true,
          expectedCanAdmin: false,
        },
      ])(
        "$name",
        async ({ permissions, expectedCanPush, expectedCanAdmin }) => {
          const { testUser } = await createTestUserWithGitHubToken({
            githubLogin: "test-owner",
          });

          getMockedSession().mockResolvedValue(
            createAuthenticatedSession(testUser)
          );

          mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
              permissions,
              name: "test-repo",
              full_name: "test-owner/test-repo",
              private: false,
              default_branch: "main",
            }),
          });

          const request = createPostRequest(
            "http://localhost:3000/api/github/repository/permissions",
            {
              repositoryUrl: "https://github.com/test-owner/test-repo",
            }
          );

          const response = await POST(request);
          const data = await expectSuccess(response);

          expect(data.data.canPush).toBe(expectedCanPush);
          expect(data.data.canAdmin).toBe(expectedCanAdmin);
        }
      );
    });

    describe("GitHub API error scenarios", () => {
      test("should handle 404 repository not found", async () => {
        const { testUser } = await createTestUserWithGitHubToken({
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: false,
          status: 404,
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/nonexistent-repo",
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(false);
        expect(data.data.hasAccess).toBe(false);
        expect(data.data.canPush).toBe(false);
        expect(data.data.canAdmin).toBe(false);
        expect(data.error).toBe("repository_not_found_or_no_access");
      });

      test("should handle 403 access forbidden", async () => {
        const { testUser } = await createTestUserWithGitHubToken({
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: false,
          status: 403,
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/private-repo",
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(false);
        expect(data.data.hasAccess).toBe(false);
        expect(data.error).toBe("access_forbidden");
      });

      test("should handle GitHub API rate limiting (429)", async () => {
        const { testUser } = await createTestUserWithGitHubToken({
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: false,
          status: 429,
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/test-repo",
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(data.success).toBe(false);
        expect(data.error).toBe("http_error_429");
      });

      test("should handle GitHub API server errors (500)", async () => {
        const { testUser } = await createTestUserWithGitHubToken({
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/test-repo",
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(data.success).toBe(false);
        expect(data.error).toBe("http_error_500");
      });

      test("should handle network errors", async () => {
        const { testUser } = await createTestUserWithGitHubToken({
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockRejectedValue(new Error("Network error"));

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/test-repo",
          }
        );

        const response = await POST(request);
        const data = await response.json();

        expect(data.success).toBe(false);
        expect(data.error).toBe("network_error");
      });

      test("should handle invalid JSON responses from GitHub API", async () => {
        const { testUser } = await createTestUserWithGitHubToken({
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("Invalid JSON");
          },
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/test-repo",
          }
        );

        const response = await POST(request);
        const data = await response.json();

        // The API catches JSON parsing errors and returns 200 with success: false
        expect(response.status).toBe(200);
        expect(data.success).toBe(false);
        expect(data.error).toBe("network_error");
      });
    });

    describe("Edge cases and error handling", () => {
      test("should handle malformed repository URLs gracefully", async () => {
        const { testUser } = await createTestUserWithGitHubToken();

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "not-a-valid-url",
          }
        );

        const response = await POST(request);

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe("Invalid repository URL");
      });

      test("should handle GitHub URLs with special characters in repo name", async () => {
        const { testUser } = await createTestUserWithGitHubToken({
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            permissions: { push: true, admin: false },
            name: "repo-with-dashes_and_underscores",
            full_name: "test-owner/repo-with-dashes_and_underscores",
            private: false,
            default_branch: "main",
          }),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl:
              "https://github.com/test-owner/repo-with-dashes_and_underscores",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
      });

      test("should handle repositories with missing permissions object", async () => {
        const { testUser } = await createTestUserWithGitHubToken({
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
          }),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/test-repo",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.data.canPush).toBe(false);
        expect(data.data.canAdmin).toBe(false);
      });

      test("should handle workspaceSlug parameter (for future workspace scoping)", async () => {
        const { testUser } = await createTestUserWithGitHubToken({
          githubLogin: "test-owner",
        });

        getMockedSession().mockResolvedValue(
          createAuthenticatedSession(testUser)
        );

        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            permissions: { push: true, admin: false },
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
          }),
        });

        const request = createPostRequest(
          "http://localhost:3000/api/github/repository/permissions",
          {
            repositoryUrl: "https://github.com/test-owner/test-repo",
            workspaceSlug: "test-workspace",
          }
        );

        const response = await POST(request);
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
      });
    });
  });

  describe("GET /api/github/repository/permissions", () => {
    test("should handle GET request with query parameters", async () => {
      const { testUser } = await createTestUserWithGitHubToken({
        githubLogin: "test-owner",
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          permissions: { push: true, admin: false },
          name: "test-repo",
          full_name: "test-owner/test-repo",
          private: false,
          default_branch: "main",
        }),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/github/repository/permissions",
        {
          repositoryUrl: "https://github.com/test-owner/test-repo",
        }
      );

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.data.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/test-repo",
        expect.any(Object)
      );
    });

    test("should return 400 for GET request without repository URL", async () => {
      const { testUser } = await createTestUserWithGitHubToken();

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        "http://localhost:3000/api/github/repository/permissions"
      );

      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Repository URL is required");
    });

    test("should handle GET request with workspaceSlug parameter", async () => {
      const { testUser } = await createTestUserWithGitHubToken({
        githubLogin: "test-owner",
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          permissions: { push: true, admin: false },
          name: "test-repo",
          full_name: "test-owner/test-repo",
          private: false,
          default_branch: "main",
        }),
      });

      const request = createGetRequest(
        "http://localhost:3000/api/github/repository/permissions",
        {
          repositoryUrl: "https://github.com/test-owner/test-repo",
          workspaceSlug: "test-workspace",
        }
      );

      const response = await GET(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
    });

    test("should return 401 for unauthenticated GET request", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        "http://localhost:3000/api/github/repository/permissions",
        {
          repositoryUrl: "https://github.com/owner/repo",
        }
      );

      const response = await GET(request);

      await expectUnauthorized(response);
    });
  });
});