import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { WebhookService } from "@/services/github/WebhookService";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import {
  mockGitHubApiResponses,
  mockGitHubApiErrors,
} from "@/__tests__/support/fixtures/github-webhook";

/**
 * Unit Tests: WebhookService
 * 
 * Tests GitHub webhook service layer for GitHub API integration,
 * idempotency, secret management, and error handling.
 * 
 * Priority: MEDIUM (Priority 3)
 * 
 * Coverage:
 * - ensureRepoWebhook() - Idempotent webhook creation/update
 * - GitHub API operations (listHooks, createHook, updateHook, deleteHook)
 * - Secret generation and encryption
 * - Error handling for GitHub API errors (403, 404)
 * - Repository lookup and validation
 * - Default branch detection
 */

// Mock external dependencies
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findUnique: vi.fn(),
    },
    repository: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Create a mock encryptionService that will be returned by getInstance
const mockEncryptionService = {
  encryptField: vi.fn((fieldName: string, value: string) => ({
    data: `encrypted_${value}`,
    iv: "mock_iv",
    tag: "mock_tag",
    version: "1",
    encryptedAt: new Date().toISOString(),
  })),
  decryptField: vi.fn((fieldName: string, encrypted: any) => {
    if (typeof encrypted === "string") {
      try {
        const parsed = JSON.parse(encrypted);
        if (parsed.data && parsed.data.includes("encrypted_")) {
          return parsed.data.replace("encrypted_", "");
        }
      } catch {
        // If not JSON, try direct replacement
        if (encrypted.includes("encrypted_")) {
          return encrypted.replace("encrypted_", "");
        }
      }
    }
    return "decrypted_value";
  }),
};

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => mockEncryptionService),
  },
}));

vi.mock("@/lib/auth/nextauth");
vi.mock("@/utils/repositoryParser");

describe("WebhookService - Unit Tests", () => {
  let webhookService: WebhookService;
  const mockServiceConfig = {
    baseURL: "https://api.github.com",
    apiKey: "",
    timeout: 10000,
    headers: {
      Accept: "application/vnd.github.v3+json",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    webhookService = new WebhookService(mockServiceConfig);

    // Default mock for getGithubUsernameAndPAT
    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
      username: "test-user",
      token: "github_pat_test",
    });

    // Default mock for parseGithubOwnerRepo
    vi.mocked(parseGithubOwnerRepo).mockReturnValue({
      owner: "test-org",
      repo: "test-repo",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ensureRepoWebhook()", () => {
    const mockParams = {
      userId: "user-123",
      workspaceId: "workspace-123",
      repositoryUrl: "https://github.com/test-org/test-repo",
      callbackUrl: "https://example.com/webhook",
      events: ["push", "pull_request"],
      active: true,
    };

    beforeEach(() => {
      // Mock workspace lookup
      vi.mocked(db.workspace.findUnique).mockResolvedValue({
        id: "workspace-123",
        slug: "test-workspace",
        ownerId: "user-123",
      } as any);

      // Mock repository lookup
      vi.mocked(db.repository.findUnique).mockResolvedValue({
        id: "repo-123",
        repositoryUrl: mockParams.repositoryUrl,
        workspaceId: mockParams.workspaceId,
        githubWebhookId: null,
        githubWebhookSecret: null,
      } as any);

      // Mock repository update
      vi.mocked(db.repository.update).mockResolvedValue({
        id: "repo-123",
      } as any);
    });

    test("should throw error when workspace is not found", async () => {
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

      await expect(webhookService.ensureRepoWebhook(mockParams)).rejects.toThrow(
        "Workspace not found"
      );
    });

    test("should throw error when repository is not found in database", async () => {
      vi.mocked(db.repository.findUnique).mockResolvedValue(null);

      await expect(webhookService.ensureRepoWebhook(mockParams)).rejects.toThrow(
        "Repository not found for workspace"
      );
    });

    test("should call parseGithubOwnerRepo with repository URL", async () => {
      // Mock GitHub API to return no existing hooks
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGitHubApiResponses.listHooksEmpty,
      });

      await webhookService.ensureRepoWebhook(mockParams);

      expect(parseGithubOwnerRepo).toHaveBeenCalledWith(mockParams.repositoryUrl);
    });

    test("should create new webhook when none exists", async () => {
      // Mock GitHub API - no existing hooks
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.listHooksEmpty,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.createHookSuccess(),
        });

      const result = await webhookService.ensureRepoWebhook(mockParams);

      expect(result).toEqual({
        id: 12345,
        secret: expect.any(String),
      });

      // Verify webhook secret was generated and encrypted
      expect(result.secret).toHaveLength(64); // 32 bytes = 64 hex characters
    });

    test("should update existing webhook when found", async () => {
      const existingHookId = 98765;

      // Mock GitHub API - existing hook found
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () =>
            mockGitHubApiResponses.listHooksWithExisting(
              mockParams.callbackUrl,
              existingHookId
            ),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.updateHookSuccess,
        });

      const result = await webhookService.ensureRepoWebhook(mockParams);

      expect(result.id).toBe(existingHookId);
    });

    test("should reuse existing webhook secret when webhook exists", async () => {
      const existingSecret = "existing_webhook_secret_12345";

      // Mock repository with existing encrypted secret
      vi.mocked(db.repository.findUnique).mockResolvedValue({
        id: "repo-123",
        repositoryUrl: mockParams.repositoryUrl,
        workspaceId: mockParams.workspaceId,
        githubWebhookId: "98765",
        githubWebhookSecret: JSON.stringify({ data: `encrypted_${existingSecret}` }),
      } as any);

      // Mock GitHub API - existing hook found
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () =>
            mockGitHubApiResponses.listHooksWithExisting(mockParams.callbackUrl),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.updateHookSuccess,
        });

      const result = await webhookService.ensureRepoWebhook(mockParams);

      expect(result.secret).toBe(existingSecret);
    });

    test("should generate new secret when webhook exists but has no stored secret", async () => {
      // Mock repository without stored secret
      vi.mocked(db.repository.findUnique).mockResolvedValue({
        id: "repo-123",
        repositoryUrl: mockParams.repositoryUrl,
        workspaceId: mockParams.workspaceId,
        githubWebhookId: "98765",
        githubWebhookSecret: null,
      } as any);

      // Mock GitHub API - existing hook found
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () =>
            mockGitHubApiResponses.listHooksWithExisting(mockParams.callbackUrl),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.updateHookSuccess,
        });

      const result = await webhookService.ensureRepoWebhook(mockParams);

      expect(result.secret).toBeDefined();
      expect(result.secret).toHaveLength(64);
    });

    test("should encrypt webhook secret before storing in database", async () => {
      const mockEncrypt = vi.fn().mockReturnValue({
        data: "encrypted_data",
        iv: "mock_iv",
        tag: "mock_tag",
        version: "1",
        encryptedAt: new Date().toISOString(),
      });

      vi.mocked(EncryptionService.getInstance).mockReturnValue({
        encryptField: mockEncrypt,
        decryptField: vi.fn(),
      } as any);

      // Mock GitHub API - no existing hooks
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.listHooksEmpty,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.createHookSuccess(),
        });

      await webhookService.ensureRepoWebhook(mockParams);

      expect(mockEncrypt).toHaveBeenCalledWith(
        "githubWebhookSecret",
        expect.any(String)
      );
    });

    test("should store webhookId and encrypted secret in database", async () => {
      const mockUpdate = vi.fn().mockResolvedValue({});
      vi.mocked(db.repository.update).mockImplementation(mockUpdate);

      // Mock GitHub API - no existing hooks
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.listHooksEmpty,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.createHookSuccess(),
        });

      await webhookService.ensureRepoWebhook(mockParams);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "repo-123" },
          data: {
            githubWebhookId: "12345",
            githubWebhookSecret: expect.any(String),
          },
        })
      );
    });

    test("should use workspace slug for GitHub credentials when not provided", async () => {
      const paramsWithoutSlug = {
        ...mockParams,
        workspaceSlug: undefined,
      };

      // Mock GitHub API
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.listHooksEmpty,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.createHookSuccess(),
        });

      await webhookService.ensureRepoWebhook(paramsWithoutSlug);

      expect(getGithubUsernameAndPAT).toHaveBeenCalledWith(
        mockParams.userId,
        "test-workspace" // slug from mocked workspace lookup
      );
    });

    test("should use provided workspace slug when available", async () => {
      const paramsWithSlug = {
        ...mockParams,
        workspaceSlug: "custom-slug",
      };

      // Mock GitHub API
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.listHooksEmpty,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.createHookSuccess(),
        });

      await webhookService.ensureRepoWebhook(paramsWithSlug);

      expect(getGithubUsernameAndPAT).toHaveBeenCalledWith(
        mockParams.userId,
        "custom-slug"
      );
    });
  });

  describe("GitHub API Error Handling", () => {
    const mockParams = {
      userId: "user-123",
      workspaceId: "workspace-123",
      repositoryUrl: "https://github.com/test-org/test-repo",
      callbackUrl: "https://example.com/webhook",
    };

    beforeEach(() => {
      vi.mocked(db.workspace.findUnique).mockResolvedValue({
        id: "workspace-123",
        slug: "test-workspace",
        ownerId: "user-123",
      } as any);

      vi.mocked(db.repository.findUnique).mockResolvedValue({
        id: "repo-123",
        repositoryUrl: mockParams.repositoryUrl,
        workspaceId: mockParams.workspaceId,
        githubWebhookId: null,
        githubWebhookSecret: null,
      } as any);

      vi.mocked(db.repository.update).mockResolvedValue({
        id: "repo-123",
      } as any);
    });

    test("should throw INSUFFICIENT_PERMISSIONS error on GitHub API 403", async () => {
      // Mock GitHub API - 403 Forbidden
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => mockGitHubApiErrors.forbidden403,
      });

      await expect(webhookService.ensureRepoWebhook(mockParams)).rejects.toThrow(
        "INSUFFICIENT_PERMISSIONS"
      );
    });

    test("should throw WEBHOOK_CREATION_FAILED on GitHub API 404", async () => {
      // Mock GitHub API - 404 Not Found
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => mockGitHubApiErrors.notFound404,
      });

      await expect(webhookService.ensureRepoWebhook(mockParams)).rejects.toThrow(
        "WEBHOOK_CREATION_FAILED"
      );
    });

    test("should throw WEBHOOK_CREATION_FAILED on GitHub API 500", async () => {
      // Mock GitHub API - 500 Server Error
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => mockGitHubApiErrors.serverError500,
      });

      await expect(webhookService.ensureRepoWebhook(mockParams)).rejects.toThrow(
        "WEBHOOK_CREATION_FAILED"
      );
    });

    test("should throw INSUFFICIENT_PERMISSIONS when creating hook returns 403", async () => {
      // Mock GitHub API - list hooks succeeds, create hook fails with 403
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.listHooksEmpty,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: async () => mockGitHubApiErrors.forbidden403,
        });

      await expect(webhookService.ensureRepoWebhook(mockParams)).rejects.toThrow(
        "INSUFFICIENT_PERMISSIONS"
      );
    });

    test("should throw INSUFFICIENT_PERMISSIONS when updating hook returns 403", async () => {
      // Mock GitHub API - list hooks succeeds, update hook fails with 403
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () =>
            mockGitHubApiResponses.listHooksWithExisting(mockParams.callbackUrl),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: async () => mockGitHubApiErrors.forbidden403,
        });

      await expect(webhookService.ensureRepoWebhook(mockParams)).rejects.toThrow(
        "INSUFFICIENT_PERMISSIONS"
      );
    });

    test("should handle network failures gracefully", async () => {
      // Mock network error
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      await expect(webhookService.ensureRepoWebhook(mockParams)).rejects.toThrow();
    });
  });

  describe("deleteRepoWebhook()", () => {
    const mockParams = {
      userId: "user-123",
      workspaceId: "workspace-123",
      repositoryUrl: "https://github.com/test-org/test-repo",
    };

    beforeEach(() => {
      vi.mocked(db.workspace.findUnique).mockResolvedValue({
        id: "workspace-123",
        slug: "test-workspace",
        ownerId: "user-123",
      } as any);

      vi.mocked(db.repository.update).mockResolvedValue({
        id: "repo-123",
      } as any);
    });

    test("should delete webhook from GitHub and database", async () => {
      const webhookId = "12345";

      vi.mocked(db.repository.findUnique).mockResolvedValue({
        id: "repo-123",
        githubWebhookId: webhookId,
      } as any);

      // Mock GitHub API - delete hook
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
      });

      await webhookService.deleteRepoWebhook(mockParams);

      // Verify GitHub API was called
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/hooks/${webhookId}`),
        expect.objectContaining({ method: "DELETE" })
      );

      // Verify database was updated
      expect(db.repository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            githubWebhookId: null,
            githubWebhookSecret: null,
          },
        })
      );
    });

    test("should return early when repository has no webhookId", async () => {
      vi.mocked(db.repository.findUnique).mockResolvedValue({
        id: "repo-123",
        githubWebhookId: null,
      } as any);

      global.fetch = vi.fn();

      await webhookService.deleteRepoWebhook(mockParams);

      // Should not call GitHub API
      expect(fetch).not.toHaveBeenCalled();
    });

    test("should throw error when workspace is not found", async () => {
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

      await expect(webhookService.deleteRepoWebhook(mockParams)).rejects.toThrow(
        "Workspace not found"
      );
    });

    test("should throw INSUFFICIENT_PERMISSIONS on GitHub API 403", async () => {
      vi.mocked(db.repository.findUnique).mockResolvedValue({
        id: "repo-123",
        githubWebhookId: "12345",
      } as any);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      });

      await expect(webhookService.deleteRepoWebhook(mockParams)).rejects.toThrow(
        "INSUFFICIENT_PERMISSIONS"
      );
    });
  });

  describe("Default Branch Detection", () => {
    const mockParams = {
      userId: "user-123",
      workspaceId: "workspace-123",
      repositoryUrl: "https://github.com/test-org/test-repo",
      callbackUrl: "https://example.com/webhook",
      repositoryName: "Test Repo",
    };

    beforeEach(() => {
      vi.mocked(db.workspace.findUnique).mockResolvedValue({
        id: "workspace-123",
        slug: "test-workspace",
        ownerId: "user-123",
      } as any);

      vi.mocked(db.repository.upsert).mockResolvedValue({
        id: "repo-123",
        repositoryUrl: mockParams.repositoryUrl,
        workspaceId: mockParams.workspaceId,
      } as any);

      // Mock findUnique for ensureRepoWebhook call
      vi.mocked(db.repository.findUnique).mockResolvedValue({
        id: "repo-123",
        repositoryUrl: mockParams.repositoryUrl,
        workspaceId: mockParams.workspaceId,
        githubWebhookId: null,
        githubWebhookSecret: null,
      } as any);

      vi.mocked(db.repository.update).mockResolvedValue({
        id: "repo-123",
      } as any);
    });

    test("should detect and store default branch during setup", async () => {
      const customDefaultBranch = "develop";

      // Mock GitHub API - repository info with custom default branch
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.repositoryInfo(customDefaultBranch),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.listHooksEmpty,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.createHookSuccess(),
        });

      await webhookService.setupRepositoryWithWebhook(mockParams);

      // Verify default branch was stored
      expect(db.repository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            branch: customDefaultBranch,
          }),
        })
      );
    });

    test("should return null when default branch detection fails", async () => {
      // Mock GitHub API - 404 for repository info, then successful webhook creation
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.listHooksEmpty,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockGitHubApiResponses.createHookSuccess(),
        });

      const result = await webhookService.setupRepositoryWithWebhook(mockParams);

      expect(result.defaultBranch).toBeNull();
      // Verify webhook was still created despite branch detection failure
      expect(result.webhookId).toBe(12345);
    });

    test("should throw INSUFFICIENT_PERMISSIONS on 403 during branch detection", async () => {
      // Mock GitHub API - 403 for repository info
      // The detectRepositoryDefaultBranch catches the error and returns null, then
      // it proceeds to try to list hooks which will also fail with 403
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: async () => mockGitHubApiErrors.forbidden403,
        });

      await expect(
        webhookService.setupRepositoryWithWebhook(mockParams)
      ).rejects.toThrow("INSUFFICIENT_PERMISSIONS");
    });
  });
});