/**
 * Unit tests for GET /api/features/[featureId]/plan-status
 */
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    feature: { findUnique: vi.fn() },
  },
}));

vi.mock("@/services/roadmap/utils", () => ({
  validateFeatureAccess: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { db } = await import("@/lib/db");
const { validateFeatureAccess } = await import("@/services/roadmap/utils");
const { GET } = await import(
  "@/app/api/features/[featureId]/plan-status/route"
);

const mockFindUnique = db.feature.findUnique as Mock;
const mockValidate = validateFeatureAccess as Mock;

const params = { params: Promise.resolve({ featureId: "feat-1" }) };

function makeRequest(authed = true): NextRequest {
  return new NextRequest(
    "http://localhost/api/features/feat-1/plan-status",
    {
      method: "GET",
      headers: authed
        ? {
            [MIDDLEWARE_HEADERS.USER_ID]: "user-1",
            [MIDDLEWARE_HEADERS.USER_EMAIL]: "t@e.com",
            [MIDDLEWARE_HEADERS.USER_NAME]: "T",
            [MIDDLEWARE_HEADERS.AUTH_STATUS]: "authenticated",
          }
        : {},
    },
  );
}

describe("GET /api/features/[featureId]/plan-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidate.mockResolvedValue(undefined);
  });

  it("401 when unauthenticated", async () => {
    const res = await GET(makeRequest(false), params);
    expect(res.status).toBe(401);
    // DB and auth guard should not be called
    expect(mockValidate).not.toHaveBeenCalled();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("403/404 when validateFeatureAccess throws 'denied'", async () => {
    mockValidate.mockRejectedValue(new Error("Access denied"));
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/denied/i);
  });

  it("404 when validateFeatureAccess throws 'not found'", async () => {
    mockValidate.mockRejectedValue(new Error("Feature not found"));
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(404);
  });

  it("returns workflowStatus and hasLogs: true when stakworkProjectId is set", async () => {
    mockFindUnique.mockResolvedValue({
      workflowStatus: "COMPLETED",
      stakworkProjectId: "proj-123",
    });
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      workflowStatus: "COMPLETED",
      hasLogs: true,
    });
  });

  it("returns workflowStatus and hasLogs: false when stakworkProjectId is null", async () => {
    mockFindUnique.mockResolvedValue({
      workflowStatus: "IN_PROGRESS",
      stakworkProjectId: null,
    });
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      workflowStatus: "IN_PROGRESS",
      hasLogs: false,
    });
  });

  it("404 when feature is null after auth (guard against race)", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Feature not found");
  });

  it("queries only workflowStatus and stakworkProjectId (minimal select)", async () => {
    mockFindUnique.mockResolvedValue({
      workflowStatus: "PENDING",
      stakworkProjectId: null,
    });
    await GET(makeRequest(), params);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: "feat-1" },
      select: { workflowStatus: true, stakworkProjectId: true },
    });
  });
});
