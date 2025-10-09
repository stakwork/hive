import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkRepositoryPermissions } from '@/app/api/github/repository/permissions/route';

// Mock fixtures for GitHub API responses
const mockGitHubResponses = {
  pushPermission: {
    ok: true,
    status: 200,
    json: async () => ({
      name: 'test-repo',
      full_name: 'test-owner/test-repo',
      private: false,
      default_branch: 'main',
      permissions: {
        admin: false,
        maintain: false,
        push: true,
        triage: false,
        pull: true,
      },
    }),
  },
  adminPermission: {
    ok: true,
    status: 200,
    json: async () => ({
      name: 'test-repo',
      full_name: 'test-owner/test-repo',
      private: false,
      default_branch: 'main',
      permissions: {
        admin: true,
        maintain: true,
        push: true,
        triage: true,
        pull: true,
      },
    }),
  },
  maintainPermission: {
    ok: true,
    status: 200,
    json: async () => ({
      name: 'test-repo',
      full_name: 'test-owner/test-repo',
      private: false,
      default_branch: 'main',
      permissions: {
        admin: false,
        maintain: true,
        push: true,
        triage: true,
        pull: true,
      },
    }),
  },
  pullOnlyPermission: {
    ok: true,
    status: 200,
    json: async () => ({
      name: 'test-repo',
      full_name: 'test-owner/test-repo',
      private: false,
      default_branch: 'main',
      permissions: {
        admin: false,
        maintain: false,
        push: false,
        triage: false,
        pull: true,
      },
    }),
  },
  noPermissions: {
    ok: true,
    status: 200,
    json: async () => ({
      name: 'test-repo',
      full_name: 'test-owner/test-repo',
      private: false,
      default_branch: 'main',
      permissions: {},
    }),
  },
  missingPermissions: {
    ok: true,
    status: 200,
    json: async () => ({
      name: 'test-repo',
      full_name: 'test-owner/test-repo',
      private: false,
      default_branch: 'main',
    }),
  },
  notFound: {
    ok: false,
    status: 404,
    json: async () => ({
      message: 'Not Found',
    }),
  },
  forbidden: {
    ok: false,
    status: 403,
    json: async () => ({
      message: 'Forbidden',
    }),
  },
  serverError: {
    ok: false,
    status: 500,
    json: async () => ({
      message: 'Internal Server Error',
    }),
  },
  rateLimitError: {
    ok: false,
    status: 429,
    json: async () => ({
      message: 'Rate limit exceeded',
    }),
  },
};

// Test repository URLs
const testUrls = {
  httpsStandard: 'https://github.com/owner/repo',
  httpsWithGit: 'https://github.com/owner/repo.git',
  ssh: 'git@github.com:owner/repo.git',
  sshWithoutGit: 'git@github.com:owner/repo',
  invalidGitLab: 'https://gitlab.com/owner/repo',
  malformed: 'not-a-valid-url',
  missingRepo: 'https://github.com/owner',
  missingOwner: 'https://github.com/',
  withTrailingSlash: 'https://github.com/owner/repo/',
  withQueryParams: 'https://github.com/owner/repo?tab=readme',
  withFragment: 'https://github.com/owner/repo#readme',
};



describe('checkRepositoryPermissions - Unit Tests', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('URL Parsing and Validation', () => {
    test('should parse standard HTTPS GitHub URL correctly', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pushPermission);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Accept': 'application/vnd.github.v3+json',
          }),
        })
      );
      expect(result.hasAccess).toBe(true);
    });

    test('should parse HTTPS URL with .git suffix', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pushPermission);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsWithGit);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo',
        expect.any(Object)
      );
      expect(result.hasAccess).toBe(true);
    });

    test('should parse SSH URL format', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pushPermission);

      const result = await checkRepositoryPermissions('test-token', testUrls.ssh);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo',
        expect.any(Object)
      );
      expect(result.hasAccess).toBe(true);
    });

    test('should parse SSH URL without .git suffix', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pushPermission);

      const result = await checkRepositoryPermissions('test-token', testUrls.sshWithoutGit);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo',
        expect.any(Object)
      );
      expect(result.hasAccess).toBe(true);
    });

    test('should handle URL with trailing slash', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pushPermission);

      const result = await checkRepositoryPermissions('test-token', testUrls.withTrailingSlash);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo',
        expect.any(Object)
      );
      expect(result.hasAccess).toBe(true);
    });

    test('should reject non-GitHub URLs', async () => {
      const result = await checkRepositoryPermissions('test-token', testUrls.invalidGitLab);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'invalid_repository_url'
      });
    });

    test('should reject malformed URLs', async () => {
      const result = await checkRepositoryPermissions('test-token', testUrls.malformed);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'invalid_repository_url'
      });
    });

    test('should reject URLs missing repository name', async () => {
      const result = await checkRepositoryPermissions('test-token', testUrls.missingRepo);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.error).toBe('invalid_repository_url');
    });

    test('should reject empty URL', async () => {
      const result = await checkRepositoryPermissions('test-token', '');

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.error).toBe('invalid_repository_url');
    });
  });

  describe('Permission Logic Verification', () => {
    test('should calculate canPush=true and canAdmin=true for admin permission', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.adminPermission);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result).toMatchObject({
        hasAccess: true,
        canPush: true,
        canAdmin: true,
      });
      expect(result.permissions).toEqual({
        admin: true,
        maintain: true,
        push: true,
        triage: true,
        pull: true,
      });
    });

    test('should calculate canPush=true and canAdmin=false for maintain permission', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.maintainPermission);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result).toMatchObject({
        hasAccess: true,
        canPush: true,
        canAdmin: false,
      });
      expect(result.permissions?.maintain).toBe(true);
      expect(result.permissions?.admin).toBe(false);
    });

    test('should calculate canPush=true and canAdmin=false for push permission', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pushPermission);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result).toMatchObject({
        hasAccess: true,
        canPush: true,
        canAdmin: false,
      });
      expect(result.permissions?.push).toBe(true);
      expect(result.permissions?.admin).toBe(false);
    });

    test('should calculate canPush=false and canAdmin=false for pull-only permission', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pullOnlyPermission);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result).toMatchObject({
        hasAccess: true,
        canPush: false,
        canAdmin: false,
      });
      expect(result.permissions?.pull).toBe(true);
      expect(result.permissions?.push).toBe(false);
    });

    test('should handle empty permissions object', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.noPermissions);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result).toMatchObject({
        hasAccess: true,
        canPush: false,
        canAdmin: false,
        permissions: {},
      });
    });

    test('should handle missing permissions field in response', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.missingPermissions);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result).toMatchObject({
        hasAccess: true,
        canPush: false,
        canAdmin: false,
        permissions: {},
      });
    });

    test('should handle permissions with false values correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'test-repo',
          full_name: 'test-owner/test-repo',
          private: false,
          default_branch: 'main',
          permissions: {
            admin: false,
            maintain: false,
            push: false,
            triage: false,
            pull: false,
          },
        }),
      });

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
    });
  });

  describe('GitHub API Response Handling', () => {
    test('should extract repository metadata correctly', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pushPermission);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result.repositoryData).toEqual({
        name: 'test-repo',
        full_name: 'test-owner/test-repo',
        private: false,
        default_branch: 'main',
      });
    });

    test('should handle private repository flag', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'private-repo',
          full_name: 'test-owner/private-repo',
          private: true,
          default_branch: 'develop',
          permissions: {
            admin: true,
            push: true,
            pull: true,
          },
        }),
      });

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result.repositoryData?.private).toBe(true);
      expect(result.repositoryData?.default_branch).toBe('develop');
    });

    test('should pass correct authorization header', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pushPermission);
      const token = 'gho_test_token_12345';

      await checkRepositoryPermissions(token, testUrls.httpsStandard);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': `Bearer ${token}`,
          }),
        })
      );
    });

    test('should pass GitHub API v3 accept header', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pushPermission);

      await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept': 'application/vnd.github.v3+json',
          }),
        })
      );
    });
  });

  describe('Error Handling - GitHub API Responses', () => {
    test('should handle 404 Not Found error', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.notFound);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'repository_not_found_or_no_access'
      });
    });

    test('should handle 403 Forbidden error', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.forbidden);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'access_forbidden'
      });
    });

    test('should handle 500 Server Error', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.serverError);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'http_error_500'
      });
    });

    test('should handle 429 Rate Limit error', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.rateLimitError);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'http_error_429'
      });
    });

    test('should handle other HTTP error codes', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ message: 'Bad Gateway' }),
      });

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'http_error_502'
      });
    });
  });

  describe('Error Handling - Network Failures', () => {
    test('should handle network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'network_error'
      });
    });

    test('should handle timeout error', async () => {
      mockFetch.mockRejectedValue(new Error('Request timeout'));

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'network_error'
      });
    });

    test('should handle fetch rejection', async () => {
      mockFetch.mockRejectedValue(new Error('Failed to fetch'));

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result.error).toBe('network_error');
    });

    test('should handle JSON parsing error', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result.error).toBe('network_error');
    });
  });

  describe('Edge Cases', () => {
    test('should handle URL with query parameters', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pushPermission);

      const result = await checkRepositoryPermissions('test-token', testUrls.withQueryParams);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo',
        expect.any(Object)
      );
      expect(result.hasAccess).toBe(true);
    });

    test('should handle URL with fragment', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pushPermission);

      const result = await checkRepositoryPermissions('test-token', testUrls.withFragment);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo',
        expect.any(Object)
      );
      expect(result.hasAccess).toBe(true);
    });

    test('should handle special characters in repository name', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'repo-with-dashes',
          full_name: 'owner/repo-with-dashes',
          private: false,
          default_branch: 'main',
          permissions: { push: true },
        }),
      });

      const result = await checkRepositoryPermissions(
        'test-token',
        'https://github.com/owner/repo-with-dashes'
      );

      expect(result.hasAccess).toBe(true);
    });

    test('should handle org name with special characters', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pushPermission);

      const result = await checkRepositoryPermissions(
        'test-token',
        'https://github.com/org-name-123/repo'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/org-name-123/repo',
        expect.any(Object)
      );
      expect(result.hasAccess).toBe(true);
    });

    test('should return consistent structure on all error paths', async () => {
      const errorScenarios = [
        { mock: () => mockFetch.mockResolvedValue(mockGitHubResponses.notFound) },
        { mock: () => mockFetch.mockResolvedValue(mockGitHubResponses.forbidden) },
        { mock: () => mockFetch.mockResolvedValue(mockGitHubResponses.serverError) },
        { mock: () => mockFetch.mockRejectedValue(new Error('Network error')) },
      ];

      for (const scenario of errorScenarios) {
        scenario.mock();
        const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

        expect(result).toHaveProperty('hasAccess', false);
        expect(result).toHaveProperty('canPush', false);
        expect(result).toHaveProperty('canAdmin', false);
        expect(result).toHaveProperty('error');
        expect(typeof result.error).toBe('string');
      }
    });

    test('should not include error field on successful response', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pushPermission);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result.error).toBeUndefined();
    });
  });

  describe('Return Type Validation', () => {
    test('should always return required boolean fields', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pushPermission);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(typeof result.hasAccess).toBe('boolean');
      expect(typeof result.canPush).toBe('boolean');
      expect(typeof result.canAdmin).toBe('boolean');
    });

    test('should include permissions object on success', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pushPermission);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result.permissions).toBeDefined();
      expect(typeof result.permissions).toBe('object');
    });

    test('should include repositoryData on success', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.pushPermission);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result.repositoryData).toBeDefined();
      expect(result.repositoryData).toHaveProperty('name');
      expect(result.repositoryData).toHaveProperty('full_name');
      expect(result.repositoryData).toHaveProperty('private');
      expect(result.repositoryData).toHaveProperty('default_branch');
    });

    test('should not include permissions or repositoryData on error', async () => {
      mockFetch.mockResolvedValue(mockGitHubResponses.notFound);

      const result = await checkRepositoryPermissions('test-token', testUrls.httpsStandard);

      expect(result.permissions).toBeUndefined();
      expect(result.repositoryData).toBeUndefined();
    });
  });
});