import { authOptions } from '@/lib/auth/nextauth';
import { db } from '@/lib/db';
import { EncryptionService } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { ensureMockWorkspaceForUser } from '@/utils/mockSetup';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    account: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    workspace: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/encryption', () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      encryptField: vi.fn((field: string, value: string) => ({
        data: `encrypted_${value}`,
        iv: 'mock_iv',
        tag: 'mock_tag',
        version: 'v1',
        encryptedAt: new Date().toISOString(),
      })),
    })),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    authInfo: vi.fn(),
    authError: vi.fn(),
    authWarn: vi.fn(),
    authDebug: vi.fn(),
  },
}));

vi.mock('@/utils/mockSetup', () => ({
  ensureMockWorkspaceForUser: vi.fn(),
  ensureStakworkMockWorkspace: vi.fn(),
}));

describe('signIn callback', () => {
  let signInCallback: any;
  let mockEncryptionService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Get the signIn callback from authOptions
    signInCallback = authOptions.callbacks?.signIn;
    
    mockEncryptionService = {
      encryptField: vi.fn((field: string, value: string) => ({
        data: `encrypted_${value}`,
        iv: 'mock_iv',
        tag: 'mock_tag',
        version: 'v1',
        encryptedAt: new Date().toISOString(),
      })),
    };
    (EncryptionService.getInstance as any).mockReturnValue(mockEncryptionService);
  });

  describe('Mock Provider Authentication', () => {
    it('should create new user for mock authentication when user does not exist', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'mockuser',
        email: 'mockuser@mock.dev',
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
      };
      const mockAccount = {
        provider: 'mock',
        type: 'credentials',
      };

      (db.user.findUnique as any).mockResolvedValue(null);
      const mockNewUser = { id: 'new-user-123', ...mockUser };
      (db.user.create as any).mockResolvedValue(mockNewUser);
      (ensureMockWorkspaceForUser as any).mockResolvedValue('test-workspace');
      (db.workspace.findFirst as any).mockResolvedValue({ slug: 'test-workspace' });

      // Act
      const result = await authOptions.callbacks?.signIn!({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(true);
      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'mockuser@mock.dev' },
      });
      expect(db.user.create).toHaveBeenCalledWith({
        data: {
          name: 'mockuser',
          email: 'mockuser@mock.dev',
          image: 'https://avatars.githubusercontent.com/u/1?v=4',
          emailVerified: expect.any(Date),
        },
      });
      // The user ID is mutated in the callback, so workspace operations use the new ID
      expect(ensureMockWorkspaceForUser).toHaveBeenCalledWith(expect.any(String));
      expect(db.workspace.findFirst).toHaveBeenCalledWith({
        where: { ownerId: expect.any(String), deleted: false },
        select: { slug: true },
      });
      expect(logger.authInfo).toHaveBeenCalledWith(
        'Mock workspace created successfully',
        'SIGNIN_MOCK_SUCCESS',
        {
          userId: expect.any(String),
          workspaceSlug: 'test-workspace',
        }
      );
    });

    it('should use existing user for mock authentication when user exists', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'existinguser',
        email: 'existinguser@mock.dev',
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
      };
      const mockAccount = {
        provider: 'mock',
        type: 'credentials',
      };
      const existingUser = {
        id: 'existing-user-456',
        email: 'existinguser@mock.dev',
        name: 'Existing User',
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (ensureMockWorkspaceForUser as any).mockResolvedValue('existing-workspace');
      (db.workspace.findFirst as any).mockResolvedValue({ slug: 'existing-workspace' });

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(true);
      expect(db.user.create).not.toHaveBeenCalled();
      expect(ensureMockWorkspaceForUser).toHaveBeenCalledWith('existing-user-456');
      expect(logger.authInfo).toHaveBeenCalledWith(
        'Mock workspace created successfully',
        'SIGNIN_MOCK_SUCCESS',
        {
          userId: 'existing-user-456',
          workspaceSlug: 'existing-workspace',
        }
      );
    });

    it('should return false when workspace creation fails (empty slug)', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'testuser',
        email: 'testuser@mock.dev',
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
      };
      const mockAccount = {
        provider: 'mock',
        type: 'credentials',
      };

      (db.user.findUnique as any).mockResolvedValue(null);
      (db.user.create as any).mockResolvedValue({ id: 'user-789', email: mockUser.email });
      (ensureMockWorkspaceForUser as any).mockResolvedValue(''); // Empty slug

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(false);
      expect(logger.authError).toHaveBeenCalledWith(
        'Failed to create mock workspace - workspace slug is empty',
        'SIGNIN_MOCK_WORKSPACE_FAILED',
        { userId: expect.any(String) } // User ID could be temp-id or user-789 depending on mutation timing
      );
      expect(db.workspace.findFirst).not.toHaveBeenCalled();
    });

    it('should return false when workspace creation fails (null slug)', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'testuser',
        email: 'testuser@mock.dev',
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
      };
      const mockAccount = {
        provider: 'mock',
        type: 'credentials',
      };

      (db.user.findUnique as any).mockResolvedValue(null);
      (db.user.create as any).mockResolvedValue({ id: 'user-789', email: mockUser.email });
      (ensureMockWorkspaceForUser as any).mockResolvedValue(null);

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(false);
      expect(logger.authError).toHaveBeenCalledWith(
        'Failed to create mock workspace - workspace slug is empty',
        'SIGNIN_MOCK_WORKSPACE_FAILED',
        { userId: expect.any(String) } // User ID could be temp-id or user-789 depending on mutation timing
      );
    });

    it('should return false when workspace verification fails', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'testuser',
        email: 'testuser@mock.dev',
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
      };
      const mockAccount = {
        provider: 'mock',
        type: 'credentials',
      };

      (db.user.findUnique as any).mockResolvedValue(null);
      (db.user.create as any).mockResolvedValue({ id: 'user-999', email: mockUser.email });
      (ensureMockWorkspaceForUser as any).mockResolvedValue('test-workspace');
      (db.workspace.findFirst as any).mockResolvedValue(null); // Workspace not found

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(false);
      expect(logger.authError).toHaveBeenCalledWith(
        'Mock workspace created but not found on verification - possible transaction issue',
        'SIGNIN_MOCK_VERIFICATION_FAILED',
        { userId: expect.any(String), expectedSlug: 'test-workspace' } // User ID mutation timing varies
      );
    });

    it('should return false and log error when exception occurs during mock auth', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'testuser',
        email: 'testuser@mock.dev',
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
      };
      const mockAccount = {
        provider: 'mock',
        type: 'credentials',
      };
      const error = new Error('Database connection failed');

      (db.user.findUnique as any).mockRejectedValue(error);

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(false);
      expect(logger.authError).toHaveBeenCalledWith(
        'Failed to handle mock authentication',
        'SIGNIN_MOCK',
        error
      );
    });
  });

  describe('GitHub Provider Authentication', () => {
    it('should create new GitHub account for existing user without GitHub account', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'GitHub User',
        email: 'githubuser@example.com',
        image: 'https://avatars.githubusercontent.com/u/123',
      };
      const mockAccount = {
        provider: 'github',
        type: 'oauth',
        providerAccountId: 'github-123',
        access_token: 'gho_test_token',
        refresh_token: 'ghr_refresh_token',
        expires_at: 1234567890,
        token_type: 'bearer',
        scope: 'read:user user:email',
        id_token: 'id_token_value',
        session_state: 'session_state_value',
      };
      const existingUser = {
        id: 'existing-user-123',
        email: 'githubuser@example.com',
        name: 'GitHub User',
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(null); // No existing GitHub account
      (db.account.create as any).mockResolvedValue({});

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(true);
      expect(db.account.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'existing-user-123',
          provider: 'github',
        },
      });
      expect(db.account.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'existing-user-123',
          type: 'oauth',
          provider: 'github',
          providerAccountId: 'github-123',
          expires_at: 1234567890,
          token_type: 'bearer',
          scope: 'read:user user:email',
          session_state: 'session_state_value',
        }),
      });
      // Verify tokens were encrypted and stringified
      const createCall = (db.account.create as any).mock.calls[0][0];
      expect(createCall.data.access_token).toContain('encrypted_gho_test_token');
      expect(createCall.data.refresh_token).toContain('encrypted_ghr_refresh_token');
      expect(createCall.data.id_token).toContain('encrypted_id_token_value');
      expect(mockUser.id).toBe('existing-user-123');
    });

    it('should update existing GitHub account tokens on re-authentication', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'GitHub User',
        email: 'githubuser@example.com',
        image: 'https://avatars.githubusercontent.com/u/123',
      };
      const mockAccount = {
        provider: 'github',
        type: 'oauth',
        providerAccountId: 'github-123',
        access_token: 'gho_new_token',
        refresh_token: 'ghr_new_refresh',
        scope: 'read:user user:email repo',
        id_token: 'new_id_token',
      };
      const existingUser = {
        id: 'existing-user-456',
        email: 'githubuser@example.com',
        name: 'GitHub User',
      };
      const existingAccount = {
        id: 'account-789',
        userId: 'existing-user-456',
        provider: 'github',
        access_token: 'old_encrypted_token',
        refresh_token: 'old_encrypted_refresh',
        id_token: 'old_encrypted_id_token',
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(existingAccount);
      (db.account.update as any).mockResolvedValue({});

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(true);
      expect(db.account.update).toHaveBeenCalledWith({
        where: { id: 'account-789' },
        data: expect.objectContaining({
          scope: 'read:user user:email repo',
        }),
      });
      // Verify tokens were encrypted and stringified
      const updateCall = (db.account.update as any).mock.calls[0][0];
      expect(updateCall.data.access_token).toContain('encrypted_gho_new_token');
      expect(updateCall.data.refresh_token).toContain('encrypted_ghr_new_refresh');
      expect(updateCall.data.id_token).toContain('encrypted_new_id_token');
    });

    it('should not update account when access_token is missing', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'GitHub User',
        email: 'githubuser@example.com',
        image: 'https://avatars.githubusercontent.com/u/123',
      };
      const mockAccount = {
        provider: 'github',
        type: 'oauth',
        providerAccountId: 'github-123',
        access_token: null, // No access token
        scope: 'read:user user:email',
      };
      const existingUser = {
        id: 'existing-user-456',
        email: 'githubuser@example.com',
        name: 'GitHub User',
      };
      const existingAccount = {
        id: 'account-789',
        userId: 'existing-user-456',
        provider: 'github',
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(existingAccount);

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(true);
      expect(db.account.update).not.toHaveBeenCalled();
    });

    it('should handle GitHub auth when user does not exist (adapter creates user)', async () => {
      // Arrange
      const mockUser = {
        id: 'new-github-user-123',
        name: 'New GitHub User',
        email: 'newuser@github.com',
        image: 'https://avatars.githubusercontent.com/u/999',
      };
      const mockAccount = {
        provider: 'github',
        type: 'oauth',
        providerAccountId: 'github-999',
        access_token: 'gho_new_user_token',
      };

      (db.user.findUnique as any).mockResolvedValue(null); // No existing user

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(true);
      expect(db.account.findFirst).not.toHaveBeenCalled();
      expect(db.account.create).not.toHaveBeenCalled();
    });

    it('should handle optional tokens (refresh_token, id_token) gracefully', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'GitHub User',
        email: 'githubuser@example.com',
        image: 'https://avatars.githubusercontent.com/u/123',
      };
      const mockAccount = {
        provider: 'github',
        type: 'oauth',
        providerAccountId: 'github-123',
        access_token: 'gho_test_token',
        refresh_token: null, // No refresh token
        id_token: undefined, // No id_token
        scope: 'read:user user:email',
      };
      const existingUser = {
        id: 'existing-user-123',
        email: 'githubuser@example.com',
        name: 'GitHub User',
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(null);
      (db.account.create as any).mockResolvedValue({});

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(true);
      expect(db.account.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          refresh_token: null,
          id_token: null,
        }),
      });
    });

    it('should continue on error during GitHub re-authentication', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'GitHub User',
        email: 'githubuser@example.com',
        image: 'https://avatars.githubusercontent.com/u/123',
      };
      const mockAccount = {
        provider: 'github',
        type: 'oauth',
        providerAccountId: 'github-123',
        access_token: 'gho_test_token',
      };
      const error = new Error('Database error');

      (db.user.findUnique as any).mockRejectedValue(error);

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(true); // Should still return true for GitHub auth
      expect(logger.authError).toHaveBeenCalledWith(
        'Failed to handle GitHub re-authentication',
        'SIGNIN_GITHUB',
        error
      );
    });
  });

  describe('Non-GitHub/Mock Provider', () => {
    it('should return true for other providers without special handling', async () => {
      // Arrange
      const mockUser = {
        id: 'user-123',
        name: 'Test User',
        email: 'user@example.com',
      };
      const mockAccount = {
        provider: 'google',
        type: 'oauth',
      };

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(true);
      expect(db.user.findUnique).not.toHaveBeenCalled();
      expect(ensureMockWorkspaceForUser).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle user without email for mock provider', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'mockuser',
        email: null,
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
      };
      const mockAccount = {
        provider: 'mock',
        type: 'credentials',
      };

      (db.user.findUnique as any).mockResolvedValue(null);

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(false); // Should fail because email is required for user.create
    });

    it('should handle user without email for GitHub provider', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'GitHub User',
        email: null,
        image: 'https://avatars.githubusercontent.com/u/123',
      };
      const mockAccount = {
        provider: 'github',
        type: 'oauth',
        access_token: 'gho_test_token',
      };

      (db.user.findUnique as any).mockResolvedValue(null);

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(true); // Should still allow sign-in (adapter handles it)
      expect(db.user.findUnique).not.toHaveBeenCalled();
    });

    it('should preserve original tokens when update has no new tokens', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'GitHub User',
        email: 'githubuser@example.com',
        image: 'https://avatars.githubusercontent.com/u/123',
      };
      const mockAccount = {
        provider: 'github',
        type: 'oauth',
        providerAccountId: 'github-123',
        access_token: 'gho_new_token',
        refresh_token: null,
        id_token: null,
        scope: 'read:user',
      };
      const existingUser = {
        id: 'existing-user-456',
        email: 'githubuser@example.com',
      };
      const existingAccount = {
        id: 'account-789',
        userId: 'existing-user-456',
        provider: 'github',
        refresh_token: 'old_encrypted_refresh',
        id_token: 'old_encrypted_id_token',
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(existingAccount);
      (db.account.update as any).mockResolvedValue({});

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(true);
      expect(db.account.update).toHaveBeenCalledWith({
        where: { id: 'account-789' },
        data: expect.objectContaining({
          refresh_token: 'old_encrypted_refresh', // Preserved
          id_token: 'old_encrypted_id_token', // Preserved
        }),
      });
    });
  });

  describe('User ID Usage', () => {
    it('should use newly created user ID for workspace creation in mock provider', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'mockuser',
        email: 'mockuser@mock.dev',
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
      };
      const mockAccount = {
        provider: 'mock',
        type: 'credentials',
      };

      (db.user.findUnique as any).mockResolvedValue(null);
      (db.user.create as any).mockResolvedValue({ id: 'new-user-id-123', email: mockUser.email });
      (ensureMockWorkspaceForUser as any).mockResolvedValue('test-workspace');
      (db.workspace.findFirst as any).mockResolvedValue({ slug: 'test-workspace' });

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(true);
      expect(ensureMockWorkspaceForUser).toHaveBeenCalledWith('new-user-id-123');
      expect(db.workspace.findFirst).toHaveBeenCalledWith({
        where: { ownerId: 'new-user-id-123', deleted: false },
        select: { slug: true },
      });
    });

    it('should use existing user ID for account creation in GitHub provider', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'GitHub User',
        email: 'githubuser@example.com',
        image: 'https://avatars.githubusercontent.com/u/123',
      };
      const mockAccount = {
        provider: 'github',
        type: 'oauth',
        providerAccountId: 'github-123',
        access_token: 'gho_test_token',
      };
      const existingUser = {
        id: 'existing-user-999',
        email: 'githubuser@example.com',
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(null);
      (db.account.create as any).mockResolvedValue({});

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(true);
      expect(db.account.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'existing-user-999',
          provider: 'github',
        },
      });
      expect(db.account.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'existing-user-999',
        }),
      });
    });
  });

  describe('Security & Data Integrity', () => {
    it('should encrypt all GitHub OAuth tokens when creating new account', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'GitHub User',
        email: 'githubuser@example.com',
        image: 'https://avatars.githubusercontent.com/u/123',
      };
      const mockAccount = {
        provider: 'github',
        type: 'oauth',
        providerAccountId: 'github-123',
        access_token: 'gho_sensitive_token',
        refresh_token: 'ghr_sensitive_refresh',
        id_token: 'sensitive_id_token',
      };
      const existingUser = {
        id: 'existing-user-123',
        email: 'githubuser@example.com',
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(null);
      (db.account.create as any).mockResolvedValue({});

      // Act
      await signInCallback({ user: mockUser, account: mockAccount });

      // Assert - verify all tokens are encrypted
      const createCall = (db.account.create as any).mock.calls[0][0];
      expect(createCall.data.access_token).toContain('encrypted_gho_sensitive_token');
      expect(createCall.data.refresh_token).toContain('encrypted_ghr_sensitive_refresh');
      expect(createCall.data.id_token).toContain('encrypted_sensitive_id_token');
      
      // Verify all encrypted fields are JSON stringified
      expect(() => JSON.parse(createCall.data.access_token)).not.toThrow();
      expect(() => JSON.parse(createCall.data.refresh_token)).not.toThrow();
      expect(() => JSON.parse(createCall.data.id_token)).not.toThrow();
    });

    it('should encrypt tokens when updating existing GitHub account', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'GitHub User',
        email: 'githubuser@example.com',
        image: 'https://avatars.githubusercontent.com/u/123',
      };
      const mockAccount = {
        provider: 'github',
        type: 'oauth',
        providerAccountId: 'github-123',
        access_token: 'gho_new_sensitive_token',
        refresh_token: 'ghr_new_sensitive_refresh',
      };
      const existingUser = {
        id: 'existing-user-456',
        email: 'githubuser@example.com',
      };
      const existingAccount = {
        id: 'account-789',
        userId: 'existing-user-456',
        provider: 'github',
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(existingAccount);
      (db.account.update as any).mockResolvedValue({});

      // Act
      await signInCallback({ user: mockUser, account: mockAccount });

      // Assert - verify tokens are encrypted
      const updateCall = (db.account.update as any).mock.calls[0][0];
      expect(updateCall.data.access_token).toContain('encrypted_gho_new_sensitive_token');
      expect(updateCall.data.refresh_token).toContain('encrypted_ghr_new_sensitive_refresh');
      
      // Verify encrypted fields are JSON stringified
      expect(() => JSON.parse(updateCall.data.access_token)).not.toThrow();
      expect(() => JSON.parse(updateCall.data.refresh_token)).not.toThrow();
    });

    it('should verify workspace exists before allowing mock authentication to complete', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'mockuser',
        email: 'mockuser@mock.dev',
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
      };
      const mockAccount = {
        provider: 'mock',
        type: 'credentials',
      };

      (db.user.findUnique as any).mockResolvedValue(null);
      (db.user.create as any).mockResolvedValue({ id: 'user-123', email: mockUser.email });
      (ensureMockWorkspaceForUser as any).mockResolvedValue('test-workspace');
      (db.workspace.findFirst as any).mockResolvedValue({ slug: 'test-workspace' });

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(true);
      expect(db.workspace.findFirst).toHaveBeenCalledWith({
        where: { ownerId: 'user-123', deleted: false },
        select: { slug: true },
      });
      expect(logger.authInfo).toHaveBeenCalledWith(
        'Mock workspace created successfully',
        'SIGNIN_MOCK_SUCCESS',
        expect.any(Object)
      );
    });

    it('should handle concurrent sign-in attempts with same email (mock provider)', async () => {
      // Arrange - simulates race condition where user is created between check and creation
      const mockUser = {
        id: 'temp-id',
        name: 'mockuser',
        email: 'mockuser@mock.dev',
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
      };
      const mockAccount = {
        provider: 'mock',
        type: 'credentials',
      };
      const raceConditionError = new Error('Unique constraint failed on email');

      (db.user.findUnique as any).mockResolvedValue(null);
      (db.user.create as any).mockRejectedValue(raceConditionError);

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(false);
      expect(logger.authError).toHaveBeenCalledWith(
        'Failed to handle mock authentication',
        'SIGNIN_MOCK',
        raceConditionError
      );
    });

    it('should mutate user object ID during mock authentication', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id-will-be-replaced',
        name: 'mockuser',
        email: 'mockuser@mock.dev',
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
      };
      const mockAccount = {
        provider: 'mock',
        type: 'credentials',
      };

      (db.user.findUnique as any).mockResolvedValue(null);
      (db.user.create as any).mockResolvedValue({ id: 'database-generated-id', email: mockUser.email });
      (ensureMockWorkspaceForUser as any).mockResolvedValue('test-workspace');
      (db.workspace.findFirst as any).mockResolvedValue({ slug: 'test-workspace' });

      // Act
      await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert - user.id should be mutated to the database-generated ID
      expect(mockUser.id).toBe('database-generated-id');
    });

    it('should mutate user object ID when using existing user (mock provider)', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id-will-be-replaced',
        name: 'existinguser',
        email: 'existinguser@mock.dev',
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
      };
      const mockAccount = {
        provider: 'mock',
        type: 'credentials',
      };
      const existingUser = {
        id: 'existing-database-id',
        email: 'existinguser@mock.dev',
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (ensureMockWorkspaceForUser as any).mockResolvedValue('existing-workspace');
      (db.workspace.findFirst as any).mockResolvedValue({ slug: 'existing-workspace' });

      // Act
      await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert - user.id should be mutated to the existing database ID
      expect(mockUser.id).toBe('existing-database-id');
    });

    it('should mutate user object ID when linking GitHub to existing user', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id-will-be-replaced',
        name: 'GitHub User',
        email: 'githubuser@example.com',
        image: 'https://avatars.githubusercontent.com/u/123',
      };
      const mockAccount = {
        provider: 'github',
        type: 'oauth',
        providerAccountId: 'github-123',
        access_token: 'gho_test_token',
      };
      const existingUser = {
        id: 'real-user-database-id',
        email: 'githubuser@example.com',
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(null);
      (db.account.create as any).mockResolvedValue({});

      // Act
      await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert - user.id should be mutated to the existing user's database ID
      expect(mockUser.id).toBe('real-user-database-id');
    });
  });

  describe('Account Data Handling', () => {
    it('should correctly handle all GitHub OAuth fields in account creation', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'GitHub User',
        email: 'githubuser@example.com',
        image: 'https://avatars.githubusercontent.com/u/123',
      };
      const mockAccount = {
        provider: 'github',
        type: 'oauth',
        providerAccountId: 'github-123456',
        access_token: 'gho_test_token',
        refresh_token: 'ghr_refresh_token',
        expires_at: 1735000000,
        token_type: 'bearer',
        scope: 'read:user user:email repo',
        id_token: 'id_token_jwt',
        session_state: 'session_state_value',
      };
      const existingUser = {
        id: 'existing-user-123',
        email: 'githubuser@example.com',
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(null);
      (db.account.create as any).mockResolvedValue({});

      // Act
      await signInCallback({ user: mockUser, account: mockAccount });

      // Assert
      expect(db.account.create).toHaveBeenCalledWith({
        data: {
          userId: 'existing-user-123',
          type: 'oauth',
          provider: 'github',
          providerAccountId: 'github-123456',
          access_token: expect.stringContaining('encrypted_gho_test_token'),
          refresh_token: expect.stringContaining('encrypted_ghr_refresh_token'),
          expires_at: 1735000000,
          token_type: 'bearer',
          scope: 'read:user user:email repo',
          id_token: expect.stringContaining('encrypted_id_token_jwt'),
          session_state: 'session_state_value',
        },
      });
    });

    it('should handle account update with subset of fields', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'GitHub User',
        email: 'githubuser@example.com',
        image: 'https://avatars.githubusercontent.com/u/123',
      };
      const mockAccount = {
        provider: 'github',
        type: 'oauth',
        providerAccountId: 'github-123',
        access_token: 'gho_updated_token',
        scope: 'read:user user:email',
        // Note: no refresh_token or id_token in update
      };
      const existingUser = {
        id: 'existing-user-456',
        email: 'githubuser@example.com',
      };
      const existingAccount = {
        id: 'account-789',
        userId: 'existing-user-456',
        provider: 'github',
        refresh_token: 'old_refresh_token',
        id_token: 'old_id_token',
      };

      (db.user.findUnique as any).mockResolvedValue(existingUser);
      (db.account.findFirst as any).mockResolvedValue(existingAccount);
      (db.account.update as any).mockResolvedValue({});

      // Act
      await signInCallback({ user: mockUser, account: mockAccount });

      // Assert - should preserve old tokens when new ones aren't provided
      expect(db.account.update).toHaveBeenCalledWith({
        where: { id: 'account-789' },
        data: {
          access_token: expect.stringContaining('encrypted_gho_updated_token'),
          scope: 'read:user user:email',
          refresh_token: 'old_refresh_token',
          id_token: 'old_id_token',
        },
      });
    });
  });

  describe('Mock Workspace Atomicity', () => {
    it('should fail authentication if workspace slug is undefined', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'testuser',
        email: 'testuser@mock.dev',
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
      };
      const mockAccount = {
        provider: 'mock',
        type: 'credentials',
      };

      (db.user.findUnique as any).mockResolvedValue(null);
      (db.user.create as any).mockResolvedValue({ id: 'user-789', email: mockUser.email });
      (ensureMockWorkspaceForUser as any).mockResolvedValue(undefined);

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert
      expect(result).toBe(false);
      expect(logger.authError).toHaveBeenCalledWith(
        'Failed to create mock workspace - workspace slug is empty',
        'SIGNIN_MOCK_WORKSPACE_FAILED',
        { userId: expect.any(String) }
      );
    });

    it('should verify workspace was committed to database before completing authentication', async () => {
      // Arrange
      const mockUser = {
        id: 'temp-id',
        name: 'testuser',
        email: 'testuser@mock.dev',
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
      };
      const mockAccount = {
        provider: 'mock',
        type: 'credentials',
      };

      (db.user.findUnique as any).mockResolvedValue(null);
      (db.user.create as any).mockResolvedValue({ id: 'user-999', email: mockUser.email });
      (ensureMockWorkspaceForUser as any).mockResolvedValue('test-workspace');
      
      // First call to findFirst in verification - returns null (not found)
      (db.workspace.findFirst as any).mockResolvedValue(null);

      // Act
      const result = await signInCallback({
        user: mockUser,
        account: mockAccount,
      });

      // Assert - authentication should fail due to verification failure
      expect(result).toBe(false);
      expect(db.workspace.findFirst).toHaveBeenCalledWith({
        where: { ownerId: expect.any(String), deleted: false },
        select: { slug: true },
      });
      expect(logger.authError).toHaveBeenCalledWith(
        'Mock workspace created but not found on verification - possible transaction issue',
        'SIGNIN_MOCK_VERIFICATION_FAILED',
        { userId: expect.any(String), expectedSlug: 'test-workspace' }
      );
    });
  });
});
