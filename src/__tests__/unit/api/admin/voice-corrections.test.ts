import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";
import { GET } from "@/app/api/admin/voice-corrections/route";
import { GET as GETAggregate } from "@/app/api/admin/voice-corrections/aggregate/route";

const mockUserFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockCount = vi.fn();
const mockGroupBy = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
    voiceCorrectionLearning: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      count: (...args: unknown[]) => mockCount(...args),
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
    },
  },
}));

function makeRequest(url: string, role = "SUPER_ADMIN"): NextRequest {
  const req = new NextRequest(url, { method: "GET" });
  req.headers.set(MIDDLEWARE_HEADERS.USER_ID, "admin-1");
  // Simulate what middleware injects
  return req;
}

function makeUnprivilegedRequest(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
  // No USER_ID header → requireSuperAdmin returns 401/403
}

describe("GET /api/admin/voice-corrections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
  });

  test("returns 401 when no user id header is present", async () => {
    const req = makeUnprivilegedRequest("http://localhost/api/admin/voice-corrections");
    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  test("returns 403 when user is not SUPER_ADMIN", async () => {
    mockUserFindUnique.mockResolvedValue({ role: "USER" });

    const req = makeRequest("http://localhost/api/admin/voice-corrections");
    const res = await GET(req);

    expect(res.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  test("returns 200 with paginated data for super admin", async () => {
    mockUserFindUnique.mockResolvedValue({ role: "SUPER_ADMIN" });
    mockFindMany.mockResolvedValue([
      {
        id: "rec-1",
        userId: "u1",
        surface: "task_chat",
        rawTranscript: "ficks the log in",
        preVoiceText: "",
        finalText: "fix the login",
        createdAt: new Date("2026-01-01"),
        user: { id: "u1", name: "Alice", email: "alice@example.com" },
      },
    ]);
    mockCount.mockResolvedValue(1);

    const req = makeRequest("http://localhost/api/admin/voice-corrections?page=1&pageSize=20");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
    expect(body.data).toHaveLength(1);
  });

  test("applies surface filter when provided", async () => {
    mockUserFindUnique.mockResolvedValue({ role: "SUPER_ADMIN" });
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const req = makeRequest("http://localhost/api/admin/voice-corrections?surface=task_chat");
    await GET(req);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ surface: "task_chat" }),
      }),
    );
  });

  test("clamps pageSize to max 100", async () => {
    mockUserFindUnique.mockResolvedValue({ role: "SUPER_ADMIN" });
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const req = makeRequest("http://localhost/api/admin/voice-corrections?pageSize=999");
    await GET(req);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });
});

describe("GET /api/admin/voice-corrections/aggregate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGroupBy.mockResolvedValue([]);
  });

  test("returns 401 when no user id header is present", async () => {
    const req = makeUnprivilegedRequest("http://localhost/api/admin/voice-corrections/aggregate");
    const res = await GETAggregate(req);

    expect(res.status).toBe(401);
    expect(mockGroupBy).not.toHaveBeenCalled();
  });

  test("returns 403 when user is not SUPER_ADMIN", async () => {
    mockUserFindUnique.mockResolvedValue({ role: "USER" });

    const req = makeRequest("http://localhost/api/admin/voice-corrections/aggregate");
    const res = await GETAggregate(req);

    expect(res.status).toBe(403);
    expect(mockGroupBy).not.toHaveBeenCalled();
  });

  test("returns 200 with aggregated data for super admin", async () => {
    mockUserFindUnique.mockResolvedValue({ role: "SUPER_ADMIN" });
    mockGroupBy.mockResolvedValue([
      {
        rawTranscript: "ficks the log in",
        finalText: "fix the login",
        surface: "task_chat",
        _count: { id: 5 },
      },
    ]);

    const req = makeRequest("http://localhost/api/admin/voice-corrections/aggregate");
    const res = await GETAggregate(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      rawTranscript: "ficks the log in",
      finalText: "fix the login",
      surface: "task_chat",
      count: 5,
    });
  });

  test("passes surface filter to groupBy when provided", async () => {
    mockUserFindUnique.mockResolvedValue({ role: "SUPER_ADMIN" });
    mockGroupBy.mockResolvedValue([]);

    const req = makeRequest("http://localhost/api/admin/voice-corrections/aggregate?surface=whiteboard");
    await GETAggregate(req);

    expect(mockGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { surface: "whiteboard" } }),
    );
  });
});
