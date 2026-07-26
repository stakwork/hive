import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Stable mock references ───────────────────────────────────────────────────

const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockGetMiddlewareContext = vi.hoisted(() => vi.fn(() => ({ userId: "user-1" })));
const mockRequireAuth = vi.hoisted(() => vi.fn(() => ({ id: "user-1" })));
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockGetClientIp = vi.hoisted(() => vi.fn(() => "127.0.0.1"));

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: mockGetMiddlewareContext,
  requireAuth: mockRequireAuth,
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: mockGetWorkspaceSwarmAccess,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { GET } from "@/app/api/workspaces/[slug]/legal/benchmarks/tasks/size/[...taskSlug]/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(slug: string, taskSlugParts: string[]) {
  const taskPath = taskSlugParts.join("/");
  const url = `http://localhost/api/workspaces/${slug}/legal/benchmarks/tasks/size/${taskPath}`;
  const req = new NextRequest(url, { method: "GET" });
  return {
    req,
    params: Promise.resolve({ slug, taskSlug: taskSlugParts }),
  };
}

const MOCK_DOCUMENTS_API = [
  { type: "file", name: "contract.pdf", size: 102400 },
  { type: "file", name: "exhibit-a.docx", size: 51200 },
  { type: "dir", name: "attachments", size: 0 },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/legal/benchmarks/tasks/size/[...taskSlug]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetMiddlewareContext.mockReturnValue({ userId: "user-1" });
    mockRequireAuth.mockReturnValue({ id: "user-1" });
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: true,
      data: { workspaceId: "ws-1" },
    });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockGetClientIp.mockReturnValue("127.0.0.1");
  });

  test("returns 404 for non-openlaw workspace slug", async () => {
    const { req, params } = makeRequest("other-workspace", ["contracts", "review-contract"]);
    const res = await GET(req, { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  test("returns 400 for invalid taskSlug — path traversal ../", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const { req, params } = makeRequest("openlaw", ["..", "evil"]);
    const res = await GET(req, { params });
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("returns 400 for invalid taskSlug — uppercase characters", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const { req, params } = makeRequest("openlaw", ["Contracts", "ReviewContract"]);
    const res = await GET(req, { params });
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("returns 400 for invalid taskSlug — special characters", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const { req, params } = makeRequest("openlaw", ["..%2Fevil"]);
    const res = await GET(req, { params });
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("returns correct { total_source_size_bytes, files } for valid task with blob entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => MOCK_DOCUMENTS_API,
      }),
    );

    const { req, params } = makeRequest("openlaw", ["contracts", "review-contract"]);
    const res = await GET(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    // Only file-type entries are included
    expect(body.files).toHaveLength(2);
    expect(body.files[0]).toMatchObject({ name: "contract.pdf", size: 102400 });
    expect(body.files[1]).toMatchObject({ name: "exhibit-a.docx", size: 51200 });
    // Total is the sum of file sizes only (dir excluded)
    expect(body.total_source_size_bytes).toBe(102400 + 51200);
  });

  test("returns { total_source_size_bytes: 0, files: [] } when all entries have type !== 'file'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { type: "dir", name: "subdirectory", size: 0 },
          { type: "symlink", name: "link", size: 0 },
        ],
      }),
    );

    const { req, params } = makeRequest("openlaw", ["contracts", "no-files-task"]);
    const res = await GET(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.files).toEqual([]);
    expect(body.total_source_size_bytes).toBe(0);
  });

  test("returns 502 on GitHub API non-2xx — body contains no upstream status text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: async () => ({ message: "API rate limit exceeded" }),
      }),
    );

    const { req, params } = makeRequest("openlaw", ["contracts", "some-task"]);
    const res = await GET(req, { params });
    expect(res.status).toBe(502);

    const body = await res.json();
    // Must not echo GitHub status text or error detail
    expect(body.error).not.toContain("Forbidden");
    expect(body.error).not.toContain("rate limit");
    expect(body.error).not.toContain("403");
    expect(typeof body.error).toBe("string");
  });

  test("returns 429 when rate limit is exceeded — fetch is not called", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false });
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const { req, params } = makeRequest("openlaw", ["contracts", "review-contract"]);
    const res = await GET(req, { params });
    expect(res.status).toBe(429);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("returns 403 when swarm access is denied", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "ACCESS_DENIED" },
    });

    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const { req, params } = makeRequest("openlaw", ["contracts", "some-task"]);
    const res = await GET(req, { params });
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("reconstructs slug with / from catch-all segments and calls correct GitHub URL", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    vi.stubGlobal("fetch", mockFetch);

    const { req, params } = makeRequest("openlaw", ["white-collar-defense", "grand-jury", "review"]);
    await GET(req, { params });

    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("white-collar-defense/grand-jury/review/documents");
  });
});
