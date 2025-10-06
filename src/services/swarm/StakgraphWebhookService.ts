import { db } from "@/lib/db";
import { computeHmacSha256Hex, timingSafeEqual, EncryptionService } from "@/lib/encryption";
import { WebhookPayload } from "@/types";
import { updateStakgraphStatus } from "@/services/swarm/stakgraph-status";

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
        return {
          success: false,
          status: 400,
          message: "Missing request_id",
        };
      }
      console.log("STAKGRAPH WEBHOOK RECEIVED", {
        requestId: request_id,
        requestIdHeader,
      });
      const swarm = await this.lookupAndVerifySwarm(request_id, signature, rawBody);
      if (!swarm) {
        return {
          success: false,
          status: 401,
          message: "Unauthorized",
        };
      }

      await updateStakgraphStatus(swarm, payload);

      console.log("[StakgraphWebhook] processed", {
        requestId: request_id,
        workspaceId: swarm.workspaceId,
        swarmId: swarm.id,
        repositoryUrl: swarm.repositoryUrl,
        status: payload.status,
      });

      return { success: true, status: 200 };
    } catch (error) {
      console.error("Error processing stakgraph webhook:", error);
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
    repositoryUrl: string | null;
  } | null> {
    const swarm = await db.swarm.findFirst({
      where: { ingestRefId: requestId },
      select: {
        id: true,
        workspaceId: true,
        swarmApiKey: true,
        repositoryUrl: true,
      },
    });

    if (!swarm) {
      console.warn("No swarm found for request_id:", requestId);
      return null;
    }

    if (!swarm.swarmApiKey) {
      console.error("Swarm missing API key for request_id:", requestId);
      return null;
    }

    // Decrypt and verify the signature
    let secret: string;
    try {
      secret = this.encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey);
    } catch (error) {
      console.error("Failed to decrypt swarm API key:", error);
      return null;
    }

    const sigHeader = signature.startsWith("sha256=") ? signature.slice(7) : signature;
    const expected = computeHmacSha256Hex(secret, rawBody);

    if (!timingSafeEqual(expected, sigHeader)) {
      console.error("Webhook signature mismatch");
      return null;
    }

    return {
      id: swarm.id,
      workspaceId: swarm.workspaceId,
      repositoryUrl: swarm.repositoryUrl,
    };
  }
}
