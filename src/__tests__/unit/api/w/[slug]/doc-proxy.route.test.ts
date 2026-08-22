/**
 * Unit tests for GET /api/w/[slug]/doc-proxy
 *
 * Verifies:
 * - 401 when unauthenticated (no session)
 * - 403 when authenticated but not a workspace member (IDOR protection)
 * - IDOR: no network call fires before auth checks
 * - 400 for non-HTTPS URL (SSRF guard — http://)
 * - 400 for disallowed domain (SSRF guard — e.g. evil.com)
 * - 400 when `url` param is missing
 * - 200 with correct Content-Type on successful proxy
 * - 502 on upstream fetch failure
 * - GitHub token attached for raw.githubusercontent.com
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetServerSession = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

const mockFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    workspaceMember: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
  },
}));

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeRequest(url: string, params: Record<string, string> = {}): NextRequest {
  const searchParams = new URLSearchParams(params);
  return new NextRequest(`https://app.example.com/api/w/test-slug/doc-proxy?${searchParams.toString()}`);
}

function makeParams(slug = "test-slug") {
  return { params: Promise.resolve({ slug }) };
}

// ─── Import after mocks ───────────────────────────────────────────────────────

import { GET } from "@/app/api/w/[slug]/doc-proxy/route";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/w/[slug]/doc-proxy — auth guards", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test("returns 401 when session is null (unauthenticated)", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = makeRequest("https://app.example.com/api/w/test-slug/doc-proxy", {
      url: "https://raw.githubusercontent.com/stakwork/harvey-labs/main/doc.docx",
    });

    const res = await GET(req, makeParams());

    expect(res.status).toBe(401);
    // IDOR: db must NOT have been called before auth check
    expect(mockFindFirst).not.toHaveBeenCalled();
    // No external fetch should have fired
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("returns 403 when user is not a workspace member (IDOR protection)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "outsider@example.com" } });
    // Member lookup returns null → not a member
    mockFindFirst.mockResolvedValue(null);

    const req = makeRequest("https://app.example.com/api/w/test-slug/doc-proxy", {
      url: "https://raw.githubusercontent.com/stakwork/harvey-labs/main/doc.docx",
    });

    const res = await GET(req, makeParams());

    expect(res.status).toBe(403);
    // IDOR: no external fetch should have fired
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("IDOR: auth check fires before any external fetch", async () => {
    // Unauthenticated — no session at all
    mockGetServerSession.mockResolvedValue(null);

    const req = makeRequest("https://app.example.com/api/w/test-slug/doc-proxy", {
      url: "https://raw.githubusercontent.com/stakwork/harvey-labs/main/secret.docx",
    });

    const res = await GET(req, makeParams());

    expect(res.status).toBe(401);
    // Under no circumstances should external fetch be called before auth
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});

describe("GET /api/w/[slug]/doc-proxy — SSRF guard", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Authenticated member for all SSRF tests
    mockGetServerSession.mockResolvedValue({ user: { email: "member@example.com" } });
    mockFindFirst.mockResolvedValue({ id: "member-1" });
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test("returns 400 for non-HTTPS scheme (http://)", async () => {
    const req = makeRequest("https://app.example.com/api/w/test-slug/doc-proxy", {
      url: "http://raw.githubusercontent.com/stakwork/harvey-labs/main/doc.docx",
    });

    const res = await GET(req, makeParams());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/https/i);
    // No external fetch should fire after SSRF rejection
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("returns 400 for disallowed domain (evil.com)", async () => {
    const req = makeRequest("https://app.example.com/api/w/test-slug/doc-proxy", {
      url: "https://evil.com/steal-docs.docx",
    });

    const res = await GET(req, makeParams());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not allowed|domain/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("returns 400 for another disallowed domain (internal.corp.internal)", async () => {
    const req = makeRequest("https://app.example.com/api/w/test-slug/doc-proxy", {
      url: "https://internal.corp.internal/secrets.docx",
    });

    const res = await GET(req, makeParams());

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("returns 400 when `url` param is missing", async () => {
    const req = makeRequest("https://app.example.com/api/w/test-slug/doc-proxy");

    const res = await GET(req, makeParams());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/url.*required/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("GET /api/w/[slug]/doc-proxy — successful proxy", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGetServerSession.mockResolvedValue({ user: { email: "member@example.com" } });
    mockFindFirst.mockResolvedValue({ id: "member-1" });
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test("proxies raw.githubusercontent.com content with correct Content-Type", async () => {
    const fakeDocx = new ArrayBuffer(8);
    const contentType =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    fetchSpy.mockResolvedValueOnce(
      new Response(fakeDocx, {
        status: 200,
        headers: { "Content-Type": contentType },
      })
    );

    const targetUrl =
      "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/corporate/doc.docx";

    const req = makeRequest("https://app.example.com/api/w/test-slug/doc-proxy", {
      url: targetUrl,
    });

    const res = await GET(req, makeParams());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(contentType);
    // Cache-Control must be no-store
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  test("attaches GitHub token for raw.githubusercontent.com host", async () => {
    const originalToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "ghp_test_token_12345";

    try {
      fetchSpy.mockResolvedValueOnce(
        new Response(new ArrayBuffer(4), {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        })
      );

      const targetUrl =
        "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/doc.docx";

      const req = makeRequest("https://app.example.com/api/w/test-slug/doc-proxy", {
        url: targetUrl,
      });

      await GET(req, makeParams());

      // The fetch call should have included the Authorization header
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [fetchedUrl, fetchOptions] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(fetchedUrl).toBe(targetUrl);
      expect((fetchOptions.headers as Record<string, string>)["Authorization"]).toBe(
        "token ghp_test_token_12345"
      );
    } finally {
      if (originalToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalToken;
      }
    }
  });

  test("returns 502 on upstream fetch network failure", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Network failure"));

    const targetUrl =
      "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/doc.docx";

    const req = makeRequest("https://app.example.com/api/w/test-slug/doc-proxy", {
      url: targetUrl,
    });

    const res = await GET(req, makeParams());

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/fetch|upstream/i);
  });

  test("returns 502 when upstream returns non-2xx", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 404, statusText: "Not Found" })
    );

    const targetUrl =
      "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/doc.docx";

    const req = makeRequest("https://app.example.com/api/w/test-slug/doc-proxy", {
      url: targetUrl,
    });

    const res = await GET(req, makeParams());

    expect(res.status).toBe(502);
  });
});
