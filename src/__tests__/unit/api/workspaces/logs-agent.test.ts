import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/workspaces/[slug]/logs-agent/route";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
  checkIsSuperAdmin: vi.fn(),
}));

vi.mock("@/services/logs-agent", () => ({
  runLogsAgent: vi.fn(),
}));

const { getMiddlewareContext: mockGetMiddlewareContext, requireAuth: mockRequireAuth } =
  await import("@/lib/middleware/utils");
const { runLogsAgent: mockRunLogsAgent } = await import("@/services/logs-agent");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(slug: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost:3000/api/workspaces/${slug}/logs-agent`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function setupAuth(userId = "user-123") {
  (mockGetMiddlewareContext as Mock).mockReturnValue({ user: { id: userId } });
  (mockRequireAuth as Mock).mockReturnValue({ id: userId });
}

function setupUnauth() {
  (mockGetMiddlewareContext as Mock).mockReturnValue({ user: null });
  (mockRequireAuth as Mock).mockReturnValue(
    NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/workspaces/[slug]/logs-agent (thin wrapper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    test("returns 401 when not authenticated", async () => {
      setupUnauth();
      const req = makeRequest("ws", { prompt: "test" });
      const res = await POST(req, { params: Promise.resolve({ slug: "ws" }) });
      expect(res.status).toBe(401);
    });
  });

  describe("Request validation", () => {
    beforeEach(() => setupAuth());

    test("returns 400 when slug is empty", async () => {
      const req = makeRequest("", { prompt: "test" });
      const res = await POST(req, { params: Promise.resolve({ slug: "" }) });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "Workspace slug is required" });
    });

    test("returns 400 when prompt is missing", async () => {
      const req = makeRequest("ws", { prompt: "" });
      const res = await POST(req, { params: Promise.resolve({ slug: "ws" }) });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "prompt is required" });
    });

    test("returns 400 when prompt is whitespace only", async () => {
      const req = makeRequest("ws", { prompt: "   " });
      const res = await POST(req, { params: Promise.resolve({ slug: "ws" }) });
      expect(res.status).toBe(400);
    });
  });

  describe("Successful delegation to service", () => {
    beforeEach(() => setupAuth());

    test("returns 200 with answer and sessionId on success", async () => {
      (mockRunLogsAgent as Mock).mockResolvedValue({
        success: true,
        data: { answer: "Here is what happened", sessionId: "sess-1" },
      });
      const req = makeRequest("ws", { prompt: "What went wrong?" });
      const res = await POST(req, { params: Promise.resolve({ slug: "ws" }) });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ answer: "Here is what happened", sessionId: "sess-1" });
    });

    test("forwards prompt, scope, and sessionId to service", async () => {
      (mockRunLogsAgent as Mock).mockResolvedValue({
        success: true,
        data: { answer: "ok", sessionId: "" },
      });
      const req = makeRequest("ws", {
        prompt: "debug run",
        sessionId: "sess-abc",
        scope: { featureIds: ["feat-1"], taskIds: ["task-1"] },
      });
      await POST(req, { params: Promise.resolve({ slug: "ws" }) });
      expect(mockRunLogsAgent).toHaveBeenCalledWith({
        slug: "ws",
        userId: "user-123",
        prompt: "debug run",
        sessionId: "sess-abc",
        scope: { featureIds: ["feat-1"], taskIds: ["task-1"] },
      });
    });
  });

  describe("Error mapping from service", () => {
    beforeEach(() => setupAuth());

    const cases = [
      { name: "WORKSPACE_NOT_FOUND → HTTP 404", error: { type: "WORKSPACE_NOT_FOUND" }, status: 404 },
      { name: "ACCESS_DENIED → HTTP 403", error: { type: "ACCESS_DENIED" }, status: 403 },
      { name: "SWARM_NOT_ACTIVE → HTTP 400", error: { type: "SWARM_NOT_ACTIVE" }, status: 400 },
      { name: "SWARM_NOT_CONFIGURED → HTTP 400", error: { type: "SWARM_NOT_CONFIGURED" }, status: 400 },
      { name: "SWARM_NAME_MISSING → HTTP 400", error: { type: "SWARM_NAME_MISSING" }, status: 400 },
      { name: "AGENT_REQUEST_FAILED → HTTP 502", error: { type: "AGENT_REQUEST_FAILED", statusCode: 503, message: "x" }, status: 502 },
      { name: "NO_REQUEST_ID → HTTP 502", error: { type: "NO_REQUEST_ID" }, status: 502 },
      { name: "AGENT_FAILED → HTTP 502", error: { type: "AGENT_FAILED", message: "boom" }, status: 502 },
      { name: "TIMEOUT → HTTP 504", error: { type: "TIMEOUT" }, status: 504 },
      { name: "UNEXPECTED → HTTP 500", error: { type: "UNEXPECTED", message: "oops" }, status: 500 },
    ];

    test.each(cases)("$name", async ({ error, status }) => {
      (mockRunLogsAgent as Mock).mockResolvedValue({ success: false, error });
      const req = makeRequest("ws", { prompt: "test" });
      const res = await POST(req, { params: Promise.resolve({ slug: "ws" }) });
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(body).toHaveProperty("error");
    });
  });
});
