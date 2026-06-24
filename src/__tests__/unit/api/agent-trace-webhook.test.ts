import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";

// --- Mocks ---

vi.mock("@/lib/db", () => ({
  db: {
    agentLog: {
      update: vi.fn(),
    },
  },
}));

// Use vi.hoisted so the mock fn reference is stable when vi.mock factory runs
const mockPusherTrigger = vi.hoisted(() => vi.fn());

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: mockPusherTrigger },
  getFeatureChannelName: (id: string) => `feature-${id}`,
  getTaskChannelName: (id: string) => `task-${id}`,
  PUSHER_EVENTS: { AGENT_TRACE_READY: "agent-trace-ready" },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/webhook/agent-trace/route";
import { db } from "@/lib/db";

const VALID_TOKEN = "test-api-token";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.API_TOKEN = VALID_TOKEN;
});

function makeRequest(body: Record<string, unknown>, token = VALID_TOKEN) {
  return new NextRequest("http://localhost/api/webhook/agent-trace", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": token,
    },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  agentLogId: "log-1",
  traceId: "trace-abc",
  phoenixTraceUrl: "https://phoenix.example.com/traces/abc",
  status: "ready",
};

describe("POST /api/webhook/agent-trace", () => {
  test("returns 401 when token is invalid", async () => {
    const res = await POST(makeRequest(VALID_BODY, "wrong-token"));
    expect(res.status).toBe(401);
  });

  test("returns 400 when required fields are missing", async () => {
    const res = await POST(makeRequest({ agentLogId: "log-1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Missing required fields");
  });

  test("updates agentLog with trace fields", async () => {
    (db.agentLog.update as Mock).mockResolvedValue({ featureId: null, taskId: null });

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    expect(db.agentLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "log-1" },
        data: {
          traceId: "trace-abc",
          phoenixTraceUrl: "https://phoenix.example.com/traces/abc",
          traceStatus: "ready",
        },
      })
    );
  });

  test("fires Pusher on feature channel when featureId is present", async () => {
    (db.agentLog.update as Mock).mockResolvedValue({ featureId: "feat-1", taskId: null });
    mockPusherTrigger.mockResolvedValue(undefined);

    await POST(makeRequest(VALID_BODY));

    expect(mockPusherTrigger).toHaveBeenCalledWith(
      "feature-feat-1",
      "agent-trace-ready",
      expect.objectContaining({ agentLogId: "log-1", traceStatus: "ready" })
    );
  });

  test("fires Pusher on task channel when taskId is present", async () => {
    (db.agentLog.update as Mock).mockResolvedValue({ featureId: null, taskId: "task-1" });
    mockPusherTrigger.mockResolvedValue(undefined);

    await POST(makeRequest(VALID_BODY));

    expect(mockPusherTrigger).toHaveBeenCalledWith(
      "task-task-1",
      "agent-trace-ready",
      expect.objectContaining({ agentLogId: "log-1" })
    );
  });

  test("fires Pusher on both channels when both featureId and taskId are present", async () => {
    (db.agentLog.update as Mock).mockResolvedValue({
      featureId: "feat-1",
      taskId: "task-1",
    });
    mockPusherTrigger.mockResolvedValue(undefined);

    await POST(makeRequest(VALID_BODY));

    expect(mockPusherTrigger).toHaveBeenCalledTimes(2);
    const channels = mockPusherTrigger.mock.calls.map((c) => c[0]);
    expect(channels).toContain("feature-feat-1");
    expect(channels).toContain("task-task-1");
  });

  test("returns success even when Pusher throws", async () => {
    (db.agentLog.update as Mock).mockResolvedValue({ featureId: "feat-1", taskId: null });
    mockPusherTrigger.mockRejectedValue(new Error("Pusher down"));

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test("returns { success: true } on success", async () => {
    (db.agentLog.update as Mock).mockResolvedValue({ featureId: null, taskId: null });

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
