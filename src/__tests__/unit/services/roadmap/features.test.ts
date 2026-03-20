import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { FeatureStatus, FeaturePriority } from "@prisma/client";

// Mock dependencies before imports
vi.mock("@/lib/db", () => ({
  db: {users: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },features: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccessById: vi.fn(),
}));

// Import after mocks
import { db } from "@/lib/db";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { createFeature, listFeatures, updateFeature } from "@/services/roadmap/features";

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
    priority: FeaturePriority.LOW,
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
    vi.mocked(validateWorkspaceAccessById).mockResolvedValue(mockWorkspaceAccess as any);
    vi.mocked(db.users.findUnique).mockResolvedValue(mockUser as any);
    vi.mocked(db.features.create).mockResolvedValue(mockCreatedFeature as any);
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
        })
      ).rejects.toThrow("Access denied");

      expect(validateWorkspaceAccessById).toHaveBeenCalledWith(
        mockWorkspaceId,
        mockUserId
      );
    });

    test("allows feature creation when user has workspace access", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(validateWorkspaceAccessById).toHaveBeenCalledWith(
        mockWorkspaceId,
        mockUserId
      );
    });
  });

  describe("Required Field Validation", () => {
    test("throws error when title is missing", async () => {
      await expect(
        createFeature(mockUserId, {
          title: "",
          workspaceId: mockWorkspaceId,
        })
      ).rejects.toThrow("Title is required");
    });

    test("throws error when title is only whitespace", async () => {
      await expect(
        createFeature(mockUserId, {
          title: "   ",
          workspaceId: mockWorkspaceId,
        })
      ).rejects.toThrow("Title is required");
    });

    test("accepts title with leading/trailing whitespace (trimmed)", async () => {
      const result = await createFeature(mockUserId, {
        title: "  Valid Title  ",
        workspaceId: mockWorkspaceId,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Valid Title",
          }),
        })
      );
    });
  });

  describe("User Existence Validation", () => {
    test("throws error when user does not exist", async () => {
      vi.mocked(db.users.findUnique).mockResolvedValue(null);

      await expect(
        createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
        })
      ).rejects.toThrow("User not found");

      expect(db.users.findUnique).toHaveBeenCalledWith({
        where: { id: mockUserId },
      });
    });

    test("proceeds when user exists", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.users.findUnique).toHaveBeenCalledWith({
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
        })
      ).rejects.toThrow("Invalid status");
    });

    test("accepts valid BACKLOG status", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.BACKLOG,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FeatureStatus.BACKLOG,
          }),
        })
      );
    });

    test("accepts valid PLANNED status", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.PLANNED,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FeatureStatus.PLANNED,
          }),
        })
      );
    });

    test("accepts valid IN_PROGRESS status", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.IN_PROGRESS,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FeatureStatus.IN_PROGRESS,
          }),
        })
      );
    });

    test("accepts valid COMPLETED status", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.COMPLETED,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FeatureStatus.COMPLETED,
          }),
        })
      );
    });

    test("accepts valid CANCELLED status", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        status: FeatureStatus.CANCELLED,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FeatureStatus.CANCELLED,
          }),
        })
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
        })
      ).rejects.toThrow("Invalid priority");
    });

    test("accepts valid NONE priority", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        priority: FeaturePriority.LOW,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: FeaturePriority.LOW,
          }),
        })
      );
    });

    test("accepts valid LOW priority", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        priority: FeaturePriority.LOW,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: FeaturePriority.LOW,
          }),
        })
      );
    });

    test("accepts valid MEDIUM priority", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        priority: FeaturePriority.MEDIUM,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: FeaturePriority.MEDIUM,
          }),
        })
      );
    });

    test("accepts valid HIGH priority", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        priority: FeaturePriority.HIGH,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: FeaturePriority.HIGH,
          }),
        })
      );
    });

    test("accepts valid URGENT priority", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        priority: FeaturePriority.CRITICAL,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: FeaturePriority.CRITICAL,
          }),
        })
      );
    });
  });

  describe("Assignee Validation", () => {
    test("throws error when assignee does not exist", async () => {
      vi.mocked(db.users.findFirst).mockResolvedValue(null);

      await expect(
        createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
          assigneeId: mockAssigneeId,
        })
      ).rejects.toThrow("Assignee not found");

      expect(db.users.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockAssigneeId,
          deleted: false,
        },
      });
    });

    test("throws error when assignee is soft-deleted", async () => {
      vi.mocked(db.users.findFirst).mockResolvedValue(null);

      await expect(
        createFeature(mockUserId, {
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
          assigneeId: mockAssigneeId,
        })
      ).rejects.toThrow("Assignee not found");

      expect(db.users.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockAssigneeId,
          deleted: false,
        },
      });
    });

    test("accepts valid assignee", async () => {
      vi.mocked(db.users.findFirst).mockResolvedValue(mockAssignee as any);

      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        assigneeId: mockAssigneeId,
      });

      expect(db.users.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockAssigneeId,
          deleted: false,
        },
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assigneeId: mockAssigneeId,
          }),
        })
      );
    });

    test("does not validate assignee when assigneeId is null", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        assigneeId: null,
      });

      expect(db.users.findFirst).not.toHaveBeenCalled();
    });

    test("does not validate assignee when assigneeId is undefined", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.users.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("Data Sanitization", () => {
    test("trims whitespace from title", async () => {
      await createFeature(mockUserId, {
        title: "  Title with spaces  ",
        workspaceId: mockWorkspaceId,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Title with spaces",
          }),
        })
      );
    });

    test("trims whitespace from brief", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        brief: "  Brief with spaces  ",
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            brief: "Brief with spaces",
          }),
        })
      );
    });

    test("trims whitespace from requirements", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        requirements: "  Requirements with spaces  ",
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requirements: "Requirements with spaces",
          }),
        })
      );
    });

    test("trims whitespace from architecture", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        architecture: "  Architecture with spaces  ",
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            architecture: "Architecture with spaces",
          }),
        })
      );
    });

    test("converts empty brief to null", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        brief: "",
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            brief: null,
          }),
        })
      );
    });

    test("converts whitespace-only brief to null", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        brief: "   ",
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            brief: null,
          }),
        })
      );
    });
  });

  describe("Default Values", () => {
    test("uses BACKLOG as default status when not provided", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FeatureStatus.BACKLOG,
          }),
        })
      );
    });

    test("uses NONE as default priority when not provided", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: FeaturePriority.LOW,
          }),
        })
      );
    });

    test("uses null as default assigneeId when not provided", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assigneeId: null,
          }),
        })
      );
    });

    test("uses empty array as default personas when not provided", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            personas: [],
          }),
        })
      );
    });
  });

  describe("Successful Feature Creation", () => {
    test("creates feature with minimal required fields", async () => {
      const result = await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.features.create).toHaveBeenCalledWith({
        data: {
          title: "Test Feature",
          brief: null,
          requirements: null,
          architecture: null,
          personas: [],
          workspaceId: mockWorkspaceId,
          status: FeatureStatus.BACKLOG,
          priority: FeaturePriority.LOW,
          assigneeId: null,
          isFastTrack: false,
          createdById: mockUserId,
          updatedById: mockUserId,
          phases: {
            create: {
              name: "Phase 1",
              description: null,
              status: "NOT_STARTED",
              order: 0,
            },
          },
        },
        include: {
          assignee: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
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
      vi.mocked(db.users.findFirst).mockResolvedValue(mockAssignee as any);

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

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Complete Feature",
            brief: "Feature brief",
            requirements: "Feature requirements",
            architecture: "Feature architecture",
            personas: ["persona1", "persona2"],
            status: FeatureStatus.PLANNED,
            priority: FeaturePriority.HIGH,
            assigneeId: mockAssigneeId,
          }),
        })
      );
    });

    test("creates feature with isFastTrack: true", async () => {
      vi.mocked(db.features.create).mockResolvedValue({
        ...mockCreatedFeature,
        isFastTrack: true,
      } as any);

      const result = await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
        isFastTrack: true,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isFastTrack: true,
          }),
        })
      );

      expect(result).toEqual(
        expect.objectContaining({
          isFastTrack: true,
        })
      );
    });

    test("defaults isFastTrack to false when omitted", async () => {
      await createFeature(mockUserId, {
        title: "Test Feature",
        workspaceId: mockWorkspaceId,
      });

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isFastTrack: false,
          }),
        })
      );
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

      expect(db.features.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            createdById: mockUserId,
            updatedById: mockUserId,
          }),
        })
      );
    });
  });
});

describe("listFeatures", () => {
  const mockUserId = "user-123";
  const mockWorkspaceId = "workspace-456";
  const mockCreatorId = "creator-789";

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

  const mockFeatures = [
    {
      id: "feature-1",
      title: "Feature 1",
      status: FeatureStatus.BACKLOG,
      priority: FeaturePriority.LOW,
      createdAt: new Date(),
      updatedAt: new Date(),
      assignee: null,
      createdBy: { id: mockCreatorId, name: "Creator", email: "creator@test.com", image: null },
      _count: { userStories: 0, tasks: 0 },
      chatMessages: [],
      phases: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateWorkspaceAccessById).mockResolvedValue(mockWorkspaceAccess as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("assigneeId owner filter (OR logic)", () => {
    const ownerId = "owner-user-001";

    test("uses OR logic: returns features where user is explicit assignee OR creator with no assignee", async () => {
      vi.mocked(db.features.findMany).mockResolvedValue(mockFeatures as any);
      vi.mocked(db.features.count).mockResolvedValue(1);

      await listFeatures({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        assigneeId: ownerId,
      });

      expect(db.features.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: mockWorkspaceId,
            deleted: false,
            OR: [
              { assigneeId: ownerId },
              { assigneeId: null, createdById: ownerId },
            ],
          }),
        })
      );
    });

    test("does NOT set direct assigneeId on where clause when a specific user is passed", async () => {
      vi.mocked(db.features.findMany).mockResolvedValue(mockFeatures as any);
      vi.mocked(db.features.count).mockResolvedValue(1);

      await listFeatures({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        assigneeId: ownerId,
      });

      const callArgs = vi.mocked(db.features.findMany).mock.calls[0]?.[0];
      expect(callArgs?.where).not.toHaveProperty("assigneeId");
      expect(callArgs?.where).toHaveProperty("OR");
    });

    test("UNASSIGNED still sets assigneeId = null directly (no OR)", async () => {
      vi.mocked(db.features.findMany).mockResolvedValue(mockFeatures as any);
      vi.mocked(db.features.count).mockResolvedValue(1);

      await listFeatures({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        assigneeId: "UNASSIGNED",
      });

      expect(db.features.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: mockWorkspaceId,
            deleted: false,
            assigneeId: null,
          }),
        })
      );

      const callArgs = vi.mocked(db.features.findMany).mock.calls[0]?.[0];
      expect(callArgs?.where).not.toHaveProperty("OR");
    });

    test("no assigneeId param → no OR and no assigneeId filter applied", async () => {
      vi.mocked(db.features.findMany).mockResolvedValue(mockFeatures as any);
      vi.mocked(db.features.count).mockResolvedValue(1);

      await listFeatures({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
      });

      const callArgs = vi.mocked(db.features.findMany).mock.calls[0]?.[0];
      expect(callArgs?.where).not.toHaveProperty("OR");
      expect(callArgs?.where).not.toHaveProperty("assigneeId");
    });

    test("OR filter combines correctly with status filter", async () => {
      vi.mocked(db.features.findMany).mockResolvedValue(mockFeatures as any);
      vi.mocked(db.features.count).mockResolvedValue(1);

      await listFeatures({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        assigneeId: ownerId,
        statuses: [FeatureStatus.BACKLOG],
      });

      expect(db.features.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: mockWorkspaceId,
            deleted: false,
            status: { in: [FeatureStatus.BACKLOG] },
            OR: [
              { assigneeId: ownerId },
              { assigneeId: null, createdById: ownerId },
            ],
          }),
        })
      );
    });

    test("OR filter combines correctly with priority filter", async () => {
      vi.mocked(db.features.findMany).mockResolvedValue(mockFeatures as any);
      vi.mocked(db.features.count).mockResolvedValue(1);

      await listFeatures({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        assigneeId: ownerId,
        priorities: [FeaturePriority.HIGH],
      });

      expect(db.features.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: mockWorkspaceId,
            deleted: false,
            priority: { in: [FeaturePriority.HIGH] },
            OR: [
              { assigneeId: ownerId },
              { assigneeId: null, createdById: ownerId },
            ],
          }),
        })
      );
    });

    test("OR filter combines correctly with search filter", async () => {
      vi.mocked(db.features.findMany).mockResolvedValue(mockFeatures as any);
      vi.mocked(db.features.count).mockResolvedValue(1);

      await listFeatures({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        assigneeId: ownerId,
        search: "auth",
      });

      expect(db.features.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: mockWorkspaceId,
            deleted: false,
            title: { contains: "auth", mode: "insensitive" },
            OR: [
              { assigneeId: ownerId },
              { assigneeId: null, createdById: ownerId },
            ],
          }),
        })
      );
    });

    test("respects pagination with OR owner filter", async () => {
      vi.mocked(db.features.findMany).mockResolvedValue(mockFeatures as any);
      vi.mocked(db.features.count).mockResolvedValue(25);

      await listFeatures({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        assigneeId: ownerId,
        page: 2,
        limit: 10,
      });

      expect(db.features.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { assigneeId: ownerId },
              { assigneeId: null, createdById: ownerId },
            ],
          }),
          skip: 10,
          take: 10,
        })
      );
    });
  });

  describe("access validation", () => {
    test("throws error when user does not have workspace access", async () => {
      vi.mocked(validateWorkspaceAccessById).mockResolvedValue({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });

      await expect(
        listFeatures({
          workspaceId: mockWorkspaceId,
          userId: mockUserId,
        })
      ).rejects.toThrow("Access denied");

      expect(validateWorkspaceAccessById).toHaveBeenCalledWith(
        mockWorkspaceId,
        mockUserId
      );
    });

    test("allows listing when user has workspace access", async () => {
      vi.mocked(db.features.findMany).mockResolvedValue(mockFeatures as any);
      vi.mocked(db.features.count).mockResolvedValue(1);

      await listFeatures({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
      });

      expect(validateWorkspaceAccessById).toHaveBeenCalledWith(
        mockWorkspaceId,
        mockUserId
      );
      expect(db.features.findMany).toHaveBeenCalled();
    });
  });
});

describe("updateFeature - planUpdatedAt", () => {
  const mockFeatureId = "feature-123";
  const mockUserId = "user-123";
  const mockWorkspaceId = "workspace-123";

  const mockFeature = {
    id: mockFeatureId,
    title: "Test Feature",
    workspaceId: mockWorkspaceId,
    createdById: mockUserId,
    brief: null,
    requirements: null,
    architecture: null,
    personas: null,
    status: "PLANNED",
    priority: "MEDIUM",
    assigneeId: null,
    systemAssigneeId: null,
    deleted: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    planUpdatedAt: null,
    workspace: {
      id: mockWorkspaceId,
      ownerId: mockUserId,
      deleted: false,
      members: [{ role: "OWNER" }],
    },
  };

  const mockUpdatedFeature = {
    ...mockFeature,
    assignee: null,
    systemAssignee: null,
    userStories: [],
    phases: [],
    tasks: [],
    createdBy: {
      id: mockUserId,
      name: "Test User",
      email: "test@example.com",
    },
    updatedBy: {
      id: mockUserId,
      name: "Test User",
      email: "test@example.com",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateWorkspaceAccessById).mockResolvedValue({
      hasAccess: true,
      canRead: true,
      canWrite: true,
      canAdmin: false,
    });
    vi.mocked(db.features.findUnique).mockResolvedValue(mockFeature as any);
  });

  describe("plan field updates", () => {
    test("stamps planUpdatedAt when updating brief", async () => {
      vi.mocked(db.features.update).mockResolvedValue(mockUpdatedFeature as any);

      await updateFeature(mockFeatureId, mockUserId, { brief: "Updated brief" });

      expect(db.features.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockFeatureId },
          data: expect.objectContaining({
            brief: "Updated brief",
            planUpdatedAt: expect.any(Date),
          }),
        })
      );
    });

    test("stamps planUpdatedAt when updating requirements", async () => {
      vi.mocked(db.features.update).mockResolvedValue(mockUpdatedFeature as any);

      await updateFeature(mockFeatureId, mockUserId, { requirements: "Updated requirements" });

      expect(db.features.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockFeatureId },
          data: expect.objectContaining({
            requirements: "Updated requirements",
            planUpdatedAt: expect.any(Date),
          }),
        })
      );
    });

    test("stamps planUpdatedAt when updating architecture", async () => {
      vi.mocked(db.features.update).mockResolvedValue(mockUpdatedFeature as any);

      await updateFeature(mockFeatureId, mockUserId, { architecture: "Updated architecture" });

      expect(db.features.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockFeatureId },
          data: expect.objectContaining({
            architecture: "Updated architecture",
            planUpdatedAt: expect.any(Date),
          }),
        })
      );
    });

    test("stamps planUpdatedAt when updating multiple plan fields", async () => {
      vi.mocked(db.features.update).mockResolvedValue(mockUpdatedFeature as any);

      await updateFeature(mockFeatureId, mockUserId, {
        brief: "New brief",
        requirements: "New requirements",
      });

      expect(db.features.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockFeatureId },
          data: expect.objectContaining({
            brief: "New brief",
            requirements: "New requirements",
            planUpdatedAt: expect.any(Date),
          }),
        })
      );
    });
  });

  describe("non-plan field updates", () => {
    test("does NOT stamp planUpdatedAt when updating only title", async () => {
      vi.mocked(db.features.update).mockResolvedValue(mockUpdatedFeature as any);

      await updateFeature(mockFeatureId, mockUserId, { title: "New Title" });

      expect(db.features.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockFeatureId },
          data: expect.objectContaining({
            title: "New Title",
          }),
        })
      );

      const updateCall = vi.mocked(db.features.update).mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty("planUpdatedAt");
    });

    test("does NOT stamp planUpdatedAt when updating only status", async () => {
      vi.mocked(db.features.update).mockResolvedValue(mockUpdatedFeature as any);

      await updateFeature(mockFeatureId, mockUserId, { status: "IN_PROGRESS" });

      expect(db.features.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockFeatureId },
          data: expect.objectContaining({
            status: "IN_PROGRESS",
          }),
        })
      );

      const updateCall = vi.mocked(db.features.update).mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty("planUpdatedAt");
    });

    test("does NOT stamp planUpdatedAt when updating only priority", async () => {
      vi.mocked(db.features.update).mockResolvedValue(mockUpdatedFeature as any);

      await updateFeature(mockFeatureId, mockUserId, { priority: "HIGH" });

      expect(db.features.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockFeatureId },
          data: expect.objectContaining({
            priority: "HIGH",
          }),
        })
      );

      const updateCall = vi.mocked(db.features.update).mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty("planUpdatedAt");
    });

    test("does NOT stamp planUpdatedAt when updating only assigneeId", async () => {
      const assigneeUser = {
        id: "user-456",
        name: "New Assignee",
        email: "assignee@example.com",
        deleted: false,
      };
      
      vi.mocked(db.users.findFirst).mockResolvedValue(assigneeUser as any);
      vi.mocked(db.features.update).mockResolvedValue(mockUpdatedFeature as any);

      await updateFeature(mockFeatureId, mockUserId, { assigneeId: "user-456" });

      expect(db.features.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockFeatureId },
        })
      );

      const updateCall = vi.mocked(db.features.update).mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty("planUpdatedAt");
    });
  });

  describe("mixed updates", () => {
    test("stamps planUpdatedAt when updating plan field along with non-plan fields", async () => {
      vi.mocked(db.features.update).mockResolvedValue(mockUpdatedFeature as any);

      await updateFeature(mockFeatureId, mockUserId, {
        brief: "Updated brief",
        status: "IN_PROGRESS",
        priority: "HIGH",
      });

      expect(db.features.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockFeatureId },
          data: expect.objectContaining({
            brief: "Updated brief",
            status: "IN_PROGRESS",
            priority: "HIGH",
            planUpdatedAt: expect.any(Date),
          }),
        })
      );
    });

    test("stamps planUpdatedAt when updating architecture with title", async () => {
      vi.mocked(db.features.update).mockResolvedValue(mockUpdatedFeature as any);

      await updateFeature(mockFeatureId, mockUserId, {
        title: "New Title",
        architecture: "New Architecture",
      });

      expect(db.features.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockFeatureId },
          data: expect.objectContaining({
            title: "New Title",
            architecture: "New Architecture",
            planUpdatedAt: expect.any(Date),
          }),
        })
      );
    });
  });
});
