import { getGithubUsernameAndPAT } from '@/lib/auth';
import { db } from '@/lib/db';
import { EncryptionService } from '@/lib/encryption';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the database
vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: vi.fn(),
    },
    gitHubAuth: {
      findUnique: vi.fn(),
    },
    account: {
      findFirst: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
    sourceControlOrg: {
      findUnique: vi.fn(),
    },
    sourceControlToken: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock the encryption service
vi.mock('@/lib/encryption', () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((field: string, value: string) => {
        // Return the value as-is for testing
        return value.replace('encrypted_', 'decrypted_');
      }),
    })),
  },
}));

describe('getGithubUsernameAndPAT', () => {
  const mockUserId = 'user-123';
  const mockWorkspaceSlug = 'test-workspace';

  let mockEncryptionService: { decryptField: any };

  beforeEach(() => {
    vi.clearAllMocks();
    mockEncryptionService = {
      decryptField: vi.fn((field: string, value: string) => {
        // Return the value as-is for testing
        return value.replace('encrypted_', 'decrypted_');
      }),
    };
    (EncryptionService.getInstance as any).mockReturnValue(mockEncryptionService);
  });

  describe('Mock User Detection', () => {
    it('should return null for mock users with @mock.dev email', async () => {
      // Arrange
      (db.user.findUnique as any).mockResolvedValue({
        id: mockUserId,
        email: 'testuser@mock.dev',
      });

      // Act
      const result = await getGithubUsernameAndPAT(mockUserId, mockWorkspaceSlug);

      // Assert
      expect(result).toBeNull();
      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockUserId },
      });
      // Should not query GitHub auth or account for mock users
      expect(db.gitHubAuth.findUnique).not.toHaveBeenCalled();
      expect(db.account.findFirst).not.toHaveBeenCalled();
    });

    it('should return null for mock users with any subdomain of @mock.dev', async () => {
      // Arrange
      (db.user.findUnique as any).mockResolvedValue({
        id: mockUserId,
        email: 'developer@staging.mock.dev',
      });

      // Act
      const result = await getGithubUsernameAndPAT(mockUserId, mockWorkspaceSlug);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('OAuth Token Path (No Workspace)', () => {
    it('should return OAuth token when no workspace slug provided', async () => {
      // Arrange
      const mockUser = {
        id: mockUserId,
        email: 'real.user@company.com',
      };
      const mockGithubAuth = {
        userId: mockUserId,
        githubUsername: 'testuser',
      };
      const mockAccount = {
        userId: mockUserId,
        provider: 'github',
        access_token: 'encrypted_oauth_token',
      };

      (db.user.findUnique as any).mockResolvedValue(mockUser);
      (db.gitHubAuth.findUnique as any).mockResolvedValue(mockGithubAuth);
      (db.account.findFirst as any).mockResolvedValue(mockAccount);

      // Act - No workspace slug provided
      const result = await getGithubUsernameAndPAT(mockUserId);

      // Assert
      expect(result).toEqual({
        username: 'testuser',
        token: 'decrypted_oauth_token',
      });
      // Should not query workspace-related tables
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
      expect(db.sourceControlToken.findUnique).not.toHaveBeenCalled();
    });

    it('should return null when OAuth account is missing', async () => {
      // Arrange
      const mockUser = {
        id: mockUserId,
        email: 'user@example.com',
      };
      const mockGithubAuth = {
        userId: mockUserId,
        githubUsername: 'githubuser',
      };

      (db.user.findUnique as any).mockResolvedValue(mockUser);
      (db.gitHubAuth.findUnique as any).mockResolvedValue(mockGithubAuth);
      (db.account.findFirst as any).mockResolvedValue(null);

      // Act - No workspace slug provided
      const result = await getGithubUsernameAndPAT(mockUserId);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when OAuth account has no token', async () => {
      // Arrange
      const mockUser = {
        id: mockUserId,
        email: 'user@company.org',
      };
      const mockGithubAuth = {
        userId: mockUserId,
        githubUsername: 'appuser',
      };
      const mockAccount = {
        userId: mockUserId,
        provider: 'github',
        access_token: null,
      };

      (db.user.findUnique as any).mockResolvedValue(mockUser);
      (db.gitHubAuth.findUnique as any).mockResolvedValue(mockGithubAuth);
      (db.account.findFirst as any).mockResolvedValue(mockAccount);

      // Act - No workspace slug provided
      const result = await getGithubUsernameAndPAT(mockUserId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('Workspace App Token Path', () => {
    it('should return app token when workspace has sourceControlOrg', async () => {
      // Arrange
      const mockUser = {
        id: mockUserId,
        email: 'user@company.com',
      };
      const mockGithubAuth = {
        userId: mockUserId,
        githubUsername: 'testuser',
      };
      const mockWorkspace = {
        slug: mockWorkspaceSlug,
        sourceControlOrg: {
          id: 'org-123',
        },
      };
      const mockSourceControlToken = {
        token: 'encrypted_app_token',
      };

      (db.user.findUnique as any).mockResolvedValue(mockUser);
      (db.gitHubAuth.findUnique as any).mockResolvedValue(mockGithubAuth);
      (db.workspace.findUnique as any).mockResolvedValue(mockWorkspace);
      (db.sourceControlToken.findUnique as any).mockResolvedValue(mockSourceControlToken);

      // Act
      const result = await getGithubUsernameAndPAT(mockUserId, mockWorkspaceSlug);

      // Assert
      expect(result).toEqual({
        username: 'testuser',
        token: 'decrypted_app_token',
      });
      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: mockWorkspaceSlug },
        include: { sourceControlOrg: true },
      });
      expect(db.sourceControlToken.findUnique).toHaveBeenCalledWith({
        where: {
          userId_sourceControlOrgId: {
            userId: mockUserId,
            sourceControlOrgId: 'org-123',
          },
        },
      });
    });

    it('should return OAuth token when workspace has no sourceControlOrg', async () => {
      // Arrange
      const mockUser = {
        id: mockUserId,
        email: 'user@company.com',
      };
      const mockGithubAuth = {
        userId: mockUserId,
        githubUsername: 'testuser',
      };
      const mockWorkspace = {
        slug: mockWorkspaceSlug,
        sourceControlOrg: null,
      };
      const mockAccount = {
        userId: mockUserId,
        provider: 'github',
        access_token: 'encrypted_oauth_token',
      };

      (db.user.findUnique as any).mockResolvedValue(mockUser);
      (db.gitHubAuth.findUnique as any).mockResolvedValue(mockGithubAuth);
      (db.workspace.findUnique as any).mockResolvedValue(mockWorkspace);
      (db.account.findFirst as any).mockResolvedValue(mockAccount);

      // Act
      const result = await getGithubUsernameAndPAT(mockUserId, mockWorkspaceSlug);

      // Assert
      expect(result).toEqual({
        username: 'testuser',
        token: 'decrypted_oauth_token',
      });
      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: mockWorkspaceSlug },
        include: { sourceControlOrg: true },
      });
      // Should fall back to OAuth when no sourceControlOrg
      expect(db.account.findFirst).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
          provider: 'github',
        },
      });
    });

    it('should return null when workspace not found', async () => {
      // Arrange
      const mockUser = {
        id: mockUserId,
        email: 'user@company.com',
      };
      const mockGithubAuth = {
        userId: mockUserId,
        githubUsername: 'testuser',
      };

      (db.user.findUnique as any).mockResolvedValue(mockUser);
      (db.gitHubAuth.findUnique as any).mockResolvedValue(mockGithubAuth);
      (db.workspace.findUnique as any).mockResolvedValue(null);
      (db.account.findFirst as any).mockResolvedValue(null);

      // Act
      const result = await getGithubUsernameAndPAT(mockUserId, mockWorkspaceSlug);

      // Assert
      expect(result).toBeNull();
      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: mockWorkspaceSlug },
        include: { sourceControlOrg: true },
      });
    });

    it('should return null when sourceControlToken not found', async () => {
      // Arrange
      const mockUser = {
        id: mockUserId,
        email: 'user@company.com',
      };
      const mockGithubAuth = {
        userId: mockUserId,
        githubUsername: 'testuser',
      };
      const mockWorkspace = {
        slug: mockWorkspaceSlug,
        sourceControlOrg: {
          id: 'org-123',
        },
      };

      (db.user.findUnique as any).mockResolvedValue(mockUser);
      (db.gitHubAuth.findUnique as any).mockResolvedValue(mockGithubAuth);
      (db.workspace.findUnique as any).mockResolvedValue(mockWorkspace);
      (db.sourceControlToken.findUnique as any).mockResolvedValue(null);

      // Act
      const result = await getGithubUsernameAndPAT(mockUserId, mockWorkspaceSlug);

      // Assert
      expect(result).toBeNull();
      expect(db.sourceControlToken.findUnique).toHaveBeenCalledWith({
        where: {
          userId_sourceControlOrgId: {
            userId: mockUserId,
            sourceControlOrgId: 'org-123',
          },
        },
      });
    });
  });

  describe('Missing Data Scenarios', () => {
    it('should return null when user does not exist', async () => {
      // Arrange
      (db.user.findUnique as any).mockResolvedValue(null);

      // Act
      const result = await getGithubUsernameAndPAT(mockUserId, mockWorkspaceSlug);

      // Assert
      expect(result).toBeNull();
      expect(db.gitHubAuth.findUnique).not.toHaveBeenCalled();
      expect(db.account.findFirst).not.toHaveBeenCalled();
    });

    it('should return null when user exists but GitHub auth is missing', async () => {
      // Arrange
      const mockUser = {
        id: mockUserId,
        email: 'user@example.com',
      };
      (db.user.findUnique as any).mockResolvedValue(mockUser);
      (db.gitHubAuth.findUnique as any).mockResolvedValue(null);

      // Act
      const result = await getGithubUsernameAndPAT(mockUserId, mockWorkspaceSlug);

      // Assert
      expect(result).toBeNull();
      expect(db.gitHubAuth.findUnique).toHaveBeenCalledWith({
        where: { userId: mockUserId },
      });
    });

    it('should return null when GitHub auth has no username', async () => {
      // Arrange
      const mockUser = {
        id: mockUserId,
        email: 'user@example.com',
      };
      const mockGithubAuth = {
        userId: mockUserId,
        githubUsername: null, // Missing username
      };

      (db.user.findUnique as any).mockResolvedValue(mockUser);
      (db.gitHubAuth.findUnique as any).mockResolvedValue(mockGithubAuth);

      // Act
      const result = await getGithubUsernameAndPAT(mockUserId, mockWorkspaceSlug);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when GitHub auth has empty username', async () => {
      // Arrange
      const mockUser = {
        id: mockUserId,
        email: 'user@example.com',
      };
      const mockGithubAuth = {
        userId: mockUserId,
        githubUsername: '', // Empty username
      };

      (db.user.findUnique as any).mockResolvedValue(mockUser);
      (db.gitHubAuth.findUnique as any).mockResolvedValue(mockGithubAuth);

      // Act
      const result = await getGithubUsernameAndPAT(mockUserId, mockWorkspaceSlug);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strings and whitespace in email', async () => {
      // Arrange
      (db.user.findUnique as any).mockResolvedValue({
        id: mockUserId,
        email: '   @mock.dev   ',
      });

      // Act
      const result = await getGithubUsernameAndPAT(mockUserId, mockWorkspaceSlug);

      // Assert
      expect(result).toBeNull();
    });

    it('should handle undefined email gracefully', async () => {
      // Arrange
      const mockUser = {
        id: mockUserId,
        email: undefined,
      };
      const mockGithubAuth = {
        userId: mockUserId,
        githubUsername: 'testuser',
      };
      const mockAccount = {
        userId: mockUserId,
        provider: 'github',
        access_token: 'encrypted_token',
      };
      (db.user.findUnique as any).mockResolvedValue(mockUser);
      (db.gitHubAuth.findUnique as any).mockResolvedValue(mockGithubAuth);
      (db.account.findFirst as any).mockResolvedValue(mockAccount);

      // Act - No workspace slug provided
      const result = await getGithubUsernameAndPAT(mockUserId);

      // Assert
      expect(result).toEqual({
        username: 'testuser',
        token: 'decrypted_token',
      });
    });

    it('should handle null email gracefully', async () => {
      // Arrange
      const mockUser = {
        id: mockUserId,
        email: null,
      };
      const mockGithubAuth = {
        userId: mockUserId,
        githubUsername: 'testuser',
      };
      const mockAccount = {
        userId: mockUserId,
        provider: 'github',
        access_token: 'encrypted_token',
      };
      (db.user.findUnique as any).mockResolvedValue(mockUser);
      (db.gitHubAuth.findUnique as any).mockResolvedValue(mockGithubAuth);
      (db.account.findFirst as any).mockResolvedValue(mockAccount);

      // Act - No workspace slug provided
      const result = await getGithubUsernameAndPAT(mockUserId);

      // Assert
      expect(result).toEqual({
        username: 'testuser',
        token: 'decrypted_token',
      });
    });

    it('should handle case variations in @mock.dev email', async () => {
      // Arrange
      (db.user.findUnique as any).mockResolvedValue({
        id: mockUserId,
        email: 'TestUser@MOCK.DEV',
      });

      // Act
      const result = await getGithubUsernameAndPAT(mockUserId, mockWorkspaceSlug);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('Integration with Real Usage Patterns', () => {
    it('should return data in format expected by API endpoints', async () => {
      // Arrange - Simulating real usage from GitHub API endpoints
      const mockUser = {
        id: mockUserId,
        email: 'api.user@company.com',
      };
      const mockGithubAuth = {
        userId: mockUserId,
        githubUsername: 'apiuser',
      };
      const mockAccount = {
        userId: mockUserId,
        provider: 'github',
        access_token: 'encrypted_pat',
      };

      (db.user.findUnique as any).mockResolvedValue(mockUser);
      (db.gitHubAuth.findUnique as any).mockResolvedValue(mockGithubAuth);
      (db.account.findFirst as any).mockResolvedValue(mockAccount);

      // Act - No workspace slug provided (OAuth token)
      const result = await getGithubUsernameAndPAT(mockUserId);

      // Assert - Verify the returned object has all expected properties
      expect(result).toHaveProperty('username');
      expect(result).toHaveProperty('token');
      expect(result?.username).toBe('apiuser');
      expect(result?.token).toBe('decrypted_pat');

      // Verify API endpoints can use token
      const tokenToUse = result?.token;
      expect(tokenToUse).toBe('decrypted_pat');
    });

    it('should handle webhook service integration pattern', async () => {
      // Arrange - Simulating usage from WebhookService.getUserGithubAccessToken
      const mockUser = {
        id: mockUserId,
        email: 'webhook.user@service.com',
      };
      const mockGithubAuth = {
        userId: mockUserId,
        githubUsername: 'webhookuser',
      };
      const mockAccount = {
        userId: mockUserId,
        provider: 'github',
        access_token: 'encrypted_webhook_pat',
      };

      (db.user.findUnique as any).mockResolvedValue(mockUser);
      (db.gitHubAuth.findUnique as any).mockResolvedValue(mockGithubAuth);
      (db.account.findFirst as any).mockResolvedValue(mockAccount);

      // Act - No workspace slug provided (OAuth token)
      const result = await getGithubUsernameAndPAT(mockUserId);

      // Assert - Verify webhook service can safely access token
      expect(result?.token).toBe('decrypted_webhook_pat');

      // Simulate webhook service logic: if (!githubProfile?.token) throw error
      expect(result?.token).toBeTruthy();
      const tokenForWebhook = result?.token;
      expect(tokenForWebhook).toBe('decrypted_webhook_pat');
    });
  });
});