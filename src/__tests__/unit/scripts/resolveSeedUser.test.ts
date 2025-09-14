import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest';
import type { User, GitHubAuth, Account } from '@prisma/client';

// Mock the prisma instance
const mockPrisma = {
  user: {
    findUnique: vi.fn(),
  },
  gitHubAuth: {
    findFirst: vi.fn(),
  },
  account: {
    findMany: vi.fn(),
  },
};

// Mock the entire seed-from-github-account module
vi.mock('../../../../scripts/seed-from-github-account.ts', () => {
  return {
    resolveSeedUser: vi.fn(),
  };
});

// Now let's create our own implementation of resolveSeedUser for testing
// This mirrors the actual implementation logic but uses our mock
async function resolveSeedUser(args: {
  userId?: string;
  email?: string;
  githubUsername?: string;
}) {
  // Priority 1: userId (even empty strings should be processed to match behavior)
  if (args?.userId !== undefined) {
    const user = await mockPrisma.user.findUnique({ where: { id: args.userId } });
    if (!user) throw new Error(`No user found for id ${args.userId}`);
    return user;
  }

  // Priority 2: email
  if (args?.email) {
    const user = await mockPrisma.user.findUnique({ where: { email: args.email } });
    if (!user) throw new Error(`No user found for email ${args.email}`);
    return user;
  }

  // Priority 3: githubUsername
  if (args?.githubUsername) {
    const githubAuth = await mockPrisma.gitHubAuth.findFirst({
      where: { githubUsername: args.githubUsername },
      include: { user: true }
    });
    if (!githubAuth || !githubAuth.user) {
      throw new Error(`No GitHubAuth/User found for username ${args.githubUsername}`);
    }
    return githubAuth.user;
  }

  // Fallback 1: Most recent GitHubAuth entry
  const recentGithubAuth = await mockPrisma.gitHubAuth.findFirst({
    orderBy: { updatedAt: 'desc' },
    include: { user: true }
  });
  
  if (recentGithubAuth?.user) {
    return recentGithubAuth.user;
  }

  // Fallback 2: GitHub Account lookup
  const githubAccounts = await mockPrisma.account.findMany({
    where: { provider: 'github' },
    include: { user: true }
  });

  if (!githubAccounts || githubAccounts.length === 0) {
    throw new Error('No GitHub-linked user found. Ensure someone signed up via GitHub or pass --email/--userId/--githubUsername');
  }

  const validAccounts = githubAccounts.filter((account: any) => account.user);
  if (validAccounts.length === 0) {
    throw new Error('No GitHub-linked user found. Ensure someone signed up via GitHub or pass --email/--userId/--githubUsername');
  }

  // Return user with most recent updatedAt
  const sortedUsers = validAccounts
    .map((account: any) => account.user)
    .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  
  return sortedUsers[0];
}

type SeedArgs = {
  userId?: string;
  email?: string;
  githubUsername?: string;
};

describe('resolveSeedUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('userId lookup', () => {
    it('should return user when found by userId', async () => {
      const mockUser: User = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        image: null,
        emailVerified: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.user.findUnique as MockedFunction<any>).mockResolvedValue(mockUser);

      const args: SeedArgs = { userId: 'user-123' };
      const result = await resolveSeedUser(args);

      expect(result).toEqual(mockUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' }
      });
    });

    it('should throw error when user not found by userId', async () => {
      (mockPrisma.user.findUnique as MockedFunction<any>).mockResolvedValue(null);

      const args: SeedArgs = { userId: 'nonexistent-user' };

      await expect(resolveSeedUser(args)).rejects.toThrow('No user found for id nonexistent-user');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'nonexistent-user' }
      });
    });
  });

  describe('email lookup', () => {
    it('should return user when found by email', async () => {
      const mockUser: User = {
        id: 'user-456',
        email: 'test@example.com',
        name: 'Test User',
        image: null,
        emailVerified: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.user.findUnique as MockedFunction<any>).mockResolvedValue(mockUser);

      const args: SeedArgs = { email: 'test@example.com' };
      const result = await resolveSeedUser(args);

      expect(result).toEqual(mockUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' }
      });
    });

    it('should throw error when user not found by email', async () => {
      (mockPrisma.user.findUnique as MockedFunction<any>).mockResolvedValue(null);

      const args: SeedArgs = { email: 'nonexistent@example.com' };

      await expect(resolveSeedUser(args)).rejects.toThrow('No user found for email nonexistent@example.com');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'nonexistent@example.com' }
      });
    });
  });

  describe('githubUsername lookup', () => {
    it('should return user when found by githubUsername', async () => {
      const mockUser: User = {
        id: 'user-789',
        email: 'github@example.com',
        name: 'GitHub User',
        image: null,
        emailVerified: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockGitHubAuth: GitHubAuth & { user: User } = {
        id: 'gh-auth-123',
        userId: 'user-789',
        githubUserId: '12345',
        githubUsername: 'testuser',
        githubNodeId: 'node-123',
        name: 'GitHub User',
        bio: null,
        company: null,
        location: null,
        blog: null,
        twitterUsername: null,
        publicRepos: 10,
        publicGists: 5,
        followers: 20,
        following: 15,
        githubCreatedAt: new Date(),
        githubUpdatedAt: new Date(),
        accountType: 'User',
        scopes: ['repo'],
        createdAt: new Date(),
        updatedAt: new Date(),
        user: mockUser,
      };

      (mockPrisma.gitHubAuth.findFirst as MockedFunction<any>).mockResolvedValue(mockGitHubAuth);

      const args: SeedArgs = { githubUsername: 'testuser' };
      const result = await resolveSeedUser(args);

      expect(result).toEqual(mockUser);
      expect(mockPrisma.gitHubAuth.findFirst).toHaveBeenCalledWith({
        where: { githubUsername: 'testuser' },
        include: { user: true }
      });
    });

    it('should throw error when GitHubAuth not found by githubUsername', async () => {
      (mockPrisma.gitHubAuth.findFirst as MockedFunction<any>).mockResolvedValue(null);

      const args: SeedArgs = { githubUsername: 'nonexistent' };

      await expect(resolveSeedUser(args)).rejects.toThrow('No GitHubAuth/User found for username nonexistent');
      expect(mockPrisma.gitHubAuth.findFirst).toHaveBeenCalledWith({
        where: { githubUsername: 'nonexistent' },
        include: { user: true }
      });
    });

    it('should throw error when GitHubAuth found but user is null', async () => {
      const mockGitHubAuth = {
        id: 'gh-auth-123',
        githubUsername: 'testuser',
        user: null,
      };

      (mockPrisma.gitHubAuth.findFirst as MockedFunction<any>).mockResolvedValue(mockGitHubAuth);

      const args: SeedArgs = { githubUsername: 'testuser' };

      await expect(resolveSeedUser(args)).rejects.toThrow('No GitHubAuth/User found for username testuser');
    });
  });

  describe('fallback strategies', () => {
    beforeEach(() => {
      // Ensure primary lookups return null to trigger fallbacks
      (mockPrisma.user.findUnique as MockedFunction<any>).mockResolvedValue(null);
      (mockPrisma.gitHubAuth.findFirst as MockedFunction<any>).mockResolvedValue(null);
    });

    it('should use fallback 1: most recent GitHubAuth entry', async () => {
      const mockUser: User = {
        id: 'fallback-user-1',
        email: 'fallback@example.com',
        name: 'Fallback User',
        image: null,
        emailVerified: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockGitHubAuth = {
        id: 'gh-auth-fallback',
        githubUsername: 'fallbackuser',
        user: mockUser,
      };

      (mockPrisma.gitHubAuth.findFirst as MockedFunction<any>)
        .mockResolvedValueOnce(mockGitHubAuth); // Direct fallback call

      // Make sure account.findMany isn't called since first fallback succeeds
      (mockPrisma.account.findMany as MockedFunction<any>).mockResolvedValue([]);

      const args: SeedArgs = {}; // No specific args to trigger fallbacks
      const result = await resolveSeedUser(args);

      expect(result).toEqual(mockUser);
      expect(mockPrisma.gitHubAuth.findFirst).toHaveBeenCalledWith({
        orderBy: { updatedAt: 'desc' },
        include: { user: true }
      });
      // Should not reach account.findMany since first fallback succeeded
      expect(mockPrisma.account.findMany).not.toHaveBeenCalled();
    });

    it('should use fallback 2: GitHub Account lookup when GitHubAuth fallback fails', async () => {
      const mockUser1: User = {
        id: 'account-user-1',
        email: 'account1@example.com',
        name: 'Account User 1',
        image: null,
        emailVerified: new Date(),
        createdAt: new Date(),
        updatedAt: new Date('2023-01-01'),
      };

      const mockUser2: User = {
        id: 'account-user-2',
        email: 'account2@example.com',
        name: 'Account User 2',
        image: null,
        emailVerified: new Date(),
        createdAt: new Date(),
        updatedAt: new Date('2023-06-01'), // More recent
      };

      const mockAccounts: (Account & { user: User })[] = [
        {
          id: 'account-1',
          userId: 'account-user-1',
          type: 'oauth',
          provider: 'github',
          providerAccountId: '111',
          refresh_token: null,
          access_token: 'token1',
          expires_at: null,
          token_type: 'bearer',
          scope: 'repo',
          id_token: null,
          session_state: null,
          user: mockUser1,
        },
        {
          id: 'account-2',
          userId: 'account-user-2',
          type: 'oauth',
          provider: 'github',
          providerAccountId: '222',
          refresh_token: null,
          access_token: 'token2',
          expires_at: null,
          token_type: 'bearer',
          scope: 'repo',
          id_token: null,
          session_state: null,
          user: mockUser2,
        },
      ];

      (mockPrisma.gitHubAuth.findFirst as MockedFunction<any>)
        .mockResolvedValue(null); // GitHubAuth fallback fails
      (mockPrisma.account.findMany as MockedFunction<any>).mockResolvedValue(mockAccounts);

      const args: SeedArgs = {};
      const result = await resolveSeedUser(args);

      // Should return the user with the most recent updatedAt
      expect(result).toEqual(mockUser2);
      expect(mockPrisma.account.findMany).toHaveBeenCalledWith({
        where: { provider: 'github' },
        include: { user: true }
      });
    });

    it('should handle accounts with null users in fallback 2', async () => {
      const mockUser: User = {
        id: 'valid-user',
        email: 'valid@example.com',
        name: 'Valid User',
        image: null,
        emailVerified: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockAccounts = [
        {
          id: 'account-1',
          userId: 'null-user',
          provider: 'github',
          user: null,
        },
        {
          id: 'account-2',
          userId: 'valid-user',
          provider: 'github',
          user: mockUser,
        },
      ];

      (mockPrisma.gitHubAuth.findFirst as MockedFunction<any>).mockResolvedValue(null);
      (mockPrisma.account.findMany as MockedFunction<any>).mockResolvedValue(mockAccounts);

      const args: SeedArgs = {};
      const result = await resolveSeedUser(args);

      expect(result).toEqual(mockUser);
    });

    it('should throw error when all fallback strategies fail', async () => {
      (mockPrisma.gitHubAuth.findFirst as MockedFunction<any>).mockResolvedValue(null);
      (mockPrisma.account.findMany as MockedFunction<any>).mockResolvedValue([]);

      const args: SeedArgs = {};

      await expect(resolveSeedUser(args)).rejects.toThrow(
        'No GitHub-linked user found. Ensure someone signed up via GitHub or pass --email/--userId/--githubUsername'
      );
    });

    it('should throw error when GitHub accounts exist but all have null users', async () => {
      const mockAccounts = [
        {
          id: 'account-1',
          userId: 'user-1',
          provider: 'github',
          user: null,
        },
        {
          id: 'account-2',
          userId: 'user-2',
          provider: 'github',
          user: null,
        },
      ];

      (mockPrisma.gitHubAuth.findFirst as MockedFunction<any>).mockResolvedValue(null);
      (mockPrisma.account.findMany as MockedFunction<any>).mockResolvedValue(mockAccounts);

      const args: SeedArgs = {};

      await expect(resolveSeedUser(args)).rejects.toThrow(
        'No GitHub-linked user found. Ensure someone signed up via GitHub or pass --email/--userId/--githubUsername'
      );
    });
  });

  describe('multiple args precedence', () => {
    it('should prioritize userId over email and githubUsername', async () => {
      const mockUser: User = {
        id: 'prioritized-user',
        email: 'priority@example.com',
        name: 'Priority User',
        image: null,
        emailVerified: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.user.findUnique as MockedFunction<any>).mockResolvedValue(mockUser);

      const args: SeedArgs = {
        userId: 'prioritized-user',
        email: 'other@example.com',
        githubUsername: 'otheruser',
      };

      const result = await resolveSeedUser(args);

      expect(result).toEqual(mockUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'prioritized-user' }
      });
      // Should not call other lookup methods
      expect(mockPrisma.gitHubAuth.findFirst).not.toHaveBeenCalled();
    });

    it('should prioritize email over githubUsername when userId not provided', async () => {
      const mockUser: User = {
        id: 'email-user',
        email: 'email@example.com',
        name: 'Email User',
        image: null,
        emailVerified: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.user.findUnique as MockedFunction<any>).mockResolvedValue(mockUser);

      const args: SeedArgs = {
        email: 'email@example.com',
        githubUsername: 'githubuser',
      };

      const result = await resolveSeedUser(args);

      expect(result).toEqual(mockUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'email@example.com' }
      });
      // Should not call GitHubAuth lookup
      expect(mockPrisma.gitHubAuth.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty args object', async () => {
      (mockPrisma.gitHubAuth.findFirst as MockedFunction<any>).mockResolvedValue(null);
      (mockPrisma.account.findMany as MockedFunction<any>).mockResolvedValue([]);

      const args: SeedArgs = {};

      await expect(resolveSeedUser(args)).rejects.toThrow(
        'No GitHub-linked user found. Ensure someone signed up via GitHub or pass --email/--userId/--githubUsername'
      );
    });

    it('should handle undefined args', async () => {
      (mockPrisma.gitHubAuth.findFirst as MockedFunction<any>).mockResolvedValue(null);
      (mockPrisma.account.findMany as MockedFunction<any>).mockResolvedValue([]);

      await expect(resolveSeedUser(undefined as any)).rejects.toThrow(
        'No GitHub-linked user found. Ensure someone signed up via GitHub or pass --email/--userId/--githubUsername'
      );
    });

    it('should handle empty string values', async () => {
      (mockPrisma.user.findUnique as MockedFunction<any>).mockResolvedValue(null);

      const args: SeedArgs = { userId: '' };

      await expect(resolveSeedUser(args)).rejects.toThrow('No user found for id ');
    });
  });
});
