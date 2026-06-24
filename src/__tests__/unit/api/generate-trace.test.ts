import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";

// --- Mocks ---

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({ userId: "user-1" })),
  requireAuth: vi.fn(() => ({ id: "user-1" })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    agentLog: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(async () => ({
    hasAccess: true,
    canRead: true,
    canWrite: true,
    canAdmin: true,
  })),
}));

vi.mock("@/lib/signed-urls", () => ({
  generateSignedUrl: vi.fn(
    () => "https://example.com/api/agent-logs/log-1/content?sig=abc&expires=9999"
  ),
}));

vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(() => "https://example.com"),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Config mock — use vi.hoisted so the object reference is stable when vi.mock is hoisted
const mockConfig = vi.hoisted(() => ({
  STAKWORK_AGENT_TRACE_WORKFLOW_ID: "12345" as string | undefined,
  STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
  STAKWORK_API_KEY: "test-key",
}));

vi.mock("@/config/env", () => ({ config: mockConfig }));

// fetch mock
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { POST } from "@/app/api/workspaces/[slug]/agent-logs/[logId]/generate-trace/route";
import { db } from "@/lib/db";

function makeRequest(slug = "test-ws", logId = "log-1") {
  return new NextRequest(
    `http://localhost/api/workspaces/${slug}/agent-logs/${logId}/generate-trace`,
    { method: "POST" }
  );
}

function makeParams(slug = "test-ws", logId = "log-1") {
  return { params: Promise.resolve({ slug, logId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.STAKWORK_AGENT_TRACE_WORKFLOW_ID = "12345";
  (db.workspace.findUnique as Mock).mockResolvedValue({ id: "ws-1" });
  (db.agentLog.findFirst as Mock).mockResolvedValue({ id: "log-1" });
  (db.agentLog.update as Mock).mockResolvedValue({ id: "log-1", traceStatus: "pending" });
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { project_id: 99 } }),
  });
});

describe("POST /api/workspaces/[slug]/agent-logs/[logId]/generate-trace", () => {
  test("returns 501 when STAKWORK_AGENT_TRACE_WORKFLOW_ID is not configured", async () => {
    mockConfig.STAKWORK_AGENT_TRACE_WORKFLOW_ID = undefined;

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toContain("not configured");
  });

  test("returns 404 when agent log not found in workspace", async () => {
    (db.agentLog.findFirst as Mock).mockResolvedValue(null);

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  test("sets traceStatus to pending and returns { status: 'pending' }", async () => {
    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("pending");

    expect(db.agentLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "log-1" },
        data: { traceStatus: "pending" },
      })
    );
  });

  test("triggers Stakwork workflow with correct payload", async () => {
    await POST(makeRequest(), makeParams());

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/projects");
    const body = JSON.parse(opts.body);
    expect(body.workflow_id).toBe(12345);
    expect(body.name).toBe("agent-trace-log-1");
    expect(body.workflow_params.set_var.attributes.vars.agentLogId).toBe("log-1");
    expect(body.workflow_params.set_var.attributes.vars.blobUrl).toContain("sig=abc");
    expect(opts.headers.Authorization).toContain("Token token=");
  });

  test("returns 502 when Stakwork call fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "error",
    });

    const res = await POST(makeRequest(), makeParams());
    expect(res.status).toBe(502);
  });
});
