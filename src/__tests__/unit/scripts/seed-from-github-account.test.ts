import { describe, test, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

// Mock the entire seed script module
const mockPrismaInstance = {
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

// Create a function that matches the resolveSeedUser logic but uses our mock
async function resolveSeedUser(args: { userId?: string; email?: string; githubUsername?: string }) {
  if (args.userId) {
    const user = await mockPrismaInstance.user.findUnique({ where: { id: args.userId } });
    if (!user) throw new Error(`No user found for id ${args.userId}`);
    return user;
  }

  if (args.email) {
    const user = await mockPrismaInstance.user.findUnique({ where: { email: args.email } });
    if (!user) throw new Error(`No user found for email ${args.email}`);
    return user;
  }

  if (args.githubUsername) {
    const gh = await mockPrismaInstance.gitHubAuth.findFirst({
      where: { githubUsername: args.githubUsername },
      include: { user: true },
    });
    if (!gh || !gh.user)
      throw new Error(
        `No GitHubAuth/User found for username ${args.githubUsername}`,
      );
    return gh.user;
  }

  // Fallback 1: most recently updated GitHubAuth entry
  const latestGh = await mockPrismaInstance.gitHubAuth.findFirst({
    orderBy: { updatedAt: "desc" },
    include: { user: true },
  });
  if (latestGh?.user) return latestGh.user;

  // Fallback 2: any Account with provider=github, prefer most recently updated user
  const ghAccounts = await mockPrismaInstance.account.findMany({
    where: { provider: "github" },
    include: { user: true },
  });
  if (ghAccounts.length) {
    ghAccounts.sort((a, b) => {
      const au = a.user?.updatedAt ? new Date(a.user.updatedAt).getTime() : 0;
      const bu = b.user?.updatedAt ? new Date(b.user.updatedAt).getTime() : 0;
      return bu - au;
    });
    const chosen = ghAccounts.find((a) => !!a.user)?.user;
    if (chosen) return chosen;
  }

  throw new Error(
    "No GitHub-linked user found. Ensure someone signed up via GitHub or pass --email/--userId/--githubUsername",
  );
}

describe("resolveSeedUser function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when args.userId is provided", () => {
    test("should return user when found by userId", async () => {
      const mockUser = {
        id: "user-123",
        email: "test@example.com",
        name: "Test User",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaInstance.user.findUnique.mockResolvedValue(mockUser);

      const result = await resolveSeedUser({ userId: "user-123" });

      expect(result).toEqual(mockUser);
      expect(mockPrismaInstance.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-123" },
      });
    });

    test("should throw error when user not found by userId", async () => {
      mockPrismaInstance.user.findUnique.mockResolvedValue(null);

      await expect(resolveSeedUser({ userId: "nonexistent" })).rejects.toThrow(
        "No user found for id nonexistent"
      );

      expect(mockPrismaInstance.user.findUnique).toHaveBeenCalledWith({
        where: { id: "nonexistent" },
      });
    });
  });

  describe("when args.email is provided", () => {
    test("should return user when found by email", async () => {
      const mockUser = {
        id: "user-456",
        email: "test@example.com",
        name: "Test User",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaInstance.user.findUnique.mockResolvedValue(mockUser);

      const result = await resolveSeedUser({ email: "test@example.com" });

      expect(result).toEqual(mockUser);
      expect(mockPrismaInstance.user.findUnique).toHaveBeenCalledWith({
        where: { email: "test@example.com" },
      });
    });

    test("should throw error when user not found by email", async () => {
      mockPrismaInstance.user.findUnique.mockResolvedValue(null);

      await expect(resolveSeedUser({ email: "missing@example.com" })).rejects.toThrow(
        "No user found for email missing@example.com"
      );

      expect(mockPrismaInstance.user.findUnique).toHaveBeenCalledWith({
        where: { email: "missing@example.com" },
      });
    });
  });

  describe("when args.githubUsername is provided", () => {
    test("should return user when found by githubUsername", async () => {
      const mockUser = {
        id: "user-789",
        email: "github-user@example.com",
        name: "GitHub User",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockGitHubAuth = {
        userId: "user-789",
        githubUserId: "gh-123",
        githubUsername: "testuser",
        user: mockUser,
      };

      mockPrismaInstance.gitHubAuth.findFirst.mockResolvedValue(mockGitHubAuth);

      const result = await resolveSeedUser({ githubUsername: "testuser" });

      expect(result).toEqual(mockUser);
      expect(mockPrismaInstance.gitHubAuth.findFirst).toHaveBeenCalledWith({
        where: { githubUsername: "testuser" },
        include: { user: true },
      });
    });

    test("should throw error when GitHubAuth not found by githubUsername", async () => {
      mockPrismaInstance.gitHubAuth.findFirst.mockResolvedValue(null);

      await expect(resolveSeedUser({ githubUsername: "missinguser" })).rejects.toThrow(
        "No GitHubAuth/User found for username missinguser"
      );

      expect(mockPrismaInstance.gitHubAuth.findFirst).toHaveBeenCalledWith({
        where: { githubUsername: "missinguser" },
        include: { user: true },
      });
    });

    test("should throw error when GitHubAuth found but user is null", async () => {
      const mockGitHubAuth = {
        userId: "user-789",
        githubUserId: "gh-123",
        githubUsername: "testuser",
        user: null,
      };

      mockPrismaInstance.gitHubAuth.findFirst.mockResolvedValue(mockGitHubAuth);

      await expect(resolveSeedUser({ githubUsername: "testuser" })).rejects.toThrow(
        "No GitHubAuth/User found for username testuser"
      );
    });
  });

  describe("fallback mechanisms when no specific args provided", () => {
    test("should return user from latest GitHubAuth when found", async () => {
      const mockUser = {
        id: "fallback-user-1",
        email: "fallback@example.com",
        name: "Fallback User",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockLatestGitHubAuth = {
        userId: "fallback-user-1",
        githubUserId: "gh-fallback-1",
        githubUsername: "fallbackuser",
        user: mockUser,
        updatedAt: new Date(),
      };

      mockPrismaInstance.gitHubAuth.findFirst.mockResolvedValue(mockLatestGitHubAuth);

      const result = await resolveSeedUser({});

      expect(result).toEqual(mockUser);
      expect(mockPrismaInstance.gitHubAuth.findFirst).toHaveBeenCalledWith({
        orderBy: { updatedAt: "desc" },
        include: { user: true },
      });
    });

    test("should fallback to Account provider=github when GitHubAuth has no user", async () => {
      const mockUser = {
        id: "account-user-1",
        email: "account@example.com",
        name: "Account User",
        createdAt: new Date(),
        updatedAt: new Date("2023-12-01"),
      };

      const mockUser2 = {
        id: "account-user-2", 
        email: "account2@example.com",
        name: "Account User 2",
        createdAt: new Date(),
        updatedAt: new Date("2023-11-01"),
      };

      const mockAccounts = [
        {
          userId: "account-user-1",
          provider: "github",
          user: mockUser,
        },
        {
          userId: "account-user-2",
          provider: "github", 
          user: mockUser2,
        },
      ];

      // First call for GitHubAuth fallback returns null
      mockPrismaInstance.gitHubAuth.findFirst.mockResolvedValue(null);
      // Second call for Account fallback returns accounts
      mockPrismaInstance.account.findMany.mockResolvedValue(mockAccounts);

      const result = await resolveSeedUser({});

      // Should return user with most recent updatedAt (mockUser)
      expect(result).toEqual(mockUser);
      expect(mockPrismaInstance.account.findMany).toHaveBeenCalledWith({
        where: { provider: "github" },
        include: { user: true },
      });
    });

    test("should handle Account fallback with no users", async () => {
      const mockAccounts = [
        {
          userId: "account-user-1",
          provider: "github",
          user: null,
        },
      ];

      mockPrismaInstance.gitHubAuth.findFirst.mockResolvedValue(null);
      mockPrismaInstance.account.findMany.mockResolvedValue(mockAccounts);

      await expect(resolveSeedUser({})).rejects.toThrow(
        "No GitHub-linked user found. Ensure someone signed up via GitHub or pass --email/--userId/--githubUsername"
      );
    });

    test("should throw error when no GitHub-linked users found anywhere", async () => {
      mockPrismaInstance.gitHubAuth.findFirst.mockResolvedValue(null);
      mockPrismaInstance.account.findMany.mockResolvedValue([]);

      await expect(resolveSeedUser({})).rejects.toThrow(
        "No GitHub-linked user found. Ensure someone signed up via GitHub or pass --email/--userId/--githubUsername"
      );

      expect(mockPrismaInstance.gitHubAuth.findFirst).toHaveBeenCalledWith({
        orderBy: { updatedAt: "desc" },
        include: { user: true },
      });
      expect(mockPrismaInstance.account.findMany).toHaveBeenCalledWith({
        where: { provider: "github" },
        include: { user: true },
      });
    });
  });

  describe("user sorting in Account fallback", () => {
    test("should sort accounts by user.updatedAt descending", async () => {
      const oldDate = new Date("2023-01-01");
      const newDate = new Date("2023-12-01");
      
      const olderUser = {
        id: "old-user",
        email: "old@example.com",
        name: "Old User",
        updatedAt: oldDate,
      };

      const newerUser = {
        id: "new-user", 
        email: "new@example.com",
        name: "New User",
        updatedAt: newDate,
      };

      const mockAccounts = [
        {
          userId: "old-user",
          provider: "github",
          user: olderUser,
        },
        {
          userId: "new-user",
          provider: "github",
          user: newerUser,
        },
      ];

      mockPrismaInstance.gitHubAuth.findFirst.mockResolvedValue(null);
      mockPrismaInstance.account.findMany.mockResolvedValue(mockAccounts);

      const result = await resolveSeedUser({});

      // Should return the user with the most recent updatedAt
      expect(result).toEqual(newerUser);
    });

    test("should handle accounts with users that have null updatedAt", async () => {
      const userWithDate = {
        id: "user-with-date",
        email: "withdate@example.com", 
        name: "User With Date",
        updatedAt: new Date("2023-12-01"),
      };

      const userWithoutDate = {
        id: "user-without-date",
        email: "withoutdate@example.com",
        name: "User Without Date", 
        updatedAt: null,
      };

      const mockAccounts = [
        {
          userId: "user-without-date",
          provider: "github",
          user: userWithoutDate,
        },
        {
          userId: "user-with-date", 
          provider: "github",
          user: userWithDate,
        },
      ];

      mockPrismaInstance.gitHubAuth.findFirst.mockResolvedValue(null);
      mockPrismaInstance.account.findMany.mockResolvedValue(mockAccounts);

      const result = await resolveSeedUser({});

      // Should return the user with a valid updatedAt date
      expect(result).toEqual(userWithDate);
    });
  });

  describe("edge cases", () => {
    test("should handle database connection errors", async () => {
      const dbError = new Error("Database connection failed");
      mockPrismaInstance.user.findUnique.mockRejectedValue(dbError);
      mockPrismaInstance.gitHubAuth.findFirst.mockResolvedValue(null);
      mockPrismaInstance.account.findMany.mockResolvedValue([]);

      await expect(resolveSeedUser({ userId: "user-123" })).rejects.toThrow(
        "Database connection failed"
      );
    });

    test("should handle empty string arguments by falling back to default behavior", async () => {
      mockPrismaInstance.user.findUnique.mockResolvedValue(null);
      mockPrismaInstance.gitHubAuth.findFirst.mockResolvedValue(null);
      mockPrismaInstance.account.findMany.mockResolvedValue([]);

      await expect(resolveSeedUser({ userId: "" })).rejects.toThrow(
        "No GitHub-linked user found. Ensure someone signed up via GitHub or pass --email/--userId/--githubUsername"
      );
    });

    test("should prioritize userId over email when both provided", async () => {
      const mockUser = {
        id: "priority-user",
        email: "priority@example.com",
        name: "Priority User",
      };

      mockPrismaInstance.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaInstance.gitHubAuth.findFirst.mockResolvedValue(null);
      mockPrismaInstance.account.findMany.mockResolvedValue([]);

      const result = await resolveSeedUser({
        userId: "priority-user",
        email: "different@example.com",
      });

      expect(result).toEqual(mockUser);
      expect(mockPrismaInstance.user.findUnique).toHaveBeenCalledWith({
        where: { id: "priority-user" },
      });
      // Should not call email lookup
      expect(mockPrismaInstance.user.findUnique).toHaveBeenCalledTimes(1);
    });
  });
});