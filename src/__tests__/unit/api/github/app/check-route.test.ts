import { NextRequest } from 'next/server';
import { GET } from '@/app/api/github/app/check/route';
import { getServerSession } from 'next-auth/next';
import { getUserAppTokens } from '@/lib/githubApp';
import { db } from '@/lib/db';

// Mock dependencies
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));
vi.mock('@/lib/githubApp');
vi.mock('@/lib/db', () => ({
  db: {
    sourceControlOrg: {
      findUnique: vi.fn(),
    },
  },
}));
vi.mock('@/lib/auth/nextauth', () => ({
  authOptions: {},
}));

describe('GET /api/github/app/check', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createMockRequest = (url: string) => {
    return new NextRequest(new URL(url, 'http://localhost:3000'));
  };

  const mockAuthenticatedSession = () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: {
        id: 'user-123',
        name: 'Test User',
        email: 'test@example.com',
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    } as any);
  };

  const mockUnauthenticatedSession = () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
  };

  describe('authentication', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockUnauthenticatedSession();

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({
        hasPushAccess: false,
        error: 'Unauthorized',
      });
    });

    it('should proceed with check when user is authenticated', async () => {
      mockAuthenticatedSession();
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: 'ghs_mock_token',
        refreshToken: null,
        expiresAt: null,
      });
      vi.mocked(db.sourceControlOrg.findUnique).mockResolvedValue({
        id: 'org-123',
        githubLogin: 'owner',
        githubInstallationId: '12345',
        workspaceId: 'workspace-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          full_name: 'owner/repo',
          permissions: { push: true },
        }),
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  describe('URL validation', () => {
    it('should return 400 when repositoryUrl parameter is missing', async () => {
      mockAuthenticatedSession();

      const request = createMockRequest('/api/github/app/check');
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({
        hasPushAccess: false,
        error: 'Missing required parameter: repositoryUrl',
      });
    });

    it('should return 400 for invalid GitHub URL format', async () => {
      mockAuthenticatedSession();

      const request = createMockRequest('/api/github/app/check?repositoryUrl=not-a-github-url');
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({
        hasPushAccess: false,
        error: 'Invalid GitHub repository URL',
      });
    });

    it('should accept HTTPS URLs with .git suffix', async () => {
      mockAuthenticatedSession();
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: 'ghs_mock_token',
        refreshToken: null,
        expiresAt: null,
      });
      vi.mocked(db.sourceControlOrg.findUnique).mockResolvedValue({
        id: 'org-123',
        githubLogin: 'owner',
        githubInstallationId: '12345',
        workspaceId: 'workspace-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          full_name: 'owner/repo',
          permissions: { push: true },
        }),
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo.git');
      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    it('should accept SSH URLs', async () => {
      mockAuthenticatedSession();
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: 'ghs_mock_token',
        refreshToken: null,
        expiresAt: null,
      });
      vi.mocked(db.sourceControlOrg.findUnique).mockResolvedValue({
        id: 'org-123',
        githubLogin: 'owner',
        githubInstallationId: '12345',
        workspaceId: 'workspace-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          full_name: 'owner/repo',
          permissions: { push: true },
        }),
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=git@github.com:owner/repo.git');
      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    it('should handle URLs with special characters', async () => {
      mockAuthenticatedSession();
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: 'ghs_mock_token',
        refreshToken: null,
        expiresAt: null,
      });
      vi.mocked(db.sourceControlOrg.findUnique).mockResolvedValue({
        id: 'org-123',
        githubLogin: 'owner',
        githubInstallationId: '12345',
        workspaceId: 'workspace-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          full_name: 'owner/repo-with-dashes_and_underscores',
          permissions: { push: true },
        }),
      });

      const request = createMockRequest(
        '/api/github/app/check?repositoryUrl=https://github.com/owner/repo-with-dashes_and_underscores'
      );
      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  describe('GitHub App token retrieval', () => {
    it('should return 403 when user has no GitHub App tokens', async () => {
      mockAuthenticatedSession();
      vi.mocked(getUserAppTokens).mockResolvedValue(null);

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data).toEqual({
        hasPushAccess: false,
        error: 'No GitHub App tokens found for this repository owner',
      });
    });

    it('should return 403 when access token is missing', async () => {
      mockAuthenticatedSession();
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data).toEqual({
        hasPushAccess: false,
        error: 'No GitHub App tokens found for this repository owner',
      });
    });
  });

  describe('installation lookup', () => {
    it('should return 200 with hasPushAccess=false when no installation found', async () => {
      mockAuthenticatedSession();
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: 'ghs_mock_token',
        refreshToken: null,
        expiresAt: null,
      });
      vi.mocked(db.sourceControlOrg.findUnique).mockResolvedValue(null);

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        hasPushAccess: false,
        error: 'No GitHub App installation found for this repository owner',
      });
    });

    it('should return 200 with hasPushAccess=false when installation ID is missing', async () => {
      mockAuthenticatedSession();
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: 'ghs_mock_token',
        refreshToken: null,
        expiresAt: null,
      });
      vi.mocked(db.sourceControlOrg.findUnique).mockResolvedValue({
        id: 'org-123',
        githubLogin: 'owner',
        githubInstallationId: null,
        workspaceId: 'workspace-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        hasPushAccess: false,
        error: 'No GitHub App installation found for this repository owner',
      });
    });
  });

  describe('GitHub API integration', () => {
    beforeEach(() => {
      mockAuthenticatedSession();
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: 'ghs_mock_token',
        refreshToken: null,
        expiresAt: null,
      });
      vi.mocked(db.sourceControlOrg.findUnique).mockResolvedValue({
        id: 'org-123',
        githubLogin: 'owner',
        githubInstallationId: '12345',
        workspaceId: 'workspace-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    });

    it('should return hasPushAccess=true when repository has push permission', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          full_name: 'owner/repo',
          permissions: { push: true, admin: false, maintain: false },
        }),
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        hasPushAccess: true,
      });
    });

    it('should return hasPushAccess=true when repository has admin permission', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          full_name: 'owner/repo',
          permissions: { push: false, admin: true, maintain: false },
        }),
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        hasPushAccess: true,
      });
    });

    it('should return hasPushAccess=true when repository has maintain permission', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          full_name: 'owner/repo',
          permissions: { push: false, admin: false, maintain: true },
        }),
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        hasPushAccess: true,
      });
    });

    it('should return hasPushAccess=false when repository only has read permission', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          full_name: 'owner/repo',
          permissions: { push: false, admin: false, maintain: false, pull: true },
        }),
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.hasPushAccess).toBe(false);
    });

    it('should handle case-insensitive repository name matching', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          full_name: 'Owner/Repo',
          permissions: { push: true },
        }),
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        hasPushAccess: true,
      });
    });

    it('should return requiresInstallationUpdate when repository not accessible (404)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toMatchObject({
        hasPushAccess: false,
        requiresInstallationUpdate: true,
        installationId: '12345',
      });
      expect(data.error).toContain('owner/repo');
    });

    it('should handle successful repository access check', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          full_name: 'owner/target-repo',
          permissions: { push: true },
        }),
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/target-repo');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        hasPushAccess: true,
      });
    });
  });

  describe('GitHub API error handling', () => {
    beforeEach(() => {
      mockAuthenticatedSession();
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: 'ghs_mock_token',
        refreshToken: null,
        expiresAt: null,
      });
      vi.mocked(db.sourceControlOrg.findUnique).mockResolvedValue({
        id: 'org-123',
        githubLogin: 'owner',
        githubInstallationId: '12345',
        workspaceId: 'workspace-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    });

    it('should return requiresReauth when GitHub API returns 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toMatchObject({
        hasPushAccess: false,
        requiresReauth: true,
        error: 'GitHub API error 401',
      });
    });

    it('should return requiresReauth when GitHub API returns 403', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toMatchObject({
        hasPushAccess: false,
        requiresReauth: true,
        error: 'GitHub API error 403',
      });
    });

    it('should return requiresInstallationUpdate when GitHub API returns 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toMatchObject({
        hasPushAccess: false,
        requiresInstallationUpdate: true,
        installationId: '12345',
      });
      expect(data.error).toContain('owner/repo');
      expect(data.error).toContain('not accessible');
    });

    it('should return error when GitHub API returns 500', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toMatchObject({
        hasPushAccess: false,
        error: 'GitHub API error 500',
      });
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toMatchObject({
        hasPushAccess: false,
        error: 'Internal server error',
      });
    });

    it('should handle JSON parse errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      // Route's outer try-catch returns 500 for unexpected errors
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Internal server error');
    });
  });

  describe('response format validation', () => {
    beforeEach(() => {
      mockAuthenticatedSession();
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: 'ghs_mock_token',
        refreshToken: null,
        expiresAt: null,
      });
      vi.mocked(db.sourceControlOrg.findUnique).mockResolvedValue({
        id: 'org-123',
        githubLogin: 'owner',
        githubInstallationId: '12345',
        workspaceId: 'workspace-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    });

    it('should set requiresReauth flag on authentication errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const request = createMockRequest('/api/github/app/check?repositoryUrl=https://github.com/owner/repo');
      const response = await GET(request);

      const data = await response.json();
      expect(data.requiresReauth).toBe(true);
      expect(data.error).toBe('GitHub API error 401');
    });
  });
});
