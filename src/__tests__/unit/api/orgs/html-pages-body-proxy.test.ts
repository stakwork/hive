/**
 * Unit tests for GET /api/orgs/[githubLogin]/html-pages/[slug]
 *
 * The org body proxy is members-only and must serve the bytes as an
 * opaque download — never `text/html` on Hive's own origin.
 *
 * Authorization goes through `resolveAuthorizedOrgId` (shared with the
 * canvas/node/[liveId] route and org-resource CRUD routes) via the
 * `getMiddlewareContext`/`requireAuth` pattern, rather than a direct
 * `getServerSession` + `validateUserBelongsToOrg` call.
 */

import { describe, test, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));
vi.mock("@/lib/auth/org-access", () => ({
  resolveAuthorizedOrgId: vi.fn(),
}));
vi.mock("@/services/html-pages", () => ({ getHtmlPageBytes: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { getHtmlPageBytes } from "@/services/html-pages";
import { checkRateLimit } from "@/lib/rate-limit";
import { GET } from "@/app/api/orgs/[githubLogin]/html-pages/[slug]/route";

const mockGetMiddlewareContext = getMiddlewareContext as unknown as Mock;
const mockRequireAuth = requireAuth as unknown as Mock;
const mockResolveAuthorizedOrgId = resolveAuthorizedOrgId as unknown as Mock;
const mockGetBytes = getHtmlPageBytes as unknown as Mock;
const mockCheckRateLimit = checkRateLimit as unknown as Mock;

const GITHUB_LOGIN = "acme-org";
const ORG_ID = "org-cuid-1";
const SLUG = "my-page";
const USER_ID = "user-1";
const HTML = "<!DOCTYPE html><html><body>hello</body></html>";

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/orgs/${GITHUB_LOGIN}/html-pages/${SLUG}`,
    { method: "GET" },
  );
}

const params = { params: Promise.resolve({ githubLogin: GITHUB_LOGIN, slug: SLUG }) };

describe("GET /api/orgs/[githubLogin]/html-pages/[slug]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    mockGetMiddlewareContext.mockReturnValue({ user: { id: USER_ID } });
    mockRequireAuth.mockReturnValue({ id: USER_ID });
    mockResolveAuthorizedOrgId.mockResolvedValue(ORG_ID);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockGetBytes.mockResolvedValue({
      page: { slug: SLUG, s3Key: `orgs/${ORG_ID}/canvas/x.html` },
      bytes: Buffer.from(HTML, "utf8"),
    });
  });

  test("401 when unauthenticated", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockRequireAuth.mockReturnValue(unauthorized);

    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(401);
    expect(mockResolveAuthorizedOrgId).not.toHaveBeenCalled();
    expect(mockGetBytes).not.toHaveBeenCalled();
  });

  test("404 for an authenticated non-member (resolveAuthorizedOrgId returns null)", async () => {
    mockResolveAuthorizedOrgId.mockResolvedValue(null);

    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Not found" });
    expect(mockGetBytes).not.toHaveBeenCalled();
    expect(mockResolveAuthorizedOrgId).toHaveBeenCalledWith(GITHUB_LOGIN, USER_ID, false);
  });

  test("404 when the org row does not exist (resolveAuthorizedOrgId returns null)", async () => {
    // resolveAuthorizedOrgId is the single source of "org exists AND
    // caller is a member" — a missing org and a non-member are
    // deliberately indistinguishable at this layer.
    mockResolveAuthorizedOrgId.mockResolvedValue(null);

    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(404);
    expect(mockGetBytes).not.toHaveBeenCalled();
  });

  test("404 for a member requesting a slug owned by another org", async () => {
    // The page exists — but not under this org's (orgId, slug) scope.
    mockGetBytes.mockImplementation(async (orgId: string) =>
      orgId === "other-org-id"
        ? { page: {}, bytes: Buffer.from(HTML) }
        : null,
    );
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Not found" });
    expect(mockGetBytes).toHaveBeenCalledWith(ORG_ID, SLUG);
  });

  test("200 returns the bytes with opaque-download headers", async () => {
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer()).toString("utf8");
    expect(body).toBe(HTML);

    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  test("200 response Content-Type is never text/html", async () => {
    const res = await GET(makeRequest(), params);
    const contentType = res.headers.get("Content-Type") ?? "";
    expect(contentType).not.toContain("text/html");
    expect(contentType).not.toMatch(/html/i);
  });

  test("does not redirect to a presigned S3 URL", async () => {
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("Location")).toBeNull();
  });

  test("resolves bytes by (orgId, slug) — never by a caller-supplied key", async () => {
    await GET(makeRequest(), params);
    expect(mockGetBytes).toHaveBeenCalledTimes(1);
    expect(mockGetBytes).toHaveBeenCalledWith(ORG_ID, SLUG);
  });

  test("passes requireAdmin=false to resolveAuthorizedOrgId", async () => {
    await GET(makeRequest(), params);
    expect(mockResolveAuthorizedOrgId).toHaveBeenCalledWith(GITHUB_LOGIN, USER_ID, false);
  });

  test("429 when the rate limit is exceeded, before any bytes are read", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });

    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(mockResolveAuthorizedOrgId).not.toHaveBeenCalled();
    expect(mockGetBytes).not.toHaveBeenCalled();
  });

  test("rate limit key is scoped per authenticated user", async () => {
    await GET(makeRequest(), params);
    const [key] = mockCheckRateLimit.mock.calls[0];
    expect(key).toContain(USER_ID);
  });
});
