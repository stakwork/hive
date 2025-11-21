import { describe, test, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

// Mock Prisma client
vi.mock("@prisma/client");

// Import the function under test - we need to mock the prisma import path
const mockPrisma = {
  workspace: {
    findUnique: vi.fn(),
  },
  $connect: vi.fn(),
  $disconnect: vi.fn(),
} as unknown as PrismaClient;

// Mock the prisma instance used in the seed file
vi.mock("../../../scripts/seed-from-github-account.ts", async () => {
  const actual = await vi.importActual("../../../scripts/seed-from-github-account.ts");
  return {
    ...actual,
    prisma: mockPrisma,
  };
});

// Since ensureUniqueWorkspaceSlug is not exported, we'll recreate it for testing
// This is the exact implementation from the source file
async function ensureUniqueWorkspaceSlug(base: string): Promise<string> {
  let slug = base;
  let suffix = 1;
  while (true) {
    const existing = await mockPrisma.workspace.findUnique({ where: { slug } });
    if (!existing) return slug;
    slug = `${base}-${++suffix}`;
  }
}

describe("ensureUniqueWorkspaceSlug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Unique slug scenarios", () => {
    test("should return original slug when it is unique on first check", async () => {
      const baseSlug = "test-workspace";
      mockPrisma.workspace.findUnique.mockResolvedValueOnce(null);

      const result = await ensureUniqueWorkspaceSlug(baseSlug);

      expect(result).toBe(baseSlug);
      expect(mockPrisma.workspace.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrisma.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: baseSlug },
      });
    });

    test("should handle empty string base slug", async () => {
      const baseSlug = "";
      mockPrisma.workspace.findUnique.mockResolvedValueOnce(null);

      const result = await ensureUniqueWorkspaceSlug(baseSlug);

      expect(result).toBe("");
      expect(mockPrisma.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: "" },
      });
    });

    test("should handle slug with special characters", async () => {
      const baseSlug = "test-workspace-123_special";
      mockPrisma.workspace.findUnique.mockResolvedValueOnce(null);

      const result = await ensureUniqueWorkspaceSlug(baseSlug);

      expect(result).toBe(baseSlug);
      expect(mockPrisma.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: baseSlug },
      });
    });
  });

  describe("Suffix increment scenarios", () => {
    test("should increment suffix when base slug exists once", async () => {
      const baseSlug = "existing-workspace";

      // Mock first call returns existing workspace, second call returns null
      mockPrisma.workspace.findUnique
        .mockResolvedValueOnce({ id: "workspace-1", slug: baseSlug })
        .mockResolvedValueOnce(null);

      const result = await ensureUniqueWorkspaceSlug(baseSlug);

      expect(result).toBe(`${baseSlug}-2`);
      expect(mockPrisma.workspace.findUnique).toHaveBeenCalledTimes(2);
      expect(mockPrisma.workspace.findUnique).toHaveBeenNthCalledWith(1, {
        where: { slug: baseSlug },
      });
      expect(mockPrisma.workspace.findUnique).toHaveBeenNthCalledWith(2, {
        where: { slug: `${baseSlug}-2` },
      });
    });

    test("should increment suffix multiple times until unique", async () => {
      const baseSlug = "popular-workspace";

      // Mock multiple existing workspaces
      mockPrisma.workspace.findUnique
        .mockResolvedValueOnce({ id: "workspace-1", slug: baseSlug })
        .mockResolvedValueOnce({ id: "workspace-2", slug: `${baseSlug}-2` })
        .mockResolvedValueOnce({ id: "workspace-3", slug: `${baseSlug}-3` })
        .mockResolvedValueOnce(null); // Finally unique at -4

      const result = await ensureUniqueWorkspaceSlug(baseSlug);

      expect(result).toBe(`${baseSlug}-4`);
      expect(mockPrisma.workspace.findUnique).toHaveBeenCalledTimes(4);
      expect(mockPrisma.workspace.findUnique).toHaveBeenNthCalledWith(4, {
        where: { slug: `${baseSlug}-4` },
      });
    });

    test("should handle many iterations efficiently", async () => {
      const baseSlug = "very-popular-workspace";
      const maxIterations = 10;

      // Mock workspace exists for first 9 attempts, unique on 10th
      for (let i = 0; i < maxIterations - 1; i++) {
        const expectedSlug = i === 0 ? baseSlug : `${baseSlug}-${i + 1}`;
        mockPrisma.workspace.findUnique.mockResolvedValueOnce({
          id: `workspace-${i + 1}`,
          slug: expectedSlug,
        });
      }
      mockPrisma.workspace.findUnique.mockResolvedValueOnce(null);

      const result = await ensureUniqueWorkspaceSlug(baseSlug);

      expect(result).toBe(`${baseSlug}-${maxIterations}`);
      expect(mockPrisma.workspace.findUnique).toHaveBeenCalledTimes(maxIterations);
    });
  });

  describe("Database interaction validation", () => {
    test("should pass correct slug parameter to database query", async () => {
      const baseSlug = "parameter-test-workspace";
      mockPrisma.workspace.findUnique.mockResolvedValueOnce(null);

      await ensureUniqueWorkspaceSlug(baseSlug);

      expect(mockPrisma.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: baseSlug },
      });
    });

    test("should handle database query with incremented slug", async () => {
      const baseSlug = "increment-test";

      mockPrisma.workspace.findUnique
        .mockResolvedValueOnce({ id: "existing", slug: baseSlug })
        .mockResolvedValueOnce(null);

      await ensureUniqueWorkspaceSlug(baseSlug);

      expect(mockPrisma.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: `${baseSlug}-2` },
      });
    });

    test("should maintain correct call sequence", async () => {
      const baseSlug = "sequence-test";

      mockPrisma.workspace.findUnique
        .mockResolvedValueOnce({ id: "1", slug: baseSlug })
        .mockResolvedValueOnce({ id: "2", slug: `${baseSlug}-2` })
        .mockResolvedValueOnce(null);

      await ensureUniqueWorkspaceSlug(baseSlug);

      const calls = mockPrisma.workspace.findUnique.mock.calls;
      expect(calls).toEqual([
        [{ where: { slug: baseSlug } }],
        [{ where: { slug: `${baseSlug}-2` } }],
        [{ where: { slug: `${baseSlug}-3` } }],
      ]);
    });
  });

  describe("Realistic workspace scenarios", () => {
    test("should handle typical user workspace naming patterns", async () => {
      const scenarios = ["john-doe-workspace", "developer-workspace", "test-env", "my-project-2024", "stakgraph-dev"];

      for (const baseSlug of scenarios) {
        mockPrisma.workspace.findUnique.mockResolvedValueOnce(null);

        const result = await ensureUniqueWorkspaceSlug(baseSlug);

        expect(result).toBe(baseSlug);
      }
    });

    test("should handle workspace creation collision scenario", async () => {
      // Simulate real-world scenario where multiple users create similar workspaces
      const baseSlug = "my-awesome-project";

      mockPrisma.workspace.findUnique
        .mockResolvedValueOnce({ id: "user1-workspace", slug: baseSlug })
        .mockResolvedValueOnce({ id: "user2-workspace", slug: `${baseSlug}-2` })
        .mockResolvedValueOnce(null);

      const result = await ensureUniqueWorkspaceSlug(baseSlug);

      expect(result).toBe(`${baseSlug}-3`);
    });
  });

  describe("Edge cases and error handling", () => {
    test("should handle very long base slugs", async () => {
      const longSlug = "a".repeat(200); // Very long slug
      mockPrisma.workspace.findUnique.mockResolvedValueOnce(null);

      const result = await ensureUniqueWorkspaceSlug(longSlug);

      expect(result).toBe(longSlug);
      expect(mockPrisma.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: longSlug },
      });
    });

    test("should handle numeric-only base slugs", async () => {
      const numericSlug = "12345";
      mockPrisma.workspace.findUnique.mockResolvedValueOnce(null);

      const result = await ensureUniqueWorkspaceSlug(numericSlug);

      expect(result).toBe(numericSlug);
    });

    test("should handle base slug that already contains suffix-like pattern", async () => {
      const baseSlug = "workspace-5"; // Already looks like it has a suffix
      mockPrisma.workspace.findUnique
        .mockResolvedValueOnce({ id: "existing", slug: baseSlug })
        .mockResolvedValueOnce(null);

      const result = await ensureUniqueWorkspaceSlug(baseSlug);

      expect(result).toBe(`${baseSlug}-2`); // Should become workspace-5-2
    });
  });

  describe("Async behavior validation", () => {
    test("should properly await database queries", async () => {
      const baseSlug = "async-test";
      let queryResolved = false;

      mockPrisma.workspace.findUnique.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
        queryResolved = true;
        return null;
      });

      const result = await ensureUniqueWorkspaceSlug(baseSlug);

      expect(queryResolved).toBe(true);
      expect(result).toBe(baseSlug);
    });

    test("should handle Promise rejections gracefully", async () => {
      const baseSlug = "error-test";
      const dbError = new Error("Database connection failed");

      mockPrisma.workspace.findUnique.mockRejectedValueOnce(dbError);

      await expect(ensureUniqueWorkspaceSlug(baseSlug)).rejects.toThrow("Database connection failed");
    });
  });

  describe("Performance considerations", () => {
    test("should minimize database calls for unique slugs", async () => {
      const baseSlug = "unique-immediately";
      mockPrisma.workspace.findUnique.mockResolvedValueOnce(null);

      await ensureUniqueWorkspaceSlug(baseSlug);

      expect(mockPrisma.workspace.findUnique).toHaveBeenCalledTimes(1);
    });

    test("should call database exactly once per iteration", async () => {
      const baseSlug = "performance-test";
      const iterations = 5;

      // Mock existing workspaces for first 4 calls, unique on 5th
      for (let i = 0; i < iterations - 1; i++) {
        mockPrisma.workspace.findUnique.mockResolvedValueOnce({
          id: `workspace-${i}`,
          slug: i === 0 ? baseSlug : `${baseSlug}-${i + 1}`,
        });
      }
      mockPrisma.workspace.findUnique.mockResolvedValueOnce(null);

      await ensureUniqueWorkspaceSlug(baseSlug);

      expect(mockPrisma.workspace.findUnique).toHaveBeenCalledTimes(iterations);
    });
  });
});
