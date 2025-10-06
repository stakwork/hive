import { NextRequest, NextResponse } from "next/server";
import { StakgraphWebhookService } from "@/services/swarm/StakgraphWebhookService";
import { WebhookPayload } from "@/types";

export const fetchCache = "force-no-store";

export async function POST(request: NextRequest) {
  console.log("STAKGRAPH WEBHOOK RECEIVED");
  try {
    const signature = request.headers.get("x-signature");
    const requestIdHeader = request.headers.get("x-request-id") || request.headers.get("idempotency-key");

    if (!signature) {
      return NextResponse.json({ success: false, message: "Missing signature" }, { status: 401 });
    }

    const rawBody = await request.text();
    let payload: WebhookPayload;

    try {
      payload = JSON.parse(rawBody) as WebhookPayload;
    } catch (error) {
      console.error("Error parsing JSON:", error);
      return NextResponse.json({ success: false, message: "Invalid JSON" }, { status: 400 });
    }

    console.log("HIVE - WEBHOOK PAYLOAD RECEIVED", payload);

    const webhookService = new StakgraphWebhookService();
    const result = await webhookService.processWebhook(signature, rawBody, payload, requestIdHeader);

    if (!result.success) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error handling stakgraph webhook:", error);
    return NextResponse.json({ success: false, message: "Failed to process webhook" }, { status: 500 });
  }
}
