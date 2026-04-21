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
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/utils/blob-fetch", () => ({
  fetchBlobContent: vi.fn(),
}));

// Stub the workspace-access validator so this unit stays focused on the
// agent-logs pagination/search paths. Integration coverage owns the
// real membership check.
vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccessById: vi.fn(async () => ({
    hasAccess: true,
    canRead: true,
    canWrite: true,
    canAdmin: true,
    userRole: "OWNER",
    workspace: { id: "ws-1" },
  })),
}));

import { GET } from "@/app/api/agent-logs/route";
import { db } from "@/lib/db";
import { fetchBlobContent } from "@/lib/utils/blob-fetch";

/** Build an authenticated NextRequest */
function makeRequest(query: Record<string, string>) {
  const url = new URL("http://localhost/api/agent-logs");
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const req = new NextRequest(url.toString());
  return req;
}

/** Minimal AgentLog shape returned by findMany */
function makeLog(id: string, content = "log content") {
  return {
    id,
    blobUrl: `http://example.com/blob/${id}`,
    agent: "test-agent",
    stakworkRunId: null,
    taskId: null,
    featureId: null,
    createdAt: new Date(),
    stakworkRun: null,
    feature: null,
    _content: content, // used by fetchBlobContent mock
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------

describe("GET /api/agent-logs — hasMore without search", () => {
  test("hasMore=true when skip + limit < total", async () => {
    const logs = Array.from({ length: 20 }, (_, i) => makeLog(`log-${i}`));
    (db.agentLog.findMany as Mock).mockResolvedValue(logs);
    (db.agentLog.count as Mock).mockResolvedValue(50); // 50 total, skip=0, limit=20

    const res = await GET(
      makeRequest({ workspace_id: "ws-1", limit: "20", skip: "0" })
    );
    const body = await res.json();

    expect(body.hasMore).toBe(true);
  });

  test("hasMore=false when skip + limit >= total", async () => {
    const logs = Array.from({ length: 10 }, (_, i) => makeLog(`log-${i}`));
    (db.agentLog.findMany as Mock).mockResolvedValue(logs);
    (db.agentLog.count as Mock).mockResolvedValue(10); // 10 total, skip=0, limit=20

    const res = await GET(
      makeRequest({ workspace_id: "ws-1", limit: "20", skip: "0" })
    );
    const body = await res.json();

    expect(body.hasMore).toBe(false);
  });
});

describe("GET /api/agent-logs — hasMore with keyword search", () => {
  test("hasMore=false when filtered results < limit", async () => {
    // DB returns 20 logs but only 5 match the blob search
    const logs = Array.from({ length: 20 }, (_, i) => makeLog(`log-${i}`, i < 5 ? "needle" : "hay"));
    (db.agentLog.findMany as Mock).mockResolvedValue(logs);
    (db.agentLog.count as Mock).mockResolvedValue(20);
    (fetchBlobContent as Mock).mockImplementation(async (url: string) => {
      const id = url.split("/").pop()!;
      const idx = parseInt(id.replace("log-", ""), 10);
      return idx < 5 ? "needle" : "hay";
    });

    const res = await GET(
      makeRequest({ workspace_id: "ws-1", limit: "20", skip: "0", search: "needle" })
    );
    const body = await res.json();

    // 5 filtered results < limit 20 → hasMore must be false
    expect(body.hasMore).toBe(false);
    expect(body.data).toHaveLength(5);
  });

  test("hasMore=true when filtered results equal limit", async () => {
    // DB returns 20 logs and all 20 match the blob search
    const logs = Array.from({ length: 20 }, (_, i) => makeLog(`log-${i}`, "needle"));
    (db.agentLog.findMany as Mock).mockResolvedValue(logs);
    (db.agentLog.count as Mock).mockResolvedValue(20);
    (fetchBlobContent as Mock).mockResolvedValue("needle");

    const res = await GET(
      makeRequest({ workspace_id: "ws-1", limit: "20", skip: "0", search: "needle" })
    );
    const body = await res.json();

    // 20 filtered results === limit 20 → hasMore must be true (more may exist)
    expect(body.hasMore).toBe(true);
    expect(body.data).toHaveLength(20);
  });

  test("hasMore=false when search returns 0 results", async () => {
    const logs = Array.from({ length: 5 }, (_, i) => makeLog(`log-${i}`, "no match"));
    (db.agentLog.findMany as Mock).mockResolvedValue(logs);
    (db.agentLog.count as Mock).mockResolvedValue(5);
    (fetchBlobContent as Mock).mockResolvedValue("no match");

    const res = await GET(
      makeRequest({ workspace_id: "ws-1", limit: "20", skip: "0", search: "needle" })
    );
    const body = await res.json();

    expect(body.hasMore).toBe(false);
    expect(body.data).toHaveLength(0);
  });
});
