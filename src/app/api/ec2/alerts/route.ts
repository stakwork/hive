import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const messageType = request.headers.get("x-amz-sns-message-type");

  if (!messageType) {
    return NextResponse.json({ error: "Missing x-amz-sns-message-type header" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Handle SNS subscription confirmation
  if (messageType === "SubscriptionConfirmation") {
    const subscribeUrl = body.SubscribeURL as string | undefined;
    if (!subscribeUrl) {
      return NextResponse.json({ error: "Missing SubscribeURL" }, { status: 400 });
    }
    try {
      await fetch(subscribeUrl);
      logger.info("SNS subscription confirmed", "ec2-alerts", { subscribeUrl });
    } catch (err) {
      logger.error("Failed to confirm SNS subscription", "ec2-alerts", { err });
    }
    return NextResponse.json({ ok: true });
  }

  // Handle alarm notifications
  if (messageType === "Notification") {
    const rawMessage = body.Message as string | undefined;
    if (!rawMessage) {
      return NextResponse.json({ error: "Missing Message field" }, { status: 400 });
    }

    let parsedMessage: Record<string, unknown>;
    try {
      parsedMessage = JSON.parse(rawMessage);
    } catch {
      return NextResponse.json({ error: "Invalid Message JSON" }, { status: 400 });
    }

    try {
      const dimensions = (
        (parsedMessage.Trigger as Record<string, unknown>)?.Dimensions as Array<{ name: string; value: string }>
      ) ?? [];
      const instanceId = dimensions.find((d) => d.name === "InstanceId")?.value;
      const alarmName = parsedMessage.AlarmName as string | undefined;
      const alarmState = parsedMessage.NewStateValue as string | undefined;
      const stateReason = parsedMessage.NewStateReason as string | undefined;
      const stateChangeTime = parsedMessage.StateChangeTime as string | undefined;

      if (!instanceId || !alarmName || !alarmState || !stateReason || !stateChangeTime) {
        return NextResponse.json({ error: "Missing required alarm fields" }, { status: 400 });
      }

      const alarmType = alarmName.includes("high-cpu") ? "high-cpu" : "low-cpu";
      const triggeredAt = new Date(stateChangeTime);

      await db.ec2_alerts.upsert({
        where: { instanceId },
        create: { instanceId, alarmName, alarmState, alarmType, stateReason, triggeredAt },
        update: { alarmName, alarmState, alarmType, stateReason, triggeredAt },
      });

      logger.info("EC2 alert upserted", "ec2-alerts", { instanceId, alarmName, alarmState });
      return NextResponse.json({ ok: true });
    } catch (err) {
      logger.error("Failed to process EC2 alert notification", "ec2-alerts", { err });
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unsupported message type" }, { status: 400 });
}
