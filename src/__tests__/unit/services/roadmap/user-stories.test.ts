import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock dependencies before imports
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
    },
    userStory: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/services/roadmap/utils", () => ({
  validateFeatureAccess: vi.fn(),
  calculateNextOrder: vi.fn(),
}));

// Import after mocks
import { createUserStory } from "@/services/roadmap/user-stories";
import { validateFeatureAccess, calculateNextOrder } from "@/services/roadmap/utils";
import { db } from "@/lib/db";

const mockedDb = vi.mocked(db);
const mockedValidateFeatureAccess = vi.mocked(validateFeatureAccess);
const mockedCalculateNextOrder = vi.mocked(calculateNextOrder);

describe("createUserStory", () => {
  const mockUserId = "user-123";
  const mockFeatureId = "feature-456";
  const mockWorkspaceId = "workspace-789";

  const mockUser = {
    id: mockUserId,
    name: "Test User",
    email: "test@example.com",
    emailVerified: null,
    image: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  };

  const mockFeature = {
    id: mockFeatureId,
    workspaceId: mockWorkspaceId,
    workspace: {
      id: mockWorkspaceId,
      ownerId: mockUserId,
      deleted: false,
      members: [],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("successful user story creation", () => {
    test("should create user story with valid data", async () => {
      const mockUserStory = {
        id: "story-001",
        title: "User can login",
        order: 0,
        completed: false,
        featureId: mockFeatureId,
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date("2024-01-15"),
        updatedAt: new Date("2024-01-15"),
        createdBy: {
          id: mockUserId,
          name: "Test User",
          email: "test@example.com",
          image: null,
        },
        updatedBy: {
          id: mockUserId,
          name: "Test User",
          email: "test@example.com",
          image: null,
        },
        feature: {
          id: mockFeatureId,
          title: "Authentication",
          workspaceId: mockWorkspaceId,
        },
      };

      mockedValidateFeatureAccess.mockResolvedValue(mockFeature as any);
      mockedCalculateNextOrder.mockResolvedValue(0);
      mockedDb.user.findUnique.mockResolvedValue(mockUser);
      mockedDb.userStory.create.mockResolvedValue(mockUserStory as any);

      const result = await createUserStory(mockFeatureId, mockUserId, {
        title: "User can login",
      });

      expect(result).toEqual(mockUserStory);
      expect(mockedValidateFeatureAccess).toHaveBeenCalledWith(mockFeatureId, mockUserId);
      expect(mockedCalculateNextOrder).toHaveBeenCalledWith(db.userStory, {
        featureId: mockFeatureId,
      });
      expect(mockedDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockUserId },
      });
      expect(mockedDb.userStory.create).toHaveBeenCalledWith({
        data: {
          title: "User can login",
          featureId: mockFeatureId,
          order: 0,
          completed: false,
          createdById: mockUserId,
          updatedById: mockUserId,
        },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          updatedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          feature: {
            select: {
              id: true,
              title: true,
              workspaceId: true,
            },
          },
        },
      });
    });

    test("should trim whitespace from title", async () => {
      const mockUserStory = {
        id: "story-002",
        title: "User can logout",
        order: 1,
        completed: false,
        featureId: mockFeatureId,
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date("2024-01-15"),
        updatedAt: new Date("2024-01-15"),
        createdBy: {
          id: mockUserId,
          name: "Test User",
          email: "test@example.com",
          image: null,
        },
        updatedBy: {
          id: mockUserId,
          name: "Test User",
          email: "test@example.com",
          image: null,
        },
        feature: {
          id: mockFeatureId,
          title: "Authentication",
          workspaceId: mockWorkspaceId,
        },
      };

      mockedValidateFeatureAccess.mockResolvedValue(mockFeature as any);
      mockedCalculateNextOrder.mockResolvedValue(1);
      mockedDb.user.findUnique.mockResolvedValue(mockUser);
      mockedDb.userStory.create.mockResolvedValue(mockUserStory as any);

      await createUserStory(mockFeatureId, mockUserId, {
        title: "  User can logout  ",
      });

      expect(mockedDb.userStory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "User can logout",
          }),
        })
      );
    });

    test("should set audit fields correctly", async () => {
      const mockUserStory = {
        id: "story-003",
        title: "User can reset password",
        order: 2,
        completed: false,
        featureId: mockFeatureId,
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date("2024-01-15"),
        updatedAt: new Date("2024-01-15"),
        createdBy: {
          id: mockUserId,
          name: "Test User",
          email: "test@example.com",
          image: null,
        },
        updatedBy: {
          id: mockUserId,
          name: "Test User",
          email: "test@example.com",
          image: null,
        },
        feature: {
          id: mockFeatureId,
          title: "Authentication",
          workspaceId: mockWorkspaceId,
        },
      };

      mockedValidateFeatureAccess.mockResolvedValue(mockFeature as any);
      mockedCalculateNextOrder.mockResolvedValue(2);
      mockedDb.user.findUnique.mockResolvedValue(mockUser);
      mockedDb.userStory.create.mockResolvedValue(mockUserStory as any);

      await createUserStory(mockFeatureId, mockUserId, {
        title: "User can reset password",
      });

      expect(mockedDb.userStory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            createdById: mockUserId,
            updatedById: mockUserId,
          }),
        })
      );
    });

    test("should use calculated order value", async () => {
      const mockUserStory = {
        id: "story-004",
        title: "User can view profile",
        order: 5,
        completed: false,
        featureId: mockFeatureId,
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date("2024-01-15"),
        updatedAt: new Date("2024-01-15"),
        createdBy: {
          id: mockUserId,
          name: "Test User",
          email: "test@example.com",
          image: null,
        },
        updatedBy: {
          id: mockUserId,
          name: "Test User",
          email: "test@example.com",
          image: null,
        },
        feature: {
          id: mockFeatureId,
          title: "User Profile",
          workspaceId: mockWorkspaceId,
        },
      };

      mockedValidateFeatureAccess.mockResolvedValue(mockFeature as any);
      mockedCalculateNextOrder.mockResolvedValue(5);
      mockedDb.user.findUnique.mockResolvedValue(mockUser);
      mockedDb.userStory.create.mockResolvedValue(mockUserStory as any);

      await createUserStory(mockFeatureId, mockUserId, {
        title: "User can view profile",
      });

      expect(mockedCalculateNextOrder).toHaveBeenCalledWith(db.userStory, {
        featureId: mockFeatureId,
      });
      expect(mockedDb.userStory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            order: 5,
          }),
        })
      );
    });
  });

  describe("title validation", () => {
    test("should throw error when title is missing", async () => {
      mockedValidateFeatureAccess.mockResolvedValue(mockFeature as any);

      await expect(
        createUserStory(mockFeatureId, mockUserId, {} as any)
      ).rejects.toThrow("Missing required field: title");

      expect(mockedCalculateNextOrder).not.toHaveBeenCalled();
      expect(mockedDb.user.findUnique).not.toHaveBeenCalled();
      expect(mockedDb.userStory.create).not.toHaveBeenCalled();
    });

    test("should throw error when title is empty string", async () => {
      mockedValidateFeatureAccess.mockResolvedValue(mockFeature as any);

      await expect(
        createUserStory(mockFeatureId, mockUserId, { title: "" })
      ).rejects.toThrow("Missing required field: title");
    });

    test("should throw error when title is only whitespace", async () => {
      mockedValidateFeatureAccess.mockResolvedValue(mockFeature as any);

      await expect(
        createUserStory(mockFeatureId, mockUserId, { title: "   " })
      ).rejects.toThrow("Missing required field: title");
    });

    test("should throw error when title is not a string", async () => {
      mockedValidateFeatureAccess.mockResolvedValue(mockFeature as any);

      await expect(
        createUserStory(mockFeatureId, mockUserId, { title: 123 as any })
      ).rejects.toThrow("Missing required field: title");

      await expect(
        createUserStory(mockFeatureId, mockUserId, { title: null as any })
      ).rejects.toThrow("Missing required field: title");

      await expect(
        createUserStory(mockFeatureId, mockUserId, { title: undefined as any })
      ).rejects.toThrow("Missing required field: title");
    });
  });

  describe("user validation", () => {
    test("should throw error when user not found", async () => {
      mockedValidateFeatureAccess.mockResolvedValue(mockFeature as any);
      mockedCalculateNextOrder.mockResolvedValue(0);
      mockedDb.user.findUnique.mockResolvedValue(null);

      await expect(
        createUserStory(mockFeatureId, mockUserId, { title: "Valid title" })
      ).rejects.toThrow("User not found");

      expect(mockedDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockUserId },
      });
      expect(mockedDb.userStory.create).not.toHaveBeenCalled();
    });

    test("should validate user exists before creating story", async () => {
      mockedValidateFeatureAccess.mockResolvedValue(mockFeature as any);
      mockedCalculateNextOrder.mockResolvedValue(0);
      mockedDb.user.findUnique.mockResolvedValue(mockUser);
      mockedDb.userStory.create.mockResolvedValue({
        id: "story-005",
        title: "Test story",
        order: 0,
        completed: false,
        featureId: mockFeatureId,
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: mockUser as any,
        updatedBy: mockUser as any,
        feature: {
          id: mockFeatureId,
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
        },
      } as any);

      await createUserStory(mockFeatureId, mockUserId, { title: "Test story" });

      expect(mockedDb.user.findUnique).toHaveBeenCalledBefore(
        mockedDb.userStory.create as any
      );
    });
  });

  describe("access control", () => {
    test("should validate feature access before creation", async () => {
      mockedValidateFeatureAccess.mockResolvedValue(mockFeature as any);
      mockedCalculateNextOrder.mockResolvedValue(0);
      mockedDb.user.findUnique.mockResolvedValue(mockUser);
      mockedDb.userStory.create.mockResolvedValue({
        id: "story-006",
        title: "Test story",
        order: 0,
        completed: false,
        featureId: mockFeatureId,
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: mockUser as any,
        updatedBy: mockUser as any,
        feature: {
          id: mockFeatureId,
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
        },
      } as any);

      await createUserStory(mockFeatureId, mockUserId, { title: "Test story" });

      expect(mockedValidateFeatureAccess).toHaveBeenCalledWith(
        mockFeatureId,
        mockUserId
      );
      expect(mockedValidateFeatureAccess).toHaveBeenCalledBefore(
        mockedDb.userStory.create as any
      );
    });

    test("should throw error when feature not found", async () => {
      mockedValidateFeatureAccess.mockRejectedValue(new Error("Feature not found"));

      await expect(
        createUserStory(mockFeatureId, mockUserId, { title: "Valid title" })
      ).rejects.toThrow("Feature not found");

      expect(mockedCalculateNextOrder).not.toHaveBeenCalled();
      expect(mockedDb.user.findUnique).not.toHaveBeenCalled();
      expect(mockedDb.userStory.create).not.toHaveBeenCalled();
    });

    test("should throw error when access denied", async () => {
      mockedValidateFeatureAccess.mockRejectedValue(new Error("Access denied"));

      await expect(
        createUserStory(mockFeatureId, mockUserId, { title: "Valid title" })
      ).rejects.toThrow("Access denied");

      expect(mockedCalculateNextOrder).not.toHaveBeenCalled();
      expect(mockedDb.user.findUnique).not.toHaveBeenCalled();
      expect(mockedDb.userStory.create).not.toHaveBeenCalled();
    });
  });

  describe("order calculation", () => {
    test("should calculate order for feature", async () => {
      mockedValidateFeatureAccess.mockResolvedValue(mockFeature as any);
      mockedCalculateNextOrder.mockResolvedValue(3);
      mockedDb.user.findUnique.mockResolvedValue(mockUser);
      mockedDb.userStory.create.mockResolvedValue({
        id: "story-007",
        title: "Test story",
        order: 3,
        completed: false,
        featureId: mockFeatureId,
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: mockUser as any,
        updatedBy: mockUser as any,
        feature: {
          id: mockFeatureId,
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
        },
      } as any);

      await createUserStory(mockFeatureId, mockUserId, { title: "Test story" });

      expect(mockedCalculateNextOrder).toHaveBeenCalledWith(db.userStory, {
        featureId: mockFeatureId,
      });
    });

    test("should use order 0 for first story in feature", async () => {
      mockedValidateFeatureAccess.mockResolvedValue(mockFeature as any);
      mockedCalculateNextOrder.mockResolvedValue(0);
      mockedDb.user.findUnique.mockResolvedValue(mockUser);
      mockedDb.userStory.create.mockResolvedValue({
        id: "story-008",
        title: "First story",
        order: 0,
        completed: false,
        featureId: mockFeatureId,
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: mockUser as any,
        updatedBy: mockUser as any,
        feature: {
          id: mockFeatureId,
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
        },
      } as any);

      await createUserStory(mockFeatureId, mockUserId, { title: "First story" });

      expect(mockedDb.userStory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            order: 0,
          }),
        })
      );
    });
  });

  describe("database operations", () => {
    test("should include all required relations in create", async () => {
      const mockUserStory = {
        id: "story-009",
        title: "Story with relations",
        order: 0,
        completed: false,
        featureId: mockFeatureId,
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: {
          id: mockUserId,
          name: "Test User",
          email: "test@example.com",
          image: null,
        },
        updatedBy: {
          id: mockUserId,
          name: "Test User",
          email: "test@example.com",
          image: null,
        },
        feature: {
          id: mockFeatureId,
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
        },
      };

      mockedValidateFeatureAccess.mockResolvedValue(mockFeature as any);
      mockedCalculateNextOrder.mockResolvedValue(0);
      mockedDb.user.findUnique.mockResolvedValue(mockUser);
      mockedDb.userStory.create.mockResolvedValue(mockUserStory as any);

      const result = await createUserStory(mockFeatureId, mockUserId, {
        title: "Story with relations",
      });

      expect(result.createdBy).toBeDefined();
      expect(result.updatedBy).toBeDefined();
      expect(result.feature).toBeDefined();
      expect(result.createdBy.id).toBe(mockUserId);
      expect(result.updatedBy.id).toBe(mockUserId);
      expect(result.feature.id).toBe(mockFeatureId);
    });

    test("should set completed to false by default", async () => {
      mockedValidateFeatureAccess.mockResolvedValue(mockFeature as any);
      mockedCalculateNextOrder.mockResolvedValue(0);
      mockedDb.user.findUnique.mockResolvedValue(mockUser);
      mockedDb.userStory.create.mockResolvedValue({
        id: "story-010",
        title: "New story",
        order: 0,
        completed: false,
        featureId: mockFeatureId,
        createdById: mockUserId,
        updatedById: mockUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: mockUser as any,
        updatedBy: mockUser as any,
        feature: {
          id: mockFeatureId,
          title: "Test Feature",
          workspaceId: mockWorkspaceId,
        },
      } as any);

      await createUserStory(mockFeatureId, mockUserId, { title: "New story" });

      expect(mockedDb.userStory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            completed: false,
          }),
        })
      );
    });
  });
});