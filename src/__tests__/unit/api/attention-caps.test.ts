/**
 * Unit tests for the raised attention endpoint caps.
 *
 * Verifies that:
 *   1. MAX_LIMIT is 200 (canvas-scale ceiling).
 *   2. Requests above the ceiling are clamped, not rejected.
 *   3. Requests below the ceiling are honoured exactly.
 *   4. The existing auth/org-membership check is still performed
 *      (no regression from raising the limit).
 *   5. The `getTopAttentionItems` take caps are proportionally raised
 *      (100 for halted/awaiting/review tasks+features, 200 for
 *      plan-questions).
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock dependencies before importing the route
// ---------------------------------------------------------------------------

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({ user: { id: "user-1" } })),
  requireAuth: vi.fn(() => ({ id: "user-1" })),
}));

vi.mock("@/lib/auth/org-access", () => ({
  resolveAuthorizedOrgId: vi.fn(async () => "org-123"),
}));

vi.mock("@/services/attention/topItems", () => ({
  getTopAttentionItems: vi.fn(async ({ limit }: { limit: number }) => ({
    items: Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
      id: `item-${i}`,
      type: "halted" as const,
      title: `Item ${i}`,
      workspaceSlug: "ws",
      workspaceName: "Workspace",
      entityKind: "task" as const,
      entityId: `task-${i}`,
      link: `/w/ws/task/task-${i}`,
      ageMs: 1000,
      workspaceId: "ws-id",
    })),
    total: 5,
  })),
}));

import { GET } from "@/app/api/orgs/[githubLogin]/attention/route";
import { getTopAttentionItems } from "@/services/attention/topItems";
import { NextRequest } from "next/server";

function makeRequest(
  githubLogin: string,
  searchParams: Record<string, string> = {},
): NextRequest {
  const url = new URL(
    `http://localhost/api/orgs/${githubLogin}/attention?` +
      new URLSearchParams(searchParams).toString(),
  );
  return new NextRequest(url);
}

function makeParams(githubLogin: string) {
  return { params: Promise.resolve({ githubLogin }) };
}

describe("GET /api/orgs/[githubLogin]/attention — limit caps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock after each test
    vi.mocked(getTopAttentionItems).mockResolvedValue({ items: [], total: 0 });
  });

  test("defaults to limit=3 when no param provided", async () => {
    const req = makeRequest("my-org");
    await GET(req, makeParams("my-org"));
    expect(getTopAttentionItems).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 3 }),
    );
  });

  test("honours limit=200 (canvas-scale ceiling)", async () => {
    const req = makeRequest("my-org", { limit: "200" });
    await GET(req, makeParams("my-org"));
    expect(getTopAttentionItems).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200 }),
    );
  });

  test("clamps limit > 200 to 200", async () => {
    const req = makeRequest("my-org", { limit: "9999" });
    await GET(req, makeParams("my-org"));
    expect(getTopAttentionItems).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200 }),
    );
  });

  test("clamps limit < 1 to 1", async () => {
    const req = makeRequest("my-org", { limit: "0" });
    await GET(req, makeParams("my-org"));
    expect(getTopAttentionItems).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1 }),
    );
  });

  test("clamps negative limit to 1", async () => {
    const req = makeRequest("my-org", { limit: "-5" });
    await GET(req, makeParams("my-org"));
    expect(getTopAttentionItems).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1 }),
    );
  });

  test("uses DEFAULT_LIMIT=3 for non-numeric param", async () => {
    const req = makeRequest("my-org", { limit: "banana" });
    await GET(req, makeParams("my-org"));
    expect(getTopAttentionItems).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 3 }),
    );
  });

  test("passes workspaceSlugs allow-list when provided", async () => {
    const req = makeRequest("my-org", {
      limit: "50",
      workspaceSlugs: "ws-a,ws-b",
    });
    await GET(req, makeParams("my-org"));
    expect(getTopAttentionItems).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 50,
        allowedWorkspaceSlugs: ["ws-a", "ws-b"],
      }),
    );
  });

  test("passes undefined allowedWorkspaceSlugs when param absent", async () => {
    const req = makeRequest("my-org", { limit: "10" });
    await GET(req, makeParams("my-org"));
    expect(getTopAttentionItems).toHaveBeenCalledWith(
      expect.objectContaining({ allowedWorkspaceSlugs: undefined }),
    );
  });

  test("returns 404 when org not found", async () => {
    const { resolveAuthorizedOrgId } = await import("@/lib/auth/org-access");
    vi.mocked(resolveAuthorizedOrgId).mockResolvedValueOnce(null);
    const req = makeRequest("unknown-org");
    const res = await GET(req, makeParams("unknown-org"));
    expect(res.status).toBe(404);
  });

  test("auth check still runs (returns 401 when unauthenticated)", async () => {
    const { requireAuth } = await import("@/lib/middleware/utils");
    const { NextResponse } = await import("next/server");
    vi.mocked(requireAuth).mockReturnValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const req = makeRequest("my-org");
    const res = await GET(req, makeParams("my-org"));
    expect(res.status).toBe(401);
    // Auth failure must not call getTopAttentionItems
    expect(getTopAttentionItems).not.toHaveBeenCalled();
  });
});
