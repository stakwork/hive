import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { db } from "@/lib/db";

// Mock the database module
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

describe("getPrimaryRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  test("should return primary repository when workspace has repositories", async () => {
    const mockWorkspace = {
      id: "workspace-1",
      repositories: [
        {
          id: "repo-1",
          repositoryUrl: "https://github.com/owner/test-repo",
          ignoreDirs: null,
          unitGlob: null,
          integrationGlob: null,
          e2eGlob: null,
          name: "test-repo",
          description: null,
          branch: "main",
        },
      ],
    };

    (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

    const result = await getPrimaryRepository("workspace-1");

    expect(db.workspace.findUnique).toHaveBeenCalledWith({
      where: { id: "workspace-1" },
      include: {
        repositories: {
          select: {
            id: true,
            repositoryUrl: true,
            ignoreDirs: true,
            unitGlob: true,
            integrationGlob: true,
            e2eGlob: true,
            name: true,
            description: true,
            branch: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    expect(result).toEqual({
      id: "repo-1",
      repositoryUrl: "https://github.com/owner/test-repo",
      ignoreDirs: null,
      unitGlob: null,
      integrationGlob: null,
      e2eGlob: null,
      name: "test-repo",
      description: null,
      branch: "main",
    });
  });

  test("should return null when workspace has no repositories", async () => {
    const mockWorkspace = {
      id: "workspace-without-repos",
      repositories: [],
    };

    (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

    const result = await getPrimaryRepository("workspace-without-repos");

    expect(db.workspace.findUnique).toHaveBeenCalledWith({
      where: { id: "workspace-without-repos" },
      include: {
        repositories: {
          select: {
            id: true,
            repositoryUrl: true,
            ignoreDirs: true,
            unitGlob: true,
            integrationGlob: true,
            e2eGlob: true,
            name: true,
            description: true,
            branch: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    expect(result).toBeNull();
  });

  test("should return null when workspace does not exist", async () => {
    (db.workspace.findUnique as Mock).mockResolvedValue(null);

    const result = await getPrimaryRepository("non-existent-workspace");

    expect(db.workspace.findUnique).toHaveBeenCalledWith({
      where: { id: "non-existent-workspace" },
      include: {
        repositories: {
          select: {
            id: true,
            repositoryUrl: true,
            ignoreDirs: true,
            unitGlob: true,
            integrationGlob: true,
            e2eGlob: true,
            name: true,
            description: true,
            branch: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    expect(result).toBeNull();
  });

  test("should return first created repository when multiple repositories exist", async () => {
    const mockWorkspace = {
      id: "workspace-1",
      repositories: [
        {
          id: "repo-1",
          repositoryUrl: "https://github.com/owner/oldest-repo",
          ignoreDirs: null,
          unitGlob: null,
          integrationGlob: null,
          e2eGlob: null,
          name: "oldest-repo",
          description: null,
          branch: "main",
        },
        {
          id: "repo-2",
          repositoryUrl: "https://github.com/owner/newer-repo",
          ignoreDirs: null,
          unitGlob: null,
          integrationGlob: null,
          e2eGlob: null,
          name: "newer-repo",
          description: "A newer repository",
          branch: "develop",
        },
      ],
    };

    (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

    const result = await getPrimaryRepository("workspace-1");

    expect(db.workspace.findUnique).toHaveBeenCalledWith({
      where: { id: "workspace-1" },
      include: {
        repositories: {
          select: {
            id: true,
            repositoryUrl: true,
            ignoreDirs: true,
            unitGlob: true,
            integrationGlob: true,
            e2eGlob: true,
            name: true,
            description: true,
            branch: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    expect(result?.name).toBe("oldest-repo");
    expect(result?.id).toBe("repo-1");
  });

  test("should handle database errors gracefully", async () => {
    const dbError = new Error("Database connection failed");
    (db.workspace.findUnique as Mock).mockRejectedValue(dbError);

    await expect(getPrimaryRepository("workspace-1")).rejects.toThrow(
      "Database connection failed"
    );

    expect(db.workspace.findUnique).toHaveBeenCalledWith({
      where: { id: "workspace-1" },
      include: {
        repositories: {
          select: {
            id: true,
            repositoryUrl: true,
            ignoreDirs: true,
            unitGlob: true,
            integrationGlob: true,
            e2eGlob: true,
            name: true,
            description: true,
            branch: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  });

  test("should correctly construct query with workspace ID", async () => {
    const workspaceId = "test-workspace-123";
    (db.workspace.findUnique as Mock).mockResolvedValue(null);

    await getPrimaryRepository(workspaceId);

    expect(db.workspace.findUnique).toHaveBeenCalledTimes(1);
    expect(db.workspace.findUnique).toHaveBeenCalledWith({
      where: { id: workspaceId },
      include: {
        repositories: {
          select: {
            id: true,
            repositoryUrl: true,
            ignoreDirs: true,
            unitGlob: true,
            integrationGlob: true,
            e2eGlob: true,
            name: true,
            description: true,
            branch: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  });

  test("should order repositories by createdAt in ascending order", async () => {
    const mockWorkspace = {
      id: "workspace-1",
      repositories: [
        {
          id: "repo-1",
          repositoryUrl: "https://github.com/owner/primary-repo",
          ignoreDirs: null,
          unitGlob: null,
          integrationGlob: null,
          e2eGlob: null,
          name: "primary-repo",
          description: null,
          branch: "main",
        },
      ],
    };

    (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

    await getPrimaryRepository("workspace-1");

    expect(db.workspace.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          repositories: expect.objectContaining({
            orderBy: { createdAt: "asc" },
          }),
        }),
      })
    );
  });

  test("should return repository with all expected fields", async () => {
    const mockWorkspace = {
      id: "workspace-1",
      repositories: [
        {
          id: "repo-1",
          repositoryUrl: "https://github.com/owner/test-repo",
          ignoreDirs: "node_modules,dist",
          unitGlob: "**/*.test.ts",
          integrationGlob: "**/*.integration.ts",
          e2eGlob: "**/*.e2e.ts",
          name: "test-repo",
          description: "Test repository",
          branch: "main",
        },
      ],
    };

    (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

    const result = await getPrimaryRepository("workspace-1");

    expect(result).toEqual({
      id: "repo-1",
      repositoryUrl: "https://github.com/owner/test-repo",
      ignoreDirs: "node_modules,dist",
      unitGlob: "**/*.test.ts",
      integrationGlob: "**/*.integration.ts",
      e2eGlob: "**/*.e2e.ts",
      name: "test-repo",
      description: "Test repository",
      branch: "main",
    });
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("name");
    expect(result).toHaveProperty("repositoryUrl");
    expect(result).toHaveProperty("branch");
    expect(result).toHaveProperty("ignoreDirs");
    expect(result).toHaveProperty("unitGlob");
    expect(result).toHaveProperty("integrationGlob");
    expect(result).toHaveProperty("e2eGlob");
    expect(result).toHaveProperty("description");
  });

  test("should handle Prisma query timeout errors", async () => {
    const timeoutError = new Error("Query timeout");
    (db.workspace.findUnique as Mock).mockRejectedValue(timeoutError);

    await expect(getPrimaryRepository("workspace-1")).rejects.toThrow(
      "Query timeout"
    );
  });

  test("should select only required repository fields", async () => {
    const mockWorkspace = {
      id: "workspace-1",
      repositories: [
        {
          id: "repo-1",
          repositoryUrl: "https://github.com/owner/test-repo",
          ignoreDirs: null,
          unitGlob: null,
          integrationGlob: null,
          e2eGlob: null,
          name: "test-repo",
          description: null,
          branch: "main",
        },
      ],
    };

    (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);

    await getPrimaryRepository("workspace-1");

    expect(db.workspace.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          repositories: expect.objectContaining({
            select: {
              id: true,
              repositoryUrl: true,
              ignoreDirs: true,
              unitGlob: true,
              integrationGlob: true,
              e2eGlob: true,
              name: true,
              description: true,
              branch: true,
            },
          }),
        }),
      })
    );
  });
});