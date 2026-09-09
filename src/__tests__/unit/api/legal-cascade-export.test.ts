/**
 * GET /api/workspaces/[slug]/legal/benchmarks/cascade/export?runId=...
 *
 * - Access errors from resolveCascadeAccess pass straight through (auth,
 *   openlaw gate, IDOR-guarded run lookup all live there).
 * - A stricter per-user rate limit guards the fan-out.
 * - Success streams one HTML document as an attachment, no-store.
 * - Assembly failures are a 502 JSON error, never a half-built document.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockResolveCascadeAccess = vi.hoisted(() => vi.fn());
const mockAssembleCascadeExport = vi.hoisted(() => vi.fn());
const mockAssembleHtml = vi.hoisted(() => vi.fn());
const mockRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/legal-cascade/server", () => ({
  resolveCascadeAccess: mockResolveCascadeAccess,
}));
vi.mock("@/lib/legal-cascade/export/assemble", () => ({
  assembleCascadeExport: mockAssembleCascadeExport,
}));
vi.mock("@/lib/legal-cascade/export/offline-html", async () => {
  const actual = await vi.importActual<typeof import("@/lib/legal-cascade/export/offline-html")>(
    "@/lib/legal-cascade/export/offline-html",
  );
  return { ...actual, assembleCascadeOfflineHtml: mockAssembleHtml };
});
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockRateLimit }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GET } from "@/app/api/workspaces/[slug]/legal/benchmarks/cascade/export/route";
import { CascadeBundleMissingError } from "@/lib/legal-cascade/export/offline-html";

const ACCESS = {
  userId: "user-1",
  slug: "openlaw",
  workspaceId: "ws-1",
  runId: "run-1",
  projectId: 1,
  baseUrl: "https://swarm:3355",
  apiKey: "k",
  swarmName: "swarm",
  useMocks: false,
};

function call() {
  const req = new NextRequest(
    "http://localhost/api/workspaces/openlaw/legal/benchmarks/cascade/export?runId=run-1",
  );
  return GET(req, { params: Promise.resolve({ slug: "openlaw" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveCascadeAccess.mockResolvedValue(ACCESS);
  mockRateLimit.mockResolvedValue({ allowed: true });
  mockAssembleCascadeExport.mockResolvedValue({
    model: { agents: [], summary: { agents: 2, subAgents: 0, concepts: 0, totalTokens: 0, toolCalls: 0, running: false } },
    peeks: { a: { state: "done", payload: {} } },
    meta: { runId: "run-1", identifier: null, exportedAt: "x", skippedPeeks: [] },
  });
  mockAssembleHtml.mockReturnValue("<!DOCTYPE html><html>héllo</html>");
});

describe("GET cascade/export", () => {
  it("returns the access error untouched", async () => {
    mockResolveCascadeAccess.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await call();
    expect(res.status).toBe(401);
    expect(mockAssembleCascadeExport).not.toHaveBeenCalled();
  });

  it("rate limits per user before doing any work", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
    const res = await call();
    expect(res.status).toBe(429);
    expect(mockRateLimit).toHaveBeenCalledWith("legal-cascade-export:user-1", 10, 60);
    expect(mockAssembleCascadeExport).not.toHaveBeenCalled();
  });

  it("streams the document as an HTML attachment", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="run-trace-run-1\.html"/,
    );
    const body = await res.text();
    expect(body).toBe("<!DOCTYPE html><html>héllo</html>");
    expect(res.headers.get("Content-Length")).toBe(String(Buffer.byteLength(body, "utf8")));

    expect(mockAssembleCascadeExport).toHaveBeenCalledWith(ACCESS);
    expect(mockAssembleHtml).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ runId: "run-1" }) }),
      "Run trace · run-1",
    );
  });

  it("answers 500 with a clear message instead of a blank document when the bundle is missing", async () => {
    mockAssembleHtml.mockImplementation(() => {
      throw new CascadeBundleMissingError("/srv/src/lib/legal-cascade/export/cascade-offline.js");
    });
    const res = await call();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/trace export bundle is not built/i);
    expect(res.headers.get("Content-Type")).toMatch(/json/);
  });

  it("answers 502 JSON when assembly fails", async () => {
    mockAssembleCascadeExport.mockRejectedValue(new Error("stakgraph responded 500"));
    const res = await call();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Failed to build trace export" });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
