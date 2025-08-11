import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { RepositoryStatus, SwarmWizardStep } from "@prisma/client";
import { mapStatusToStepStatus } from "@/utils/conversions";
import { computeHmacSha256Hex, timingSafeEqual } from "@/lib/encryption";
import { WebhookPayload } from "@/types";

export const fetchCache = "force-no-store";

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("x-signature");
    const requestIdHeader =
      request.headers.get("x-request-id") ||
      request.headers.get("idempotency-key");
    if (!signature) {
      return NextResponse.json(
        { success: false, message: "Missing signature" },
        { status: 401 },
      );
    }

    const rawBody = await request.text();
    let payload: WebhookPayload;
    try {
      payload = JSON.parse(rawBody) as WebhookPayload;
    } catch (error) {
      console.error("Error parsing JSON:", error);
      return NextResponse.json(
        { success: false, message: "Invalid JSON" },
        { status: 400 },
      );
    }

    const secret = process.env.STAKGRAPH_WEBHOOK_SECRET || "";
    if (!secret) {
      console.error("Missing STAKGRAPH_WEBHOOK_SECRET env var");
      return NextResponse.json(
        { success: false, message: "Server misconfigured" },
        { status: 500 },
      );
    }

    const sigHeader = signature.startsWith("sha256=")
      ? signature.slice(7)
      : signature;
    const expected = computeHmacSha256Hex(secret, rawBody);
    if (!timingSafeEqual(expected, sigHeader)) {
      console.error("Webhook signature mismatch");
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const { request_id } = payload;
    if (!request_id) {
      return NextResponse.json(
        { success: false, message: "Missing request_id" },
        { status: 400 },
      );
    }

    const swarm = await db.swarm.findFirst({
      where: { ingestRefId: request_id },
    });
    if (!swarm) {
      console.error("No swarm found for request_id:", request_id);
      return NextResponse.json({ success: true }, { status: 202 });
    }

    const stepStatus = mapStatusToStepStatus(payload.status);
    const stakgraphData = {
      requestId: request_id,
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error handling stakgraph webhook:", error);
    return NextResponse.json(
      { success: false, message: "Failed to process webhook" },
      { status: 500 },
    );
  }
}
