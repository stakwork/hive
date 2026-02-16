import { describe, test, expect, beforeEach, vi, Mock } from "vitest";
import { createWorkspace } from "@/services/workspace";
import { db } from "@/lib/db";
import {
  WORKSPACE_ERRORS,
  WORKSPACE_LIMITS,
  WORKSPACE_SLUG_PATTERNS,
} from "@/lib/constants";
import type { Workspace } from "@prisma/client";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe("createWorkspace - Unit Tests", () => {
  const mockUserId = "user-123";
  const mockWorkspaceId = "workspace-456";

  // Mock data factory
  const createMockWorkspaceData = (overrides = {}) => ({
    name: "Test Workspace",
    slug: "test-workspace",
    description: "Test description",
    ownerId: mockUserId,
    ...overrides,
  });

  const createMockWorkspace = (overrides = {}): Workspace => ({
    id: mockWorkspaceId,
    name: "Test Workspace",
    slug: "test-workspace",
    description: "Test description",
    mission: null,
    ownerId: mockUserId,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    deleted: false,
    deletedAt: null,
    originalSlug: null,
    repositoryDraft: null,
    sourceControlOrgId: null,
    stakworkApiKey: null,
    logoUrl: null,
    logoKey: null,
    nodeTypeOrder: [
      { type: "Function", value: 20 },
      { type: "Feature", value: 20 },
      { type: "File", value: 20 },
      { type: "Endpoint", value: 20 },
      { type: "Person", value: 20 },
      { type: "Episode", value: 20 },
      { type: "Call", value: 20 },
      { type: "Message", value: 20 },
    ],
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Successful Creation", () => {
    test("should create workspace with valid inputs", async () => {
      // Mock workspace count under limit
      (db.workspace.count as Mock).mockResolvedValue(0);
      
      // Mock no existing workspace with same slug
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      // Mock successful creation
      const mockWorkspace = createMockWorkspace();
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace(createMockWorkspaceData());

      expect(db.workspace.count).toHaveBeenCalledWith({
        where: {
          ownerId: mockUserId,
          deleted: false,
        },
      });

      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: "test-workspace", deleted: false },
        select: { id: true },
      });

      expect(db.workspace.create).toHaveBeenCalledWith({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          description: "Test description",
          ownerId: mockUserId,
          repositoryDraft: undefined,
        },
      });

      expect(result).toMatchObject({
        id: mockWorkspaceId,
        name: "Test Workspace",
        slug: "test-workspace",
        description: "Test description",
        ownerId: mockUserId,
      });
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    test("should create workspace without description (optional field)", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const mockWorkspace = createMockWorkspace({ description: null });
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace({
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: mockUserId,
      });

      expect(db.workspace.create).toHaveBeenCalledWith({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: mockUserId,
          repositoryDraft: undefined,
        },
      });

      expect(result.description).toBeNull();
    });

    test("should return workspace with ISO-formatted timestamps", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const createdAt = new Date("2024-01-15T10:30:00.000Z");
      const updatedAt = new Date("2024-01-15T10:30:00.000Z");
      const mockWorkspace = createMockWorkspace({ createdAt, updatedAt });
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace(createMockWorkspaceData());

      expect(result.createdAt).toBe(createdAt.toISOString());
      expect(result.updatedAt).toBe(updatedAt.toISOString());
    });

    test("should create workspace with repositoryUrl", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const mockWorkspace = createMockWorkspace({ repositoryDraft: "https://github.com/test/repo" });
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace({
        name: "Test",
        slug: "test-workspace",
        ownerId: mockUserId,
        repositoryUrl: "https://github.com/test/repo",
      });

      expect(db.workspace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          repositoryDraft: "https://github.com/test/repo",
        }),
      });
    });
  });

  describe("Slug Validation - Reserved Names", () => {
    test("should reject reserved slugs", async () => {
      const reservedSlugs = [
        "api",
        "admin",
        "dashboard",
        "settings",
        "auth",
        "workspaces",
        "workspace",
        "tasks",
        "projects",
        "repos",
      ];

      for (const slug of reservedSlugs) {
        await expect(
          createWorkspace({
            name: "Test",
            slug,
            ownerId: mockUserId,
          })
        ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_RESERVED);

        // Ensure no database calls for reserved slugs
        expect(db.workspace.create).not.toHaveBeenCalled();
      }
    });
  });

  describe("Slug Validation - Invalid Format", () => {
    test("should reject slugs with invalid characters", async () => {
      const invalidSlugs = [
        "My Workspace", // spaces
        "_workspace", // starts with underscore
        "workspace_", // ends with underscore
        "workspace.", // ends with special char
        "work@space", // special characters
        "UPPERCASE", // uppercase
        "workspace!", // exclamation mark
      ];

      for (const slug of invalidSlugs) {
        await expect(
          createWorkspace({
            name: "Test",
            slug,
            ownerId: mockUserId,
          })
        ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_INVALID_FORMAT);
      }
    });

    test("should reject slugs starting with hyphen", async () => {
      await expect(
        createWorkspace({
          name: "Test",
          slug: "-workspace",
          ownerId: mockUserId,
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_INVALID_FORMAT);
    });

    test("should reject slugs ending with hyphen", async () => {
      await expect(
        createWorkspace({
          name: "Test",
          slug: "workspace-",
          ownerId: mockUserId,
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_INVALID_FORMAT);
    });

    test("should reject empty slug", async () => {
      await expect(
        createWorkspace({
          name: "Test",
          slug: "",
          ownerId: mockUserId,
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_INVALID_LENGTH);
    });

    test("should accept valid slugs with hyphens", async () => {
      const validSlugs = [
        "my-workspace",
        "test-123",
        "workspace-with-hyphens",
        "a1",
      ];

      for (const slug of validSlugs) {
        (db.workspace.count as Mock).mockResolvedValue(0);
        (db.workspace.findUnique as Mock).mockResolvedValue(null);
        
        const mockWorkspace = createMockWorkspace({ slug });
        (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

        const result = await createWorkspace({
          name: "Test",
          slug,
          ownerId: mockUserId,
        });

        expect(result.slug).toBe(slug);
        vi.clearAllMocks();
      }
    });
  });

  describe("Slug Validation - Length Constraints", () => {
    test("should reject slug shorter than minimum length", async () => {
      await expect(
        createWorkspace({
          name: "Test",
          slug: "a", // 1 character (min is 2)
          ownerId: mockUserId,
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_INVALID_LENGTH);
    });

    test("should reject slug longer than maximum length", async () => {
      const longSlug = "a".repeat(WORKSPACE_SLUG_PATTERNS.MAX_LENGTH + 1);

      await expect(
        createWorkspace({
          name: "Test",
          slug: longSlug,
          ownerId: mockUserId,
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_INVALID_LENGTH);
    });

    test("should accept slug at minimum length", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const minSlug = "ab"; // 2 characters
      const mockWorkspace = createMockWorkspace({ slug: minSlug });
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace({
        name: "Test",
        slug: minSlug,
        ownerId: mockUserId,
      });

      expect(result.slug).toBe(minSlug);
    });

    test("should accept slug at maximum length", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const maxSlug = "a".repeat(WORKSPACE_SLUG_PATTERNS.MAX_LENGTH);
      const mockWorkspace = createMockWorkspace({ slug: maxSlug });
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace({
        name: "Test",
        slug: maxSlug,
        ownerId: mockUserId,
      });

      expect(result.slug).toBe(maxSlug);
    });
  });

  describe("Workspace Limit Enforcement", () => {
    test("should reject creation when user reaches workspace limit", async () => {
      // Mock count at limit
      (db.workspace.count as Mock).mockResolvedValue(
        WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER
      );

      await expect(
        createWorkspace({
          name: "Extra Workspace",
          slug: "extra-workspace",
          ownerId: mockUserId,
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED);

      expect(db.workspace.count).toHaveBeenCalledWith({
        where: {
          ownerId: mockUserId,
          deleted: false,
        },
      });

      // Should not attempt to create or check slug
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
      expect(db.workspace.create).not.toHaveBeenCalled();
    });

    test("should allow creation when user is under limit", async () => {
      // Mock count under limit
      (db.workspace.count as Mock).mockResolvedValue(
        WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER - 1
      );
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const mockWorkspace = createMockWorkspace();
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace(createMockWorkspaceData());

      expect(result).toBeDefined();
      expect(db.workspace.create).toHaveBeenCalled();
    });

    test("should exclude deleted workspaces from limit count", async () => {
      // The service already filters by deleted: false in the where clause
      (db.workspace.count as Mock).mockResolvedValue(
        WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER
      );

      await expect(
        createWorkspace({
          name: "Test",
          slug: "test-workspace",
          ownerId: mockUserId,
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED);

      // Verify query excludes deleted workspaces
      expect(db.workspace.count).toHaveBeenCalledWith({
        where: {
          ownerId: mockUserId,
          deleted: false,
        },
      });
    });

    test("should enforce limit per user, not globally", async () => {
      const user1Id = "user-1";
      const user2Id = "user-2";

      (db.workspace.count as Mock).mockImplementation(({ where }) => {
        if (where.ownerId === user1Id) {
          return Promise.resolve(WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER);
        }
        return Promise.resolve(0);
      });

      // User 1 should be rejected
      await expect(
        createWorkspace({
          name: "User1 Extra",
          slug: "user1-extra",
          ownerId: user1Id,
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED);

      // User 2 should be allowed
      (db.workspace.findUnique as Mock).mockResolvedValue(null);
      const user2Workspace = createMockWorkspace({ ownerId: user2Id });
      (db.workspace.create as Mock).mockResolvedValue(user2Workspace);

      const result = await createWorkspace({
        name: "User2 Workspace",
        slug: "user2-workspace",
        ownerId: user2Id,
      });

      expect(result.ownerId).toBe(user2Id);
    });
  });

  describe("Duplicate Slug Detection", () => {
    test("should reject duplicate slug with pre-check", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);

      // Mock existing workspace with same slug
      (db.workspace.findUnique as Mock).mockResolvedValue(
        createMockWorkspace({ slug: "duplicate-slug" })
      );

      await expect(
        createWorkspace({
          name: "Test",
          slug: "duplicate-slug",
          ownerId: mockUserId,
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS);

      expect(db.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: "duplicate-slug", deleted: false },
        select: { id: true },
      });

      // Should not attempt to create
      expect(db.workspace.create).not.toHaveBeenCalled();
    });

    test("should handle P2002 constraint error from database", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      // Mock P2002 Prisma constraint error with proper meta structure
      const prismaError: any = new Error("Unique constraint failed");
      prismaError.code = "P2002";
      prismaError.meta = { target: ["slug"] };
      (db.workspace.create as Mock).mockRejectedValue(prismaError);

      await expect(
        createWorkspace({
          name: "Test",
          slug: "duplicate-slug",
          ownerId: mockUserId,
        })
      ).rejects.toThrow(WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS);
    });

    test("should allow slug reuse after deletion", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      // Mock findUnique returns null (no active workspace with that slug)
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const mockWorkspace = createMockWorkspace({
        slug: "reused-slug",
      });
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace({
        name: "Test",
        slug: "reused-slug",
        ownerId: mockUserId,
      });

      expect(result.slug).toBe("reused-slug");
    });
  });

  describe("Input Validation", () => {
    test("should handle missing name field (TypeScript validation)", async () => {
      // Note: TypeScript enforces required fields at compile time
      // At runtime, the service will attempt to create with undefined name
      // This is a runtime test showing what happens if TypeScript is bypassed
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);
      
      // Database will accept undefined, creating a workspace with null name
      const mockWorkspace = createMockWorkspace({ name: undefined as any });
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace({
        slug: "test-workspace",
        ownerId: mockUserId,
      } as any);
      
      // Service passes through whatever the DB returns
      expect(result).toBeDefined();
    });

    test("should handle missing slug field at validation", async () => {
      await expect(
        createWorkspace({
          name: "Test Workspace",
          ownerId: mockUserId,
        } as any)
      ).rejects.toThrow();
    });

    test("should accept null description", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const mockWorkspace = createMockWorkspace({ description: null });
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace({
        name: "Test",
        slug: "test-workspace",
        description: undefined,
        ownerId: mockUserId,
      });

      expect(result.description).toBeNull();
    });

    test("should accept undefined description", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const mockWorkspace = createMockWorkspace({ description: null });
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace({
        name: "Test",
        slug: "test-workspace",
        ownerId: mockUserId,
      });

      expect(result.description).toBeNull();
    });
  });

  describe("Error Handling", () => {
    test("should handle database connection errors", async () => {
      (db.workspace.count as Mock).mockRejectedValue(
        new Error("Database connection failed")
      );

      await expect(
        createWorkspace(createMockWorkspaceData())
      ).rejects.toThrow("Database connection failed");
    });

    test("should handle unknown database errors", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const unknownError = new Error("Unknown database error");
      (db.workspace.create as Mock).mockRejectedValue(unknownError);

      await expect(
        createWorkspace(createMockWorkspaceData())
      ).rejects.toThrow("Unknown database error");
    });

    test("should re-throw non-P2002 Prisma errors", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const prismaError: any = new Error("Some other constraint violation");
      prismaError.code = "P2003";
      (db.workspace.create as Mock).mockRejectedValue(prismaError);

      await expect(
        createWorkspace(createMockWorkspaceData())
      ).rejects.toThrow("Some other constraint violation");
    });
  });

  describe("Response Format Validation", () => {
    test("should return workspace with all required fields", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const mockWorkspace = createMockWorkspace();
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace(createMockWorkspaceData());

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("name");
      expect(result).toHaveProperty("slug");
      expect(result).toHaveProperty("description");
      expect(result).toHaveProperty("ownerId");
      expect(result).toHaveProperty("createdAt");
      expect(result).toHaveProperty("updatedAt");
    });

    test("should format timestamps as ISO strings", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const mockWorkspace = createMockWorkspace();
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace(createMockWorkspaceData());

      expect(typeof result.createdAt).toBe("string");
      expect(typeof result.updatedAt).toBe("string");
      expect(result.createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );
    });

    test("should preserve nodeTypeOrder field structure", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const mockWorkspace = createMockWorkspace();
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace(createMockWorkspaceData());

      // Note: Service spreads all workspace fields, including internal ones
      // TypeScript WorkspaceResponse type provides compile-time filtering
      expect(result).toHaveProperty("nodeTypeOrder");
      expect(Array.isArray(result.nodeTypeOrder)).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    test("should handle workspace creation with very long valid name", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const longName = "A".repeat(100); // Max length for name
      const mockWorkspace = createMockWorkspace({ name: longName });
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace({
        name: longName,
        slug: "test-workspace",
        ownerId: mockUserId,
      });

      expect(result.name).toBe(longName);
    });

    test("should handle workspace creation with very long valid description", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const longDescription = "A".repeat(500); // Max length for description
      const mockWorkspace = createMockWorkspace({
        description: longDescription,
      });
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace({
        name: "Test",
        slug: "test-workspace",
        description: longDescription,
        ownerId: mockUserId,
      });

      expect(result.description).toBe(longDescription);
    });

    test("should handle special characters in name", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const specialName = "Test & Co.'s Workspace!";
      const mockWorkspace = createMockWorkspace({ name: specialName });
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace({
        name: specialName,
        slug: "test-workspace",
        ownerId: mockUserId,
      });

      expect(result.name).toBe(specialName);
    });

    test("should handle numeric slug", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const numericSlug = "123456";
      const mockWorkspace = createMockWorkspace({ slug: numericSlug });
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace({
        name: "Test",
        slug: numericSlug,
        ownerId: mockUserId,
      });

      expect(result.slug).toBe(numericSlug);
    });

    test("should handle slug with mixed alphanumeric characters", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const mixedSlug = "test123workspace456";
      const mockWorkspace = createMockWorkspace({ slug: mixedSlug });
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      const result = await createWorkspace({
        name: "Test",
        slug: mixedSlug,
        ownerId: mockUserId,
      });

      expect(result.slug).toBe(mixedSlug);
    });
  });

  describe("Database Call Verification", () => {
    test("should call database methods in correct order", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(null);

      const mockWorkspace = createMockWorkspace();
      (db.workspace.create as Mock).mockResolvedValue(mockWorkspace);

      await createWorkspace(createMockWorkspaceData());

      // Verify call order
      expect(db.workspace.count).toHaveBeenCalledBefore(
        db.workspace.findUnique as Mock
      );
      expect(db.workspace.findUnique).toHaveBeenCalledBefore(
        db.workspace.create as Mock
      );
    });

    test("should not call create if slug validation fails", async () => {
      await expect(
        createWorkspace({
          name: "Test",
          slug: "api", // reserved
          ownerId: mockUserId,
        })
      ).rejects.toThrow();

      expect(db.workspace.create).not.toHaveBeenCalled();
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
      expect(db.workspace.count).not.toHaveBeenCalled();
    });

    test("should not call create if workspace limit reached", async () => {
      (db.workspace.count as Mock).mockResolvedValue(
        WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER
      );

      await expect(
        createWorkspace(createMockWorkspaceData())
      ).rejects.toThrow();

      expect(db.workspace.count).toHaveBeenCalled();
      expect(db.workspace.findUnique).not.toHaveBeenCalled();
      expect(db.workspace.create).not.toHaveBeenCalled();
    });

    test("should not call create if duplicate slug detected", async () => {
      (db.workspace.count as Mock).mockResolvedValue(0);
      (db.workspace.findUnique as Mock).mockResolvedValue(
        createMockWorkspace()
      );

      await expect(
        createWorkspace(createMockWorkspaceData())
      ).rejects.toThrow();

      expect(db.workspace.count).toHaveBeenCalled();
      expect(db.workspace.findUnique).toHaveBeenCalled();
      expect(db.workspace.create).not.toHaveBeenCalled();
    });
  });
});
