import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockGetMiddlewareContext = vi.hoisted(() => vi.fn());
const mockValidateWorkspaceAccess = vi.hoisted(() => vi.fn());
const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockFetchOpenHealthInstances = vi.hoisted(() => vi.fn());

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: mockGetMiddlewareContext,
  requireAuth: mockRequireAuth,
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: mockValidateWorkspaceAccess,
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: mockGetWorkspaceSwarmAccess,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock("@/lib/openhealth-benchmarks/scorer-client", () => ({
  fetchOpenHealthInstances: mockFetchOpenHealthInstances,
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const USER_ID = "user-1";

function makeRequest(slug: string, query = "") {
  return new NextRequest(`http://localhost/api/workspaces/${slug}/openhealth/benchmarks/tasks${query}`);
}

function setupHappyPath() {
  mockGetMiddlewareContext.mockReturnValue({});
  mockRequireAuth.mockReturnValue({ id: USER_ID });
  mockValidateWorkspaceAccess.mockResolvedValue({ canRead: true, canWrite: true });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockGetWorkspaceSwarmAccess.mockResolvedValue({
    success: true,
    data: { swarmUrl: "https://swarm.example.com/api", swarmApiKey: "swarm-key" },
  });
  mockFetchOpenHealthInstances.mockResolvedValue({ rows: [], total: 0 });
}

describe("GET /api/workspaces/[slug]/openhealth/benchmarks/tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPath();
  });

  test("returns 404 for a non-hive slug BEFORE any access check", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("openlaw");
    const res = await GET(req, { params: Promise.resolve({ slug: "openlaw" }) });
    expect(res.status).toBe(404);
    expect(mockValidateWorkspaceAccess).not.toHaveBeenCalled();
  });

  test("returns 404 for the openhealth slug BEFORE any access check", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("openhealth");
    const res = await GET(req, { params: Promise.resolve({ slug: "openhealth" }) });
    expect(res.status).toBe(404);
    expect(mockValidateWorkspaceAccess).not.toHaveBeenCalled();
  });

  test("returns 404 (not 403) for a non-member of hive", async () => {
    mockValidateWorkspaceAccess.mockResolvedValue({ canRead: false, canWrite: false });
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(404);
  });

  test("a viewer (canRead only) may read", async () => {
    mockValidateWorkspaceAccess.mockResolvedValue({ canRead: true, canWrite: false });
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(200);
  });

  test("fails closed with 503 when the rate limiter throws, before any upstream call", async () => {
    mockCheckRateLimit.mockRejectedValue(new Error("redis down"));
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(503);
    expect(mockGetWorkspaceSwarmAccess).not.toHaveBeenCalled();
    expect(mockFetchOpenHealthInstances).not.toHaveBeenCalled();
  });

  test("defaults split to public when omitted", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(200);
    expect(mockFetchOpenHealthInstances).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ split: "public" }),
    );
  });

  test("rejects split=train with 400", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive", "?split=train");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(400);
    expect(mockFetchOpenHealthInstances).not.toHaveBeenCalled();
  });

  test("rejects an empty split value with 400", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive", "?split=");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(400);
  });

  test("accepts split=heldout explicitly", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive", "?split=heldout");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(200);
    expect(mockFetchOpenHealthInstances).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ split: "heldout" }),
    );
  });

  test("rejects an unknown task with 400", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive", "?task=unknown_task");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(400);
    expect(mockFetchOpenHealthInstances).not.toHaveBeenCalled();
  });

  test("passes split/task as bound parameters, not interpolated strings", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive", "?split=heldout&task=context_summarization");
    await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(mockFetchOpenHealthInstances).toHaveBeenCalledWith(
      "https://swarm.example.com/api",
      "swarm-key",
      expect.objectContaining({ split: "heldout", task: "context_summarization" }),
    );
  });

  test("resolves swarm access with the literal hive slug, and passes the hive swarm URL/key to the scorer", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive");
    await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(mockGetWorkspaceSwarmAccess).toHaveBeenCalledWith("hive", USER_ID);
    expect(mockFetchOpenHealthInstances).toHaveBeenCalledWith(
      "https://swarm.example.com/api",
      "swarm-key",
      expect.any(Object),
    );
  });

  test("caps limit at the server maximum even when a larger value is requested", async () => {
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive", "?limit=99999");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(200);
    const call = mockFetchOpenHealthInstances.mock.calls[0][2];
    expect(call.limit).toBeLessThanOrEqual(100);
  });

  test("drops gold keys even when the upstream body contains them", async () => {
    mockFetchOpenHealthInstances.mockResolvedValue({
      rows: [
        {
          gt_id: "gt-1",
          task: "patient_diagnosis",
          granularity: "note",
          split: "public",
          patient_id: "p-1",
          encounter_id: "e-1",
          difficulty: "easy",
          ground_truth: { secret: true },
          groundTruth: { secret: true },
          gold: "leak",
        },
      ],
    });
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    const body = await res.json();
    expect(body.rows[0]).not.toHaveProperty("ground_truth");
    expect(body.rows[0]).not.toHaveProperty("groundTruth");
    expect(body.rows[0]).not.toHaveProperty("gold");
    expect(body.rows[0].gt_id).toBe("gt-1");
  });

  test("returns 503 when the swarm is not configured", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({ success: false, error: { type: "SWARM_NOT_CONFIGURED" } });
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(503);
  });

  test("returns 502 when the scorer fetch throws", async () => {
    mockFetchOpenHealthInstances.mockRejectedValue(new Error("scorer down"));
    const { GET } = await import("@/app/api/workspaces/[slug]/openhealth/benchmarks/tasks/route");
    const req = makeRequest("hive");
    const res = await GET(req, { params: Promise.resolve({ slug: "hive" }) });
    expect(res.status).toBe(502);
  });
});
