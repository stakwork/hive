import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { FeatureStatus, FeaturePriority } from "@prisma/client";

// Mock dependencies before imports
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    feature: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccessById: vi.fn(),
}));

// Import after mocks
import { db } from "@/lib/db";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { createFeature } from "@/services/roadmap/features";

describe("createFeature", () => {
  const mockUserId = "user-123";
  const mockWorkspaceId = "workspace-456";
  const mockAssigneeId = "assignee-789";

  const mockUser = {
    id: mockUserId,
    name: "Test User",
    email: "test@example.com",
    deleted: false,
  };

  const mockAssignee = {
    id: mockAssigneeId,
    name: "Assignee User",
    email: "assignee@example.com",
    deleted: false,
  };

  const mockWorkspaceAccess = {
    hasAccess: true,
    canRead: true,
    canWrite: true,
    canAdmin: false,
    userRole: "DEVELOPER" as const,
    workspace: {
      id: mockWorkspaceId,
      name: "Test Workspace",
      description: "Test workspace description",
      slug: "test-workspace",
      ownerId: "owner-123",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const mockCreatedFeature = {
    id: "feature-123",
    title: "Test Feature",
    brief: "Test brief",
    requirements: "Test requirements",
    architecture: "Test architecture",
    personas: [],
    workspaceId: mockWorkspaceId,
    status: FeatureStatus.BACKLOG,
    priority: FeaturePriority.NONE,
    assigneeId: null,
    createdById: mockUserId,
    updatedById: mockUserId,
    createdAt: new Date(),
    updatedAt: new Date(),
    assignee: null,
    createdBy: mockUser,
    workspace: {
      id: mockWorkspaceId,
      name: "Test Workspace",
      slug: "test-workspace",
    },
    _count: {
      userStories: 0,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default successful mocks
    vi.mocked(validateWorkspaceAccessById).mockResolvedValue(mockWorkspaceAccess);
    vi.mocked(db.user.findUnique).mockResolvedValue(mockUser);
    vi.mocked(db.feature.create).mockResolvedValue(mockCreatedFeature);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Workspace Access Validation", () => {
    test("throws error when user does not have workspace access", async () => {
      vi.mocked(validateWorkspaceAccessById).mockResolvedValue({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });

      await expect(
        createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
        }),
      ).rejects.toThrow("Access denied");

      expect(validateWorkspaceAccessById).toHaveBeenCalledWith(mockWorkspaceId, mockUserId);
    });

    test("allows feature creation when user has workspace access", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(validateWorkspaceAccessById).toHaveBeenCalledWith(mockWorkspaceId, mockUserId);
    });
  });

  describe("Required Field Validation", () => {
    test("throws error when title is missing", async () => {
      await expect(
        createFeature(mockUserId, {
          title: "",
          workspaceId: mockWorkspaceId,
        }),
      ).rejects.toThrow("Title is required");
    });

    test("throws error when title is only whitespace", async () => {
      await expect(
        createFeature(mockUserId, {
          title: "   ",
          workspaceId: mockWorkspaceId,
        }),
      ).rejects.toThrow("Title is required");
    });

    test("accepts title with leading/trailing whitespace (trimmed)", async () => {
      const result = await createFeature(mockUserId, {
        title: "  Valid Title  ",
        workspaceId: mockWorkspaceId,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Valid Title",
          }),
        }),
      );
    });
  });

  describe("User Existence Validation", () => {
    test("throws error when user does not exist", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue(null);

      await expect(
        createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
        }),
      ).rejects.toThrow("User not found");

      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockUserId },
      });
    });

    test("proceeds when user exists", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockUserId },
      });
    });
  });

  describe("Status Enum Validation", () => {
    test("throws error for invalid status enum value", async () => {
      await expect(
        createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
          status: "INVALID_STATUS" as FeatureStatus,
        }),
      ).rejects.toThrow("Invalid status");
    });

    test("accepts valid BACKLOG status", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.BACKLOG,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FeatureStatus.BACKLOG,
          }),
        }),
      );
    });

    test("accepts valid PLANNED status", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.PLANNED,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FeatureStatus.PLANNED,
          }),
        }),
      );
    });

    test("accepts valid IN_PROGRESS status", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.IN_PROGRESS,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FeatureStatus.IN_PROGRESS,
          }),
        }),
      );
    });

    test("accepts valid COMPLETED status", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.COMPLETED,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FeatureStatus.COMPLETED,
          }),
        }),
      );
    });

    test("accepts valid CANCELLED status", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.CANCELLED,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FeatureStatus.CANCELLED,
          }),
        }),
      );
    });
  });

  describe("Priority Enum Validation", () => {
    test("throws error for invalid priority enum value", async () => {
      await expect(
        createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
          priority: "INVALID_PRIORITY" as FeaturePriority,
        }),
      ).rejects.toThrow("Invalid priority");
    });

    test("accepts valid NONE priority", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        priority: FeaturePriority.NONE,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: FeaturePriority.NONE,
          }),
        }),
      );
    });

    test("accepts valid LOW priority", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        priority: FeaturePriority.LOW,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: FeaturePriority.LOW,
          }),
        }),
      );
    });

    test("accepts valid MEDIUM priority", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        priority: FeaturePriority.MEDIUM,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: FeaturePriority.MEDIUM,
          }),
        }),
      );
    });

    test("accepts valid HIGH priority", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        priority: FeaturePriority.HIGH,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: FeaturePriority.HIGH,
          }),
        }),
      );
    });

    test("accepts valid URGENT priority", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        priority: FeaturePriority.URGENT,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: FeaturePriority.URGENT,
          }),
        }),
      );
    });
  });

  describe("Assignee Validation", () => {
    test("throws error when assignee does not exist", async () => {
      vi.mocked(db.user.findFirst).mockResolvedValue(null);

      await expect(
        createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
          assigneeId: mockAssigneeId,
        }),
      ).rejects.toThrow("Assignee not found");

      expect(db.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockAssigneeId,
          deleted: false,
        },
      });
    });

    test("throws error when assignee is soft-deleted", async () => {
      vi.mocked(db.user.findFirst).mockResolvedValue(null);

      await expect(
        createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
          assigneeId: mockAssigneeId,
        }),
      ).rejects.toThrow("Assignee not found");

      expect(db.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockAssigneeId,
          deleted: false,
        },
      });
    });

    test("accepts valid assignee", async () => {
      vi.mocked(db.user.findFirst).mockResolvedValue(mockAssignee);

      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        assigneeId: mockAssigneeId,
      });

      expect(db.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockAssigneeId,
          deleted: false,
        },
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assigneeId: mockAssigneeId,
          }),
        }),
      );
    });

    test("does not validate assignee when assigneeId is null", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        assigneeId: null,
      });

      expect(db.user.findFirst).not.toHaveBeenCalled();
    });

    test("does not validate assignee when assigneeId is undefined", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.user.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("Data Sanitization", () => {
    test("trims whitespace from title", async () => {
      await createFeature(mockUserId, {
        title: "  Title with spaces  ",
        workspaceId: mockWorkspaceId,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Title with spaces",
          }),
        }),
      );
    });

    test("trims whitespace from brief", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        brief: "  Brief with spaces  ",
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            brief: "Brief with spaces",
          }),
        }),
      );
    });

    test("trims whitespace from requirements", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        requirements: "  Requirements with spaces  ",
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requirements: "Requirements with spaces",
          }),
        }),
      );
    });

    test("trims whitespace from architecture", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        architecture: "  Architecture with spaces  ",
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            architecture: "Architecture with spaces",
          }),
        }),
      );
    });

    test("converts empty brief to null", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        brief: "",
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            brief: null,
          }),
        }),
      );
    });

    test("converts whitespace-only brief to null", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        brief: "   ",
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            brief: null,
          }),
        }),
      );
    });
  });

  describe("Default Values", () => {
    test("uses BACKLOG as default status when not provided", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FeatureStatus.BACKLOG,
          }),
        }),
      );
    });

    test("uses NONE as default priority when not provided", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: FeaturePriority.NONE,
          }),
        }),
      );
    });

    test("uses null as default assigneeId when not provided", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assigneeId: null,
          }),
        }),
      );
    });

    test("uses empty array as default personas when not provided", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            personas: [],
          }),
        }),
      );
    });
  });

  describe("Successful Feature Creation", () => {
    test("creates feature with minimal required fields", async () => {
      const result = await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.feature.create).toHaveBeenCalledWith({
        data: {
          title: "Test Feature",
          brief: null,
          requirements: null,
          architecture: null,
          personas: [],
          workspaceId: mockWorkspaceId,
          status: FeatureStatus.BACKLOG,
          priority: FeaturePriority.NONE,
          assigneeId: null,
          createdById: mockUserId,
          updatedById: mockUserId,
        },
        include: {
          assignee: {
            select: expect.any(Object),
          },
          createdBy: {
            select: expect.any(Object),
          },
          workspace: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          _count: {
            select: {
              userStories: true,
            },
          },
        },
      });

      expect(result).toEqual(mockCreatedFeature);
    });

    test("creates feature with all fields provided", async () => {
      vi.mocked(db.user.findFirst).mockResolvedValue(mockAssignee);

      const featureData = {
        title: "Complete Feature",
        brief: "Feature brief",
        requirements: "Feature requirements",
        architecture: "Feature architecture",
        personas: ["persona1", "persona2"],
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.PLANNED,
        priority: FeaturePriority.HIGH,
        assigneeId: mockAssigneeId,
      };

      await createFeature(mockUserId, featureData);

      expect(db.feature.create).toHaveBeenCalledWith({
        data: {
          title: "Complete Feature",
          brief: "Feature brief",
          requirements: "Feature requirements",
          architecture: "Feature architecture",
          personas: ["persona1", "persona2"],
          workspaceId: mockWorkspaceId,
          status: FeatureStatus.PLANNED,
          priority: FeaturePriority.HIGH,
          assigneeId: mockAssigneeId,
          createdById: mockUserId,
          updatedById: mockUserId,
        },
        include: {
          assignee: {
            select: expect.any(Object),
          },
          createdBy: {
            select: expect.any(Object),
          },
          workspace: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          _count: {
            select: {
              userStories: true,
            },
          },
        },
      });
    });

    test("returns created feature with all relations", async () => {
      const result = await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("title");
      expect(result).toHaveProperty("workspaceId");
      expect(result).toHaveProperty("assignee");
      expect(result).toHaveProperty("createdBy");
      expect(result).toHaveProperty("workspace");
      expect(result).toHaveProperty("_count");
      expect(result._count).toHaveProperty("userStories");
    });

    test("sets createdById and updatedById to the creating user", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.feature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            createdById: mockUserId,
            updatedById: mockUserId,
          }),
        }),
      );
    });
  });
});
