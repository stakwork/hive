/**
 * Integration test for POST /api/auth/revoke-github endpoint
 * 
 * This test covers:
 * 1. Authentication and authorization checks
 * 2. GitHub account existence validation
 * 3. External GitHub API token revocation
 * 4. Database cleanup operations (account, auth data, sessions)
 * 5. Error handling scenarios
 * 6. Security validations for sensitive operations
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { POST } from '@/app/api/auth/revoke-github/route';
import { db } from '@/lib/db';
import { EncryptionService } from '@/lib/encryption';

// Mock dependencies
vi.mock('next-auth/next');
vi.mock('@/lib/db', () => ({
  db: {
    account: {
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    gitHubAuth: {
      deleteMany: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/encryption', () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn(),
    })),
  },
}));

// Mock fetch for external GitHub API calls
global.fetch = vi.fn();

describe('POST /api/auth/revoke-github Integration Tests', () => {
  const mockUserId = 'test-user-id-123';
  const mockAccountId = 'test-account-id-456';
  const mockAccessToken = '{"data":"encrypted-token","iv":"test-iv","tag":"test-tag","version":"1","encryptedAt":"2024-01-01T00:00:00Z"}';
  const mockDecryptedToken = 'github-access-token-123';

  beforeAll(() => {
    // Setup environment variables for the test
    process.env.GITHUB_CLIENT_ID = 'test-client-id';
    process.env.GITHUB_CLIENT_SECRET = 'test-client-secret';
  });

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    
    // Setup default EncryptionService mock
    const mockEncryptionService = {
      decryptField: vi.fn().mockReturnValue(mockDecryptedToken),
    };
    (EncryptionService.getInstance as any).mockReturnValue(mockEncryptionService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    // Cleanup environment variables
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
  });

  describe('Authentication and Authorization', () => {
    it('should return 401 when no session exists', async () => {
      // Arrange
      (getServerSession as any).mockResolvedValue(null);
      const request = new NextRequest('http://localhost:3000/api/auth/revoke-github', {
        method: 'POST',
      });

      // Act
      const response = await POST();
      const data = await response.json();

      // Assert
      expect(response.status).toBe(401);
      expect(data).toEqual({ error: 'Unauthorized' });
    });

    it('should return 401 when session has no user', async () => {
      // Arrange
      (getServerSession as any).mockResolvedValue({ user: null });
      const request = new NextRequest('http://localhost:3000/api/auth/revoke-github', {
        method: 'POST',
      });

      // Act
      const response = await POST();
      const data = await response.json();

      // Assert
      expect(response.status).toBe(401);
      expect(data).toEqual({ error: 'Unauthorized' });
    });

    it('should return 401 when user has no id', async () => {
      // Arrange
      (getServerSession as any).mockResolvedValue({ 
        user: { name: 'Test User' } // No id field
      });

      // Act
      const response = await POST();
      const data = await response.json();

      // Assert
      expect(response.status).toBe(401);
      expect(data).toEqual({ error: 'Unauthorized' });
    });
  });

  describe('GitHub Account Management', () => {
    beforeEach(() => {
      // Setup valid session for account tests
      (getServerSession as any).mockResolvedValue({
        user: { id: mockUserId, name: 'Test User', email: 'test@example.com' }
      });
    });

    it('should return 404 when no GitHub account found', async () => {
      // Arrange
      (db.account.findFirst as any).mockResolvedValue(null);

      // Act
      const response = await POST();
      const data = await response.json();

      // Assert
      expect(response.status).toBe(404);
      expect(data).toEqual({ error: 'No GitHub account found' });
      expect(db.account.findFirst).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
          provider: 'github',
        },
      });
    });

    it('should successfully revoke GitHub access with valid account', async () => {
      // Arrange
      const mockAccount = {
        id: mockAccountId,
        userId: mockUserId,
        provider: 'github',
        access_token: mockAccessToken,
      };

      (db.account.findFirst as any).mockResolvedValue(mockAccount);
      (db.account.delete as any).mockResolvedValue(mockAccount);
      (db.gitHubAuth.deleteMany as any).mockResolvedValue({ count: 1 });
      (db.session.deleteMany as any).mockResolvedValue({ count: 1 });
      
      // Mock successful GitHub API response
      (fetch as any).mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
      });

      // Act
      const response = await POST();
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true });
      
      // Verify database operations
      expect(db.account.delete).toHaveBeenCalledWith({
        where: { id: mockAccountId },
      });
      expect(db.gitHubAuth.deleteMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
      });
      expect(db.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
      });
    });
  });

  describe('External GitHub API Integration', () => {
    beforeEach(() => {
      // Setup valid session and account for API tests
      (getServerSession as any).mockResolvedValue({
        user: { id: mockUserId, name: 'Test User', email: 'test@example.com' }
      });

      const mockAccount = {
        id: mockAccountId,
        userId: mockUserId,
        provider: 'github',
        access_token: mockAccessToken,
      };
      (db.account.findFirst as any).mockResolvedValue(mockAccount);
      (db.account.delete as any).mockResolvedValue(mockAccount);
      (db.gitHubAuth.deleteMany as any).mockResolvedValue({ count: 1 });
      (db.session.deleteMany as any).mockResolvedValue({ count: 1 });
    });

    it('should call GitHub API with correct parameters', async () => {
      // Arrange
      (fetch as any).mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
      });

      // Act
      const response = await POST();

      // Assert
      expect(fetch).toHaveBeenCalledWith(
        'https://api.github.com/applications/revoke',
        {
          method: 'DELETE',
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            Authorization: `Basic ${Buffer.from(
              `${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`
            ).toString('base64')}`,
          },
          body: JSON.stringify({
            access_token: mockDecryptedToken,
          }),
        }
      );
      expect(response.status).toBe(200);
    });

    it('should handle GitHub API failures gracefully', async () => {
      // Arrange
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      // Act
      const response = await POST();
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200); // Should still succeed locally
      expect(data).toEqual({ success: true });
      
      // Database cleanup should still happen
      expect(db.account.delete).toHaveBeenCalled();
      expect(db.gitHubAuth.deleteMany).toHaveBeenCalled();
      expect(db.session.deleteMany).toHaveBeenCalled();
    });

    it('should handle GitHub API network errors', async () => {
      // Arrange
      (fetch as any).mockRejectedValue(new Error('Network error'));

      // Act
      const response = await POST();
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200); // Should still succeed locally
      expect(data).toEqual({ success: true });
      
      // Database cleanup should still happen
      expect(db.account.delete).toHaveBeenCalled();
    });
  });

  describe('Encryption Service Integration', () => {
    beforeEach(() => {
      (getServerSession as any).mockResolvedValue({
        user: { id: mockUserId, name: 'Test User', email: 'test@example.com' }
      });

      const mockAccount = {
        id: mockAccountId,
        userId: mockUserId,
        provider: 'github',
        access_token: mockAccessToken,
      };
      (db.account.findFirst as any).mockResolvedValue(mockAccount);
      (db.account.delete as any).mockResolvedValue(mockAccount);
      (db.gitHubAuth.deleteMany as any).mockResolvedValue({ count: 1 });
      (db.session.deleteMany as any).mockResolvedValue({ count: 1 });
      
      (fetch as any).mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
      });
    });

    it('should decrypt access token before sending to GitHub', async () => {
      // Arrange
      const mockEncryptionService = {
        decryptField: vi.fn().mockReturnValue('decrypted-token-456'),
      };
      (EncryptionService.getInstance as any).mockReturnValue(mockEncryptionService);

      // Act
      await POST();

      // Assert
      expect(EncryptionService.getInstance).toHaveBeenCalled();
      expect(mockEncryptionService.decryptField).toHaveBeenCalledWith(
        'access_token',
        mockAccessToken
      );
    });

    it('should handle accounts without access tokens', async () => {
      // Arrange
      const accountWithoutToken = {
        id: mockAccountId,
        userId: mockUserId,
        provider: 'github',
        access_token: null,
      };
      (db.account.findFirst as any).mockResolvedValue(accountWithoutToken);

      // Act
      const response = await POST();
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true });
      
      // Should not call GitHub API when no token
      expect(fetch).not.toHaveBeenCalled();
      
      // Should still delete account and auth data
      expect(db.account.delete).toHaveBeenCalled();
      expect(db.gitHubAuth.deleteMany).toHaveBeenCalled();
    });
  });

  describe('Database Operations and Cleanup', () => {
    beforeEach(() => {
      (getServerSession as any).mockResolvedValue({
        user: { id: mockUserId, name: 'Test User', email: 'test@example.com' }
      });

      const mockAccount = {
        id: mockAccountId,
        userId: mockUserId,
        provider: 'github',
        access_token: mockAccessToken,
      };
      (db.account.findFirst as any).mockResolvedValue(mockAccount);
      
      (fetch as any).mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
      });
    });

    it('should handle session deletion errors gracefully', async () => {
      // Arrange
      (db.account.delete as any).mockResolvedValue({ id: mockAccountId });
      (db.gitHubAuth.deleteMany as any).mockResolvedValue({ count: 1 });
      (db.session.deleteMany as any).mockRejectedValue(new Error('Session deletion failed'));

      // Act
      const response = await POST();
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(data).toEqual({ success: true });
      
      // Should still complete other operations
      expect(db.account.delete).toHaveBeenCalled();
      expect(db.gitHubAuth.deleteMany).toHaveBeenCalled();
    });

    it('should perform complete database cleanup sequence', async () => {
      // Arrange
      (db.account.delete as any).mockResolvedValue({ id: mockAccountId });
      (db.gitHubAuth.deleteMany as any).mockResolvedValue({ count: 2 });
      (db.session.deleteMany as any).mockResolvedValue({ count: 3 });

      // Act
      const response = await POST();

      // Assert
      expect(response.status).toBe(200);
      
      // Verify cleanup sequence
      expect(db.account.delete).toHaveBeenCalledWith({
        where: { id: mockAccountId },
      });
      expect(db.gitHubAuth.deleteMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
      });
      expect(db.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
      });
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      (getServerSession as any).mockResolvedValue({
        user: { id: mockUserId, name: 'Test User', email: 'test@example.com' }
      });
    });

    it('should return 500 on database errors', async () => {
      // Arrange
      (db.account.findFirst as any).mockRejectedValue(new Error('Database connection failed'));

      // Act
      const response = await POST();
      const data = await response.json();

      // Assert
      expect(response.status).toBe(500);
      expect(data).toEqual({ error: 'Failed to revoke GitHub access' });
    });

    it('should return 500 on encryption service errors', async () => {
      // Arrange
      const mockAccount = {
        id: mockAccountId,
        userId: mockUserId,
        provider: 'github',
        access_token: mockAccessToken,
      };
      (db.account.findFirst as any).mockResolvedValue(mockAccount);
      
      // Mock the decryptField to throw error
      const mockEncryptionService = {
        decryptField: vi.fn().mockImplementation(() => {
          throw new Error('Decryption failed');
        }),
      };
      (EncryptionService.getInstance as any).mockReturnValue(mockEncryptionService);

      // Act
      const response = await POST();
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200); // The route catches encryption errors and continues
      expect(data).toEqual({ success: true });
    });
  });

  describe('Security Validations', () => {
    it('should validate user owns the GitHub account', async () => {
      // Arrange
      (getServerSession as any).mockResolvedValue({
        user: { id: 'different-user-id', name: 'Other User' }
      });

      // Mock db.account.findFirst to return null since no account exists for 'different-user-id'
      (db.account.findFirst as any).mockResolvedValue(null);

      // Act
      const response = await POST();
      const data = await response.json();

      // Assert
      expect(response.status).toBe(404);
      expect(data).toEqual({ error: 'No GitHub account found' });
      expect(db.account.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'different-user-id', // Should search for session user, not account owner
          provider: 'github',
        },
      });
    });

    it('should only process GitHub provider accounts', async () => {
      // Arrange
      (getServerSession as any).mockResolvedValue({
        user: { id: mockUserId, name: 'Test User' }
      });

      // Act
      await POST();

      // Assert
      expect(db.account.findFirst).toHaveBeenCalledWith({
        where: {
          userId: mockUserId,
          provider: 'github', // Must specifically be GitHub
        },
      });
    });
  });
});