/**
 * Unit tests for GET /api/workspaces/[slug]/legal/benchmarks/recursion/resolve
 *
 * Authorization regression tests:
 *   - unauthenticated requests rejected before any graph call
 *   - non-openlaw workspace slugs rejected before any graph call
 *   - openlaw + valid auth + swarm access → calls resolver
 *   - missing taskSlug → 400
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockResolveEvalSetRefIdBySlug = vi.hoisted(() => vi.fn());

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({})),
  requireAuth: mockRequireAuth,
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: mockGetWorkspaceSwarmAccess,
}));

vi.mock("@/services/legal-benchmark-recursion", () => ({
  resolveEvalSetRefIdBySlug: mockResolveEvalSetRefIdBySlug,
}));

vi.mock("@/lib/utils/swarm", () => ({
  getJarvisUrl: (name: string) => `https://${name}.jarvis.example.com`,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(slug: string, taskSlug?: string): NextRequest {
  const url = `http://localhost/api/workspaces/${slug}/legal/benchmarks/recursion/resolve${taskSlug ? `?taskSlug=${encodeURIComponent(taskSlug)}` : ""}`;
  return new NextRequest(url);
}

async function callRoute(slug: string, taskSlug?: string) {
  const { GET } = await import(
    "@/app/api/workspaces/[slug]/legal/benchmarks/recursion/resolve/route"
  );
  return GET(makeRequest(slug, taskSlug), { params: Promise.resolve({ slug }) });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/legal/benchmarks/recursion/resolve — IDOR/auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 when unauthenticated — no graph call made", async () => {
    const { NextResponse } = await import("next/server");
    mockRequireAuth.mockReturnValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await callRoute("openlaw", "some-task");
    expect(res.status).toBe(401);
    expect(mockGetWorkspaceSwarmAccess).not.toHaveBeenCalled();
    expect(mockResolveEvalSetRefIdBySlug).not.toHaveBeenCalled();
  });

  it("404 for non-openlaw workspace — no graph call made", async () => {
    mockRequireAuth.mockReturnValue({ id: "user-1", email: "user@example.com" });

    const res = await callRoute("other-workspace", "some-task");
    expect(res.status).toBe(404);
    expect(mockGetWorkspaceSwarmAccess).not.toHaveBeenCalled();
    expect(mockResolveEvalSetRefIdBySlug).not.toHaveBeenCalled();
  });

  it("400 when taskSlug param is missing", async () => {
    mockRequireAuth.mockReturnValue({ id: "user-1", email: "user@example.com" });
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: true,
      data: { swarmName: "openlaw-swarm", swarmApiKey: "key-123", workspaceId: "ws-1" },
    });

    const res = await callRoute("openlaw"); // no taskSlug
    expect(res.status).toBe(400);
  });

  it("403 when swarm access denied — resolver not called", async () => {
    mockRequireAuth.mockReturnValue({ id: "user-1", email: "user@example.com" });
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "ACCESS_DENIED" },
    });

    const res = await callRoute("openlaw", "antitrust/task-1");
    expect(res.status).toBe(403);
    expect(mockResolveEvalSetRefIdBySlug).not.toHaveBeenCalled();
  });

  it("200 { refId } on success", async () => {
    mockRequireAuth.mockReturnValue({ id: "user-1", email: "user@example.com" });
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: true,
      data: { swarmName: "openlaw-swarm", swarmApiKey: "key-123", workspaceId: "ws-1" },
    });
    mockResolveEvalSetRefIdBySlug.mockResolvedValue("eval-set-ref-001");

    const res = await callRoute("openlaw", "antitrust/task-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.refId).toBe("eval-set-ref-001");
  });

  it("200 { refId: null } when resolver returns null (not found)", async () => {
    mockRequireAuth.mockReturnValue({ id: "user-1", email: "user@example.com" });
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: true,
      data: { swarmName: "openlaw-swarm", swarmApiKey: "key-123", workspaceId: "ws-1" },
    });
    mockResolveEvalSetRefIdBySlug.mockResolvedValue(null);

    const res = await callRoute("openlaw", "nonexistent/task");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.refId).toBeNull();
  });
});
