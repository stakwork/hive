import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as workspaceService from "@/services/workspace";
import { db } from "@/lib/db";
import { WORKSPACE_LIMITS, WORKSPACE_ERRORS } from "@/lib/constants";
import type { CreateWorkspaceRequest } from "@/types/workspace";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe("createWorkspace", () => {
  const mockUserId = "user-123";
  const validWorkspaceData: CreateWorkspaceRequest = {
    name: "Test Workspace",
    slug: "test-workspace",
    description: "A test workspace for unit testing",
    ownerId: mockUserId,
    repositoryUrl: "https://github.com/test/repo",
  };

  const mockCreatedWorkspace = {
    id: "workspace-123",
    name: validWorkspaceData.name,
    slug: validWorkspaceData.slug,
    description: validWorkspaceData.description,
    ownerId: validWorkspaceData.ownerId,
    repositoryDraft: validWorkspaceData.repositoryUrl,
    nodeTypeOrder: null,
    deleted: false,
    deletedAt: null,
    originalSlug: null,
    stakworkApiKey: null,
    logoKey: null,
    logoUrl: null,
    createdAt: new Date("2024-01-15T10:00:00Z"),
    updatedAt: new Date("2024-01-15T10:00:00Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(db.workspace.count).mockResolvedValue(0);
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
    vi.mocked(db.workspace.create).mockResolvedValue(mockCreatedWorkspace);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Successful workspace creation", () => {
    it("should create a workspace with valid data", async () => {
      const result = await workspaceService.createWorkspace(validWorkspaceData);

      expect(result).toEqual({
        ...mockCreatedWorkspace,
        createdAt: "2024-01-15T10:00:00.000Z",
        updatedAt: "2024-01-15T10:00:00.000Z",
      });

      // Verify database calls were made in correct order
      expect(db.workspace.count).toHaveBeenCalledWith({
        where: { ownerId: mockUserId, deleted: false },
      });
      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: validWorkspaceData.slug, deleted: false },
        select: { id: true },
      });
      expect(db.workspace.create).toHaveBeenCalledWith({
        data: {
          name: validWorkspaceData.name,
          description: validWorkspaceData.description,
          slug: validWorkspaceData.slug,
          ownerId: validWorkspaceData.ownerId,
          repositoryDraft: validWorkspaceData.repositoryUrl,
        },
      });
    });

    it("should create a workspace without optional description", async () => {
      const dataWithoutDescription = {
        ...validWorkspaceData,
        description: undefined,
      };

      await workspaceService.createWorkspace(dataWithoutDescription);

      expect(db.workspace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: dataWithoutDescription.name,
          slug: dataWithoutDescription.slug,
          ownerId: dataWithoutDescription.ownerId,
        }),
      });
    });

    it("should create a workspace without optional repositoryUrl", async () => {
      const dataWithoutRepo = {
        ...validWorkspaceData,
        repositoryUrl: undefined,
      };

      await workspaceService.createWorkspace(dataWithoutRepo);

      expect(db.workspace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: dataWithoutRepo.name,
          slug: dataWithoutRepo.slug,
          ownerId: dataWithoutRepo.ownerId,
        }),
      });
    });

    it("should handle nodeTypeOrder as array in response", async () => {
      const workspaceWithNodeOrder = {
        ...mockCreatedWorkspace,
        nodeTypeOrder: [
          { type: "Feature", value: 1 },
          { type: "Bug", value: 2 },
        ],
      };

      vi.mocked(db.workspace.create).mockResolvedValue(workspaceWithNodeOrder);

      const result = await workspaceService.createWorkspace(validWorkspaceData);

      expect(result.nodeTypeOrder).toEqual([
        { type: "Feature", value: 1 },
        { type: "Bug", value: 2 },
      ]);
    });

    it("should convert dates to ISO strings in response", async () => {
      const result = await workspaceService.createWorkspace(validWorkspaceData);

      expect(typeof result.createdAt).toBe("string");
      expect(typeof result.updatedAt).toBe("string");
      expect(result.createdAt).toBe("2024-01-15T10:00:00.000Z");
      expect(result.updatedAt).toBe("2024-01-15T10:00:00.000Z");
    });
  });

  describe("Slug validation", () => {
    it("should throw error for invalid slug format with underscores", async () => {
      await expect(
        workspaceService.createWorkspace({
          ...validWorkspaceData,
          slug: "Invalid_Slug!",
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_INVALID_FORMAT);
      
      // Verify no database operations were performed
      expect(db.workspace.count).not.toHaveBeenCalled();
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
      expect(db.workspace.create).not.toHaveBeenCalled();
    });

    it("should throw error for reserved slug", async () => {
      await expect(
        workspaceService.createWorkspace({
          ...validWorkspaceData,
          slug: "api",
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_RESERVED);
      
      // Verify no database operations were performed
      expect(db.workspace.count).not.toHaveBeenCalled();
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
      expect(db.workspace.create).not.toHaveBeenCalled();
    });

    it("should throw error for slug that is too short", async () => {
      await expect(
        workspaceService.createWorkspace({
          ...validWorkspaceData,
          slug: "a",
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_INVALID_LENGTH);
      
      // Verify no database operations were performed
      expect(db.workspace.count).not.toHaveBeenCalled();
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
      expect(db.workspace.create).not.toHaveBeenCalled();
    });

    it("should throw error for slug that is too long", async () => {
      await expect(
        workspaceService.createWorkspace({
          ...validWorkspaceData,
          slug: "a".repeat(51),
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_INVALID_LENGTH);
      
      // Verify no database operations were performed
      expect(db.workspace.count).not.toHaveBeenCalled();
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
      expect(db.workspace.create).not.toHaveBeenCalled();
    });
    
    it("should throw error for null slug", async () => {
      await expect(
        workspaceService.createWorkspace({
          ...validWorkspaceData,
          slug: null as any,
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_INVALID_FORMAT);
    });
    
    it("should throw error for slug with uppercase letters", async () => {
      await expect(
        workspaceService.createWorkspace({
          ...validWorkspaceData,
          slug: "MyWorkspace",
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_INVALID_FORMAT);
    });
    
    it("should throw error for slug starting with hyphen", async () => {
      await expect(
        workspaceService.createWorkspace({
          ...validWorkspaceData,
          slug: "-invalid",
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_INVALID_FORMAT);
    });
    
    it("should throw error for slug ending with hyphen", async () => {
      await expect(
        workspaceService.createWorkspace({
          ...validWorkspaceData,
          slug: "invalid-",
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_INVALID_FORMAT);
    });
    
    it("should throw error for slug with consecutive hyphens", async () => {
      await expect(
        workspaceService.createWorkspace({
          ...validWorkspaceData,
          slug: "invalid--slug",
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_INVALID_FORMAT);
    });
  });

  describe("Workspace limit enforcement", () => {
    it("should throw error when user has reached workspace limit", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(
        WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER
      );

      await expect(workspaceService.createWorkspace(validWorkspaceData)).rejects.toThrow(
        WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED
      );

      expect(db.workspace.count).toHaveBeenCalledWith({
        where: { ownerId: mockUserId, deleted: false },
      });
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
      expect(db.workspace.create).not.toHaveBeenCalled();
    });

    it("should throw error when user has exceeded workspace limit", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(
        WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER + 1
      );

      await expect(workspaceService.createWorkspace(validWorkspaceData)).rejects.toThrow(
        WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED
      );
    });

    it("should allow creation when user is one below the limit", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(
        WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER - 1
      );

      await expect(workspaceService.createWorkspace(validWorkspaceData)).resolves.toBeDefined();
    });

    it("should only count non-deleted workspaces against limit", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(5);

      await workspaceService.createWorkspace(validWorkspaceData);

      expect(db.workspace.count).toHaveBeenCalledWith({
        where: { ownerId: mockUserId, deleted: false },
      });
    });
  });

  describe("Slug uniqueness validation", () => {
    it("should throw error when slug already exists", async () => {
      vi.mocked(db.workspace.findUnique).mockResolvedValue({
        id: "existing-workspace-id",
      } as any);

      await expect(workspaceService.createWorkspace(validWorkspaceData)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS
      );

      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: validWorkspaceData.slug, deleted: false },
        select: { id: true },
      });
      expect(db.workspace.create).not.toHaveBeenCalled();
    });

    it("should allow slug reuse if previous workspace was soft-deleted", async () => {
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

      await expect(workspaceService.createWorkspace(validWorkspaceData)).resolves.toBeDefined();

      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: validWorkspaceData.slug, deleted: false },
        select: { id: true },
      });
    });

    it("should only check for non-deleted workspaces with same slug", async () => {
      await workspaceService.createWorkspace(validWorkspaceData);

      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: expect.objectContaining({
          deleted: false,
        }),
        select: { id: true },
      });
    });
  });

  describe("Database error handling", () => {
    it("should handle Prisma P2002 unique constraint violation", async () => {
      const prismaError = {
        code: "P2002",
        meta: {
          target: ["slug"],
        },
      };

      vi.mocked(db.workspace.create).mockRejectedValue(prismaError);

      await expect(workspaceService.createWorkspace(validWorkspaceData)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS
      );
    });

    it("should handle P2002 error with multiple target fields including slug", async () => {
      const prismaError = {
        code: "P2002",
        meta: {
          target: ["slug", "ownerId"],
        },
      };

      vi.mocked(db.workspace.create).mockRejectedValue(prismaError);

      await expect(workspaceService.createWorkspace(validWorkspaceData)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS
      );
    });

    it("should re-throw P2002 error if not related to slug", async () => {
      const prismaError = {
        code: "P2002",
        meta: {
          target: ["email"],
        },
      };

      vi.mocked(db.workspace.create).mockRejectedValue(prismaError);

      await expect(workspaceService.createWorkspace(validWorkspaceData)).rejects.toEqual(prismaError);
    });

    it("should re-throw other Prisma errors", async () => {
      const prismaError = {
        code: "P2003",
        message: "Foreign key constraint failed",
      };

      vi.mocked(db.workspace.create).mockRejectedValue(prismaError);

      await expect(workspaceService.createWorkspace(validWorkspaceData)).rejects.toEqual(prismaError);
    });

    it("should re-throw non-Prisma database errors", async () => {
      const genericError = new Error("Database connection failed");

      vi.mocked(db.workspace.create).mockRejectedValue(genericError);

      await expect(workspaceService.createWorkspace(validWorkspaceData)).rejects.toThrow(
        "Database connection failed"
      );
    });

    it("should re-throw errors without proper structure", async () => {
      vi.mocked(db.workspace.create).mockRejectedValue("String error");

      await expect(workspaceService.createWorkspace(validWorkspaceData)).rejects.toBe("String error");
    });
  });

  describe("Data integrity", () => {
    it("should create workspace with all provided fields", async () => {
      await workspaceService.createWorkspace(validWorkspaceData);

      expect(db.workspace.create).toHaveBeenCalledWith({
        data: {
          name: validWorkspaceData.name,
          description: validWorkspaceData.description,
          slug: validWorkspaceData.slug,
          ownerId: validWorkspaceData.ownerId,
          repositoryDraft: validWorkspaceData.repositoryUrl,
        },
      });
    });

    it("should associate workspace with correct owner", async () => {
      await workspaceService.createWorkspace(validWorkspaceData);

      expect(db.workspace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ownerId: mockUserId,
        }),
      });
    });

    it("should preserve repository URL in repositoryDraft field", async () => {
      const repoUrl = "https://github.com/org/repo";

      await workspaceService.createWorkspace({
        ...validWorkspaceData,
        repositoryUrl: repoUrl,
      });

      expect(db.workspace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          repositoryDraft: repoUrl,
        }),
      });
    });

    it("should return workspace with consistent data types", async () => {
      const result = await workspaceService.createWorkspace(validWorkspaceData);

      expect(typeof result.id).toBe("string");
      expect(typeof result.name).toBe("string");
      expect(typeof result.slug).toBe("string");
      expect(typeof result.ownerId).toBe("string");
      expect(typeof result.createdAt).toBe("string");
      expect(typeof result.updatedAt).toBe("string");
    });
  });

  describe("Edge cases", () => {
    it("should handle workspace creation with minimal data", async () => {
      const minimalData: CreateWorkspaceRequest = {
        name: "Minimal",
        slug: "minimal",
        ownerId: mockUserId,
      };

      await workspaceService.createWorkspace(minimalData);

      expect(db.workspace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Minimal",
          slug: "minimal",
          ownerId: mockUserId,
        }),
      });
    });

    it("should handle special characters in workspace name", async () => {
      const specialName = "Test @ Workspace #1 (2024)";

      await workspaceService.createWorkspace({
        ...validWorkspaceData,
        name: specialName,
      });

      expect(db.workspace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: specialName,
        }),
      });
    });

    it("should handle long descriptions", async () => {
      const longDescription = "A".repeat(500);

      await workspaceService.createWorkspace({
        ...validWorkspaceData,
        description: longDescription,
      });

      expect(db.workspace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: longDescription,
        }),
      });
    });
  });
});
