import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/revoke-github/route';
import { db } from '@/lib/db';
import { EncryptionService } from '@/lib/encryption';
import { getServerSession } from 'next-auth/next';
import { User, Account, GitHubAuth, Session } from '@prisma/client';

// Mock next-auth session
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}));

// Mock fetch for GitHub API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('POST /api/auth/revoke-github Integration Tests', () => {
  let testUser: User;
  let testAccount: Account;
  let testGitHubAuth: GitHubAuth;
  let testSession: Session;
  const encryptionService = EncryptionService.getInstance();

  const mockGitHubToken = 'github_token_12345';
  const mockEncryptedToken = encryptionService.encryptField('access_token', mockGitHubToken);

  beforeAll(() => {
    // Set up environment variables for GitHub API
    process.env.GITHUB_CLIENT_ID = 'test_github_client_id';
    process.env.GITHUB_CLIENT_SECRET = 'test_github_client_secret';
  });

  beforeEach(async () => {
    // Clean up any existing test data
    await db.session.deleteMany({ where: { user: { email: 'test@example.com' } } });
    await db.account.deleteMany({ where: { user: { email: 'test@example.com' } } });
    await db.gitHubAuth.deleteMany({ where: { user: { email: 'test@example.com' } } });
    await db.user.deleteMany({ where: { email: 'test@example.com' } });

    // Create test user
    testUser = await db.user.create({
      data: {
        id: 'test-user-id',
        name: 'Test User',
        email: 'test@example.com',
        role: 'USER',
      },
    });

    // Create test GitHub account with encrypted token
    testAccount = await db.account.create({
      data: {
        id: 'test-account-id',
        userId: testUser.id,
        type: 'oauth',
        provider: 'github',
        providerAccountId: '12345',
        access_token: JSON.stringify(mockEncryptedToken),
        refresh_token: null,
        expires_at: null,
        token_type: 'bearer',
        scope: 'repo,user',
      },
    });

    // Create test GitHub auth record
    testGitHubAuth = await db.gitHubAuth.create({
      data: {
        id: 'test-github-auth-id',
        userId: testUser.id,
        githubUserId: '12345',
        githubUsername: 'testuser',
      },
    });

    // Create test session
    testSession = await db.session.create({
      data: {
        id: 'test-session-id',
        sessionToken: 'test-session-token',
        userId: testUser.id,
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
      },
    });

    // Reset mocks
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterAll(async () => {
    // Clean up test data
    await db.session.deleteMany({ where: { user: { email: 'test@example.com' } } });
    await db.account.deleteMany({ where: { user: { email: 'test@example.com' } } });
    await db.gitHubAuth.deleteMany({ where: { user: { email: 'test@example.com' } } });
    await db.user.deleteMany({ where: { email: 'test@example.com' } });
  });

  describe('Authentication and Authorization', () => {
    it('should return 401 when user is not authenticated', async () => {
      // Mock no session
      (getServerSession as any).mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/auth/revoke-github', {
        method: 'POST',
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 401 when session user has no id', async () => {
      // Mock session without user id
      (getServerSession as any).mockResolvedValue({
        user: { email: 'test@example.com' },
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 404 when user has no GitHub account', async () => {
      // Delete the test account first
      await db.account.delete({ where: { id: testAccount.id } });

      // Mock valid session
      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id, email: 'test@example.com' },
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('No GitHub account found');
    });
  });

  describe('GitHub Token Revocation', () => {
    it('should successfully revoke GitHub token and clean up data', async () => {
      // Mock successful GitHub API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      // Mock valid session
      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id, email: 'test@example.com' },
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify GitHub API was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/applications/revoke',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'Authorization': expect.stringContaining('Basic '),
          }),
          body: JSON.stringify({
            access_token: mockGitHubToken,
          }),
        })
      );

      // Verify database cleanup - account should be deleted
      const deletedAccount = await db.account.findFirst({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();

      // Verify GitHub auth data is deleted
      const deletedGitHubAuth = await db.gitHubAuth.findMany({
        where: { userId: testUser.id },
      });
      expect(deletedGitHubAuth).toHaveLength(0);

      // Verify all user sessions are deleted
      const deletedSessions = await db.session.findMany({
        where: { userId: testUser.id },
      });
      expect(deletedSessions).toHaveLength(0);
    });

    it('should handle GitHub API errors gracefully and still clean up data', async () => {
      // Mock GitHub API error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      // Mock valid session
      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id, email: 'test@example.com' },
      });

      const response = await POST();
      const data = await response.json();

      // Should still succeed even if GitHub API fails
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify database cleanup still occurs
      const deletedAccount = await db.account.findFirst({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();
    });

    it('should handle network errors when revoking GitHub token', async () => {
      // Mock network error
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Mock valid session
      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id, email: 'test@example.com' },
      });

      const response = await POST();
      const data = await response.json();

      // Should still succeed and clean up data
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify database cleanup occurs despite network error
      const deletedAccount = await db.account.findFirst({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();
    });
  });

  describe('Data Security and Encryption', () => {
    it('should properly decrypt access token before sending to GitHub', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id, email: 'test@example.com' },
      });

      await POST();

      // Verify the decrypted token was sent to GitHub API
      const fetchCall = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody.access_token).toBe(mockGitHubToken);
    });

    it('should handle account without access token', async () => {
      // Create account without access token
      await db.account.update({
        where: { id: testAccount.id },
        data: { access_token: null },
      });

      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id, email: 'test@example.com' },
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Should not make GitHub API call
      expect(mockFetch).not.toHaveBeenCalled();

      // Should still clean up database
      const deletedAccount = await db.account.findFirst({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();
    });
  });

  describe('Database Transaction Safety', () => {
    it('should handle session deletion errors gracefully', async () => {
      // Delete sessions before the endpoint tries to
      await db.session.deleteMany({ where: { userId: testUser.id } });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id, email: 'test@example.com' },
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should handle database errors and return appropriate error response', async () => {
      // Mock database error by using invalid user id
      (getServerSession as any).mockResolvedValue({
        user: { id: 'non-existent-user-id', email: 'test@example.com' },
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('No GitHub account found');
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    it('should handle malformed encrypted token data', async () => {
      // Update account with malformed encrypted token
      await db.account.update({
        where: { id: testAccount.id },
        data: { access_token: 'invalid-encrypted-data' },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id, email: 'test@example.com' },
      });

      // Should handle decryption error gracefully
      const response = await POST();

      // Even if decryption fails, should still clean up
      expect(response.status).toBe(200);
      
      const deletedAccount = await db.account.findFirst({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();
    });

    it('should handle missing environment variables gracefully', async () => {
      // Temporarily remove environment variables
      const originalClientId = process.env.GITHUB_CLIENT_ID;
      const originalClientSecret = process.env.GITHUB_CLIENT_SECRET;
      
      delete process.env.GITHUB_CLIENT_ID;
      delete process.env.GITHUB_CLIENT_SECRET;

      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id, email: 'test@example.com' },
      });

      const response = await POST();
      const data = await response.json();

      // Should still succeed and clean up data
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Restore environment variables
      process.env.GITHUB_CLIENT_ID = originalClientId;
      process.env.GITHUB_CLIENT_SECRET = originalClientSecret;
    });
  });

  describe('Multiple Account Scenarios', () => {
    it('should only delete the GitHub account for the authenticated user', async () => {
      // Create another user with GitHub account
      const otherUser = await db.user.create({
        data: {
          id: 'other-user-id',
          name: 'Other User',
          email: 'other@example.com',
          role: 'USER',
        },
      });

      const otherAccount = await db.account.create({
        data: {
          id: 'other-account-id',
          userId: otherUser.id,
          type: 'oauth',
          provider: 'github',
          providerAccountId: '67890',
          access_token: JSON.stringify(mockEncryptedToken),
          token_type: 'bearer',
          scope: 'repo,user',
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      (getServerSession as any).mockResolvedValue({
        user: { id: testUser.id, email: 'test@example.com' },
      });

      const response = await POST();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Test user's account should be deleted
      const deletedAccount = await db.account.findFirst({
        where: { id: testAccount.id },
      });
      expect(deletedAccount).toBeNull();

      // Other user's account should remain
      const remainingAccount = await db.account.findFirst({
        where: { id: otherAccount.id },
      });
      expect(remainingAccount).not.toBeNull();

      // Clean up
      await db.account.delete({ where: { id: otherAccount.id } });
      await db.user.delete({ where: { id: otherUser.id } });
    });
  });
});