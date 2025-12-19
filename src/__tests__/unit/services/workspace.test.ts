import { describe, test, expect, beforeEach, vi } from "vitest";
import { createWorkspace } from "@/services/workspace";
import { db } from "@/lib/db";
import {
  WORKSPACE_ERRORS,
  WORKSPACE_LIMITS,
} from "@/lib/constants";
import type { CreateWorkspaceRequest } from "@/types/workspace";

// Mock Prisma client
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock validateWorkspaceSlug to control validation behavior
vi.mock("@/services/workspace", async () => {
  const actual = await vi.importActual<typeof import("@/services/workspace")>("@/services/workspace");
  return {
    ...actual,
    // Keep original createWorkspace, only mock validateWorkspaceSlug when needed
  };
});

describe("createWorkspace", () => {
  const mockUserId = "user-123";
  const mockWorkspaceId = "ws-456";

  const validRequest: CreateWorkspaceRequest = {
    name: "Test Workspace",
    description: "Test description",
    slug: "test-workspace",
    ownerId: mockUserId,
    repositoryUrl: "https://github.com/test/repo",
  };

  const mockWorkspaceDbResponse = {
    id: mockWorkspaceId,
    name: validRequest.name,
    description: validRequest.description,
    slug: validRequest.slug,
    ownerId: mockUserId,
    repositoryDraft: validRequest.repositoryUrl,
    logoUrl: null,
    logoKey: null,
    sourceControlOrgId: null,
    stakworkApiKey: null,
    mission: null,
    originalSlug: null,
    deleted: false,
    deletedAt: null,
    nodeTypeOrder: [
      { type: "Function", value: 20 },
      { type: "Feature", value: 20 },
    ],
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Happy Path - Successful Workspace Creation", () => {
    test("creates workspace with valid input", async () => {
      // Mock workspace count check (under limit)
      vi.mocked(db.workspace.count).mockResolvedValue(5);

      // Mock slug uniqueness check (slug available)
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

      // Mock workspace creation
      vi.mocked(db.workspace.create).mockResolvedValue(mockWorkspaceDbResponse);

      const result = await createWorkspace(validRequest);

      // Verify workspace count was checked with correct filters
      expect(db.workspace.count).toHaveBeenCalledWith({
        where: { ownerId: mockUserId, deleted: false },
      });

      // Verify slug uniqueness was checked
      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: validRequest.slug, deleted: false },
        select: { id: true },
      });

      // Verify workspace was created with correct data
      expect(db.workspace.create).toHaveBeenCalledWith({
        data: {
          name: validRequest.name,
          description: validRequest.description,
          slug: validRequest.slug,
          ownerId: mockUserId,
          repositoryDraft: validRequest.repositoryUrl,
        },
      });

      // Verify response structure (includes all DB fields due to spread operator)
      expect(result).toEqual({
        id: mockWorkspaceId,
        name: validRequest.name,
        description: validRequest.description,
        slug: validRequest.slug,
        ownerId: mockUserId,
        logoUrl: null,
        logoKey: null,
        sourceControlOrgId: null,
        stakworkApiKey: null,
        mission: null,
        originalSlug: null,
        deleted: false,
        deletedAt: null,
        repositoryDraft: validRequest.repositoryUrl,
        nodeTypeOrder: [
          { type: "Function", value: 20 },
          { type: "Feature", value: 20 },
        ],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });
    });

    test("creates workspace without optional description", async () => {
      const requestWithoutDescription: CreateWorkspaceRequest = {
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: mockUserId,
      };

      vi.mocked(db.workspace.count).mockResolvedValue(0);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
      vi.mocked(db.workspace.create).mockResolvedValue({
        ...mockWorkspaceDbResponse,
        description: null,
      });

      const result = await createWorkspace(requestWithoutDescription);

      expect(db.workspace.create).toHaveBeenCalledWith({
        data: {
          name: requestWithoutDescription.name,
          description: undefined,
          slug: requestWithoutDescription.slug,
          ownerId: mockUserId,
          repositoryDraft: undefined,
        },
      });

      expect(result.description).toBeNull();
    });

    test("creates workspace without optional repositoryUrl", async () => {
      const requestWithoutRepo: CreateWorkspaceRequest = {
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: mockUserId,
      };

      vi.mocked(db.workspace.count).mockResolvedValue(0);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
      vi.mocked(db.workspace.create).mockResolvedValue({
        ...mockWorkspaceDbResponse,
        repositoryDraft: null,
      });

      await createWorkspace(requestWithoutRepo);

      expect(db.workspace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          repositoryDraft: undefined,
        }),
      });
    });
  });

  describe("Slug Validation", () => {
    test("rejects slug that is too short (less than 2 characters)", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: "a",
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_INVALID_LENGTH
      );

      // Should not call database operations if validation fails
      expect(db.workspace.count).not.toHaveBeenCalled();
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
      expect(db.workspace.create).not.toHaveBeenCalled();
    });

    test("rejects slug that is too long (more than 50 characters)", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: "a".repeat(51),
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_INVALID_LENGTH
      );

      expect(db.workspace.count).not.toHaveBeenCalled();
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
      expect(db.workspace.create).not.toHaveBeenCalled();
    });

    test("rejects slug with invalid format (uppercase letters)", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: "Test-Workspace",
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      );
    });

    test("rejects slug with invalid format (special characters)", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: "test_workspace",
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      );
    });

    test("rejects slug with invalid format (spaces)", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: "test workspace",
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      );
    });

    test("rejects slug with invalid format (starting with hyphen)", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: "-test-workspace",
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      );
    });

    test("rejects slug with invalid format (ending with hyphen)", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: "test-workspace-",
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      );
    });

    test("rejects slug with consecutive hyphens", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: "test--workspace",
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      );
    });

    test("rejects reserved slug 'api'", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: "api",
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_RESERVED
      );
    });

    test("rejects reserved slug 'admin'", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: "admin",
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_RESERVED
      );
    });

    test("rejects reserved slug 'dashboard'", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: "dashboard",
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_RESERVED
      );
    });

    test("rejects reserved slug 'settings'", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: "settings",
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_RESERVED
      );
    });

    test("accepts valid slug with lowercase alphanumeric and hyphens", async () => {
      const validSlugs = [
        "test-workspace",
        "test123",
        "my-awesome-workspace-2024",
        "ab",
        "a".repeat(50),
      ];

      vi.mocked(db.workspace.count).mockResolvedValue(0);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
      vi.mocked(db.workspace.create).mockResolvedValue(mockWorkspaceDbResponse);

      for (const slug of validSlugs) {
        const request: CreateWorkspaceRequest = {
          ...validRequest,
          slug,
        };

        await expect(createWorkspace(request)).resolves.toBeDefined();
      }
    });
  });

  describe("Workspace Limit Enforcement", () => {
    test("rejects workspace creation when user has reached limit", async () => {
      // Mock user has exactly MAX_WORKSPACES_PER_USER workspaces
      vi.mocked(db.workspace.count).mockResolvedValue(
        WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER
      );

      await expect(createWorkspace(validRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED
      );

      // Should not check slug uniqueness or create workspace
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
      expect(db.workspace.create).not.toHaveBeenCalled();
    });

    test("rejects workspace creation when user has exceeded limit", async () => {
      // Mock user has more than MAX_WORKSPACES_PER_USER workspaces
      vi.mocked(db.workspace.count).mockResolvedValue(
        WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER + 5
      );

      await expect(createWorkspace(validRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED
      );
    });

    test("allows workspace creation when user is one below limit", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(
        WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER - 1
      );
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
      vi.mocked(db.workspace.create).mockResolvedValue(mockWorkspaceDbResponse);

      await expect(createWorkspace(validRequest)).resolves.toBeDefined();

      expect(db.workspace.create).toHaveBeenCalled();
    });

    test("counts only non-deleted workspaces for limit", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(5);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
      vi.mocked(db.workspace.create).mockResolvedValue(mockWorkspaceDbResponse);

      await createWorkspace(validRequest);

      // Verify deleted filter is applied
      expect(db.workspace.count).toHaveBeenCalledWith({
        where: { ownerId: mockUserId, deleted: false },
      });
    });
  });

  describe("Slug Uniqueness Enforcement", () => {
    test("rejects workspace creation when slug already exists", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(5);

      // Mock existing workspace with same slug
      vi.mocked(db.workspace.findUnique).mockResolvedValue({
        id: "existing-ws-id",
      } as any);

      await expect(createWorkspace(validRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS
      );

      // Should not attempt to create workspace
      expect(db.workspace.create).not.toHaveBeenCalled();
    });

    test("checks slug uniqueness with deleted filter", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(5);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
      vi.mocked(db.workspace.create).mockResolvedValue(mockWorkspaceDbResponse);

      await createWorkspace(validRequest);

      // Verify slug uniqueness check includes deleted filter
      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: validRequest.slug, deleted: false },
        select: { id: true },
      });
    });

    test("allows slug reuse if previous workspace is soft-deleted", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(5);

      // Slug exists but workspace is deleted (returns null due to deleted: false filter)
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
      vi.mocked(db.workspace.create).mockResolvedValue(mockWorkspaceDbResponse);

      await expect(createWorkspace(validRequest)).resolves.toBeDefined();

      expect(db.workspace.create).toHaveBeenCalled();
    });
  });

  describe("Prisma Error Handling", () => {
    test("handles P2002 unique constraint violation for slug", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(5);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

      // Mock P2002 Prisma error (race condition)
      const prismaError = new Error("Unique constraint violation");
      Object.assign(prismaError, {
        code: "P2002",
        meta: { target: ["slug"] },
      });

      vi.mocked(db.workspace.create).mockRejectedValue(prismaError);

      await expect(createWorkspace(validRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS
      );
    });

    test("rethrows non-P2002 Prisma errors", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(5);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

      const otherError = new Error("Database connection error");
      vi.mocked(db.workspace.create).mockRejectedValue(otherError);

      await expect(createWorkspace(validRequest)).rejects.toThrow(
        "Database connection error"
      );
    });

    test("rethrows P2002 error for non-slug fields", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(5);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

      const prismaError = new Error("Unique constraint violation");
      Object.assign(prismaError, {
        code: "P2002",
        meta: { target: ["ownerId"] },
      });

      vi.mocked(db.workspace.create).mockRejectedValue(prismaError);

      await expect(createWorkspace(validRequest)).rejects.toThrow(
        "Unique constraint violation"
      );
    });
  });

  describe("Edge Cases", () => {
    test("handles null slug gracefully", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: null as any,
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      );
    });

    test("handles undefined slug gracefully", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: undefined as any,
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      );
    });

    test("handles empty string slug", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: "",
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_INVALID_LENGTH
      );
    });

    test("handles slug with only hyphens", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: "---",
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      );
    });

    test("handles very long workspace name", async () => {
      const longName = "A".repeat(1000);
      const requestWithLongName: CreateWorkspaceRequest = {
        ...validRequest,
        name: longName,
      };

      vi.mocked(db.workspace.count).mockResolvedValue(0);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
      vi.mocked(db.workspace.create).mockResolvedValue({
        ...mockWorkspaceDbResponse,
        name: longName,
      });

      const result = await createWorkspace(requestWithLongName);

      expect(result.name).toBe(longName);
      expect(db.workspace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: longName,
        }),
      });
    });

    test("handles very long description", async () => {
      const longDescription = "A".repeat(5000);
      const requestWithLongDescription: CreateWorkspaceRequest = {
        ...validRequest,
        description: longDescription,
      };

      vi.mocked(db.workspace.count).mockResolvedValue(0);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
      vi.mocked(db.workspace.create).mockResolvedValue({
        ...mockWorkspaceDbResponse,
        description: longDescription,
      });

      const result = await createWorkspace(requestWithLongDescription);

      expect(result.description).toBe(longDescription);
    });
  });

  describe("Response Format Validation", () => {
    test("returns response with ISO formatted dates", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(0);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
      vi.mocked(db.workspace.create).mockResolvedValue(mockWorkspaceDbResponse);

      const result = await createWorkspace(validRequest);

      // Verify dates are ISO strings, not Date objects
      expect(typeof result.createdAt).toBe("string");
      expect(typeof result.updatedAt).toBe("string");
      expect(result.createdAt).toBe("2024-01-01T00:00:00.000Z");
      expect(result.updatedAt).toBe("2024-01-01T00:00:00.000Z");
    });

    test("returns response with all required fields", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(0);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
      vi.mocked(db.workspace.create).mockResolvedValue(mockWorkspaceDbResponse);

      const result = await createWorkspace(validRequest);

      // Verify all required WorkspaceResponse fields are present
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("name");
      expect(result).toHaveProperty("slug");
      expect(result).toHaveProperty("ownerId");
      expect(result).toHaveProperty("createdAt");
      expect(result).toHaveProperty("updatedAt");

      // Verify optional fields are present (even if null)
      expect(result).toHaveProperty("description");
      expect(result).toHaveProperty("logoUrl");
      expect(result).toHaveProperty("logoKey");
      expect(result).toHaveProperty("nodeTypeOrder");
    });

    test("preserves nodeTypeOrder in response", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(0);
      vi.mocked(db.workspace.findUnique).mockResolvedValue(null);
      vi.mocked(db.workspace.create).mockResolvedValue(mockWorkspaceDbResponse);

      const result = await createWorkspace(validRequest);

      expect(result.nodeTypeOrder).toEqual([
        { type: "Function", value: 20 },
        { type: "Feature", value: 20 },
      ]);
    });
  });

  describe("Database Operation Sequence", () => {
    test("calls database operations in correct order", async () => {
      const callOrder: string[] = [];

      vi.mocked(db.workspace.count).mockImplementation(async () => {
        callOrder.push("count");
        return 5;
      });

      vi.mocked(db.workspace.findUnique).mockImplementation(async () => {
        callOrder.push("findUnique");
        return null;
      });

      vi.mocked(db.workspace.create).mockImplementation(async () => {
        callOrder.push("create");
        return mockWorkspaceDbResponse;
      });

      await createWorkspace(validRequest);

      // Verify operations are called in expected order
      expect(callOrder).toEqual(["count", "findUnique", "create"]);
    });

    test("stops execution after validation failure", async () => {
      const invalidRequest: CreateWorkspaceRequest = {
        ...validRequest,
        slug: "invalid slug",
      };

      await expect(createWorkspace(invalidRequest)).rejects.toThrow();

      // Database operations should not be called
      expect(db.workspace.count).not.toHaveBeenCalled();
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
      expect(db.workspace.create).not.toHaveBeenCalled();
    });

    test("stops execution after workspace limit check failure", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(
        WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER
      );

      await expect(createWorkspace(validRequest)).rejects.toThrow();

      // Should not proceed to uniqueness check or creation
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
      expect(db.workspace.create).not.toHaveBeenCalled();
    });

    test("stops execution after slug uniqueness check failure", async () => {
      vi.mocked(db.workspace.count).mockResolvedValue(5);
      vi.mocked(db.workspace.findUnique).mockResolvedValue({
        id: "existing-ws-id",
      } as any);

      await expect(createWorkspace(validRequest)).rejects.toThrow();

      // Should not proceed to creation
      expect(db.workspace.create).not.toHaveBeenCalled();
    });
  });
});
