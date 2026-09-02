/**
 * Unit tests for GET /api/orgs/[githubLogin]/html-pages/[slug]
 *
 * The org body proxy is members-only and must serve the bytes as an
 * opaque download — never `text/html` on Hive's own origin.
 */

import { describe, test, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth/nextauth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  db: { sourceControlOrg: { findFirst: vi.fn() } },
}));
vi.mock("@/services/workspace", () => ({
  validateUserBelongsToOrg: vi.fn(),
}));
vi.mock("@/services/html-pages", () => ({ getHtmlPageBytes: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { getHtmlPageBytes } from "@/services/html-pages";
import { GET } from "@/app/api/orgs/[githubLogin]/html-pages/[slug]/route";

const mockSession = getServerSession as unknown as Mock;
const mockOrgFindFirst = db.sourceControlOrg.findFirst as unknown as Mock;
const mockIsMember = validateUserBelongsToOrg as unknown as Mock;
const mockGetBytes = getHtmlPageBytes as unknown as Mock;

const GITHUB_LOGIN = "acme-org";
const ORG_ID = "org-cuid-1";
const SLUG = "my-page";
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
    mockSession.mockResolvedValue({ user: { id: "user-1" } });
    mockIsMember.mockResolvedValue(true);
    mockOrgFindFirst.mockResolvedValue({ id: ORG_ID });
    mockGetBytes.mockResolvedValue({
      page: { slug: SLUG, s3Key: `orgs/${ORG_ID}/canvas/x.html` },
      bytes: Buffer.from(HTML, "utf8"),
    });
  });

  test("401 when unauthenticated", async () => {
    mockSession.mockResolvedValue(null);
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockGetBytes).not.toHaveBeenCalled();
  });

  test("401 when the session has no user id", async () => {
    mockSession.mockResolvedValue({ user: {} });
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(401);
  });

  test("404 for an authenticated non-member", async () => {
    mockIsMember.mockResolvedValue(false);
    const res = await GET(makeRequest(), params);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Not found" });
    expect(mockGetBytes).not.toHaveBeenCalled();
    expect(mockIsMember).toHaveBeenCalledWith(GITHUB_LOGIN, "user-1");
  });

  test("404 when the org row does not exist", async () => {
    mockOrgFindFirst.mockResolvedValue(null);
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
});
