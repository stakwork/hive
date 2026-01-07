import { describe, test, expect, vi, beforeEach } from "vitest";
import { StakgraphWebhookService } from "@/services/swarm/StakgraphWebhookService";
import { updateStakgraphStatus } from "@/services/swarm/stakgraph-status";
import { computeHmacSha256Hex, timingSafeEqual } from "@/lib/encryption";
import { db } from "@/lib/db";
import type { WebhookPayload } from "@/types";

vi.mock("@/services/swarm/stakgraph-status", () => ({
  updateStakgraphStatus: vi.fn(),
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

const mockedUpdateStakgraphStatus = vi.mocked(updateStakgraphStatus);
const mockedDbSwarm = vi.mocked(db.swarm);
const mockedComputeHmac = vi.mocked(computeHmacSha256Hex);
const mockedTimingSafeEqual = vi.mocked(timingSafeEqual);

describe("StakgraphWebhookService", () => {
  let service: StakgraphWebhookService;
  let mockSwarm: { id: string; workspaceId: string };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new StakgraphWebhookService();

    mockSwarm = {
      id: "swarm-123",
      workspaceId: "workspace-456",
    };
  });

  describe("processWebhook", () => {
    const validPayload: WebhookPayload = {
      request_id: "req-123",
      status: "Complete",
      progress: 100,
      result: { nodes: 10, edges: 20 },
      error: null,
      started_at: "2024-01-01T00:00:00Z",
      completed_at: "2024-01-01T00:01:00Z",
      duration_ms: 60000,
    };

    const rawBody = JSON.stringify(validPayload);
    const signature = "sha256=valid-signature";

    test("should process webhook successfully", async () => {
      mockedDbSwarm.findFirst.mockResolvedValueOnce({
        id: mockSwarm.id,
        workspaceId: mockSwarm.workspaceId,
        swarmApiKey: "encrypted-key",
         
      } as any);

       
      (service as any).encryptionService = {
        decryptField: vi.fn().mockReturnValue("decrypted-key"),
      };

      mockedComputeHmac.mockReturnValue("valid-signature");
      mockedTimingSafeEqual.mockReturnValue(true);
      mockedUpdateStakgraphStatus.mockResolvedValueOnce();

      const result = await service.processWebhook(signature, rawBody, validPayload, "header-123");

      expect(result).toEqual({ success: true, status: 200 });
      expect(mockedUpdateStakgraphStatus).toHaveBeenCalledWith(mockSwarm, validPayload);
    });

    test("should return error for missing request_id", async () => {
      const payloadWithoutId = { ...validPayload, request_id: "" };

      const result = await service.processWebhook(signature, rawBody, payloadWithoutId, "header-123");

      expect(result).toEqual({
        success: false,
        status: 400,
        message: "Missing request_id",
      });
      expect(mockedUpdateStakgraphStatus).not.toHaveBeenCalled();
    });

    test("should return error for invalid signature", async () => {
      mockedDbSwarm.findFirst.mockResolvedValueOnce({
        id: mockSwarm.id,
        workspaceId: mockSwarm.workspaceId,
        swarmApiKey: "encrypted-key",
         
      } as any);

       
      (service as any).encryptionService = {
        decryptField: vi.fn().mockReturnValue("decrypted-key"),
      };

      mockedComputeHmac.mockReturnValue("expected-signature");
      mockedTimingSafeEqual.mockReturnValue(false);

      const result = await service.processWebhook("sha256=invalid-signature", rawBody, validPayload, "header-123");

      expect(result).toEqual({
        success: false,
        status: 401,
        message: "Unauthorized",
      });
      expect(mockedUpdateStakgraphStatus).not.toHaveBeenCalled();
    });

    test("should return error for missing swarm", async () => {
      mockedDbSwarm.findFirst.mockResolvedValueOnce(null);

      const result = await service.processWebhook(signature, rawBody, validPayload, "header-123");

      expect(result).toEqual({
        success: false,
        status: 401,
        message: "Unauthorized",
      });
      expect(mockedUpdateStakgraphStatus).not.toHaveBeenCalled();
    });

    test("should handle updateStakgraphStatus errors", async () => {
      mockedDbSwarm.findFirst.mockResolvedValueOnce({
        id: mockSwarm.id,
        workspaceId: mockSwarm.workspaceId,
        swarmApiKey: "encrypted-key",
         
      } as any);

       
      (service as any).encryptionService = {
        decryptField: vi.fn().mockReturnValue("decrypted-key"),
      };

      mockedComputeHmac.mockReturnValue("valid-signature");
      mockedTimingSafeEqual.mockReturnValue(true);
      mockedUpdateStakgraphStatus.mockRejectedValueOnce(new Error("Update failed"));

      const result = await service.processWebhook(signature, rawBody, validPayload, "header-123");

      expect(result).toEqual({
        success: false,
        status: 500,
        message: "Failed to process webhook",
      });
    });
  });
});
