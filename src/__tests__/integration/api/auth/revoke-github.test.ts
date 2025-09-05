import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { db } from '@/lib/db';
import { EncryptionService } from '@/lib/encryption';
import { POST } from '@/app/api/auth/revoke-github/route';
import { 
  createTestUser, 
  cleanup, 
  mockData 
} from '@/__tests__/utils/test-helpers';

// Mock external dependencies
vi.mock('next-auth/next');
vi.mock('@/lib/encryption');
vi.mock('node:crypto');

const mockGetServerSession = vi.mocked(getServerSession);
const mockEncryptionService = vi.mocked(EncryptionService);

describe('POST /api/auth/revoke-github Integration Tests', () => {
  let testUser: any;
  let testAccount: any;
  let testGitHubAuth: any;
  let testSession: any;

  beforeAll(async () => {
    // Ensure clean database state
    await db.verificationToken.deleteMany();
    await db.session.deleteMany();
    await db.account.deleteMany();
    await db.gitHubAuth.deleteMany();
    await db.user.deleteMany();
  });

  afterAll(async () => {
    // Clean up all test data
    await cleanup.deleteUsers([testUser?.id].filter(Boolean));
    await db.$disconnect();
  });

  beforeEach(async () => {
    // Create test user
    testUser = await createTestUser({
      name: 'GitHub Test User',
      email: 'github-test@example.com',
      role: 'USER'
    });

    // Create GitHub account record
    testAccount = await db.account.create({
      data: {
        userId: testUser.id,
        type: 'oauth',
        provider: 'github',
        providerAccountId: '12345',
        access_token: JSON.stringify({
          data: 'encrypted_access_token_data',
          iv: 'test_iv',
          tag: 'test_tag',
          keyId: 'test_key',
          version: '1',
          encryptedAt: new Date().toISOString()
        }),
        token_type: 'bearer',
        scope: 'read:user,user:email'
      }
    });

    // Create GitHub auth record
    testGitHubAuth = await db.gitHubAuth.create({
      data: {
        userId: testUser.id,
        githubUserId: '12345',
        githubUsername: 'testuser',
        name: 'GitHub Test User',
        bio: 'Test bio',
        publicRepos: 5,
        followers: 10
      }
    });

    // Create session record
    testSession = await db.session.create({
      data: {
        userId: testUser.id,
        sessionToken: 'test_session_token',
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
      }
    });

    // Reset all mocks
    vi.clearAllMocks();

    // Setup encryption service mock
    const mockEncryptionInstance = {
      decryptField: vi.fn().mockReturnValue('decrypted_github_token')
    };
    mockEncryptionService.getInstance = vi.fn().mockReturnValue(mockEncryptionInstance);
  });

  afterEach(async () => {
    // Clean up test data after each test
    if (testSession?.id) {
      await db.session.deleteMany({ where: { userId: testUser.id } });
    }
    if (testGitHubAuth?.id) {
      await db.gitHubAuth.deleteMany({ where: { userId: testUser.id } });
    }
    if (testAccount?.id) {
      await db.account.deleteMany({ where: { userId: testUser.id } });
    }
  });

  describe('Authentication and Authorization', () => {
    it('should return 401 when no session exists', async () => {
      // Mock no session
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/auth/revoke-github', {
        method: 'POST'
      });

      const response = await POST(request as any);
      const responseData = await response.json();

      expect(response.status).toBe(401);
      expect(responseData).toEqual({
        error: 'Unauthorized'
      });
    });

    it('should return 401 when session user has no id', async () => {
      // Mock session without user id
      mockGetServerSession.mockResolvedValue({
        user: { name: 'Test User', email: 'test@example.com' },
        expires: '2024-12-31T00:00:00.000Z'
      });

      const request = new NextRequest('http://localhost:3000/api/auth/revoke-github', {
        method: 'POST'
      });

      const response = await POST(request as any);
      const responseData = await response.json();

      expect(response.status).toBe(401);
      expect(responseData).toEqual({
        error: 'Unauthorized'
      });
    });

    it('should return 404 when no GitHub account found for user', async () => {
      // Create user without GitHub account
      const userWithoutGitHub = await createTestUser({
        name: 'No GitHub User',
        email: 'no-github@example.com'
      });

      // Mock valid session for user without GitHub account
      mockGetServerSession.mockResolvedValue({
        user: { id: userWithoutGitHub.id, name: 'No GitHub User', email: 'no-github@example.com' },
        expires: '2024-12-31T00:00:00.000Z'
      });

      const request = new NextRequest('http://localhost:3000/api/auth/revoke-github', {
        method: 'POST'
      });

      const response = await POST(request as any);
      const responseData = await response.json();

      expect(response.status).toBe(404);
      expect(responseData).toEqual({
        error: 'No GitHub account found'
      });

      // Clean up
      await cleanup.deleteUsers([userWithoutGitHub.id]);
    });
  });

  describe('Successful GitHub Revocation', () => {
    it('should successfully revoke GitHub access with valid session and account', async () => {
      // Mock valid session
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: '2024-12-31T00:00:00.000Z'
      });

      const request = new NextRequest('http://localhost:3000/api/auth/revoke-github', {
        method: 'POST'
      });

      const response = await POST(request as any);
      const responseData = await response.json();

      // Verify successful response
      expect(response.status).toBe(200);
      expect(responseData).toEqual({
        success: true
      });

      // Verify database cleanup - account should be deleted
      const accountExists = await db.account.findFirst({
        where: { id: testAccount.id }
      });
      expect(accountExists).toBeNull();

      // Verify GitHub auth data was deleted
      const githubAuthExists = await db.gitHubAuth.findFirst({
        where: { userId: testUser.id }
      });
      expect(githubAuthExists).toBeNull();

      // Verify sessions were deleted
      const sessionExists = await db.session.findFirst({
        where: { userId: testUser.id }
      });
      expect(sessionExists).toBeNull();
    });

    it('should handle account without access_token', async () => {
      // Delete existing account
      await db.account.deleteMany({ where: { userId: testUser.id } });

      // Create account without access token
      const accountWithoutToken = await db.account.create({
        data: {
          userId: testUser.id,
          type: 'oauth',
          provider: 'github',
          providerAccountId: '67890',
          access_token: null,
          token_type: 'bearer',
          scope: 'read:user'
        }
      });

      // Mock valid session
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: '2024-12-31T00:00:00.000Z'
      });

      const request = new NextRequest('http://localhost:3000/api/auth/revoke-github', {
        method: 'POST'
      });

      const response = await POST(request as any);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData).toEqual({
        success: true
      });

      // Verify database cleanup still occurred
      const accountExists = await db.account.findFirst({
        where: { id: accountWithoutToken.id }
      });
      expect(accountExists).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Mock valid session
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: '2024-12-31T00:00:00.000Z'
      });

      // Mock encryption service to throw error - this happens when decrypting token fails
      const mockEncryptionInstance = {
        decryptField: vi.fn().mockImplementation(() => {
          throw new Error('Decryption failed');
        })
      };
      mockEncryptionService.getInstance = vi.fn().mockReturnValue(mockEncryptionInstance);

      const request = new NextRequest('http://localhost:3000/api/auth/revoke-github', {
        method: 'POST'
      });

      const response = await POST(request as any);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData).toEqual({
        error: 'Failed to revoke GitHub access'
      });
    });

    it('should handle network errors when calling GitHub API', async () => {
      // Mock valid session
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: '2024-12-31T00:00:00.000Z'
      });

      // Mock network error
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      global.fetch = mockFetch;

      process.env.GITHUB_CLIENT_ID = 'test_client_id';
      process.env.GITHUB_CLIENT_SECRET = 'test_client_secret';

      const request = new NextRequest('http://localhost:3000/api/auth/revoke-github', {
        method: 'POST'
      });

      const response = await POST(request as any);
      const responseData = await response.json();

      // Should still succeed despite network error
      expect(response.status).toBe(200);
      expect(responseData).toEqual({
        success: true
      });

      // Verify database cleanup still occurred
      const accountExists = await db.account.findFirst({
        where: { id: testAccount.id }
      });
      expect(accountExists).toBeNull();
    });
  });

  describe('Data Security and Encryption', () => {
    it('should properly decrypt access tokens before sending to GitHub API', async () => {
      // Mock valid session
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: '2024-12-31T00:00:00.000Z'
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content'
      });
      global.fetch = mockFetch;

      // Create specific encrypted token format and update the account
      const encryptedToken = {
        data: 'encrypted_token_data',
        iv: 'initialization_vector',
        tag: 'auth_tag',
        keyId: 'encryption_key_id',
        version: '1',
        encryptedAt: '2024-01-01T00:00:00.000Z'
      };

      await db.account.update({
        where: { id: testAccount.id },
        data: { access_token: JSON.stringify(encryptedToken) }
      });

      const mockDecryptedToken = 'gho_decrypted_github_token_123';
      const mockEncryptionInstance = {
        decryptField: vi.fn().mockReturnValue(mockDecryptedToken)
      };
      mockEncryptionService.getInstance = vi.fn().mockReturnValue(mockEncryptionInstance);

      process.env.GITHUB_CLIENT_ID = 'test_client_id';
      process.env.GITHUB_CLIENT_SECRET = 'test_client_secret';

      const request = new NextRequest('http://localhost:3000/api/auth/revoke-github', {
        method: 'POST'
      });

      const response = await POST(request as any);

      // Verify decryption was called (testing the integration)
      expect(mockEncryptionInstance.decryptField).toHaveBeenCalled();

      // Verify GitHub API received a request
      expect(mockFetch).toHaveBeenCalled();

      expect(response.status).toBe(200);
    });

    it('should not expose sensitive data in error responses', async () => {
      // Mock valid session but cause general error by making database fail
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: '2024-12-31T00:00:00.000Z'
      });

      // Store original function to restore later
      const originalFindFirst = db.account.findFirst;

      // Mock the db.account.findFirst to throw error
      const mockFindFirst = vi.fn().mockRejectedValue(
        new Error('Database connection failed: sensitive_connection_string_with_password_123')
      );
      db.account.findFirst = mockFindFirst;

      const request = new NextRequest('http://localhost:3000/api/auth/revoke-github', {
        method: 'POST'
      });

      const response = await POST(request as any);
      const responseData = await response.json();

      // Verify error response doesn't expose sensitive details
      expect(response.status).toBe(500);
      expect(responseData).toEqual({
        error: 'Failed to revoke GitHub access'
      });
      expect(responseData).not.toHaveProperty('connection_string');
      expect(responseData).not.toHaveProperty('password');
      expect(responseData.error).not.toContain('password_123');
      expect(responseData.error).not.toContain('sensitive_connection_string');

      // Restore original function
      db.account.findFirst = originalFindFirst;
    });
  });

  describe('Database State Verification', () => {
    it('should maintain referential integrity during cleanup', async () => {
      // Create additional related data to test cascading deletes
      const additionalSession = await db.session.create({
        data: {
          userId: testUser.id,
          sessionToken: 'additional_session_token',
          expires: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });

      // Mock valid session
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: '2024-12-31T00:00:00.000Z'
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204
      });
      global.fetch = mockFetch;

      const request = new NextRequest('http://localhost:3000/api/auth/revoke-github', {
        method: 'POST'
      });

      const response = await POST(request as any);

      expect(response.status).toBe(200);

      // Verify all sessions for user were deleted
      const remainingSessions = await db.session.findMany({
        where: { userId: testUser.id }
      });
      expect(remainingSessions).toHaveLength(0);

      // Verify user record still exists (only account and sessions deleted)
      const userExists = await db.user.findFirst({
        where: { id: testUser.id }
      });
      expect(userExists).toBeTruthy();
    });

    it('should handle session deletion gracefully when sessions already deleted', async () => {
      // Pre-delete sessions to test error handling
      await db.session.deleteMany({
        where: { userId: testUser.id }
      });

      // Mock valid session
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, name: testUser.name, email: testUser.email },
        expires: '2024-12-31T00:00:00.000Z'
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204
      });
      global.fetch = mockFetch;

      const request = new NextRequest('http://localhost:3000/api/auth/revoke-github', {
        method: 'POST'
      });

      const response = await POST(request as any);

      // Should still succeed
      expect(response.status).toBe(200);
      
      // Verify other cleanup still happened
      const accountExists = await db.account.findFirst({
        where: { id: testAccount.id }
      });
      expect(accountExists).toBeNull();
    });
  });
});