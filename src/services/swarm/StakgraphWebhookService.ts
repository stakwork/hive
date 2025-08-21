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

      const swarm = await this.lookupAndVerifySwarm(
        request_id,
        signature,
        rawBody,
      );
      if (!swarm) {
        return {
          success: false,
          status: 401,
          message: "Unauthorized",
        };
      }

      await this.processWebhookPayload(swarm, payload, requestIdHeader);

      await this.updateRepositoryStatus(swarm, payload);

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
      console.error("No swarm found for request_id:", requestId);
      return null;
    }

    if (!swarm.swarmApiKey) {
      console.error("Swarm missing API key for request_id:", requestId);
      return null;
    }

    // Decrypt and verify the signature
    let secret: string;
    try {
      secret = this.encryptionService.decryptField(
        "swarmApiKey",
        swarm.swarmApiKey,
      );
    } catch (error) {
      console.error("Failed to decrypt swarm API key:", error);
      return null;
    }

    const sigHeader = signature.startsWith("sha256=")
      ? signature.slice(7)
      : signature;
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

  private async processWebhookPayload(
    swarm: { id: string; workspaceId: string; repositoryUrl: string | null },
    payload: WebhookPayload,
    requestIdHeader?: string | null,
  ): Promise<void> {
    const stepStatus = mapStatusToStepStatus(payload.status);

    const stakgraphData = {
      requestId: payload.request_id,
      requestIdHeader,
      status: payload.status,
      progress: payload.progress,
      nodes: payload.result?.nodes,
      edges: payload.result?.edges,
      error: payload.error,
      startedAt: payload.started_at,
      completedAt: payload.completed_at,
      durationMs: payload.duration_ms,
      lastUpdateAt: new Date().toISOString(),
    };

    await saveOrUpdateSwarm({
      workspaceId: swarm.workspaceId,
      wizardStep: SwarmWizardStep.INGEST_CODE,
      stepStatus,
      wizardData: { stakgraph: stakgraphData },
    });
  }

  private async updateRepositoryStatus(
    swarm: { id: string; workspaceId: string; repositoryUrl: string | null },
    payload: WebhookPayload,
  ): Promise<void> {
    const stepStatus = mapStatusToStepStatus(payload.status);

    if (stepStatus === "COMPLETED" || stepStatus === "FAILED") {
      if (swarm.repositoryUrl) {
        try {
          await db.repository.update({
            where: {
              repositoryUrl_workspaceId: {
                repositoryUrl: swarm.repositoryUrl,
                workspaceId: swarm.workspaceId,
              },
            },
            data: {
              status:
                stepStatus === "COMPLETED"
                  ? RepositoryStatus.SYNCED
                  : RepositoryStatus.FAILED,
            },
          });
        } catch (repoErr) {
          console.error("Failed to update repository status:", repoErr);
        }
      }
    }
  }
}
