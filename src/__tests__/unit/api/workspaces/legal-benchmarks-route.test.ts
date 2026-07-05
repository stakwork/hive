import { describe, test, expect, vi, beforeEach } from "vitest";
import { getServerSession } from "next-auth/next";
import type { Mock } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/services/workspace", () => {
  const mockValidateWorkspaceAccess = vi.fn();
  return {
    validateWorkspaceAccess: mockValidateWorkspaceAccess,
    __mockValidateWorkspaceAccess: mockValidateWorkspaceAccess,
  };
});

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

const workspaceMock = vi.mocked(await import("@/services/workspace"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockValidateWorkspaceAccess = (workspaceMock as any).__mockValidateWorkspaceAccess as Mock;

const mockGetServerSession = getServerSession as Mock;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/legal/benchmarks/tasks", () => {
  let GET: typeof import("@/app/api/workspaces/[slug]/legal/benchmarks/tasks/route").GET;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ GET } = await import(
      "@/app/api/workspaces/[slug]/legal/benchmarks/tasks/route"
    ));
  });

  test("returns 401 for unauthenticated request", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await GET(new Request("http://localhost/"), makeParams("openlaw"));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  test("returns 404 for non-openlaw slug", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "user@test.com" },
    });

    const res = await GET(new Request("http://localhost/"), makeParams("other-workspace"));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  test("returns 404 for stakwork slug", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "user@test.com" },
    });

    const res = await GET(new Request("http://localhost/"), makeParams("stakwork"));

    expect(res.status).toBe(404);
  });

  test("returns 403 when user has no workspace access", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "user@test.com" },
    });
    mockValidateWorkspaceAccess.mockResolvedValue({
      hasAccess: false,
      workspace: null,
    });

    const res = await GET(new Request("http://localhost/"), makeParams("openlaw"));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });

  test("returns 404 when workspace record not found", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "user@test.com" },
    });
    mockValidateWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      workspace: null,
    });

    const res = await GET(new Request("http://localhost/"), makeParams("openlaw"));

    expect(res.status).toBe(404);
  });

  test("returns correct shape for openlaw workspace", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "user@test.com" },
    });
    mockValidateWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      workspace: { id: "ws-1", slug: "openlaw" },
    });

    const res = await GET(new Request("http://localhost/"), makeParams("openlaw"));

    expect(res.status).toBe(200);
    const body = await res.json();

    // Top-level shape
    expect(body).toHaveProperty("practice_areas");
    expect(body).toHaveProperty("total");
    expect(body.total).toBe(1749);
    expect(Array.isArray(body.practice_areas)).toBe(true);

    // 25 practice areas
    expect(body.practice_areas).toHaveLength(25);

    // Each area has required fields
    const firstArea = body.practice_areas[0];
    expect(firstArea).toHaveProperty("slug");
    expect(firstArea).toHaveProperty("label");
    expect(firstArea).toHaveProperty("task_count");
    expect(firstArea).toHaveProperty("tasks");
    expect(Array.isArray(firstArea.tasks)).toBe(true);
    expect(firstArea.task_count).toBe(firstArea.tasks.length);

    // Each task has required fields
    const firstTask = firstArea.tasks[0];
    expect(firstTask).toHaveProperty("slug");
    expect(firstTask).toHaveProperty("title");
    expect(firstTask).toHaveProperty("work_type");
    expect(firstTask).toHaveProperty("tags");
    expect(["draft", "review", "extract", "compare", "identify"]).toContain(
      firstTask.work_type
    );
  });

  test("returns 500 on unexpected error", async () => {
    mockGetServerSession.mockRejectedValue(new Error("DB error"));

    const res = await GET(new Request("http://localhost/"), makeParams("openlaw"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
  });
});
