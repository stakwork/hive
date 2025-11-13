import { NextRequest, NextResponse } from "next/server";
import { StakgraphWebhookService } from "@/services/swarm/StakgraphWebhookService";
import { WebhookPayload } from "@/types";
import { logger } from "@/lib/logger";

export const fetchCache = "force-no-store";

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("x-signature");
    const requestIdHeader = request.headers.get("x-request-id") || request.headers.get("idempotency-key");

    logger.debug("[StakgraphWebhook] Received", {
      hasSignature: !!signature,
      requestIdHeader,
    });

    if (!signature) {
      logger.error("[StakgraphWebhook] Missing signature");
      return NextResponse.json({ success: false, message: "Missing signature" }, { status: 401 });
    }

    const rawBody = await request.text();
    let payload: WebhookPayload;

    try {
      payload = JSON.parse(rawBody) as WebhookPayload;
    } catch (error) {
      logger.error("[StakgraphWebhook] Invalid JSON", { error });
      return NextResponse.json({ success: false, message: "Invalid JSON" }, { status: 400 });
    }

    logger.debug("[StakgraphWebhook] Payload received", {
      requestId: payload.request_id,
      status: payload.status,
      requestIdHeader,
    });

    const webhookService = new StakgraphWebhookService();
    const result = await webhookService.processWebhook(signature, rawBody, payload, requestIdHeader);

    if (!result.success) {
      logger.error("[StakgraphWebhook] Processing failed", {
        requestId: payload.request_id,
        status: result.status,
        message: result.message,
      });
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }

    logger.debug("[StakgraphWebhook] Processing succeeded", {
      requestId: payload.request_id,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("[StakgraphWebhook] Unhandled error", { error });
    return NextResponse.json({ success: false, message: "Failed to process webhook" }, { status: 500 });
  }
}
