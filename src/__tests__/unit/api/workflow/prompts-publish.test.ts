import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
    },
    artifact: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("@/lib/runtime");
vi.mock("@/services/prompts/prompt-sync", () => ({
  publishVersion: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: vi.fn().mockReturnValue("1.2.3.4"),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { db } from "@/lib/db";
import * as runtime from "@/lib/runtime";
import { publishVersion } from "@/services/prompts/prompt-sync";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createAuthenticatedPostRequest,
  createPostRequest,
} from "@/__tests__/support/helpers/request-builders";
import { API_TOKEN_ACTOR } from "@/lib/auth/api-token";

const TEST_URL = "/api/workflow/prompts/prompt-123/versions/version-456/publish";
const TEST_API_TOKEN = "test-publish-api-token";

const mockUser = { id: "user-1", email: "test@example.com", name: "Test User" };

const mockParams = (id: string, versionId: string) => ({
  params: Promise.resolve({ id, versionId }),
});

function makeTokenRequest(url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-token": TEST_API_TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("POST /api/workflow/prompts/[id]/versions/[versionId]/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runtime.isDevelopmentMode).mockReturnValue(false);
    vi.mocked(publishVersion).mockResolvedValue(undefined as never);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true });
    // Default: no API token in env
    delete process.env.API_TOKEN;
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when no middleware auth headers are present", async () => {
    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = new NextRequest(`http://localhost${TEST_URL}`, { method: "POST" });
    const response = await POST(request, mockParams("prompt-123", "version-456"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 401 when authStatus is authenticated but name is missing (incomplete identity)", async () => {
    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const base = createPostRequest(TEST_URL, {});
    const headers = new Headers(base.headers);
    headers.set("x-middleware-auth-status", "authenticated");
    headers.set("x-middleware-user-id", "user-1");
    headers.set("x-middleware-user-email", "test@example.com");
    // x-middleware-user-name intentionally omitted
    const request = new NextRequest(`http://localhost${TEST_URL}`, {
      method: "POST",
      headers,
    });

    const response = await POST(request, mockParams("prompt-123", "version-456"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 401 when x-api-token is invalid and no session", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;
    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = new NextRequest(`http://localhost${TEST_URL}`, {
      method: "POST",
      headers: { "x-api-token": "wrong-token" },
    });
    const response = await POST(request, mockParams("prompt-123", "version-456"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  // ── Membership ────────────────────────────────────────────────────────────

  it("returns 403 when authenticated user is not a stakwork workspace member", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue(null);

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(TEST_URL, mockUser, {});
    const response = await POST(request, mockParams("prompt-123", "version-456"));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain("Access denied");
  });

  // ── Happy path (session) ──────────────────────────────────────────────────

  it("returns 200 and calls publishVersion with actor=userId on success (session)", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(TEST_URL, mockUser, {});
    const response = await POST(request, mockParams("prompt-123", "version-456"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(publishVersion).toHaveBeenCalledWith("prompt-123", "version-456", "ws-1", mockUser.id);
    // Workspace membership check used the userId from middleware
    expect(vi.mocked(db.workspace.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { ownerId: mockUser.id },
          ]),
        }),
      })
    );
  });

  it("publishedBy is set to userId on session publish", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(TEST_URL, mockUser, {});
    await POST(request, mockParams("prompt-123", "version-456"));

    // Verify publishVersion received userId as the actor
    expect(publishVersion).toHaveBeenCalledWith(
      "prompt-123", "version-456", "ws-1", mockUser.id
    );
  });

  // ── Happy path (api-token) ────────────────────────────────────────────────

  it("returns 200 when valid x-api-token is provided (no session required)", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = makeTokenRequest(TEST_URL);
    const response = await POST(request, mockParams("prompt-123", "version-456"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
  });

  it("calls publishVersion with actor=API_TOKEN_ACTOR on token publish", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = makeTokenRequest(TEST_URL);
    await POST(request, mockParams("prompt-123", "version-456"));

    expect(publishVersion).toHaveBeenCalledWith(
      "prompt-123", "version-456", "ws-1", API_TOKEN_ACTOR
    );
  });

  it("token branch does NOT check stakwork membership (no ownerId/members filter)", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = makeTokenRequest(TEST_URL);
    await POST(request, mockParams("prompt-123", "version-456"));

    // Token branch uses slug only — no ownerId / members check
    expect(db.workspace.findFirst).toHaveBeenCalledWith({ where: { slug: "stakwork" } });
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────

  it("returns 429 with Retry-After when rate limit is exceeded for token requests", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, retryAfter: 42 });

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = makeTokenRequest(TEST_URL);
    const response = await POST(request, mockParams("prompt-123", "version-456"));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    // publishVersion must NOT be called
    expect(publishVersion).not.toHaveBeenCalled();
  });

  it("uses a publish-specific rate-limit key distinct from the edit key", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = makeTokenRequest(TEST_URL);
    await POST(request, mockParams("prompt-123", "version-456"));

    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.stringContaining("prompts:publish:api-token:"),
      30,
      60,
    );
    // Must NOT use the sibling edit key
    expect(checkRateLimit).not.toHaveBeenCalledWith(
      expect.stringContaining("prompts:api-token:"),
      expect.anything(),
      expect.anything(),
    );
  });

  // ── Artifact update ───────────────────────────────────────────────────────

  it("calls artifact update when artifactId is supplied in body (session)", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);
    vi.mocked(db.artifact.findUnique).mockResolvedValue({
      id: "artifact-1",
      content: { foo: "bar" },
      message: {
        task: { workspaceId: "ws-1" },
      },
    } as never);
    vi.mocked(db.artifact.update).mockResolvedValue({} as never);

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(TEST_URL, mockUser, { artifactId: "artifact-1" });
    const response = await POST(request, mockParams("prompt-123", "version-456"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(db.artifact.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "artifact-1" } })
    );
    expect(db.artifact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "artifact-1" },
        data: expect.objectContaining({ content: expect.objectContaining({ published: true }) }),
      })
    );
  });

  // ── Not-found path ────────────────────────────────────────────────────────

  it("returns 404 when publishVersion throws with status 404", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);
    vi.mocked(publishVersion).mockRejectedValue({ status: 404, message: "Version not found" });

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(TEST_URL, mockUser, {});
    const response = await POST(request, mockParams("prompt-123", "version-456"));
    const data = await response.json();

    expect(response.status).toBe(404);
  });

  // ── Dev mode ──────────────────────────────────────────────────────────────

  it("skips workspace membership check in dev mode and calls publishVersion directly", async () => {
    vi.mocked(runtime.isDevelopmentMode).mockReturnValue(true);

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(TEST_URL, mockUser, {});
    const response = await POST(request, mockParams("prompt-123", "version-456"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    // Workspace membership check must NOT run in dev mode (only session path)
    expect(db.workspace.findFirst).not.toHaveBeenCalled();
    // publishVersion called with undefined workspaceId, userId as actor
    expect(publishVersion).toHaveBeenCalledWith("prompt-123", "version-456", undefined, mockUser.id);
  });
});
