import { NextRequest, NextResponse } from "next/server";
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("@/services/workspace", () => ({
  getWorkspaceBySlug: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    pod: { findFirst: vi.fn() },
  },
}));

// Use the real POD_BASE_DOMAIN/buildPodUrl/POD_PORTS so URL assertions are
// meaningful.

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { GET } from "@/app/api/w/[slug]/pool/[podId]/frontend-url/route";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceBySlug } from "@/services/workspace";
import { db } from "@/lib/db";

// ── Test data ─────────────────────────────────────────────────────────────

const MOCK_USER = { id: "user-1", email: "u@test.com", name: "Test" };
const MOCK_WORKSPACE = { id: "ws-001", slug: "my-workspace" };

function makeRequest(slug = "my-workspace", podId = "pod-abc"): NextRequest {
  return new NextRequest(
    `http://localhost/api/w/${slug}/pool/${podId}/frontend-url`,
    { method: "GET" },
  );
}

function makeParams(slug = "my-workspace", podId = "pod-abc") {
  return { params: Promise.resolve({ slug, podId }) };
}

function authenticated() {
  vi.mocked(getMiddlewareContext).mockReturnValue({
    authStatus: "authenticated",
    user: MOCK_USER,
  } as never);
  vi.mocked(requireAuth).mockReturnValue(MOCK_USER as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  authenticated();
  vi.mocked(getWorkspaceBySlug).mockResolvedValue(MOCK_WORKSPACE as never);
  vi.mocked(db.pod.findFirst).mockResolvedValue({
    podId: "pod-abc",
    password: "s3cr3t",
  } as never);
});

describe("GET /api/w/[slug]/pool/[podId]/frontend-url", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockReturnValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 404 when workspace is not found", async () => {
    vi.mocked(getWorkspaceBySlug).mockResolvedValue(null as never);
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns 404 when pod doesn't belong to workspace", async () => {
    vi.mocked(db.pod.findFirst).mockResolvedValue(null as never);
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(404);
  });

  it("returns the discovered frontend URL when jlist reports the frontend port", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify([
          { pid: 1, name: "goose", status: "online", port: "15551" },
          { pid: 2, name: "frontend", status: "online", port: "8080" },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await GET(makeRequest(), makeParams());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.frontendUrl).toBe(
      "https://pod-abc-8080.workspaces.sphinx.chat",
    );
    // jlist call hits the control port with Bearer auth.
    const call = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    const [url, init] = call;
    expect(url).toBe("https://pod-abc-15552.workspaces.sphinx.chat/jlist");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer s3cr3t",
    });
  });

  it("falls back to port 3000 when jlist has no frontend process", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify([
            { pid: 1, name: "goose", status: "online", port: "15551" },
          ]),
          { status: 200 },
        ),
      ),
    );

    const res = await GET(makeRequest(), makeParams());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.frontendUrl).toBe(
      "https://pod-abc-3000.workspaces.sphinx.chat",
    );
  });

  it("falls back to port 3000 when jlist request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    const res = await GET(makeRequest(), makeParams());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.frontendUrl).toBe(
      "https://pod-abc-3000.workspaces.sphinx.chat",
    );
  });

  it("falls back to port 3000 when jlist returns non-OK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );

    const res = await GET(makeRequest(), makeParams());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.frontendUrl).toBe(
      "https://pod-abc-3000.workspaces.sphinx.chat",
    );
  });
});
