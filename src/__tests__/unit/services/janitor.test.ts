import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { processJanitorWebhook } from "@/services/janitor";
import { db } from "@/lib/db";
import { pusherServer, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { JANITOR_ERRORS } from "@/lib/constants/janitor";
import { JanitorStatus, RecommendationStatus, Priority } from "@prisma/client";
import type { StakworkWebhookPayload } from "@/types/janitor";

// Mock all external dependencies
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
  }
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  getWorkspaceChannelName: vi.fn(),
  PUSHER_EVENTS: {
    RECOMMENDATIONS_UPDATED: "recommendations-updated",
  }
}));

vi.mock("@/lib/constants/janitor", () => ({
  JANITOR_ERRORS: {
    RUN_NOT_FOUND: "Janitor run not found",
  }
}));

// Create typed mocks
const mockDb = db as {
  janitorRun: {
    updateMany: Mock;
    findFirst: Mock;
    update: Mock;
  };
  janitorRecommendation: {
    createMany: Mock;
    count: Mock;
  };
  $transaction: Mock;
};

const mockPusher = pusherServer as {
  trigger: Mock;
};

const mockChannelName = getWorkspaceChannelName as Mock;
const mockEvents = PUSHER_EVENTS as {
  RECOMMENDATIONS_UPDATED: string;
};

describe("processJanitorWebhook", () => {
  // Mock data templates
  const mockProjectId = 12345;
  const mockRunId = "run-123";
  const mockWorkspaceId = "workspace-123";
  const mockWorkspaceSlug = "test-workspace";

  const mockJanitorRun = {
    id: mockRunId,
    stakworkProjectId: mockProjectId,
    status: "COMPLETED" as JanitorStatus,
    janitorType: "UNIT_TESTS",
    metadata: {},
    janitorConfig: {
      workspace: {
        id: mockWorkspaceId,
        slug: mockWorkspaceSlug,
        swarm: {
          swarmUrl: "https://test-swarm.com",
          swarmSecretAlias: "test-secret",
          poolName: "test-pool",
          name: "Test Swarm",
          id: "swarm-123",
        },
      },
    },
  };

  const mockRecommendations = [
    {
      title: "Add unit tests for UserService",
      description: "The UserService class lacks comprehensive unit test coverage",
      priority: "HIGH",
      impact: "Improves code reliability and maintainability",
      metadata: { complexity: "medium" },
    },
    {
      title: "Refactor authentication middleware",
      description: "Current auth middleware has multiple responsibilities",
      priority: "MEDIUM",
      impact: "Better separation of concerns",
      metadata: { technical_debt: true },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mock implementations
    mockDb.$transaction = vi.fn().mockImplementation(async (callback) => {
      return await callback(mockDb);
    });
    
    mockChannelName.mockReturnValue(`workspace-${mockWorkspaceSlug}`);
    mockPusher.trigger = vi.fn().mockResolvedValue(true);
  });

  describe("Successful webhook processing (COMPLETED status)", () => {
    test("should successfully process completed webhook with recommendations", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "completed",
        results: {
          recommendations: mockRecommendations,
        },
      };

      // Mock database operations
      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRecommendation.createMany.mockResolvedValue({ count: 2 });
      mockDb.janitorRecommendation.count.mockResolvedValue(5);

      const result = await processJanitorWebhook(webhookPayload);

      // Verify updateMany was called with correct parameters
      expect(mockDb.janitorRun.updateMany).toHaveBeenCalledWith({
        where: {
          stakworkProjectId: mockProjectId,
          status: { in: ["PENDING", "RUNNING"] }
        },
        data: {
          status: "COMPLETED",
          completedAt: expect.any(Date),
        }
      });

      // Verify findFirst to get the updated run
      expect(mockDb.janitorRun.findFirst).toHaveBeenCalledWith({
        where: {
          stakworkProjectId: mockProjectId,
          status: "COMPLETED"
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
                    }
                  }
                }
              }
            }
          }
        },
        orderBy: { updatedAt: "desc" }
      });

      // Verify transaction was executed
      expect(mockDb.$transaction).toHaveBeenCalled();

      // Verify Pusher event was triggered
      expect(mockPusher.trigger).toHaveBeenCalledWith(
        `workspace-${mockWorkspaceSlug}`,
        mockEvents.RECOMMENDATIONS_UPDATED,
        {
          workspaceSlug: mockWorkspaceSlug,
          newRecommendationCount: 2,
          totalRecommendationCount: 5,
          timestamp: expect.any(Date),
        }
      );

      // Verify return value
      expect(result).toEqual({
        runId: mockRunId,
        status: "COMPLETED",
        recommendationCount: 2,
      });
    });

    test("should handle completed webhook with no recommendations", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "success", // Alternative success status
        results: {
          recommendations: [],
        },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(mockJanitorRun);

      const result = await processJanitorWebhook(webhookPayload);

      // Verify no recommendations were created
      expect(mockDb.janitorRecommendation.createMany).not.toHaveBeenCalled();
      
      // Verify no Pusher event for empty recommendations
      expect(mockPusher.trigger).not.toHaveBeenCalled();

      expect(result).toEqual({
        runId: mockRunId,
        status: "COMPLETED",
        recommendationCount: 0,
      });
    });

    test("should handle completed webhook without results object", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "completed",
        // No results property
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(mockJanitorRun);

      const result = await processJanitorWebhook(webhookPayload);

      expect(mockDb.janitorRecommendation.createMany).not.toHaveBeenCalled();
      expect(mockPusher.trigger).not.toHaveBeenCalled();

      expect(result).toEqual({
        runId: mockRunId,
        status: "COMPLETED",
        recommendationCount: 0,
      });
    });
  });

  describe("Failed webhook processing", () => {
    test("should successfully process failed webhook", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "failed",
        error: "Stakwork processing failed due to timeout",
      };

      const failedJanitorRun = {
        ...mockJanitorRun,
        status: "FAILED" as JanitorStatus,
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(failedJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(failedJanitorRun);

      const result = await processJanitorWebhook(webhookPayload);

      // Verify updateMany with failed status
      expect(mockDb.janitorRun.updateMany).toHaveBeenCalledWith({
        where: {
          stakworkProjectId: mockProjectId,
          status: { in: ["PENDING", "RUNNING"] }
        },
        data: {
          status: "FAILED",
          completedAt: expect.any(Date),
          error: "Stakwork processing failed due to timeout",
        }
      });

      // Verify metadata update
      expect(mockDb.janitorRun.update).toHaveBeenCalledWith({
        where: { id: mockRunId },
        data: {
          metadata: {
            stakworkStatus: "failed",
            failedByWebhook: true,
          }
        }
      });

      // Verify no Pusher event for failed runs
      expect(mockPusher.trigger).not.toHaveBeenCalled();

      expect(result).toEqual({
        runId: mockRunId,
        status: "FAILED",
        error: "Stakwork processing failed due to timeout",
      });
    });

    test("should handle error status without error message", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "error", // Alternative error status
        // No error message
      };

      const failedJanitorRun = { ...mockJanitorRun, status: "FAILED" as JanitorStatus };
      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(failedJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(failedJanitorRun);

      const result = await processJanitorWebhook(webhookPayload);

      expect(mockDb.janitorRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            error: "Stakwork project failed with status: error",
          })
        })
      );

      expect(result).toEqual({
        runId: mockRunId,
        status: "FAILED",
        error: "error",
      });
    });
  });

  describe("Running status webhook processing", () => {
    test("should successfully process running status webhook", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "in_progress",
      };

      const runningJanitorRun = {
        ...mockJanitorRun,
        status: "RUNNING" as JanitorStatus,
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(runningJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(runningJanitorRun);

      const result = await processJanitorWebhook(webhookPayload);

      // Verify updateMany with running status
      expect(mockDb.janitorRun.updateMany).toHaveBeenCalledWith({
        where: {
          stakworkProjectId: mockProjectId,
          status: { in: ["PENDING", "RUNNING"] }
        },
        data: {
          status: "RUNNING",
          startedAt: expect.any(Date),
        }
      });

      // Verify metadata update
      expect(mockDb.janitorRun.update).toHaveBeenCalledWith({
        where: { id: mockRunId },
        data: {
          metadata: {
            stakworkStatus: "in_progress",
            lastWebhookUpdate: expect.any(Date),
          }
        }
      });

      expect(result).toEqual({
        runId: mockRunId,
        status: "RUNNING",
      });
    });
  });

  describe("Priority mapping and recommendation creation", () => {
    test("should correctly map recommendation priorities", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "completed",
        results: {
          recommendations: [
            { title: "Critical Issue", description: "Fix now", priority: "CRITICAL" },
            { title: "High Issue", description: "Fix soon", priority: "high" }, // lowercase
            { title: "Medium Issue", description: "Fix eventually", priority: "Medium" }, // mixed case
            { title: "Low Issue", description: "Maybe fix", priority: "low" },
            { title: "Invalid Priority", description: "Default priority", priority: "invalid" },
            { title: "No Priority", description: "Default priority" }, // no priority field
          ],
        },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRecommendation.createMany.mockResolvedValue({ count: 6 });
      mockDb.janitorRecommendation.count.mockResolvedValue(6);

      await processJanitorWebhook(webhookPayload);

      // Verify recommendations were created with correct priority mapping
      expect(mockDb.janitorRecommendation.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ priority: "CRITICAL" }),
          expect.objectContaining({ priority: "HIGH" }),
          expect.objectContaining({ priority: "MEDIUM" }),
          expect.objectContaining({ priority: "LOW" }),
          expect.objectContaining({ priority: "MEDIUM" }), // Invalid maps to MEDIUM
          expect.objectContaining({ priority: "MEDIUM" }), // Missing maps to MEDIUM
        ]
      });
    });

    test("should create recommendations with correct metadata", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "completed",
        results: {
          recommendations: [{
            title: "Test Recommendation",
            description: "Test description",
            priority: "HIGH",
            impact: "High impact change",
            metadata: { customField: "customValue" },
          }],
        },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRecommendation.createMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRecommendation.count.mockResolvedValue(1);

      await processJanitorWebhook(webhookPayload);

      expect(mockDb.janitorRecommendation.createMany).toHaveBeenCalledWith({
        data: [{
          janitorRunId: mockRunId,
          title: "Test Recommendation",
          description: "Test description",
          priority: "HIGH",
          impact: "High impact change",
          status: "PENDING",
          metadata: {
            customField: "customValue",
            source: "stakwork_webhook",
            janitorType: mockJanitorRun.janitorType,
            workspaceId: mockWorkspaceId,
          },
        }]
      });
    });
  });

  describe("Error handling and edge cases", () => {
    test("should throw error when no janitor run is found for completed status", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "completed",
      };

      // No rows updated (run not found or already processed)
      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 0 });

      await expect(processJanitorWebhook(webhookPayload)).rejects.toThrow(
        "Janitor run not found"
      );
    });

    test("should throw error when no janitor run is found for failed status", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "failed",
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 0 });

      await expect(processJanitorWebhook(webhookPayload)).rejects.toThrow(
        "Janitor run not found"
      );
    });

    test("should throw error when no janitor run is found for running status", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "in_progress",
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 0 });

      await expect(processJanitorWebhook(webhookPayload)).rejects.toThrow(
        "Janitor run not found"
      );
    });

    test("should handle janitor run not found after updateMany for completed status", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "completed",
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(null); // Run not found

      await expect(processJanitorWebhook(webhookPayload)).rejects.toThrow(
        "Janitor run not found"
      );
    });

    test("should handle database transaction failure", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "completed",
        results: { recommendations: mockRecommendations },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      
      // Mock transaction failure
      const transactionError = new Error("Transaction failed");
      mockDb.$transaction.mockRejectedValue(transactionError);

      await expect(processJanitorWebhook(webhookPayload)).rejects.toThrow(
        "Transaction failed"
      );
    });

    test("should handle Pusher trigger failure gracefully", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "completed",
        results: { recommendations: mockRecommendations },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRecommendation.createMany.mockResolvedValue({ count: 2 });
      mockDb.janitorRecommendation.count.mockResolvedValue(2);
      
      // Mock Pusher failure
      mockPusher.trigger.mockRejectedValue(new Error("Pusher connection failed"));

      // Should not throw error - Pusher failures are handled gracefully
      const result = await processJanitorWebhook(webhookPayload);

      expect(result).toEqual({
        runId: mockRunId,
        status: "COMPLETED",
        recommendationCount: 2,
      });
    });

    test("should handle missing workspace in janitor run", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "completed",
        results: { recommendations: [] }, // Empty recommendations to avoid workspace access
      };

      const runWithoutWorkspace = {
        ...mockJanitorRun,
        janitorConfig: {
          workspace: null, // Missing workspace
        },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(runWithoutWorkspace);
      mockDb.janitorRun.update.mockResolvedValue(runWithoutWorkspace);

      // Should not throw when there are no recommendations to process
      const result = await processJanitorWebhook(webhookPayload);
      expect(result.status).toBe("COMPLETED");
    });
  });

  describe("Race condition handling", () => {
    test("should use atomic updateMany to prevent race conditions", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "completed",
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(mockJanitorRun);

      await processJanitorWebhook(webhookPayload);

      // Verify atomic operation with status filter to prevent double processing
      expect(mockDb.janitorRun.updateMany).toHaveBeenCalledWith({
        where: {
          stakworkProjectId: mockProjectId,
          status: { in: ["PENDING", "RUNNING"] }
        },
        data: {
          status: "COMPLETED",
          completedAt: expect.any(Date),
        }
      });
    });

    test("should handle duplicate webhook calls by returning zero count", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "completed",
      };

      // Simulate already processed webhook (no rows updated)
      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 0 });

      await expect(processJanitorWebhook(webhookPayload)).rejects.toThrow(
        "Janitor run not found"
      );

      // Verify only the updateMany was called, not the subsequent operations
      expect(mockDb.janitorRun.findFirst).not.toHaveBeenCalled();
      expect(mockDb.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("Metadata and status tracking", () => {
    test("should update metadata correctly for completed status", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "completed",
      };

      const runWithExistingMetadata = {
        ...mockJanitorRun,
        metadata: { existingField: "existingValue" },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(runWithExistingMetadata);
      mockDb.janitorRun.update.mockResolvedValue(runWithExistingMetadata);

      await processJanitorWebhook(webhookPayload);

      expect(mockDb.janitorRun.update).toHaveBeenCalledWith({
        where: { id: mockRunId },
        data: {
          metadata: {
            existingField: "existingValue", // Preserved existing metadata
            stakworkStatus: "completed",
            completedByWebhook: true,
          }
        }
      });
    });

    test("should update metadata correctly for running status", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "processing",
      };

      const runningJanitorRun = {
        ...mockJanitorRun,
        status: "RUNNING" as JanitorStatus,
        metadata: {},
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(runningJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(runningJanitorRun);

      await processJanitorWebhook(webhookPayload);

      expect(mockDb.janitorRun.update).toHaveBeenCalledWith({
        where: { id: mockRunId },
        data: {
          metadata: {
            stakworkStatus: "processing",
            lastWebhookUpdate: expect.any(Date),
          }
        }
      });
    });

    test("should update metadata correctly for failed status", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "failed",
        error: "Custom error message",
      };

      const failedJanitorRun = {
        ...mockJanitorRun,
        status: "FAILED" as JanitorStatus,
        metadata: { previousField: "value" },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(failedJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(failedJanitorRun);

      await processJanitorWebhook(webhookPayload);

      expect(mockDb.janitorRun.update).toHaveBeenCalledWith({
        where: { id: mockRunId },
        data: {
          metadata: {
            previousField: "value", // Preserved existing metadata
            stakworkStatus: "failed",
            failedByWebhook: true,
          }
        }
      });
    });
  });

  describe("Pusher event handling", () => {
    test("should trigger Pusher event with correct workspace channel name", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "completed",
        results: { recommendations: [mockRecommendations[0]] },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRecommendation.createMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRecommendation.count.mockResolvedValue(3);

      await processJanitorWebhook(webhookPayload);

      expect(mockChannelName).toHaveBeenCalledWith(mockWorkspaceSlug);
      expect(mockPusher.trigger).toHaveBeenCalledWith(
        `workspace-${mockWorkspaceSlug}`,
        mockEvents.RECOMMENDATIONS_UPDATED,
        {
          workspaceSlug: mockWorkspaceSlug,
          newRecommendationCount: 1,
          totalRecommendationCount: 3,
          timestamp: expect.any(Date),
        }
      );
    });

    test("should not trigger Pusher event when no new recommendations", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "completed",
        results: { recommendations: [] },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(mockJanitorRun);

      await processJanitorWebhook(webhookPayload);

      expect(mockPusher.trigger).not.toHaveBeenCalled();
    });

    test("should continue processing despite Pusher error", async () => {
      const webhookPayload: StakworkWebhookPayload = {
        projectId: mockProjectId,
        status: "completed",
        results: { recommendations: [mockRecommendations[0]] },
      };

      mockDb.janitorRun.updateMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRun.findFirst.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRun.update.mockResolvedValue(mockJanitorRun);
      mockDb.janitorRecommendation.createMany.mockResolvedValue({ count: 1 });
      mockDb.janitorRecommendation.count.mockResolvedValue(1);

      // Mock Pusher failure
      const pusherError = new Error("Pusher service unavailable");
      mockPusher.trigger.mockRejectedValue(pusherError);

      // Should not throw - Pusher errors are caught and logged
      const result = await processJanitorWebhook(webhookPayload);

      expect(result).toEqual({
        runId: mockRunId,
        status: "COMPLETED",
        recommendationCount: 1,
      });
    });
  });
});