import { describe, test, expect, vi, beforeEach } from "vitest";
import { getServerSession } from "next-auth/next";
import type { Mock } from "vitest";
import { HARVEY_LAB_TOTAL, HARVEY_LAB_TASKS } from "@/lib/harvey-lab-tasks";

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

    // Total tracks the generated constant — no magic number
    expect(body.total).toBe(HARVEY_LAB_TOTAL);
    expect(Array.isArray(body.practice_areas)).toBe(true);

    // Practice area count matches the generated data
    expect(body.practice_areas).toHaveLength(HARVEY_LAB_TASKS.length);

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

// ─── Structural shape assertions on the generated export ─────────────────────

describe("HARVEY_LAB_TASKS export shape", () => {
  const VALID_WORK_TYPES = new Set(["draft", "review", "extract", "compare", "identify"]);

  test("HARVEY_LAB_TASKS is a non-empty array of practice areas", () => {
    expect(Array.isArray(HARVEY_LAB_TASKS)).toBe(true);
    expect(HARVEY_LAB_TASKS.length).toBeGreaterThan(0);
  });

  test("each practice area has slug, label, and tasks array", () => {
    for (const pa of HARVEY_LAB_TASKS) {
      expect(typeof pa.slug).toBe("string");
      expect(pa.slug.length).toBeGreaterThan(0);
      expect(typeof pa.label).toBe("string");
      expect(pa.label.length).toBeGreaterThan(0);
      expect(Array.isArray(pa.tasks)).toBe(true);
    }
  });

  test("each task has slug, title, valid work_type, and tags array", () => {
    for (const pa of HARVEY_LAB_TASKS) {
      for (const task of pa.tasks) {
        expect(typeof task.slug).toBe("string");
        expect(task.slug.length).toBeGreaterThan(0);
        expect(typeof task.title).toBe("string");
        expect(task.title.length).toBeGreaterThan(0);
        expect(VALID_WORK_TYPES.has(task.work_type)).toBe(true);
        expect(Array.isArray(task.tags)).toBe(true);
      }
    }
  });

  test("HARVEY_LAB_TOTAL equals the sum of all tasks across all practice areas", () => {
    const sum = HARVEY_LAB_TASKS.reduce((acc, pa) => acc + pa.tasks.length, 0);
    expect(HARVEY_LAB_TOTAL).toBe(sum);
  });

  test("task slugs start with their practice area slug", () => {
    for (const pa of HARVEY_LAB_TASKS) {
      for (const task of pa.tasks) {
        expect(task.slug.startsWith(pa.slug + "/")).toBe(true);
      }
    }
  });
});
