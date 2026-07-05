import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Stable mock references ───────────────────────────────────────────────────

const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockGetMiddlewareContext = vi.hoisted(() => vi.fn(() => ({ userId: "user-1" })));
const mockRequireAuth = vi.hoisted(() => vi.fn(() => ({ id: "user-1" })));

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: mockGetMiddlewareContext,
  requireAuth: mockRequireAuth,
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: mockGetWorkspaceSwarmAccess,
}));

import { GET } from "@/app/api/workspaces/[slug]/legal/benchmarks/tasks/[...taskSlug]/details/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(slug: string, taskSlugParts: string[]) {
  const taskPath = taskSlugParts.join("/");
  const url = `http://localhost/api/workspaces/${slug}/legal/benchmarks/tasks/${taskPath}/details`;
  const req = new NextRequest(url, { method: "GET" });
  return {
    req,
    params: Promise.resolve({ slug, taskSlug: taskSlugParts }),
  };
}

const MOCK_TASK_JSON = {
  title: "Grand Jury Subpoena Review",
  instructions: "Review the attached grand jury subpoena and advise.",
  criteria: [
    { id: "C1", title: "Scope assessment", match_criteria: "Correctly identifies the scope of the subpoena." },
    { id: "C2", title: "Privilege analysis", match_criteria: "Identifies potential privilege issues." },
  ],
};

const MOCK_DOCUMENTS_API = [
  { type: "file", name: "subpoena.pdf", html_url: "https://github.com/stakwork/harvey-labs/blob/main/tasks/wcd/gjs/documents/subpoena.pdf", download_url: "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/wcd/gjs/documents/subpoena.pdf" },
  { type: "dir", name: "attachments", html_url: "...", download_url: null },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/legal/benchmarks/tasks/[...taskSlug]/details", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetMiddlewareContext.mockReturnValue({ userId: "user-1" });
    mockRequireAuth.mockReturnValue({ id: "user-1" });
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: true,
      data: { workspaceId: "ws-1" },
    });
  });

  test("returns 404 for non-openlaw slug", async () => {
    const { req, params } = makeRequest("other-workspace", ["contracts", "review-contract"]);
    const res = await GET(req, { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  test("returns correct response shape for valid task", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_TASK_JSON,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => MOCK_DOCUMENTS_API,
        }),
    );

    const { req, params } = makeRequest("openlaw", ["white-collar-defense-investigations", "grand-jury-subpoena-review"]);
    const res = await GET(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.title).toBe("Grand Jury Subpoena Review");
    expect(body.instructions).toBe("Review the attached grand jury subpoena and advise.");
    expect(body.criteria).toHaveLength(2);
    expect(body.criteria[0]).toMatchObject({ id: "C1", title: "Scope assessment" });

    // Only file-type entries are returned
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]).toMatchObject({
      name: "subpoena.pdf",
      url: expect.stringContaining("subpoena.pdf"),
      download_url: expect.stringContaining("subpoena.pdf"),
    });
  });

  test("reconstructs slug with / from catch-all segments", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_TASK_JSON })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", mockFetch);

    const { req, params } = makeRequest("openlaw", ["contracts", "review", "complex-task"]);
    await GET(req, { params });

    // task.json fetch should use the joined slug
    const taskFetchUrl: string = mockFetch.mock.calls[0][0];
    expect(taskFetchUrl).toContain("contracts/review/complex-task/task.json");
  });

  test("returns 502 when task.json fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" })
        .mockResolvedValueOnce({ ok: true, json: async () => [] }),
    );

    const { req, params } = makeRequest("openlaw", ["contracts", "bad-slug"]);
    const res = await GET(req, { params });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/failed to fetch task data/i);
  });

  test("returns empty documents array when docs API returns 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_TASK_JSON })
        .mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" }),
    );

    const { req, params } = makeRequest("openlaw", ["contracts", "no-docs-task"]);
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.documents).toEqual([]);
    expect(body.title).toBe(MOCK_TASK_JSON.title);
  });

  test("returns 403 when swarm access is denied", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "ACCESS_DENIED" },
    });

    vi.stubGlobal("fetch", vi.fn());

    const { req, params } = makeRequest("openlaw", ["contracts", "some-task"]);
    const res = await GET(req, { params });
    expect(res.status).toBe(403);
  });

  test("returns null for missing fields in task.json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // empty task.json
        .mockResolvedValueOnce({ ok: true, json: async () => [] }),
    );

    const { req, params } = makeRequest("openlaw", ["contracts", "sparse-task"]);
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBeNull();
    expect(body.instructions).toBeNull();
    expect(body.criteria).toBeNull();
    expect(body.documents).toEqual([]);
  });
});
