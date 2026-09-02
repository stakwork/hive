/**
 * Unit tests for `/org/[githubLogin]/h/[slug]` (`HtmlSharePage`).
 *
 * The page adds its own explicit row-level authorization check (via
 * `resolveAuthorizedOrgId`) on top of the org layout's session/membership
 * gate, then scopes the `HtmlPage` lookup to the resolved `orgId` + `slug`.
 * Non-member and cross-org-slug cases must both `notFound()` identically —
 * this test asserts that indistinguishability directly, rather than just
 * checking a status code, since the page component itself throws
 * `next/navigation`'s `notFound()` marker rather than returning a response.
 */
import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";

// The page component under test is an async server component that returns
// JSX directly (not via `render()`), so the classic JSX runtime's implicit
// `React.createElement` calls need `React` reachable as a global — same
// pattern used by `AgentLogDetailPage.test.tsx` for the same reason.
globalThis.React = React;

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth/nextauth", () => ({ authOptions: {} }));
vi.mock("@/lib/auth/org-access", () => ({ resolveAuthorizedOrgId: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { htmlPage: { findUnique: vi.fn() } },
}));
vi.mock("@/components/html-artifact/HtmlArtifactFrame", () => ({
  HtmlArtifactFrame: () => null,
}));

// `notFound()` in a real Next.js request throws a special digest-bearing
// error that aborts rendering. Mirror that here so the page's control
// flow (which relies on `notFound()` never returning) is exercised the
// same way it would be in production.
class NextNotFoundError extends Error {
  digest = "NEXT_NOT_FOUND";
}
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new NextNotFoundError();
  }),
}));

import { getServerSession } from "next-auth/next";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import HtmlSharePage from "@/app/org/[githubLogin]/h/[slug]/page";

const mockSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockResolveAuthorizedOrgId = resolveAuthorizedOrgId as unknown as ReturnType<typeof vi.fn>;
const mockFindUnique = db.htmlPage.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockNotFound = notFound as unknown as ReturnType<typeof vi.fn>;

const GITHUB_LOGIN = "acme-org";
const ORG_ID = "org-cuid-1";
const SLUG = "my-page";
const USER_ID = "user-1";

function makeParams() {
  return Promise.resolve({ githubLogin: GITHUB_LOGIN, slug: SLUG });
}

async function renderOrCatch() {
  try {
    return { result: await HtmlSharePage({ params: makeParams() }) };
  } catch (e) {
    return { error: e };
  }
}

describe("HtmlSharePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSession.mockResolvedValue({ user: { id: USER_ID } });
    mockResolveAuthorizedOrgId.mockResolvedValue(ORG_ID);
    mockFindUnique.mockResolvedValue({
      title: "My Page",
      uploadedAt: new Date("2024-01-01T00:00:00Z"),
    });
  });

  test("renders when the caller is an org member and the page exists in this org", async () => {
    const { result, error } = await renderOrCatch();
    expect(error).toBeUndefined();
    expect(result).toBeDefined();
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { orgId_slug: { orgId: ORG_ID, slug: SLUG } },
      select: { title: true, uploadedAt: true },
    });
  });

  test("404s when there is no session (defensive fallback)", async () => {
    mockSession.mockResolvedValue(null);
    const { error } = await renderOrCatch();
    expect(error).toBeInstanceOf(Error);
    expect(mockResolveAuthorizedOrgId).not.toHaveBeenCalled();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test("404s for a non-member — resolveAuthorizedOrgId returns null", async () => {
    mockResolveAuthorizedOrgId.mockResolvedValue(null);
    const { error } = await renderOrCatch();
    expect(error).toBeInstanceOf(Error);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  test("404s for a cross-org slug — page belongs to a different org", async () => {
    // resolveAuthorizedOrgId succeeds (caller IS a member of *some* org),
    // but the (orgId, slug) compound lookup finds nothing because the
    // page lives under a different org.
    mockFindUnique.mockResolvedValue(null);
    const { error } = await renderOrCatch();
    expect(error).toBeInstanceOf(Error);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { orgId_slug: { orgId: ORG_ID, slug: SLUG } },
      select: { title: true, uploadedAt: true },
    });
  });

  test("non-member and cross-org-slug both call notFound() — indistinguishable outcomes", async () => {
    mockResolveAuthorizedOrgId.mockResolvedValue(null);
    await renderOrCatch();
    const nonMemberCallCount = mockNotFound.mock.calls.length;
    expect(nonMemberCallCount).toBeGreaterThan(0);

    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: USER_ID } });
    mockResolveAuthorizedOrgId.mockResolvedValue(ORG_ID);
    mockFindUnique.mockResolvedValue(null);
    await renderOrCatch();
    const crossOrgCallCount = mockNotFound.mock.calls.length;
    expect(crossOrgCallCount).toBeGreaterThan(0);

    // Both paths produce exactly the same observable outcome: a call to
    // notFound() with no arguments, no distinguishing status/error detail
    // leaked to the caller.
    expect(mockNotFound.mock.calls[0]).toEqual([]);
  });

  test("resolveAuthorizedOrgId is called with requireAdmin=false", async () => {
    await renderOrCatch();
    expect(mockResolveAuthorizedOrgId).toHaveBeenCalledWith(GITHUB_LOGIN, USER_ID, false);
  });

  test("never selects or exposes shareRef", async () => {
    await renderOrCatch();
    const call = mockFindUnique.mock.calls[0][0];
    expect(call.select).not.toHaveProperty("shareRef");
  });
});
