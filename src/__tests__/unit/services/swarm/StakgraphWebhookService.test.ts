import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StakgraphWebhookService } from "@/services/swarm/StakgraphWebhookService";
import { db } from "@/lib/db";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { RepositoryStatus, SwarmWizardStep } from "@prisma/client";
import { mapStatusToStepStatus } from "@/utils/conversions";
import {
  computeHmacSha256Hex,
  timingSafeEqual,
  EncryptionService,
} from "@/lib/encryption";
import { WebhookPayload } from "@/types";

// Mock external dependencies
vi.mock("@/lib/db", () => ({
  db: {
    swarm: {
      findFirst: vi.fn(),
    },
    repository: {
      update: vi.fn(),
    },
  },
}));
vi.mock("@/services/swarm/db");
vi.mock("@/utils/conversions");
vi.mock("@/lib/encryption");

describe("StakgraphWebhookService", () => {
  let service: StakgraphWebhookService;
  let mockEncryptionService: any;

  const mockPayload: WebhookPayload = {
    request_id: "test-request-id-123",
    status: "completed",
    progress: 100,
    result: { nodes: 150, edges: 300 },
    error: null,
    started_at: "2024-01-01T10:00:00Z",
    completed_at: "2024-01-01T10:05:00Z",
    duration_ms: 300000,
  };

  const mockSwarm = {
    id: "swarm-123",
    workspaceId: "workspace-456",
    repositoryUrl: "https://github.com/test/repo",
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock EncryptionService
    mockEncryptionService = {
      decryptField: vi.fn(),
    };
    vi.mocked(EncryptionService.getInstance).mockReturnValue(mockEncryptionService);

    // Mock default return values
    vi.mocked(mapStatusToStepStatus).mockReturnValue("COMPLETED");
    vi.mocked(computeHmacSha256Hex).mockReturnValue("valid-signature");
    vi.mocked(timingSafeEqual).mockReturnValue(true);

    service = new StakgraphWebhookService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("processWebhook", () => {
    const signature = "sha256=valid-signature";
    const rawBody = JSON.stringify(mockPayload);

    it("should process webhook successfully", async () => {
      // Mock database queries
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        id: mockSwarm.id,
        workspaceId: mockSwarm.workspaceId,
        repositoryUrl: mockSwarm.repositoryUrl,
        swarmApiKey: "encrypted-api-key",
      });

      mockEncryptionService.decryptField.mockReturnValue("decrypted-secret");
      vi.mocked(saveOrUpdateSwarm).mockResolvedValue();
      vi.mocked(db.repository.update).mockResolvedValue({});

      const result = await service.processWebhook(
        signature,
        rawBody,
        mockPayload,
        "request-header-123"
      );

      expect(result).toEqual({
        success: true,
        status: 200,
      });

      // Verify swarm lookup was called
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { ingestRefId: mockPayload.request_id },
        select: {
          id: true,
          workspaceId: true,
          swarmApiKey: true,
          repositoryUrl: true,
        },
      });

      // Verify signature verification
      expect(mockEncryptionService.decryptField).toHaveBeenCalledWith(
        "swarmApiKey",
        "encrypted-api-key"
      );
      expect(computeHmacSha256Hex).toHaveBeenCalledWith("decrypted-secret", rawBody);
      expect(timingSafeEqual).toHaveBeenCalled();

      // Verify swarm update was called
      expect(saveOrUpdateSwarm).toHaveBeenCalledWith({
        workspaceId: mockSwarm.workspaceId,
        wizardStep: SwarmWizardStep.INGEST_CODE,
        stepStatus: "COMPLETED",
        wizardData: {
          stakgraph: expect.objectContaining({
            requestId: mockPayload.request_id,
            requestIdHeader: "request-header-123",
            status: mockPayload.status,
            progress: mockPayload.progress,
            nodes: mockPayload.result?.nodes,
            edges: mockPayload.result?.edges,
            error: mockPayload.error,
            startedAt: mockPayload.started_at,
            completedAt: mockPayload.completed_at,
            durationMs: mockPayload.duration_ms,
            lastUpdateAt: expect.any(String),
          }),
        },
      });

      // Verify repository status update
      expect(db.repository.update).toHaveBeenCalledWith({
        where: {
          repositoryUrl_workspaceId: {
            repositoryUrl: mockSwarm.repositoryUrl,
            workspaceId: mockSwarm.workspaceId,
          },
        },
        data: {
          status: RepositoryStatus.SYNCED,
        },
      });
    });

    it("should return error for missing request_id", async () => {
      const invalidPayload = { ...mockPayload, request_id: "" };

      const result = await service.processWebhook(
        signature,
        rawBody,
        invalidPayload,
        "request-header-123"
      );

      expect(result).toEqual({
        success: false,
        status: 400,
        message: "Missing request_id",
      });

      // Should not call any other services
      expect(db.swarm.findFirst).not.toHaveBeenCalled();
      expect(saveOrUpdateSwarm).not.toHaveBeenCalled();
    });

    it("should return unauthorized for invalid signature", async () => {
      // Mock swarm found but signature verification fails
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        id: mockSwarm.id,
        workspaceId: mockSwarm.workspaceId,
        repositoryUrl: mockSwarm.repositoryUrl,
        swarmApiKey: "encrypted-api-key",
      });

      mockEncryptionService.decryptField.mockReturnValue("decrypted-secret");
      vi.mocked(timingSafeEqual).mockReturnValue(false); // Invalid signature

      const result = await service.processWebhook(
        signature,
        rawBody,
        mockPayload,
        "request-header-123"
      );

      expect(result).toEqual({
        success: false,
        status: 401,
        message: "Unauthorized",
      });

      // Should not call webhook processing
      expect(saveOrUpdateSwarm).not.toHaveBeenCalled();
      expect(db.repository.update).not.toHaveBeenCalled();
    });

    it("should return unauthorized when swarm not found", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue(null);

      const result = await service.processWebhook(
        signature,
        rawBody,
        mockPayload,
        "request-header-123"
      );

      expect(result).toEqual({
        success: false,
        status: 401,
        message: "Unauthorized",
      });

      expect(saveOrUpdateSwarm).not.toHaveBeenCalled();
      expect(db.repository.update).not.toHaveBeenCalled();
    });

    it("should return unauthorized when swarm has no API key", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        id: mockSwarm.id,
        workspaceId: mockSwarm.workspaceId,
        repositoryUrl: mockSwarm.repositoryUrl,
        swarmApiKey: null,
      });

      const result = await service.processWebhook(
        signature,
        rawBody,
        mockPayload,
        "request-header-123"
      );

      expect(result).toEqual({
        success: false,
        status: 401,
        message: "Unauthorized",
      });

      expect(mockEncryptionService.decryptField).not.toHaveBeenCalled();
      expect(saveOrUpdateSwarm).not.toHaveBeenCalled();
    });

    it("should return unauthorized when decryption fails", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        id: mockSwarm.id,
        workspaceId: mockSwarm.workspaceId,
        repositoryUrl: mockSwarm.repositoryUrl,
        swarmApiKey: "encrypted-api-key",
      });

      mockEncryptionService.decryptField.mockImplementation(() => {
        throw new Error("Decryption failed");
      });

      const result = await service.processWebhook(
        signature,
        rawBody,
        mockPayload,
        "request-header-123"
      );

      expect(result).toEqual({
        success: false,
        status: 401,
        message: "Unauthorized",
      });

      expect(saveOrUpdateSwarm).not.toHaveBeenCalled();
    });

    it("should handle failed status and update repository to FAILED", async () => {
      const failedPayload: WebhookPayload = {
        ...mockPayload,
        status: "failed",
        error: "Processing failed",
      };

      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        id: mockSwarm.id,
        workspaceId: mockSwarm.workspaceId,
        repositoryUrl: mockSwarm.repositoryUrl,
        swarmApiKey: "encrypted-api-key",
      });

      mockEncryptionService.decryptField.mockReturnValue("decrypted-secret");
      vi.mocked(mapStatusToStepStatus).mockReturnValue("FAILED");
      vi.mocked(saveOrUpdateSwarm).mockResolvedValue();
      vi.mocked(db.repository.update).mockResolvedValue({});

      const result = await service.processWebhook(
        signature,
        JSON.stringify(failedPayload),
        failedPayload,
        "request-header-123"
      );

      expect(result).toEqual({
        success: true,
        status: 200,
      });

      // Verify repository was marked as FAILED
      expect(db.repository.update).toHaveBeenCalledWith({
        where: {
          repositoryUrl_workspaceId: {
            repositoryUrl: mockSwarm.repositoryUrl,
            workspaceId: mockSwarm.workspaceId,
          },
        },
        data: {
          status: RepositoryStatus.FAILED,
        },
      });
    });

    it("should handle processing status without updating repository", async () => {
      const processingPayload: WebhookPayload = {
        ...mockPayload,
        status: "processing",
        progress: 50,
        completed_at: undefined,
      };

      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        id: mockSwarm.id,
        workspaceId: mockSwarm.workspaceId,
        repositoryUrl: mockSwarm.repositoryUrl,
        swarmApiKey: "encrypted-api-key",
      });

      mockEncryptionService.decryptField.mockReturnValue("decrypted-secret");
      vi.mocked(mapStatusToStepStatus).mockReturnValue("PROCESSING");
      vi.mocked(saveOrUpdateSwarm).mockResolvedValue();

      const result = await service.processWebhook(
        signature,
        JSON.stringify(processingPayload),
        processingPayload,
        "request-header-123"
      );

      expect(result).toEqual({
        success: true,
        status: 200,
      });

      // Should update swarm but not repository status (still processing)
      expect(saveOrUpdateSwarm).toHaveBeenCalled();
      expect(db.repository.update).not.toHaveBeenCalled();
    });

    it("should handle repository update failure gracefully", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        id: mockSwarm.id,
        workspaceId: mockSwarm.workspaceId,
        repositoryUrl: mockSwarm.repositoryUrl,
        swarmApiKey: "encrypted-api-key",
      });

      mockEncryptionService.decryptField.mockReturnValue("decrypted-secret");
      vi.mocked(saveOrUpdateSwarm).mockResolvedValue();
      vi.mocked(db.repository.update).mockRejectedValue(new Error("Repository update failed"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await service.processWebhook(
        signature,
        rawBody,
        mockPayload,
        "request-header-123"
      );

      // Should still return success even if repository update fails
      expect(result).toEqual({
        success: true,
        status: 200,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to update repository status:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it("should handle unexpected errors and return 500", async () => {
      vi.mocked(db.swarm.findFirst).mockRejectedValue(new Error("Database error"));

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await service.processWebhook(
        signature,
        rawBody,
        mockPayload,
        "request-header-123"
      );

      expect(result).toEqual({
        success: false,
        status: 500,
        message: "Failed to process webhook",
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        "Error processing stakgraph webhook:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it("should handle signature with sha256= prefix correctly", async () => {
      const signatureWithPrefix = "sha256=valid-signature";
      
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        id: mockSwarm.id,
        workspaceId: mockSwarm.workspaceId,
        repositoryUrl: mockSwarm.repositoryUrl,
        swarmApiKey: "encrypted-api-key",
      });

      mockEncryptionService.decryptField.mockReturnValue("decrypted-secret");
      vi.mocked(saveOrUpdateSwarm).mockResolvedValue();
      vi.mocked(db.repository.update).mockResolvedValue({});

      const result = await service.processWebhook(
        signatureWithPrefix,
        rawBody,
        mockPayload,
        "request-header-123"
      );

      expect(result).toEqual({
        success: true,
        status: 200,
      });

      // Verify signature processing removed the prefix
      expect(timingSafeEqual).toHaveBeenCalledWith("valid-signature", "valid-signature");
    });

    it("should process webhook without requestIdHeader parameter", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        id: mockSwarm.id,
        workspaceId: mockSwarm.workspaceId,
        repositoryUrl: mockSwarm.repositoryUrl,
        swarmApiKey: "encrypted-api-key",
      });

      mockEncryptionService.decryptField.mockReturnValue("decrypted-secret");
      vi.mocked(saveOrUpdateSwarm).mockResolvedValue();
      vi.mocked(db.repository.update).mockResolvedValue({});

      const result = await service.processWebhook(
        signature,
        rawBody,
        mockPayload
        // No requestIdHeader parameter
      );

      expect(result).toEqual({
        success: true,
        status: 200,
      });

      // Verify swarm update was called with undefined requestIdHeader
      expect(saveOrUpdateSwarm).toHaveBeenCalledWith({
        workspaceId: mockSwarm.workspaceId,
        wizardStep: SwarmWizardStep.INGEST_CODE,
        stepStatus: "COMPLETED",
        wizardData: {
          stakgraph: expect.objectContaining({
            requestId: mockPayload.request_id,
            requestIdHeader: undefined,
            status: mockPayload.status,
          }),
        },
      });
    });

    it("should handle swarm without repository URL", async () => {
      const swarmWithoutRepo = {
        ...mockSwarm,
        repositoryUrl: null,
      };

      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        id: swarmWithoutRepo.id,
        workspaceId: swarmWithoutRepo.workspaceId,
        repositoryUrl: swarmWithoutRepo.repositoryUrl,
        swarmApiKey: "encrypted-api-key",
      });

      mockEncryptionService.decryptField.mockReturnValue("decrypted-secret");
      vi.mocked(saveOrUpdateSwarm).mockResolvedValue();

      const result = await service.processWebhook(
        signature,
        rawBody,
        mockPayload,
        "request-header-123"
      );

      expect(result).toEqual({
        success: true,
        status: 200,
      });

      // Should update swarm but not attempt repository update
      expect(saveOrUpdateSwarm).toHaveBeenCalled();
      expect(db.repository.update).not.toHaveBeenCalled();
    });
  });
});