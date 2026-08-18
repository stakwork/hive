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
    prompt: {
      findUnique: vi.fn(),
    },
    promptVersion: {
      findFirst: vi.fn(),
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
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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

/** Default resolved PublishOutcome returned by the mock unless overridden. */
const DEFAULT_OUTCOME = { versionId: "version-456", versionNumber: 2, syncOutcome: "PUSHED" as const };

describe("POST /api/workflow/prompts/[id]/versions/[versionId]/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runtime.isDevelopmentMode).mockReturnValue(false);
    vi.mocked(publishVersion).mockResolvedValue(DEFAULT_OUTCOME);
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
    expect(data).toEqual({ success: true, syncOutcome: "PUSHED" });
    expect(publishVersion).toHaveBeenCalledWith("prompt-123", "version-456", "ws-1", mockUser.id, "UI");
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
      "prompt-123", "version-456", "ws-1", mockUser.id, "UI"
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
    expect(data).toEqual({ success: true, syncOutcome: "PUSHED" });
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
      "prompt-123", "version-456", "ws-1", API_TOKEN_ACTOR, "API"
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

  // ── syncOutcome forwarding ─────────────────────────────────────────────────

  it("response includes syncOutcome=PUSH_FAILED when publishVersion reports a sync failure", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);
    vi.mocked(publishVersion).mockResolvedValue(
      { versionId: "version-456", versionNumber: 2, syncOutcome: "PUSH_FAILED" }
    );

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(TEST_URL, mockUser, {});
    const response = await POST(request, mockParams("prompt-123", "version-456"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.syncOutcome).toBe("PUSH_FAILED");
    expect(data.success).toBe(true);
  });

  it("response includes syncOutcome=NOT_CONFIGURED when stakworkId is null (no push attempted)", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);
    vi.mocked(publishVersion).mockResolvedValue(
      { versionId: "version-456", versionNumber: 2, syncOutcome: "NOT_CONFIGURED" }
    );

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(TEST_URL, mockUser, {});
    const response = await POST(request, mockParams("prompt-123", "version-456"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.syncOutcome).toBe("NOT_CONFIGURED");
    expect(data.success).toBe(true);
  });

  // ── Stale-publish guard (409) ─────────────────────────────────────────────

  it("returns 409 when expectedPublishedVersionId disagrees with current state", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);
    // Target version exists
    vi.mocked(db.promptVersion.findFirst).mockResolvedValue(
      { id: "version-456", promptId: "prompt-123" } as never
    );
    // Prompt state: published version is different from what the client expected
    vi.mocked(db.prompt.findUnique).mockResolvedValue({
      publishedVersionId: "published-v1",
      versions: [{ versionNumber: 2 }],
    } as never);

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(TEST_URL, mockUser, {
      expectedPublishedVersionId: "stale-expected-id",  // disagrees
    });
    const response = await POST(request, mockParams("prompt-123", "version-456"));
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toContain("Conflict");
    expect(data.currentPublishedVersionId).toBe("published-v1");
    // publishVersion must NOT have been called
    expect(publishVersion).not.toHaveBeenCalled();
  });

  it("returns 409 when expectedLatestVersionNumber disagrees with current state", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);
    vi.mocked(db.promptVersion.findFirst).mockResolvedValue(
      { id: "version-456", promptId: "prompt-123" } as never
    );
    vi.mocked(db.prompt.findUnique).mockResolvedValue({
      publishedVersionId: "published-v1",
      versions: [{ versionNumber: 5 }],  // latest is v5 on server
    } as never);

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(TEST_URL, mockUser, {
      expectedLatestVersionNumber: 3,  // client thought v3 was latest
    });
    const response = await POST(request, mockParams("prompt-123", "version-456"));
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.currentLatestVersionNumber).toBe(5);
    expect(publishVersion).not.toHaveBeenCalled();
  });

  it("returns 200 and publishes when both expected fields match current state", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);
    vi.mocked(db.promptVersion.findFirst).mockResolvedValue(
      { id: "version-456", promptId: "prompt-123" } as never
    );
    vi.mocked(db.prompt.findUnique).mockResolvedValue({
      publishedVersionId: "published-v1",
      versions: [{ versionNumber: 2 }],
    } as never);

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(TEST_URL, mockUser, {
      expectedPublishedVersionId: "published-v1",  // matches
      expectedLatestVersionNumber: 2,              // matches
    });
    const response = await POST(request, mockParams("prompt-123", "version-456"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(publishVersion).toHaveBeenCalled();
  });

  it("omitting both expected fields skips the guard (existing callers unaffected)", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(TEST_URL, mockUser, {});
    const response = await POST(request, mockParams("prompt-123", "version-456"));

    expect(response.status).toBe(200);
    // No DB read for stale-check (no prompt.findUnique / promptVersion.findFirst calls)
    expect(db.promptVersion.findFirst).not.toHaveBeenCalled();
    expect(publishVersion).toHaveBeenCalled();
  });

  it("returns 404 when target version is not found during stale-guard check", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);
    vi.mocked(db.promptVersion.findFirst).mockResolvedValue(null);
    vi.mocked(db.prompt.findUnique).mockResolvedValue({
      publishedVersionId: "v1",
      versions: [{ versionNumber: 1 }],
    } as never);

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(TEST_URL, mockUser, {
      expectedPublishedVersionId: "v1",
    });
    const response = await POST(request, mockParams("prompt-123", "version-456"));

    expect(response.status).toBe(404);
    expect(publishVersion).not.toHaveBeenCalled();
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
    expect(data.success).toBe(true);
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
    expect(data.success).toBe(true);
    // Workspace membership check must NOT run in dev mode (only session path)
    expect(db.workspace.findFirst).not.toHaveBeenCalled();
    // publishVersion called with undefined workspaceId, userId as actor
    expect(publishVersion).toHaveBeenCalledWith("prompt-123", "version-456", undefined, mockUser.id, "UI");
  });
});
