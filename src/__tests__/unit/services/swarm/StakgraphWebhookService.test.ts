import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { StakgraphWebhookService } from "@/services/swarm/StakgraphWebhookService";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { mapStatusToStepStatus } from "@/utils/conversions";
import { SwarmWizardStep } from "@prisma/client";
import type { WebhookPayload } from "@/types";

// Mock the dependencies
vi.mock("@/services/swarm/db", () => ({
  saveOrUpdateSwarm: vi.fn(),
}));

vi.mock("@/utils/conversions", () => ({
  mapStatusToStepStatus: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    swarm: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/encryption", () => ({
  computeHmacSha256Hex: vi.fn(),
  timingSafeEqual: vi.fn(),
  EncryptionService: {
    getInstance: () => ({
      decryptField: vi.fn(),
    }),
  },
}));

const mockedSaveOrUpdateSwarm = vi.mocked(saveOrUpdateSwarm);
const mockedMapStatusToStepStatus = vi.mocked(mapStatusToStepStatus);

describe("StakgraphWebhookService - processWebhookPayload", () => {
  let service: StakgraphWebhookService;
  let mockSwarm: { id: string; workspaceId: string; repositoryUrl: string | null };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new StakgraphWebhookService();
    
    mockSwarm = {
      id: "swarm-123",
      workspaceId: "workspace-456",
      repositoryUrl: "https://github.com/test/repo.git",
    };

    // Default mock implementations
    mockedMapStatusToStepStatus.mockReturnValue("PROCESSING");
    mockedSaveOrUpdateSwarm.mockResolvedValue({} as any);
  });

  describe("successful webhook processing", () => {
    test("should process complete webhook payload with all fields", async () => {
      const mockPayload: WebhookPayload = {
        request_id: "req-123",
        status: "completed",
        progress: 100,
        result: {
          nodes: 500,
          edges: 1200,
        },
        error: null,
        started_at: "2024-01-01T10:00:00Z",
        completed_at: "2024-01-01T10:05:00Z",
        duration_ms: 300000,
      };

      const requestIdHeader = "header-req-456";

      mockedMapStatusToStepStatus.mockReturnValue("COMPLETED");

      // Access private method through any casting
      await (service as any).processWebhookPayload(mockSwarm, mockPayload, requestIdHeader);

      expect(mockedMapStatusToStepStatus).toHaveBeenCalledWith("completed");

      expect(mockedSaveOrUpdateSwarm).toHaveBeenCalledWith({
        workspaceId: "workspace-456",
        wizardStep: SwarmWizardStep.INGEST_CODE,
        stepStatus: "COMPLETED",
        wizardData: {
          stakgraph: {
            requestId: "req-123",
            requestIdHeader: "header-req-456",
            status: "completed",
            progress: 100,
            nodes: 500,
            edges: 1200,
            error: null,
            startedAt: "2024-01-01T10:00:00Z",
            completedAt: "2024-01-01T10:05:00Z",
            durationMs: 300000,
            lastUpdateAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
          },
        },
      });
    });

    test("should process webhook payload with minimal required fields", async () => {
      const mockPayload: WebhookPayload = {
        request_id: "req-minimal",
        status: "in_progress",
        progress: 50,
      };

      mockedMapStatusToStepStatus.mockReturnValue("PROCESSING");

      await (service as any).processWebhookPayload(mockSwarm, mockPayload);

      expect(mockedMapStatusToStepStatus).toHaveBeenCalledWith("in_progress");

      expect(mockedSaveOrUpdateSwarm).toHaveBeenCalledWith({
        workspaceId: "workspace-456",
        wizardStep: SwarmWizardStep.INGEST_CODE,
        stepStatus: "PROCESSING",
        wizardData: {
          stakgraph: {
            requestId: "req-minimal",
            requestIdHeader: undefined,
            status: "in_progress",
            progress: 50,
            nodes: undefined,
            edges: undefined,
            error: undefined,
            startedAt: undefined,
            completedAt: undefined,
            durationMs: undefined,
            lastUpdateAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
          },
        },
      });
    });

    test("should handle webhook payload with error information", async () => {
      const mockPayload: WebhookPayload = {
        request_id: "req-error",
        status: "failed",
        progress: 25,
        error: "Processing timeout after 5 minutes",
        started_at: "2024-01-01T11:00:00Z",
      };

      mockedMapStatusToStepStatus.mockReturnValue("FAILED");

      await (service as any).processWebhookPayload(mockSwarm, mockPayload, null);

      expect(mockedMapStatusToStepStatus).toHaveBeenCalledWith("failed");

      expect(mockedSaveOrUpdateSwarm).toHaveBeenCalledWith({
        workspaceId: "workspace-456",
        wizardStep: SwarmWizardStep.INGEST_CODE,
        stepStatus: "FAILED",
        wizardData: {
          stakgraph: {
            requestId: "req-error",
            requestIdHeader: null,
            status: "failed",
            progress: 25,
            nodes: undefined,
            edges: undefined,
            error: "Processing timeout after 5 minutes",
            startedAt: "2024-01-01T11:00:00Z",
            completedAt: undefined,
            durationMs: undefined,
            lastUpdateAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
          },
        },
      });
    });

    test("should handle different status mappings correctly", async () => {
      const testCases = [
        { status: "pending", expectedStepStatus: "PENDING" },
        { status: "running", expectedStepStatus: "PROCESSING" },
        { status: "success", expectedStepStatus: "COMPLETED" },
        { status: "error", expectedStepStatus: "FAILED" },
      ];

      for (const testCase of testCases) {
        vi.clearAllMocks();
        
        const mockPayload: WebhookPayload = {
          request_id: `req-${testCase.status}`,
          status: testCase.status,
          progress: 0,
        };

        mockedMapStatusToStepStatus.mockReturnValue(testCase.expectedStepStatus as any);

        await (service as any).processWebhookPayload(mockSwarm, mockPayload);

        expect(mockedMapStatusToStepStatus).toHaveBeenCalledWith(testCase.status);
        expect(mockedSaveOrUpdateSwarm).toHaveBeenCalledWith(
          expect.objectContaining({
            stepStatus: testCase.expectedStepStatus,
          })
        );
      }
    });
  });

  describe("edge cases and data handling", () => {
    test("should handle swarm with null repositoryUrl", async () => {
      const mockSwarmWithNullRepo = {
        ...mockSwarm,
        repositoryUrl: null,
      };

      const mockPayload: WebhookPayload = {
        request_id: "req-null-repo",
        status: "completed",
        progress: 100,
      };

      mockedMapStatusToStepStatus.mockReturnValue("COMPLETED");

      await (service as any).processWebhookPayload(mockSwarmWithNullRepo, mockPayload);

      expect(mockedSaveOrUpdateSwarm).toHaveBeenCalledWith({
        workspaceId: "workspace-456",
        wizardStep: SwarmWizardStep.INGEST_CODE,
        stepStatus: "COMPLETED",
        wizardData: {
          stakgraph: expect.objectContaining({
            requestId: "req-null-repo",
          }),
        },
      });
    });

    test("should handle payload with zero progress", async () => {
      const mockPayload: WebhookPayload = {
        request_id: "req-zero-progress",
        status: "started",
        progress: 0,
      };

      mockedMapStatusToStepStatus.mockReturnValue("PROCESSING");

      await (service as any).processWebhookPayload(mockSwarm, mockPayload);

      expect(mockedSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          wizardData: {
            stakgraph: expect.objectContaining({
              progress: 0,
            }),
          },
        })
      );
    });

    test("should handle payload with result containing only nodes", async () => {
      const mockPayload: WebhookPayload = {
        request_id: "req-nodes-only",
        status: "completed",
        progress: 100,
        result: {
          nodes: 250,
        },
      };

      mockedMapStatusToStepStatus.mockReturnValue("COMPLETED");

      await (service as any).processWebhookPayload(mockSwarm, mockPayload);

      expect(mockedSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          wizardData: {
            stakgraph: expect.objectContaining({
              nodes: 250,
              edges: undefined,
            }),
          },
        })
      );
    });

    test("should handle payload with result containing only edges", async () => {
      const mockPayload: WebhookPayload = {
        request_id: "req-edges-only",
        status: "completed",
        progress: 100,
        result: {
          edges: 800,
        },
      };

      mockedMapStatusToStepStatus.mockReturnValue("COMPLETED");

      await (service as any).processWebhookPayload(mockSwarm, mockPayload);

      expect(mockedSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          wizardData: {
            stakgraph: expect.objectContaining({
              nodes: undefined,
              edges: 800,
            }),
          },
        })
      );
    });

    test("should handle payload with empty result object", async () => {
      const mockPayload: WebhookPayload = {
        request_id: "req-empty-result",
        status: "completed",
        progress: 100,
        result: {},
      };

      mockedMapStatusToStepStatus.mockReturnValue("COMPLETED");

      await (service as any).processWebhookPayload(mockSwarm, mockPayload);

      expect(mockedSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          wizardData: {
            stakgraph: expect.objectContaining({
              nodes: undefined,
              edges: undefined,
            }),
          },
        })
      );
    });
  });

  describe("timestamp handling", () => {
    test("should generate current timestamp for lastUpdateAt", async () => {
      const mockPayload: WebhookPayload = {
        request_id: "req-timestamp-test",
        status: "processing",
        progress: 50,
      };

      const beforeCall = Date.now();
      
      await (service as any).processWebhookPayload(mockSwarm, mockPayload);
      
      const afterCall = Date.now();

      expect(mockedSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          wizardData: {
            stakgraph: expect.objectContaining({
              lastUpdateAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
            }),
          },
        })
      );

      // Verify timestamp is within reasonable range
      const call = mockedSaveOrUpdateSwarm.mock.calls[0][0];
      const lastUpdateAt = call.wizardData.stakgraph.lastUpdateAt;
      const lastUpdateAtTimestamp = new Date(lastUpdateAt).getTime();
      expect(lastUpdateAtTimestamp).toBeGreaterThanOrEqual(beforeCall);
      expect(lastUpdateAtTimestamp).toBeLessThanOrEqual(afterCall);
    });

    test("should preserve original timestamp fields from payload", async () => {
      const mockPayload: WebhookPayload = {
        request_id: "req-preserve-timestamps",
        status: "completed",
        progress: 100,
        started_at: "2024-01-01T08:00:00Z",
        completed_at: "2024-01-01T08:30:00Z",
        duration_ms: 1800000,
      };

      await (service as any).processWebhookPayload(mockSwarm, mockPayload);

      expect(mockedSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          wizardData: {
            stakgraph: expect.objectContaining({
              startedAt: "2024-01-01T08:00:00Z",
              completedAt: "2024-01-01T08:30:00Z",
              durationMs: 1800000,
            }),
          },
        })
      );
    });
  });

  describe("error handling scenarios", () => {
    test("should propagate saveOrUpdateSwarm errors", async () => {
      const mockPayload: WebhookPayload = {
        request_id: "req-save-error",
        status: "completed",
        progress: 100,
      };

      const saveError = new Error("Database connection failed");
      mockedSaveOrUpdateSwarm.mockRejectedValue(saveError);

      await expect(
        (service as any).processWebhookPayload(mockSwarm, mockPayload)
      ).rejects.toThrow("Database connection failed");

      expect(mockedMapStatusToStepStatus).toHaveBeenCalledWith("completed");
      expect(mockedSaveOrUpdateSwarm).toHaveBeenCalledOnce();
    });

    test("should propagate mapStatusToStepStatus errors", async () => {
      const mockPayload: WebhookPayload = {
        request_id: "req-mapping-error",
        status: "invalid_status",
        progress: 50,
      };

      const mappingError = new Error("Invalid status mapping");
      mockedMapStatusToStepStatus.mockImplementation(() => {
        throw mappingError;
      });

      await expect(
        (service as any).processWebhookPayload(mockSwarm, mockPayload)
      ).rejects.toThrow("Invalid status mapping");

      expect(mockedMapStatusToStepStatus).toHaveBeenCalledWith("invalid_status");
      expect(mockedSaveOrUpdateSwarm).not.toHaveBeenCalled();
    });

    test("should handle unexpected payload structure gracefully", async () => {
      // Test with payload missing required fields (this tests runtime robustness)
      const mockPayload = {
        status: "completed",
        progress: 100,
        // Missing request_id
      } as WebhookPayload;

      mockedMapStatusToStepStatus.mockReturnValue("COMPLETED");

      await (service as any).processWebhookPayload(mockSwarm, mockPayload);

      expect(mockedSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          wizardData: {
            stakgraph: expect.objectContaining({
              requestId: undefined,
              status: "completed",
              progress: 100,
            }),
          },
        })
      );
    });
  });

  describe("data transformation integrity", () => {
    test("should maintain exact data mapping from payload to stakgraph data", async () => {
      const mockPayload: WebhookPayload = {
        request_id: "req-data-integrity",
        status: "processing",
        progress: 75,
        result: {
          nodes: 1000,
          edges: 2500,
        },
        error: "Partial processing warning",
        started_at: "2024-01-01T12:00:00Z",
        completed_at: "2024-01-01T12:15:00Z",
        duration_ms: 900000,
      };

      const requestIdHeader = "correlation-id-789";

      await (service as any).processWebhookPayload(mockSwarm, mockPayload, requestIdHeader);

      const expectedStakgraphData = {
        requestId: "req-data-integrity",
        requestIdHeader: "correlation-id-789",
        status: "processing",
        progress: 75,
        nodes: 1000,
        edges: 2500,
        error: "Partial processing warning",
        startedAt: "2024-01-01T12:00:00Z",
        completedAt: "2024-01-01T12:15:00Z",
        durationMs: 900000,
        lastUpdateAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      };

      expect(mockedSaveOrUpdateSwarm).toHaveBeenCalledWith({
        workspaceId: "workspace-456",
        wizardStep: SwarmWizardStep.INGEST_CODE,
        stepStatus: "PROCESSING",
        wizardData: {
          stakgraph: expectedStakgraphData,
        },
      });
    });

    test("should use correct wizard step constant", async () => {
      const mockPayload: WebhookPayload = {
        request_id: "req-wizard-step",
        status: "completed",
        progress: 100,
      };

      await (service as any).processWebhookPayload(mockSwarm, mockPayload);

      expect(mockedSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          wizardStep: SwarmWizardStep.INGEST_CODE,
        })
      );
    });

    test("should pass through swarm workspaceId correctly", async () => {
      const customSwarm = {
        ...mockSwarm,
        workspaceId: "custom-workspace-id",
      };

      const mockPayload: WebhookPayload = {
        request_id: "req-workspace-id",
        status: "completed",
        progress: 100,
      };

      await (service as any).processWebhookPayload(customSwarm, mockPayload);

      expect(mockedSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "custom-workspace-id",
        })
      );
    });
  });
});