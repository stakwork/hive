import { describe, test, expect, vi, beforeEach } from "vitest";
import { createFeature } from "@/services/roadmap/features";
import { db } from "@/lib/db";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { FeatureStatus, FeaturePriority } from "@prisma/client";

vi.mock("@/lib/db");
vi.mock("@/services/workspace");

const mockedValidateWorkspaceAccess = vi.mocked(validateWorkspaceAccessById);

describe("createFeature", () => {
  const mockUserId = "user-123";
  const mockWorkspaceId = "workspace-456";

  const mockUser = {
    id: mockUserId,
    name: "Test User",
    email: "test@example.com",
    image: null,
    emailVerified: null,
    deleted: false,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  };

  const mockWorkspaceAccess = {
    hasAccess: true,
    userRole: "DEVELOPER" as const,
    workspace: {
      id: mockWorkspaceId,
      name: "Test Workspace",
      description: "Test",
      slug: "test-workspace",
      ownerId: "owner-123",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    canRead: true,
    canWrite: true,
    canAdmin: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock database methods manually - this must happen every time
    Object.assign(db, {
      user: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
      },
      feature: {
        create: vi.fn(),
      },
    });
    // Also reset the mocked functions
    mockedValidateWorkspaceAccess.mockReset();
  });

  describe("Success Cases", () => {
    test("should create feature with all fields provided", async () => {
      const mockAssignee = {
        id: "assignee-123",
        name: "Assignee User",
        email: "assignee@example.com",
        image: null,
        deleted: false,
      };

      const mockFeature = {
        id: "feature-123",
        title: "Test Feature",
        brief: "Brief description",
        requirements: "Requirements doc",
        architecture: "Architecture doc",
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.PLANNED,
        priority: FeaturePriority.HIGH,
        assigneeId: "assignee-123",
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
        assignee: {
          id: mockAssignee.id,
          name: mockAssignee.name,
          email: mockAssignee.email,
          image: mockAssignee.image,
        },
        createdBy: {
          id: mockUser.id,
          name: mockUser.name,
          email: mockUser.email,
          image: mockUser.image,
        },
        workspace: {
          id: mockWorkspaceId,
          name: "Test Workspace",
          slug: "test-workspace",
        },
        _count: {
          userStories: 0,
        },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess);
      db.user.findUnique.mockResolvedValue(mockUser);
      db.user.findFirst.mockResolvedValue(mockAssignee);
      db.feature.create.mockResolvedValue(mockFeature);

      const result = await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.PLANNED,
        priority: FeaturePriority.HIGH,
        assigneeId: "assignee-123",
        brief: "Brief description",
        requirements: "Requirements doc",
        architecture: "Architecture doc",
      });

      expect(validateWorkspaceAccessById).toHaveBeenCalledWith(mockWorkspaceId, mockUserId);
      expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: mockUserId } });
      expect(db.user.findFirst).toHaveBeenCalledWith({
        where: { id: "assignee-123", deleted: false },
      });
      expect(db.feature.create).toHaveBeenCalledWith({
        data: {
          title: "Test Feature",
          brief: "Brief description",
          requirements: "Requirements doc",
          architecture: "Architecture doc",
          personas: [],
          workspaceId: mockWorkspaceId,
          status: FeatureStatus.PLANNED,
          priority: FeaturePriority.HIGH,
          assigneeId: "assignee-123",
          createdById: mockUserId,
          updatedById: mockUserId,
        },
        include: {
          assignee: {
            select: { id: true, name: true, email: true, image: true },
          },
          createdBy: {
            select: { id: true, name: true, email: true, image: true },
          },
          workspace: {
            select: { id: true, name: true, slug: true },
          },
          _count: {
            select: { userStories: true },
          },
        },
      });
      expect(result).toEqual(mockFeature);
    });

    test("should create feature with minimal fields and apply defaults", async () => {
      const mockFeature = {
        id: "feature-123",
        title: "Minimal Feature",
        brief: null,
        requirements: null,
        architecture: null,
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.BACKLOG,
        priority: FeaturePriority.NONE,
        assigneeId: null,
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
        assignee: null,
        createdBy: {
          id: mockUser.id,
          name: mockUser.name,
          email: mockUser.email,
          image: mockUser.image,
        },
        workspace: {
          id: mockWorkspaceId,
          name: "Test Workspace",
          slug: "test-workspace",
        },
        _count: {
          userStories: 0,
        },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess);
      db.user.findUnique.mockResolvedValue(mockUser);
      db.feature.create.mockResolvedValue(mockFeature);

      const result = await createFeature(mockUserId, {
        title: "Minimal Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.feature.create).toHaveBeenCalledWith({
        data: {
          title: "Minimal Feature",
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
        include: expect.any(Object),
      });
      expect(result.status).toBe(FeatureStatus.BACKLOG);
      expect(result.priority).toBe(FeaturePriority.NONE);
      expect(result.assigneeId).toBeNull();
    });

    test("should trim whitespace from all text fields", async () => {
      const mockFeature = {
        id: "feature-123",
        title: "Trimmed Title",
        brief: "Trimmed Brief",
        requirements: "Trimmed Requirements",
        architecture: "Trimmed Architecture",
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.BACKLOG,
        priority: FeaturePriority.NONE,
        assigneeId: null,
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
        assignee: null,
        createdBy: {
          id: mockUser.id,
          name: mockUser.name,
          email: mockUser.email,
          image: mockUser.image,
        },
        workspace: {
          id: mockWorkspaceId,
          name: "Test Workspace",
          slug: "test-workspace",
        },
        _count: {
          userStories: 0,
        },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess);
      db.user.findUnique.mockResolvedValue(mockUser);
      db.feature.create.mockResolvedValue(mockFeature);

      await createFeature(mockUserId, {
        title: "  Trimmed Title  ",
        workspaceId: mockWorkspaceId,
        brief: "  Trimmed Brief  ",
        requirements: "  Trimmed Requirements  ",
        architecture: "  Trimmed Architecture  ",
      });

      expect(db.feature.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: "Trimmed Title",
          brief: "Trimmed Brief",
          requirements: "Trimmed Requirements",
          architecture: "Trimmed Architecture",
        }),
        include: expect.any(Object),
      });
    });

    test("should handle null assigneeId explicitly", async () => {
      const mockFeature = {
        id: "feature-123",
        title: "Feature",
        brief: null,
        requirements: null,
        architecture: null,
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.BACKLOG,
        priority: FeaturePriority.NONE,
        assigneeId: null,
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
        assignee: null,
        createdBy: {
          id: mockUser.id,
          name: mockUser.name,
          email: mockUser.email,
          image: mockUser.image,
        },
        workspace: {
          id: mockWorkspaceId,
          name: "Test Workspace",
          slug: "test-workspace",
        },
        _count: {
          userStories: 0,
        },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess);
      db.user.findUnique.mockResolvedValue(mockUser);
      db.feature.create.mockResolvedValue(mockFeature);

      const result = await createFeature(mockUserId, {
        title: "Feature",
        workspaceId: mockWorkspaceId,
        assigneeId: null,
      });

      expect(db.user.findFirst).not.toHaveBeenCalled();
      expect(db.feature.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          assigneeId: null,
        }),
        include: expect.any(Object),
      });
      expect(result.assigneeId).toBeNull();
    });
  });

  describe("Workspace Access Validation", () => {
    test("should deny access when user does not have workspace access", async () => {
      mockedValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });

      await expect(
        createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
        })
      ).rejects.toThrow("Access denied");

      expect(validateWorkspaceAccessById).toHaveBeenCalledWith(mockWorkspaceId, mockUserId);
      expect(db.user.findUnique).not.toHaveBeenCalled();
      expect(db.feature.create).not.toHaveBeenCalled();
    });
  });

  describe("Title Validation", () => {
    test("should reject empty title", async () => {
      mockedValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess);

      await expect(
        createFeature(mockUserId, {
          title: "",
          workspaceId: mockWorkspaceId,
        })
      ).rejects.toThrow("Title is required");

      expect(db.feature.create).not.toHaveBeenCalled();
    });

    test("should reject whitespace-only title", async () => {
      mockedValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess);

      await expect(
        createFeature(mockUserId, {
          title: "   ",
          workspaceId: mockWorkspaceId,
        })
      ).rejects.toThrow("Title is required");

      expect(db.feature.create).not.toHaveBeenCalled();
    });
  });

  describe("User Validation", () => {
    test("should reject when creating user not found", async () => {
      mockedValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess);
      db.user.findUnique.mockResolvedValue(null);

      await expect(
        createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
        })
      ).rejects.toThrow("User not found");

      expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: mockUserId } });
      expect(db.feature.create).not.toHaveBeenCalled();
    });
  });

  describe("Status Enum Validation", () => {
    test("should reject invalid status value", async () => {
      mockedValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess);
      db.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
          status: "INVALID_STATUS" as FeatureStatus,
        })
      ).rejects.toThrow(/Invalid status/);

      expect(db.feature.create).not.toHaveBeenCalled();
    });

    test("should accept all valid status values", async () => {
      const validStatuses = [
        FeatureStatus.BACKLOG,
        FeatureStatus.PLANNED,
        FeatureStatus.IN_PROGRESS,
        FeatureStatus.COMPLETED,
        FeatureStatus.CANCELLED,
      ];

      for (const status of validStatuses) {
        // Setup fresh mocks for each iteration
        mockedValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess);
        (db.user.findUnique as any).mockResolvedValue(mockUser);

        const mockFeature = {
          id: "feature-123",
          title: "Test Feature",
          brief: null,
          requirements: null,
          architecture: null,
          workspaceId: mockWorkspaceId,
          status: status,
          priority: FeaturePriority.NONE,
          assigneeId: null,
          createdById: mockUserId,
          updatedById: mockUserId,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          assignee: null,
          createdBy: {
            id: mockUser.id,
            name: mockUser.name,
            email: mockUser.email,
            image: mockUser.image,
          },
          workspace: {
            id: mockWorkspaceId,
            name: "Test Workspace",
            slug: "test-workspace",
          },
          _count: {
            userStories: 0,
          },
        };

        (db.feature.create as any).mockResolvedValue(mockFeature);

        await createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
          status: status,
        });

        expect(db.feature.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            status,
            personas: [],
          }),
          include: expect.any(Object),
        });

        vi.clearAllMocks();
      }
    });
  });

  describe("Priority Enum Validation", () => {
    test("should reject invalid priority value", async () => {
      mockedValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess);
      db.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
          priority: "INVALID_PRIORITY" as FeaturePriority,
        })
      ).rejects.toThrow(/Invalid priority/);

      expect(db.feature.create).not.toHaveBeenCalled();
    });

    test("should accept all valid priority values", async () => {
      const validPriorities = [
        FeaturePriority.NONE,
        FeaturePriority.LOW,
        FeaturePriority.MEDIUM,
        FeaturePriority.HIGH,
        FeaturePriority.CRITICAL,
      ];

      for (const priority of validPriorities) {
        // Setup fresh mocks for each iteration
        mockedValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess);
        (db.user.findUnique as any).mockResolvedValue(mockUser);

        const mockFeature = {
          id: "feature-123",
          title: "Test Feature",
          brief: null,
          requirements: null,
          architecture: null,
          workspaceId: mockWorkspaceId,
          status: FeatureStatus.BACKLOG,
          priority: priority,
          assigneeId: null,
          createdById: mockUserId,
          updatedById: mockUserId,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          assignee: null,
          createdBy: {
            id: mockUser.id,
            name: mockUser.name,
            email: mockUser.email,
            image: mockUser.image,
          },
          workspace: {
            id: mockWorkspaceId,
            name: "Test Workspace",
            slug: "test-workspace",
          },
          _count: {
            userStories: 0,
          },
        };

        (db.feature.create as any).mockResolvedValue(mockFeature);

        await createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
          priority: priority,
        });

        expect(db.feature.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            priority,
            personas: [],
          }),
          include: expect.any(Object),
        });

        vi.clearAllMocks();
      }
    });
  });

  describe("Assignee Validation", () => {
    test("should reject when assignee not found", async () => {
      mockedValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess);
      db.user.findUnique.mockResolvedValue(mockUser);
      db.user.findFirst.mockResolvedValue(null);

      await expect(
        createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
          assigneeId: "non-existent-user",
        })
      ).rejects.toThrow("Assignee not found");

      expect(db.user.findFirst).toHaveBeenCalledWith({
        where: { id: "non-existent-user", deleted: false },
      });
      expect(db.feature.create).not.toHaveBeenCalled();
    });

    test("should reject when assignee is deleted", async () => {
      mockedValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess);
      db.user.findUnique.mockResolvedValue(mockUser);
      db.user.findFirst.mockResolvedValue(null);

      await expect(
        createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
          assigneeId: "deleted-user",
        })
      ).rejects.toThrow("Assignee not found");

      expect(db.user.findFirst).toHaveBeenCalledWith({
        where: { id: "deleted-user", deleted: false },
      });
      expect(db.feature.create).not.toHaveBeenCalled();
    });

    test("should successfully assign to valid user", async () => {
      const mockAssignee = {
        id: "assignee-123",
        name: "Assignee User",
        email: "assignee@example.com",
        image: null,
        deleted: false,
      };

      const mockFeature = {
        id: "feature-123",
        title: "Test Feature",
        brief: null,
        requirements: null,
        architecture: null,
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.BACKLOG,
        priority: FeaturePriority.NONE,
        assigneeId: "assignee-123",
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
        assignee: {
          id: mockAssignee.id,
          name: mockAssignee.name,
          email: mockAssignee.email,
          image: mockAssignee.image,
        },
        createdBy: {
          id: mockUser.id,
          name: mockUser.name,
          email: mockUser.email,
          image: mockUser.image,
        },
        workspace: {
          id: mockWorkspaceId,
          name: "Test Workspace",
          slug: "test-workspace",
        },
        _count: {
          userStories: 0,
        },
      };

      mockedValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess);
      db.user.findUnique.mockResolvedValue(mockUser);
      db.user.findFirst.mockResolvedValue(mockAssignee);
      db.feature.create.mockResolvedValue(mockFeature);

      const result = await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        assigneeId: "assignee-123",
      });

      expect(db.user.findFirst).toHaveBeenCalledWith({
        where: { id: "assignee-123", deleted: false },
      });
      expect(result.assigneeId).toBe("assignee-123");
      expect(result.assignee).toEqual({
        id: mockAssignee.id,
        name: mockAssignee.name,
        email: mockAssignee.email,
        image: mockAssignee.image,
      });
    });
  });

  describe("Database Operation Verification", () => {
    test("should include all required relations in create call", async () => {
      mockedValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess);
      db.user.findUnique.mockResolvedValue(mockUser);
      db.feature.create.mockResolvedValue({
        id: "feature-123",
        title: "Test Feature",
        brief: null,
        requirements: null,
        architecture: null,
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.BACKLOG,
        priority: FeaturePriority.NONE,
        assigneeId: null,
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
        assignee: null,
        createdBy: {
          id: mockUser.id,
          name: mockUser.name,
          email: mockUser.email,
          image: mockUser.image,
        },
        workspace: {
          id: mockWorkspaceId,
          name: "Test Workspace",
          slug: "test-workspace",
        },
        _count: {
          userStories: 0,
        },
      });

      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.feature.create).toHaveBeenCalledWith({
        data: expect.any(Object),
        include: {
          assignee: {
            select: { id: true, name: true, email: true, image: true },
          },
          createdBy: {
            select: { id: true, name: true, email: true, image: true },
          },
          workspace: {
            select: { id: true, name: true, slug: true },
          },
          _count: {
            select: { userStories: true },
          },
        },
      });
    });

    test("should set createdById and updatedById to current user", async () => {
      mockedValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess);
      db.user.findUnique.mockResolvedValue(mockUser);
      db.feature.create.mockResolvedValue({
        id: "feature-123",
        title: "Test Feature",
        brief: null,
        requirements: null,
        architecture: null,
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.BACKLOG,
        priority: FeaturePriority.NONE,
        assigneeId: null,
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
        assignee: null,
        createdBy: {
          id: mockUser.id,
          name: mockUser.name,
          email: mockUser.email,
          image: mockUser.image,
        },
        workspace: {
          id: mockWorkspaceId,
          name: "Test Workspace",
          slug: "test-workspace",
        },
        _count: {
          userStories: 0,
        },
      });

      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.feature.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          createdById: mockUserId,
          updatedById: mockUserId,
        }),
        include: expect.any(Object),
      });
    });
  });
});