import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/ec2/alerts/route";
import { db } from "@/lib/db";
import { NextRequest } from "next/server";

// Helper to build SNS POST requests
function makeSnsRequest(body: object, messageType: string | null): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (messageType !== null) {
    headers["x-amz-sns-message-type"] = messageType;
  }
  return new NextRequest("http://localhost/api/ec2/alerts", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function makeNotificationBody(overrides: Record<string, unknown> = {}): object {
  const message = {
    AlarmName: "high-cpu-alarm",
    NewStateValue: "ALARM",
    NewStateReason: "Threshold Crossed: 1 datapoint greater than 80.0",
    StateChangeTime: "2026-03-02T20:00:00.000Z",
    Trigger: {
      Dimensions: [{ name: "InstanceId", value: "i-0abc123def456" }],
    },
    ...overrides,
  };
  return {
    Type: "Notification",
    Message: JSON.stringify(message),
  };
}

describe("POST /api/ec2/alerts", () => {
  const instanceId = `i-test-${Date.now()}`;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Clean up any pre-existing alerts for our test instance
    await db.ec2Alert.deleteMany({ where: { instanceId } });
  });

  it("handles SubscriptionConfirmation — returns 200, does not write to DB", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(new Response("OK", { status: 200 }));

    const req = makeSnsRequest(
      { SubscribeURL: "https://sns.aws.amazon.com/confirm?token=abc" },
      "SubscriptionConfirmation"
    );
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith("https://sns.aws.amazon.com/confirm?token=abc");

    const count = await db.ec2Alert.count({ where: { instanceId } });
    expect(count).toBe(0);

    fetchSpy.mockRestore();
  });

  it("handles Notification — creates Ec2Alert record with correct fields", async () => {
    const body = makeNotificationBody({
      AlarmName: "high-cpu-alarm",
      NewStateValue: "ALARM",
      NewStateReason: "CPU above threshold",
      StateChangeTime: "2026-03-02T20:00:00.000Z",
      Trigger: { Dimensions: [{ name: "InstanceId", value: instanceId }] },
    });

    const req = makeSnsRequest(body, "Notification");
    const res = await POST(req);

    expect(res.status).toBe(200);

    const alert = await db.ec2Alert.findUnique({ where: { instanceId } });
    expect(alert).not.toBeNull();
    expect(alert!.instanceId).toBe(instanceId);
    expect(alert!.alarmName).toBe("high-cpu-alarm");
    expect(alert!.alarmState).toBe("ALARM");
    expect(alert!.alarmType).toBe("high-cpu");
    expect(alert!.stateReason).toBe("CPU above threshold");
    expect(alert!.triggeredAt).toEqual(new Date("2026-03-02T20:00:00.000Z"));
  });

  it("handles duplicate Notification — updates existing record, no duplicate", async () => {
    const bodyFirst = makeNotificationBody({
      NewStateValue: "ALARM",
      NewStateReason: "First alarm",
      StateChangeTime: "2026-03-02T20:00:00.000Z",
      Trigger: { Dimensions: [{ name: "InstanceId", value: instanceId }] },
    });
    await POST(makeSnsRequest(bodyFirst, "Notification"));

    const bodySecond = makeNotificationBody({
      NewStateValue: "OK",
      NewStateReason: "Resolved",
      StateChangeTime: "2026-03-02T21:00:00.000Z",
      Trigger: { Dimensions: [{ name: "InstanceId", value: instanceId }] },
    });
    const res = await POST(makeSnsRequest(bodySecond, "Notification"));

    expect(res.status).toBe(200);

    const count = await db.ec2Alert.count({ where: { instanceId } });
    expect(count).toBe(1);

    const alert = await db.ec2Alert.findUnique({ where: { instanceId } });
    expect(alert!.alarmState).toBe("OK");
    expect(alert!.stateReason).toBe("Resolved");
  });

  it("returns 400 when InstanceId dimension is missing", async () => {
    const body = {
      Type: "Notification",
      Message: JSON.stringify({
        AlarmName: "high-cpu-alarm",
        NewStateValue: "ALARM",
        NewStateReason: "reason",
        StateChangeTime: "2026-03-02T20:00:00.000Z",
        Trigger: { Dimensions: [] }, // no InstanceId
      }),
    };
    const res = await POST(makeSnsRequest(body, "Notification"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when Message field is missing from Notification", async () => {
    const res = await POST(makeSnsRequest({ Type: "Notification" }, "Notification"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when x-amz-sns-message-type header is absent", async () => {
    const res = await POST(makeSnsRequest(makeNotificationBody(), null));
    expect(res.status).toBe(400);
  });

  it("returns 400 for unsupported message type", async () => {
    const res = await POST(makeSnsRequest({}, "UnsubscribeConfirmation"));
    expect(res.status).toBe(400);
  });
});
