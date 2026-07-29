import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import type { Mock } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

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

vi.mock("@/services/janitor", () => {
  const mockCreateJanitorRun = vi.fn();
  return {
    createJanitorRun: mockCreateJanitorRun,
    __mockCreateJanitorRun: mockCreateJanitorRun,
  };
});

vi.mock("@/lib/rate-limit", () => {
  const mockCheckRateLimit = vi.fn();
  return {
    checkRateLimit: mockCheckRateLimit,
    __mockCheckRateLimit: mockCheckRateLimit,
  };
});

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

const workspaceMock = vi.mocked(await import("@/services/workspace"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockValidateWorkspaceAccess = (workspaceMock as any)
  .__mockValidateWorkspaceAccess as Mock;

const janitorMock = vi.mocked(await import("@/services/janitor"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreateJanitorRun = (janitorMock as any).__mockCreateJanitorRun as Mock;

const rateLimitMock = vi.mocked(await import("@/lib/rate-limit"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCheckRateLimit = (rateLimitMock as any).__mockCheckRateLimit as Mock;

const mockGetServerSession = getServerSession as Mock;

const { POST } = await import(
  "@/app/api/workspaces/[slug]/lingo/extract/route"
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SLUG = "test-workspace";
const USER_ID = "user-123";

function makeRequest() {
  return new NextRequest(
    `http://localhost/api/workspaces/${SLUG}/lingo/extract`,
    { method: "POST" },
  );
}

function makeParams() {
  return { params: Promise.resolve({ slug: SLUG }) };
}

function setupSession(userId = USER_ID) {
  mockGetServerSession.mockResolvedValue({ user: { id: userId } });
}

function setupRateLimitAllowed() {
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
}

function setupWriteAccess() {
  mockValidateWorkspaceAccess.mockResolvedValue({
    hasAccess: true,
    canWrite: true,
    workspace: { id: "ws-abc" },
  });
}

const MOCK_RUN = {
  id: "run-xyz",
  janitorType: "LINGO_EXTRACTION",
  status: "IN_PROGRESS",
  triggeredBy: "MANUAL",
  createdAt: new Date("2024-01-01T00:00:00Z"),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/lingo/extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns 401 when no session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await POST(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  test("returns 401 when session has no user id", async () => {
    mockGetServerSession.mockResolvedValue({ user: {} });

    const res = await POST(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  test("returns 429 with Retry-After header when rate limit exceeded", async () => {
    setupSession();
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      retryAfter: 120,
    });

    const res = await POST(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error).toBe("Too many requests");
    expect(res.headers.get("Retry-After")).toBe("120");
  });

  test("returns 429 with fallback Retry-After when retryAfter is undefined", async () => {
    setupSession();
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      retryAfter: undefined,
    });

    const res = await POST(makeRequest(), makeParams());

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("300");
  });

  test("returns 403 when validateWorkspaceAccess denies access", async () => {
    setupSession();
    setupRateLimitAllowed();
    mockValidateWorkspaceAccess.mockResolvedValue({
      hasAccess: false,
      canWrite: false,
    });

    const res = await POST(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
  });

  test("returns 403 when hasAccess is true but canWrite is false", async () => {
    setupSession();
    setupRateLimitAllowed();
    mockValidateWorkspaceAccess.mockResolvedValue({
      hasAccess: true,
      canWrite: false,
    });

    const res = await POST(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
  });

  test("returns 400 with user-friendly message when janitor is disabled", async () => {
    setupSession();
    setupRateLimitAllowed();
    setupWriteAccess();
    mockCreateJanitorRun.mockRejectedValue(
      new Error("This janitor type is not enabled"),
    );

    const res = await POST(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe(
      "Lingo extraction is not enabled for this workspace. Contact your admin to enable it.",
    );
    // Must NOT echo the raw service error string
    expect(body.error).not.toContain("janitor type is not enabled");
  });

  test("returns 403 when INSUFFICIENT_PERMISSIONS is thrown (race-condition branch)", async () => {
    setupSession();
    setupRateLimitAllowed();
    setupWriteAccess();
    mockCreateJanitorRun.mockRejectedValue(
      new Error("Insufficient permissions to perform this action"),
    );

    const res = await POST(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("Forbidden");
  });

  test("returns 400 for invalid janitor type error", async () => {
    setupSession();
    setupRateLimitAllowed();
    setupWriteAccess();
    mockCreateJanitorRun.mockRejectedValue(
      new Error("Invalid janitor type: UNKNOWN"),
    );

    const res = await POST(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid janitor type");
  });

  test("returns 500 with static message for all other errors", async () => {
    setupSession();
    setupRateLimitAllowed();
    setupWriteAccess();
    const rawInternalError =
      "workspace ws-internal-uuid-1234 has no swarm URL or secret alias";
    mockCreateJanitorRun.mockRejectedValue(new Error(rawInternalError));

    const res = await POST(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Extraction could not be started");
    // Must NOT leak raw internal error details to the browser
    expect(body.error).not.toContain("ws-internal-uuid-1234");
    expect(body.error).not.toContain(rawInternalError);
  });

  test("returns 200 with runs array on happy path", async () => {
    setupSession();
    setupRateLimitAllowed();
    setupWriteAccess();
    mockCreateJanitorRun.mockResolvedValue(MOCK_RUN);

    const res = await POST(makeRequest(), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toEqual({
      id: MOCK_RUN.id,
      janitorType: MOCK_RUN.janitorType,
      status: MOCK_RUN.status,
      triggeredBy: MOCK_RUN.triggeredBy,
      createdAt: MOCK_RUN.createdAt.toISOString(),
    });
  });

  test("calls createJanitorRun with LINGO_EXTRACTION and MANUAL trigger", async () => {
    setupSession();
    setupRateLimitAllowed();
    setupWriteAccess();
    mockCreateJanitorRun.mockResolvedValue(MOCK_RUN);

    await POST(makeRequest(), makeParams());

    expect(mockCreateJanitorRun).toHaveBeenCalledWith(
      SLUG,
      USER_ID,
      "LINGO_EXTRACTION",
      "MANUAL",
    );
  });

  test("calls checkRateLimit with correct key (slug + userId)", async () => {
    setupSession();
    setupRateLimitAllowed();
    setupWriteAccess();
    mockCreateJanitorRun.mockResolvedValue(MOCK_RUN);

    await POST(makeRequest(), makeParams());

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      `lingo-extract:${SLUG}:${USER_ID}`,
      3,
      300,
    );
  });

  test("does not have a 409 branch — concurrent run errors fall through to 500", async () => {
    setupSession();
    setupRateLimitAllowed();
    setupWriteAccess();
    mockCreateJanitorRun.mockRejectedValue(
      new Error("A janitor run of this type is already in progress"),
    );

    const res = await POST(makeRequest(), makeParams());
    const body = await res.json();

    // RUN_IN_PROGRESS is never thrown for MANUAL triggers per janitor.ts:402,
    // so there is no 409 branch — it falls through to the generic 500.
    expect(res.status).toBe(500);
    expect(body.error).toBe("Extraction could not be started");
  });
});
