import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";
import {
  createUserStory,
  updateUserStory,
  deleteUserStory,
  reorderUserStories,
} from "@/services/roadmap/user-stories";

vi.mock("@/lib/db", () => ({
  db: {
    feature: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    userStory: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    workspaceMember: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe("User Stories Service - planUpdatedAt", () => {
  const mockFeature = {
    id: "feature-123",
    workspaceId: "workspace-123",
    title: "Test Feature",
    createdById: "user-123",
    workspace: {
      id: "workspace-123",
      ownerId: "user-123",
      deleted: false,
      members: [{ role: "OWNER" }],
    },
  };

  const mockUserStory = {
    id: "story-123",
    featureId: "feature-123",
    title: "Test Story",
    order: 0,
    completed: false,
    createdById: "user-123",
    updatedById: "user-123",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockWorkspaceMember = {
    userId: "user-123",
    workspaceId: "workspace-123",
    role: "OWNER",
  };

  const mockUser = {
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createUserStory", () => {
    it("should stamp planUpdatedAt when creating a user story", async () => {
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature as any);
      vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(mockWorkspaceMember as any);
      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as any);
      // Mock calculateNextOrder's findFirst call
      vi.mocked(db.userStory.findFirst).mockResolvedValue({ order: 0 } as any);
      vi.mocked(db.userStory.create).mockResolvedValue({
        ...mockUserStory,
        createdBy: mockUser,
        updatedBy: mockUser,
        feature: mockFeature,
      } as any);
      vi.mocked(db.feature.update).mockResolvedValue({} as any);

      await createUserStory("feature-123", "user-123", { title: "New Story" });

      expect(db.feature.update).toHaveBeenCalledWith({
        where: { id: "feature-123" },
        data: { planUpdatedAt: expect.any(Date) },
      });
    });
  });

  describe("updateUserStory", () => {
    it("should stamp planUpdatedAt when updating story title", async () => {
      vi.mocked(db.userStory.findUnique).mockResolvedValue({
        ...mockUserStory,
        feature: mockFeature,
      } as any);
      vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(mockWorkspaceMember as any);
      vi.mocked(db.userStory.update).mockResolvedValue({
        ...mockUserStory,
        title: "Updated Title",
        createdBy: mockUser,
        updatedBy: mockUser,
        feature: mockFeature,
      } as any);
      vi.mocked(db.feature.update).mockResolvedValue({} as any);

      await updateUserStory("story-123", "user-123", { title: "Updated Title" });

      expect(db.feature.update).toHaveBeenCalledWith({
        where: { id: "feature-123" },
        data: { planUpdatedAt: expect.any(Date) },
      });
    });

    it("should stamp planUpdatedAt when updating story completed status", async () => {
      vi.mocked(db.userStory.findUnique).mockResolvedValue({
        ...mockUserStory,
        feature: mockFeature,
      } as any);
      vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(mockWorkspaceMember as any);
      vi.mocked(db.userStory.update).mockResolvedValue({
        ...mockUserStory,
        completed: true,
        createdBy: mockUser,
        updatedBy: mockUser,
        feature: mockFeature,
      } as any);
      vi.mocked(db.feature.update).mockResolvedValue({} as any);

      await updateUserStory("story-123", "user-123", { completed: true });

      expect(db.feature.update).toHaveBeenCalledWith({
        where: { id: "feature-123" },
        data: { planUpdatedAt: expect.any(Date) },
      });
    });

    it("should stamp planUpdatedAt when updating both title and completed", async () => {
      vi.mocked(db.userStory.findUnique).mockResolvedValue({
        ...mockUserStory,
        feature: mockFeature,
      } as any);
      vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(mockWorkspaceMember as any);
      vi.mocked(db.userStory.update).mockResolvedValue({
        ...mockUserStory,
        title: "Updated Title",
        completed: true,
        createdBy: mockUser,
        updatedBy: mockUser,
        feature: mockFeature,
      } as any);
      vi.mocked(db.feature.update).mockResolvedValue({} as any);

      await updateUserStory("story-123", "user-123", {
        title: "Updated Title",
        completed: true,
      });

      expect(db.feature.update).toHaveBeenCalledWith({
        where: { id: "feature-123" },
        data: { planUpdatedAt: expect.any(Date) },
      });
    });

    it("should NOT stamp planUpdatedAt when updating only order", async () => {
      vi.mocked(db.userStory.findUnique).mockResolvedValue({
        ...mockUserStory,
        feature: mockFeature,
      } as any);
      vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(mockWorkspaceMember as any);
      vi.mocked(db.userStory.update).mockResolvedValue({
        ...mockUserStory,
        order: 5,
        createdBy: mockUser,
        updatedBy: mockUser,
        feature: mockFeature,
      } as any);

      await updateUserStory("story-123", "user-123", { order: 5 });

      expect(db.feature.update).not.toHaveBeenCalled();
    });

    it("should stamp planUpdatedAt when updating title along with order", async () => {
      vi.mocked(db.userStory.findUnique).mockResolvedValue({
        ...mockUserStory,
        feature: mockFeature,
      } as any);
      vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(mockWorkspaceMember as any);
      vi.mocked(db.userStory.update).mockResolvedValue({
        ...mockUserStory,
        title: "Updated Title",
        order: 5,
        createdBy: mockUser,
        updatedBy: mockUser,
        feature: mockFeature,
      } as any);
      vi.mocked(db.feature.update).mockResolvedValue({} as any);

      await updateUserStory("story-123", "user-123", {
        title: "Updated Title",
        order: 5,
      });

      expect(db.feature.update).toHaveBeenCalledWith({
        where: { id: "feature-123" },
        data: { planUpdatedAt: expect.any(Date) },
      });
    });
  });

  describe("deleteUserStory", () => {
    it("should stamp planUpdatedAt when deleting a user story", async () => {
      vi.mocked(db.userStory.findUnique).mockResolvedValue({
        ...mockUserStory,
        feature: mockFeature,
      } as any);
      vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(mockWorkspaceMember as any);
      vi.mocked(db.userStory.delete).mockResolvedValue(mockUserStory as any);
      vi.mocked(db.feature.update).mockResolvedValue({} as any);

      await deleteUserStory("story-123", "user-123");

      expect(db.feature.update).toHaveBeenCalledWith({
        where: { id: "feature-123" },
        data: { planUpdatedAt: expect.any(Date) },
      });
    });
  });

  describe("reorderUserStories", () => {
    it("should NOT stamp planUpdatedAt when reordering stories", async () => {
      vi.mocked(db.feature.findUnique).mockResolvedValue(mockFeature as any);
      vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(mockWorkspaceMember as any);
      vi.mocked(db.$transaction).mockResolvedValue([]);
      vi.mocked(db.userStory.findMany).mockResolvedValue([
        {
          ...mockUserStory,
          createdBy: mockUser,
          updatedBy: mockUser,
        },
      ] as any);

      await reorderUserStories("feature-123", "user-123", [
        { id: "story-123", order: 0 },
        { id: "story-456", order: 1 },
      ]);

      // Verify feature.update was NOT called (planUpdatedAt should not be stamped)
      expect(db.feature.update).not.toHaveBeenCalled();
    });
  });
});
