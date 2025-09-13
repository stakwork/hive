import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { processJanitorWebhook } from "@/services/janitor";
import { db } from "@/lib/db";
import { JANITOR_ERRORS } from "@/lib/constants/janitor";
import { pusherServer, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { StakworkWebhookPayload } from "@/types/janitor";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    janitorRun: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    janitorRecommendation: {
      createMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock Pusher
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  getWorkspaceChannelName: vi.fn(),
  PUSHER_EVENTS: {
    RECOMMENDATIONS_UPDATED: "recommendations-updated",
  },
}));

const mockDb = vi.mocked(db);
const mockPusherServer = vi.mocked(pusherServer);
const mockGetWorkspaceChannelName = vi.mocked(getWorkspaceChannelName);

describe("processJanitorWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe("completed webhook processing", () => {
    const mockCompletedWebhookData: StakworkWebhookPayload = {
      projectId: "project-123",
      status: "completed",
      results: {
        recommendations: [
          {
            title: "Fix memory leak in user service",
            description: "Memory usage increases over time due to unclosed connections",
            priority: "high",
            impact: "Performance degradation",
            metadata: {
              file: "user-service.ts",
              line: 45,
            },
          },
          {
            title: "Add input validation",
            description: "Missing validation for email field",
            priority: "medium",
            impact: "Security vulnerability",
            metadata: {
              field: "email",
              endpoint: "/api/users",
            },
          },
        ],
      },
    };

    const mockJanitorRun = {
      id: "run-123",
      janitorType: "SECURITY_AUDIT",
      metadata: { originalData: "test" },
      janitorConfig: {
        workspace: {
          id: "workspace-123",
          slug: "test-workspace",
        },
      },
    };

    test("should successfully process completed webhook with recommendations", async () => {
      // Mock updateMany to simulate successful update
      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      
      // Mock findFirst to return janitor run
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      
      // Mock transaction
      mockDb.$transaction.mockImplementation(async (callback) => {
        return callback(mockDb);
      });
      
      // Mock update for metadata
      mockDb.janitorRun.update.mockResolvedValue(mockJanitorRun);
      
      // Mock createMany for recommendations
      mockDb.janitorRecommendation.createMany.mockResolvedValue({ count: 2 });
      
      // Mock count for Pusher event
      mockDb.janitorRecommendation.count.mockResolvedValue(5);
      
      // Mock Pusher functions
      mockGetWorkspaceChannelName.mockReturnValue("workspace-test-workspace");
      mockPusherServer.trigger.mockResolvedValue(undefined);

      const result = await processJanitorWebhook(mockCompletedWebhookData);

      // Verify database operations
      expect(mockDb.janitorRun.updateMany).toHaveBeenCalledWith({
        where: {
          stakworkProjectId: "project-123",
          status: { in: ["PENDING", "RUNNING"] },
        },
        data: {
          status: "COMPLETED",
          completedAt: expect.any(Date),
        },
      });

      expect(mockDb.janitorRun.findFirst).toHaveBeenCalledWith({
        where: {
          stakworkProjectId: "project-123",
          status: "COMPLETED",
        },
        include: {
          janitorConfig: {
            include: {
              workspace: {
                include: {
                  swarm: {
                    select: {
                      swarmUrl: true,
                      swarmSecretAlias: true,
                      poolName: true,
                      name: true,
                      id: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      });

      // Verify transaction was called
      expect(mockDb.$transaction).toHaveBeenCalledTimes(1);

      // Verify recommendations were created
      expect(mockDb.janitorRecommendation.createMany).toHaveBeenCalledWith({
        data: [
          {
            janitorRunId: "run-123",
            title: "Fix memory leak in user service",
            description: "Memory usage increases over time due to unclosed connections",
            priority: "HIGH",
            impact: "Performance degradation",
            status: "PENDING",
            metadata: {
              file: "user-service.ts",
              line: 45,
              source: "stakwork_webhook",
              janitorType: "SECURITY_AUDIT",
              workspaceId: "workspace-123",
            },
          },
          {
            janitorRunId: "run-123",
            title: "Add input validation",
            description: "Missing validation for email field",
            priority: "MEDIUM",
            impact: "Security vulnerability",
            status: "PENDING",
            metadata: {
              field: "email",
              endpoint: "/api/users",
              source: "stakwork_webhook",
              janitorType: "SECURITY_AUDIT",
              workspaceId: "workspace-123",
            },
          },
        ],
      });

      // Verify Pusher event
      expect(mockGetWorkspaceChannelName).toHaveBeenCalledWith("test-workspace");
      expect(mockPusherServer.trigger).toHaveBeenCalledWith(
        "workspace-test-workspace",
        "recommendations-updated",
        {
          workspaceSlug: "test-workspace",
          newRecommendationCount: 2,
          totalRecommendationCount: 5,
          timestamp: expect.any(Date),
        }
      );

      // Verify return value
      expect(result).toEqual({
        runId: "run-123",
        status: "COMPLETED",
        recommendationCount: 2,
      });
    });

    test("should handle completed webhook with no recommendations", async () => {
      const noRecommendationsPayload: StakworkWebhookPayload = {
        projectId: "project-123",
        status: "completed",
        results: {
          recommendations: [],
        },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      mockDb.$transaction.mockImplementation(async (callback) => {
        return callback(mockDb);
      });

      const result = await processJanitorWebhook(noRecommendationsPayload);

      expect(mockDb.janitorRecommendation.createMany).not.toHaveBeenCalled();
      expect(mockPusherServer.trigger).not.toHaveBeenCalled();
      expect(result.recommendationCount).toBe(0);
    });

    test("should handle invalid priority values gracefully", async () => {
      const invalidPriorityPayload: StakworkWebhookPayload = {
        projectId: "project-123",
        status: "completed",
        results: {
          recommendations: [
            {
              title: "Test recommendation",
              description: "Test description",
              priority: "invalid-priority",
              impact: "Test impact",
              metadata: {},
            },
          ],
        },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      mockDb.$transaction.mockImplementation(async (callback) => {
        return callback(mockDb);
      });
      mockDb.janitorRecommendation.createMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRecommendation.count.mockResolvedValue(1);
      mockGetWorkspaceChannelName.mockReturnValue("workspace-test-workspace");
      mockPusherServer.trigger.mockResolvedValue(undefined);

      await processJanitorWebhook(invalidPriorityPayload);

      expect(mockDb.janitorRecommendation.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            priority: "MEDIUM", // Should default to MEDIUM for invalid priority
          }),
        ],
      });
    });

    test("should handle Pusher error gracefully", async () => {
      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      mockDb.$transaction.mockImplementation(async (callback) => {
        return callback(mockDb);
      });
      mockDb.janitorRecommendation.createMany.mockResolvedValue({ count: 2 });
      mockDb.janitorRecommendation.count.mockResolvedValue(5);
      mockGetWorkspaceChannelName.mockReturnValue("workspace-test-workspace");
      mockPusherServer.trigger.mockRejectedValue(new Error("Pusher connection failed"));

      // Should not throw error even if Pusher fails
      const result = await processJanitorWebhook(mockCompletedWebhookData);

      expect(result).toEqual({
        runId: "run-123",
        status: "COMPLETED",
        recommendationCount: 2,
      });
    });

    test("should throw error when no janitor run found for completed webhook", async () => {
      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 0 });

      await expect(processJanitorWebhook(mockCompletedWebhookData)).rejects.toThrow(
        JANITOR_ERRORS.RUN_NOT_FOUND
      );
    });
  });

  describe("failed webhook processing", () => {
    const mockFailedWebhookData: StakworkWebhookPayload = {
      projectId: "project-456",
      status: "failed",
      error: "Stakwork processing failed",
    };

    const mockFailedJanitorRun = {
      id: "run-456",
      metadata: { originalData: "test" },
      janitorConfig: {
        workspace: {
          id: "workspace-456",
          slug: "failed-workspace",
        },
      },
    };

    test("should successfully process failed webhook", async () => {
      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockFailedJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(mockFailedJanitorRun);

      const result = await processJanitorWebhook(mockFailedWebhookData);

      expect(mockDb.janitorRun.updateMany).toHaveBeenCalledWith({
        where: {
          stakworkProjectId: "project-456",
          status: { in: ["PENDING", "RUNNING"] },
        },
        data: {
          status: "FAILED",
          completedAt: expect.any(Date),
          error: "Stakwork processing failed",
        },
      });

      expect(mockDb.janitorRun.update).toHaveBeenCalledWith({
        where: { id: "run-456" },
        data: {
          metadata: {
            originalData: "test",
            stakworkStatus: "failed",
            failedByWebhook: true,
          },
        },
      });

      expect(result).toEqual({
        runId: "run-456",
        status: "FAILED",
        error: "Stakwork processing failed",
      });
    });

    test("should handle failed webhook with status-based error message", async () => {
      const statusFailedPayload: StakworkWebhookPayload = {
        projectId: "project-456",
        status: "error",
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockFailedJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(mockFailedJanitorRun);

      const result = await processJanitorWebhook(statusFailedPayload);

      expect(mockDb.janitorRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            error: "Stakwork project failed with status: error",
          }),
        })
      );

      expect(result).toEqual({
        runId: "run-456",
        status: "FAILED",
        error: "error",
      });
    });

    test("should handle failed webhook when janitor run not found", async () => {
      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(null);

      const result = await processJanitorWebhook(mockFailedWebhookData);

      expect(result).toEqual({
        runId: "",
        status: "FAILED",
        error: "Stakwork processing failed",
      });
    });

    test("should throw error when no active runs found for failed webhook", async () => {
      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 0 });

      await expect(processJanitorWebhook(mockFailedWebhookData)).rejects.toThrow(
        JANITOR_ERRORS.RUN_NOT_FOUND
      );
    });
  });

  describe("running webhook processing", () => {
    const mockRunningWebhookData: StakworkWebhookPayload = {
      projectId: "project-789",
      status: "running",
    };

    const mockRunningJanitorRun = {
      id: "run-789",
      metadata: { originalData: "test" },
    };

    test("should successfully process running webhook", async () => {
      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockRunningJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(mockRunningJanitorRun);

      const result = await processJanitorWebhook(mockRunningWebhookData);

      expect(mockDb.janitorRun.updateMany).toHaveBeenCalledWith({
        where: {
          stakworkProjectId: "project-789",
          status: { in: ["PENDING", "RUNNING"] },
        },
        data: {
          status: "RUNNING",
          startedAt: expect.any(Date),
        },
      });

      expect(mockDb.janitorRun.update).toHaveBeenCalledWith({
        where: { id: "run-789" },
        data: {
          metadata: {
            originalData: "test",
            stakworkStatus: "running",
            lastWebhookUpdate: expect.any(Date),
          },
        },
      });

      expect(result).toEqual({
        runId: "run-789",
        status: "RUNNING",
      });
    });

    test("should handle running webhook when janitor run not found", async () => {
      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(null);

      const result = await processJanitorWebhook(mockRunningWebhookData);

      expect(result).toEqual({
        runId: "",
        status: "RUNNING",
      });
    });

    test("should throw error when no active runs found for running webhook", async () => {
      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 0 });

      await expect(processJanitorWebhook(mockRunningWebhookData)).rejects.toThrow(
        JANITOR_ERRORS.RUN_NOT_FOUND
      );
    });
  });

  describe("status case handling", () => {
    test("should handle case-insensitive completed status", async () => {
      const uppercaseCompletedPayload: StakworkWebhookPayload = {
        projectId: "project-123",
        status: "COMPLETED",
        results: { recommendations: [] },
      };

      const mockJanitorRun = {
        id: "run-123",
        janitorType: "SECURITY_AUDIT",
        metadata: {},
        janitorConfig: { workspace: { id: "workspace-123", slug: "test-workspace" } },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      mockDb.$transaction.mockImplementation(async (callback) => {
        return callback(mockDb);
      });

      const result = await processJanitorWebhook(uppercaseCompletedPayload);

      expect(result.status).toBe("COMPLETED");
    });

    test("should handle case-insensitive success status", async () => {
      const successPayload: StakworkWebhookPayload = {
        projectId: "project-123",
        status: "success",
        results: { recommendations: [] },
      };

      const mockJanitorRun = {
        id: "run-123",
        janitorType: "SECURITY_AUDIT",
        metadata: {},
        janitorConfig: { workspace: { id: "workspace-123", slug: "test-workspace" } },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      mockDb.$transaction.mockImplementation(async (callback) => {
        return callback(mockDb);
      });

      const result = await processJanitorWebhook(successPayload);

      expect(result.status).toBe("COMPLETED");
    });

    test("should handle case-insensitive failed statuses", async () => {
      const errorPayload: StakworkWebhookPayload = {
        projectId: "project-456",
        status: "ERROR",
      };

      const mockJanitorRun = {
        id: "run-456",
        metadata: {},
        janitorConfig: { workspace: { id: "workspace-456", slug: "failed-workspace" } },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(mockJanitorRun);

      const result = await processJanitorWebhook(errorPayload);

      expect(result.status).toBe("FAILED");
    });
  });

  describe("database error handling", () => {
    test("should handle database transaction errors", async () => {
      const webhookData: StakworkWebhookPayload = {
        projectId: "project-123",
        status: "completed",
        results: { recommendations: [] },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue({
        id: "run-123",
        janitorType: "SECURITY_AUDIT",
        metadata: {},
        janitorConfig: { workspace: { id: "workspace-123", slug: "test-workspace" } },
      });
      
      // Mock transaction to throw error
      mockDb.$transaction.mockRejectedValue(new Error("Database transaction failed"));

      await expect(processJanitorWebhook(webhookData)).rejects.toThrow("Database transaction failed");
    });

    test("should handle updateMany database errors", async () => {
      const webhookData: StakworkWebhookPayload = {
        projectId: "project-123",
        status: "completed",
        results: { recommendations: [] },
      };

      mockDb.janitorRun.updateMany.mockRejectedValue(new Error("Database connection failed"));

      await expect(processJanitorWebhook(webhookData)).rejects.toThrow("Database connection failed");
    });
  });
});