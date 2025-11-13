import { db } from "@/lib/db";
import { computeHmacSha256Hex, timingSafeEqual, EncryptionService } from "@/lib/encryption";
import { WebhookPayload } from "@/types";
import { updateStakgraphStatus } from "@/services/swarm/stakgraph-status";
import { logger } from "@/lib/logger";

export class StakgraphWebhookService {
  private encryptionService: EncryptionService;

  constructor() {
    this.encryptionService = EncryptionService.getInstance();
  }

  async processWebhook(
    signature: string,
    rawBody: string,
    payload: WebhookPayload,
    requestIdHeader?: string | null,
  ): Promise<{ success: boolean; status: number; message?: string }> {
    try {
      const { request_id } = payload;
      if (!request_id) {
        logger.error("[StakgraphWebhookService] Missing request_id in payload");
        return {
          success: false,
          status: 400,
          message: "Missing request_id",
        };
      }

      logger.debug("[StakgraphWebhookService] Processing webhook", "swarm/StakgraphWebhookService", { {
        requestId: request_id,
        status: payload.status,
        requestIdHeader,
      } });

      const swarm = await this.lookupAndVerifySwarm(request_id, signature, rawBody);
      if (!swarm) {
        logger.error("[StakgraphWebhookService] Verification failed", "swarm/StakgraphWebhookService", { {
          requestId: request_id,
        } });
        return {
          success: false,
          status: 401,
          message: "Unauthorized",
        };
      }

      logger.debug("[StakgraphWebhookService] Swarm verified", "swarm/StakgraphWebhookService", { {
        requestId: request_id,
        workspaceId: swarm.workspaceId,
        swarmId: swarm.id,
      } });

      await updateStakgraphStatus(swarm, payload);

      logger.debug("[StakgraphWebhookService] Status updated", "swarm/StakgraphWebhookService", { {
        requestId: request_id,
        workspaceId: swarm.workspaceId,
        swarmId: swarm.id,
        status: payload.status,
      } });

      return { success: true, status: 200 };
    } catch (error) {
      logger.error("[StakgraphWebhookService] Processing error", "swarm/StakgraphWebhookService", { {
        requestId: payload.request_id,
        error,
      } });
      return {
        success: false,
        status: 500,
        message: "Failed to process webhook",
      };
    }
  }

  private async lookupAndVerifySwarm(
    requestId: string,
    signature: string,
    rawBody: string,
  ): Promise<{
    id: string;
    workspaceId: string;
  } | null> {
    const swarm = await db.swarm.findFirst({
      where: { ingestRefId: requestId },
      select: {
        id: true,
        workspaceId: true,
        swarmApiKey: true,
      },
    });

    if (!swarm) {
      logger.error("[StakgraphWebhookService] Swarm not found", "swarm/StakgraphWebhookService", { { requestId } });
      return null;
    }

    if (!swarm.swarmApiKey) {
      logger.error("[StakgraphWebhookService] Swarm missing API key", "swarm/StakgraphWebhookService", { {
        requestId,
        swarmId: swarm.id,
        workspaceId: swarm.workspaceId,
      } });
      return null;
    }

    let secret: string;
    try {
      secret = this.encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);
    } catch (error) {
      logger.error("[StakgraphWebhookService] Failed to decrypt API key", "swarm/StakgraphWebhookService", { {
        requestId,
        swarmId: swarm.id,
        workspaceId: swarm.workspaceId,
        error,
      } });
      return null;
    }

    const sigHeader = signature.startsWith("sha256=") ? signature.slice(7) : signature;
    const expected = computeHmacSha256Hex(secret, rawBody);

    if (!timingSafeEqual(expected, sigHeader)) {
      logger.error("[StakgraphWebhookService] Signature mismatch", "swarm/StakgraphWebhookService", { {
        requestId,
        swarmId: swarm.id,
        workspaceId: swarm.workspaceId,
      } });
      return null;
    }

    logger.debug("[StakgraphWebhookService] Signature verified", "swarm/StakgraphWebhookService", { {
      requestId,
      swarmId: swarm.id,
      workspaceId: swarm.workspaceId,
    } });

    return {
      id: swarm.id,
      workspaceId: swarm.workspaceId,
    };
  }
}
