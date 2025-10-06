import { describe, test, expect, beforeEach, vi, Mock } from "vitest";
import { acceptJanitorRecommendation } from "@/services/janitor";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { createTaskWithStakworkWorkflow } from "@/services/task-workflow";
import { JANITOR_ERRORS } from "@/lib/constants/janitor";
import { Priority } from "@prisma/client";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    janitorRecommendation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    workspaceMember: {
      findFirst: vi.fn(),
    },
    repository: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

vi.mock("@/services/task-workflow", () => ({
  createTaskWithStakworkWorkflow: vi.fn(),
}));

describe("acceptJanitorRecommendation", () => {
  const mockRecommendationId = "rec-123";
  const mockUserId = "user-456";
  const mockWorkspaceId = "ws-789";
  const mockWorkspaceSlug = "test-workspace";

  const mockRecommendation = {
    id: mockRecommendationId,
    title: "Add unit tests for UserService",
    description: "UserService class lacks unit test coverage",
    priority: "HIGH" as Priority,
    status: "PENDING",
    metadata: {},
    janitorRun: {
      id: "run-123",
      janitorConfig: {
        id: "config-123",
        workspace: {
          id: mockWorkspaceId,
          slug: mockWorkspaceSlug,
          name: "Test Workspace",
          ownerId: "owner-123",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    },
  };

  const mockValidWorkspaceAccess = {
    hasAccess: true,
    canRead: true,
    canWrite: true,
    canAdmin: false,
    userRole: "DEVELOPER",
    workspace: {
      id: mockWorkspaceId,
      name: "Test Workspace",
      description: null,
      slug: mockWorkspaceSlug,
      ownerId: "owner-123",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const mockUpdatedRecommendation = {
    ...mockRecommendation,
    status: "ACCEPTED",
    acceptedAt: new Date(),
    acceptedById: mockUserId,
  };

  const mockTask = {
    id: "task-123",
    title: "Add unit tests for UserService",
    description: "UserService class lacks unit test coverage",
    workspaceId: mockWorkspaceId,
    status: "TODO",
    priority: "HIGH",
    sourceType: "JANITOR",
    createdById: mockUserId,
  };

  const mockStakworkResult = {
    success: true,
    data: { project_id: 12345 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Happy Path", () => {
    test("should successfully accept recommendation without optional parameters", async () => {
      // Setup mocks
      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        mockRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );
      (db.janitorRecommendation.update as Mock).mockResolvedValue(
        mockUpdatedRecommendation
      );
      (createTaskWithStakworkWorkflow as Mock).mockResolvedValue({
        task: mockTask,
        stakworkResult: mockStakworkResult,
        chatMessage: { id: "msg-123" },
      });

      // Execute
      const result = await acceptJanitorRecommendation(
        mockRecommendationId,
        mockUserId
      );

      // Verify database calls
      expect(db.janitorRecommendation.findUnique).toHaveBeenCalledWith({
        where: { id: mockRecommendationId },
        include: {
          janitorRun: {
            include: {
              janitorConfig: {
                include: {
                  workspace: true,
                },
              },
            },
          },
        },
      });

      // Verify permission check
      expect(validateWorkspaceAccess).toHaveBeenCalledWith(
        mockWorkspaceSlug,
        mockUserId
      );

      // Verify recommendation update
      expect(db.janitorRecommendation.update).toHaveBeenCalledWith({
        where: { id: mockRecommendationId },
        data: {
          status: "ACCEPTED",
          acceptedAt: expect.any(Date),
          acceptedById: mockUserId,
          metadata: {
            assigneeId: undefined,
            repositoryId: undefined,
          },
        },
      });

      // Verify task creation with workflow
      expect(createTaskWithStakworkWorkflow).toHaveBeenCalledWith({
        title: mockRecommendation.title,
        description: mockRecommendation.description,
        workspaceId: mockWorkspaceId,
        assigneeId: undefined,
        repositoryId: undefined,
        priority: mockRecommendation.priority,
        sourceType: "JANITOR",
        userId: mockUserId,
        initialMessage: expect.stringContaining(mockRecommendation.title),
        mode: "live",
      });

      // Verify return value
      expect(result).toEqual({
        recommendation: mockUpdatedRecommendation,
        task: mockTask,
        workflow: mockStakworkResult,
      });
    });

    test("should successfully accept recommendation with assigneeId", async () => {
      const assigneeId = "assignee-123";

      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        mockRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );
      (db.workspaceMember.findFirst as Mock).mockResolvedValue({
        id: "member-123",
        userId: assigneeId,
        workspaceId: mockWorkspaceId,
      });
      (db.janitorRecommendation.update as Mock).mockResolvedValue(
        mockUpdatedRecommendation
      );
      (createTaskWithStakworkWorkflow as Mock).mockResolvedValue({
        task: mockTask,
        stakworkResult: mockStakworkResult,
        chatMessage: { id: "msg-123" },
      });

      const result = await acceptJanitorRecommendation(
        mockRecommendationId,
        mockUserId,
        { assigneeId }
      );

      // Verify assignee validation
      expect(db.workspaceMember.findFirst).toHaveBeenCalledWith({
        where: {
          userId: assigneeId,
          workspaceId: mockWorkspaceId,
        },
      });

      // Verify metadata includes assigneeId
      expect(db.janitorRecommendation.update).toHaveBeenCalledWith({
        where: { id: mockRecommendationId },
        data: expect.objectContaining({
          metadata: {
            assigneeId,
            repositoryId: undefined,
          },
        }),
      });

      // Verify task creation includes assigneeId
      expect(createTaskWithStakworkWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          assigneeId,
        })
      );

      expect(result.task).toEqual(mockTask);
    });

    test("should successfully accept recommendation with repositoryId", async () => {
      const repositoryId = "repo-123";

      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        mockRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );
      (db.repository.findFirst as Mock).mockResolvedValue({
        id: repositoryId,
        workspaceId: mockWorkspaceId,
        name: "test-repo",
      });
      (db.janitorRecommendation.update as Mock).mockResolvedValue(
        mockUpdatedRecommendation
      );
      (createTaskWithStakworkWorkflow as Mock).mockResolvedValue({
        task: mockTask,
        stakworkResult: mockStakworkResult,
        chatMessage: { id: "msg-123" },
      });

      const result = await acceptJanitorRecommendation(
        mockRecommendationId,
        mockUserId,
        { repositoryId }
      );

      // Verify repository validation
      expect(db.repository.findFirst).toHaveBeenCalledWith({
        where: {
          id: repositoryId,
          workspaceId: mockWorkspaceId,
        },
      });

      // Verify metadata includes repositoryId
      expect(db.janitorRecommendation.update).toHaveBeenCalledWith({
        where: { id: mockRecommendationId },
        data: expect.objectContaining({
          metadata: {
            assigneeId: undefined,
            repositoryId,
          },
        }),
      });

      // Verify task creation includes repositoryId
      expect(createTaskWithStakworkWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryId,
        })
      );

      expect(result.task).toEqual(mockTask);
    });

    test("should successfully accept recommendation with both assigneeId and repositoryId", async () => {
      const assigneeId = "assignee-123";
      const repositoryId = "repo-123";

      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        mockRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );
      (db.workspaceMember.findFirst as Mock).mockResolvedValue({
        id: "member-123",
        userId: assigneeId,
        workspaceId: mockWorkspaceId,
      });
      (db.repository.findFirst as Mock).mockResolvedValue({
        id: repositoryId,
        workspaceId: mockWorkspaceId,
        name: "test-repo",
      });
      (db.janitorRecommendation.update as Mock).mockResolvedValue(
        mockUpdatedRecommendation
      );
      (createTaskWithStakworkWorkflow as Mock).mockResolvedValue({
        task: mockTask,
        stakworkResult: mockStakworkResult,
        chatMessage: { id: "msg-123" },
      });

      const result = await acceptJanitorRecommendation(
        mockRecommendationId,
        mockUserId,
        { assigneeId, repositoryId }
      );

      // Verify both validations occurred
      expect(db.workspaceMember.findFirst).toHaveBeenCalledWith({
        where: {
          userId: assigneeId,
          workspaceId: mockWorkspaceId,
        },
      });
      expect(db.repository.findFirst).toHaveBeenCalledWith({
        where: {
          id: repositoryId,
          workspaceId: mockWorkspaceId,
        },
      });

      // Verify metadata includes both
      expect(db.janitorRecommendation.update).toHaveBeenCalledWith({
        where: { id: mockRecommendationId },
        data: expect.objectContaining({
          metadata: {
            assigneeId,
            repositoryId,
          },
        }),
      });

      // Verify task creation includes both
      expect(createTaskWithStakworkWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          assigneeId,
          repositoryId,
        })
      );

      expect(result.task).toEqual(mockTask);
    });
  });

  describe("Error Scenarios", () => {
    test("should throw RECOMMENDATION_NOT_FOUND when recommendation does not exist", async () => {
      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(null);

      await expect(
        acceptJanitorRecommendation(mockRecommendationId, mockUserId)
      ).rejects.toThrow(JANITOR_ERRORS.RECOMMENDATION_NOT_FOUND);

      expect(db.janitorRecommendation.findUnique).toHaveBeenCalledOnce();
      expect(validateWorkspaceAccess).not.toHaveBeenCalled();
      expect(db.janitorRecommendation.update).not.toHaveBeenCalled();
    });

    test("should throw INSUFFICIENT_PERMISSIONS when user has no workspace access", async () => {
      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        mockRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });

      await expect(
        acceptJanitorRecommendation(mockRecommendationId, mockUserId)
      ).rejects.toThrow(JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS);

      expect(validateWorkspaceAccess).toHaveBeenCalledWith(
        mockWorkspaceSlug,
        mockUserId
      );
      expect(db.janitorRecommendation.update).not.toHaveBeenCalled();
    });

    test("should throw INSUFFICIENT_PERMISSIONS when user has no write permission", async () => {
      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        mockRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: false,
        canAdmin: false,
      });

      await expect(
        acceptJanitorRecommendation(mockRecommendationId, mockUserId)
      ).rejects.toThrow(JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS);

      expect(validateWorkspaceAccess).toHaveBeenCalledWith(
        mockWorkspaceSlug,
        mockUserId
      );
      expect(db.janitorRecommendation.update).not.toHaveBeenCalled();
    });

    test("should throw RECOMMENDATION_ALREADY_PROCESSED when status is ACCEPTED", async () => {
      const acceptedRecommendation = {
        ...mockRecommendation,
        status: "ACCEPTED",
      };

      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        acceptedRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );

      await expect(
        acceptJanitorRecommendation(mockRecommendationId, mockUserId)
      ).rejects.toThrow(JANITOR_ERRORS.RECOMMENDATION_ALREADY_PROCESSED);

      expect(db.janitorRecommendation.update).not.toHaveBeenCalled();
      expect(createTaskWithStakworkWorkflow).not.toHaveBeenCalled();
    });

    test("should throw RECOMMENDATION_ALREADY_PROCESSED when status is DISMISSED", async () => {
      const dismissedRecommendation = {
        ...mockRecommendation,
        status: "DISMISSED",
      };

      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        dismissedRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );

      await expect(
        acceptJanitorRecommendation(mockRecommendationId, mockUserId)
      ).rejects.toThrow(JANITOR_ERRORS.RECOMMENDATION_ALREADY_PROCESSED);

      expect(db.janitorRecommendation.update).not.toHaveBeenCalled();
      expect(createTaskWithStakworkWorkflow).not.toHaveBeenCalled();
    });

    test("should throw ASSIGNEE_NOT_MEMBER when assigneeId is not a workspace member", async () => {
      const assigneeId = "invalid-assignee";

      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        mockRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );
      (db.workspaceMember.findFirst as Mock).mockResolvedValue(null);

      await expect(
        acceptJanitorRecommendation(mockRecommendationId, mockUserId, {
          assigneeId,
        })
      ).rejects.toThrow(JANITOR_ERRORS.ASSIGNEE_NOT_MEMBER);

      expect(db.workspaceMember.findFirst).toHaveBeenCalledWith({
        where: {
          userId: assigneeId,
          workspaceId: mockWorkspaceId,
        },
      });
      expect(db.janitorRecommendation.update).not.toHaveBeenCalled();
    });

    test("should throw REPOSITORY_NOT_FOUND when repositoryId does not belong to workspace", async () => {
      const repositoryId = "invalid-repo";

      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        mockRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );
      (db.repository.findFirst as Mock).mockResolvedValue(null);

      await expect(
        acceptJanitorRecommendation(mockRecommendationId, mockUserId, {
          repositoryId,
        })
      ).rejects.toThrow(JANITOR_ERRORS.REPOSITORY_NOT_FOUND);

      expect(db.repository.findFirst).toHaveBeenCalledWith({
        where: {
          id: repositoryId,
          workspaceId: mockWorkspaceId,
        },
      });
      expect(db.janitorRecommendation.update).not.toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty options object", async () => {
      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        mockRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );
      (db.janitorRecommendation.update as Mock).mockResolvedValue(
        mockUpdatedRecommendation
      );
      (createTaskWithStakworkWorkflow as Mock).mockResolvedValue({
        task: mockTask,
        stakworkResult: mockStakworkResult,
        chatMessage: { id: "msg-123" },
      });

      const result = await acceptJanitorRecommendation(
        mockRecommendationId,
        mockUserId,
        {}
      );

      expect(result).toBeDefined();
      expect(db.workspaceMember.findFirst).not.toHaveBeenCalled();
      expect(db.repository.findFirst).not.toHaveBeenCalled();
    });

    test("should preserve existing metadata when updating recommendation", async () => {
      const recommendationWithMetadata = {
        ...mockRecommendation,
        metadata: {
          existingKey: "existingValue",
          anotherKey: 123,
        },
      };

      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        recommendationWithMetadata
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );
      (db.janitorRecommendation.update as Mock).mockResolvedValue(
        mockUpdatedRecommendation
      );
      (createTaskWithStakworkWorkflow as Mock).mockResolvedValue({
        task: mockTask,
        stakworkResult: mockStakworkResult,
        chatMessage: { id: "msg-123" },
      });

      await acceptJanitorRecommendation(mockRecommendationId, mockUserId);

      expect(db.janitorRecommendation.update).toHaveBeenCalledWith({
        where: { id: mockRecommendationId },
        data: expect.objectContaining({
          metadata: {
            existingKey: "existingValue",
            anotherKey: 123,
            assigneeId: undefined,
            repositoryId: undefined,
          },
        }),
      });
    });

    test("should validate assigneeId before repositoryId", async () => {
      const assigneeId = "invalid-assignee";
      const repositoryId = "repo-123";

      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        mockRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );
      (db.workspaceMember.findFirst as Mock).mockResolvedValue(null);

      await expect(
        acceptJanitorRecommendation(mockRecommendationId, mockUserId, {
          assigneeId,
          repositoryId,
        })
      ).rejects.toThrow(JANITOR_ERRORS.ASSIGNEE_NOT_MEMBER);

      expect(db.workspaceMember.findFirst).toHaveBeenCalled();
      expect(db.repository.findFirst).not.toHaveBeenCalled();
    });

    test("should construct correct initial message for Stakwork workflow", async () => {
      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        mockRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );
      (db.janitorRecommendation.update as Mock).mockResolvedValue(
        mockUpdatedRecommendation
      );
      (createTaskWithStakworkWorkflow as Mock).mockResolvedValue({
        task: mockTask,
        stakworkResult: mockStakworkResult,
        chatMessage: { id: "msg-123" },
      });

      await acceptJanitorRecommendation(mockRecommendationId, mockUserId);

      expect(createTaskWithStakworkWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          initialMessage: expect.stringContaining(mockRecommendation.title),
        })
      );

      const callArgs = (createTaskWithStakworkWorkflow as Mock).mock
        .calls[0][0];
      expect(callArgs.initialMessage).toContain(mockRecommendation.title);
      expect(callArgs.initialMessage).toContain(mockRecommendation.description);
    });

    test("should set mode to 'live' for Stakwork workflow", async () => {
      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        mockRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );
      (db.janitorRecommendation.update as Mock).mockResolvedValue(
        mockUpdatedRecommendation
      );
      (createTaskWithStakworkWorkflow as Mock).mockResolvedValue({
        task: mockTask,
        stakworkResult: mockStakworkResult,
        chatMessage: { id: "msg-123" },
      });

      await acceptJanitorRecommendation(mockRecommendationId, mockUserId);

      expect(createTaskWithStakworkWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "live",
        })
      );
    });

    test("should set sourceType to JANITOR for created task", async () => {
      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        mockRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );
      (db.janitorRecommendation.update as Mock).mockResolvedValue(
        mockUpdatedRecommendation
      );
      (createTaskWithStakworkWorkflow as Mock).mockResolvedValue({
        task: mockTask,
        stakworkResult: mockStakworkResult,
        chatMessage: { id: "msg-123" },
      });

      await acceptJanitorRecommendation(mockRecommendationId, mockUserId);

      expect(createTaskWithStakworkWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: "JANITOR",
        })
      );
    });
  });

  describe("Data Integrity", () => {
    test("should verify nested includes are requested for recommendation", async () => {
      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        mockRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );
      (db.janitorRecommendation.update as Mock).mockResolvedValue(
        mockUpdatedRecommendation
      );
      (createTaskWithStakworkWorkflow as Mock).mockResolvedValue({
        task: mockTask,
        stakworkResult: mockStakworkResult,
        chatMessage: { id: "msg-123" },
      });

      await acceptJanitorRecommendation(mockRecommendationId, mockUserId);

      const findUniqueCall = (db.janitorRecommendation.findUnique as Mock).mock
        .calls[0][0];
      expect(findUniqueCall.include).toBeDefined();
      expect(findUniqueCall.include.janitorRun).toBeDefined();
      expect(findUniqueCall.include.janitorRun.include).toBeDefined();
      expect(
        findUniqueCall.include.janitorRun.include.janitorConfig
      ).toBeDefined();
      expect(
        findUniqueCall.include.janitorRun.include.janitorConfig.include
          .workspace
      ).toBe(true);
    });

    test("should set acceptedAt timestamp when updating recommendation", async () => {
      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        mockRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );
      (db.janitorRecommendation.update as Mock).mockResolvedValue(
        mockUpdatedRecommendation
      );
      (createTaskWithStakworkWorkflow as Mock).mockResolvedValue({
        task: mockTask,
        stakworkResult: mockStakworkResult,
        chatMessage: { id: "msg-123" },
      });

      const beforeTimestamp = new Date();
      await acceptJanitorRecommendation(mockRecommendationId, mockUserId);
      const afterTimestamp = new Date();

      const updateCall = (db.janitorRecommendation.update as Mock).mock
        .calls[0][0];
      const acceptedAt = updateCall.data.acceptedAt;

      expect(acceptedAt).toBeInstanceOf(Date);
      expect(acceptedAt.getTime()).toBeGreaterThanOrEqual(
        beforeTimestamp.getTime()
      );
      expect(acceptedAt.getTime()).toBeLessThanOrEqual(
        afterTimestamp.getTime()
      );
    });

    test("should set acceptedById to requesting user", async () => {
      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        mockRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );
      (db.janitorRecommendation.update as Mock).mockResolvedValue(
        mockUpdatedRecommendation
      );
      (createTaskWithStakworkWorkflow as Mock).mockResolvedValue({
        task: mockTask,
        stakworkResult: mockStakworkResult,
        chatMessage: { id: "msg-123" },
      });

      await acceptJanitorRecommendation(mockRecommendationId, mockUserId);

      expect(db.janitorRecommendation.update).toHaveBeenCalledWith({
        where: { id: mockRecommendationId },
        data: expect.objectContaining({
          acceptedById: mockUserId,
        }),
      });
    });

    test("should pass correct priority from recommendation to task", async () => {
      const highPriorityRecommendation = {
        ...mockRecommendation,
        priority: "CRITICAL" as Priority,
      };

      (db.janitorRecommendation.findUnique as Mock).mockResolvedValue(
        highPriorityRecommendation
      );
      (validateWorkspaceAccess as Mock).mockResolvedValue(
        mockValidWorkspaceAccess
      );
      (db.janitorRecommendation.update as Mock).mockResolvedValue(
        mockUpdatedRecommendation
      );
      (createTaskWithStakworkWorkflow as Mock).mockResolvedValue({
        task: mockTask,
        stakworkResult: mockStakworkResult,
        chatMessage: { id: "msg-123" },
      });

      await acceptJanitorRecommendation(mockRecommendationId, mockUserId);

      expect(createTaskWithStakworkWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: "CRITICAL",
        })
      );
    });
  });
});