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

import { db } from "@/lib/db";
import * as runtime from "@/lib/runtime";
import { publishVersion } from "@/services/prompts/prompt-sync";
import {
  createAuthenticatedPostRequest,
  createPostRequest,
} from "@/__tests__/support/helpers/request-builders";

const TEST_URL = "/api/workflow/prompts/prompt-123/versions/version-456/publish";

const mockUser = { id: "user-1", email: "test@example.com", name: "Test User" };

const mockParams = (id: string, versionId: string) => ({
  params: Promise.resolve({ id, versionId }),
});

describe("POST /api/workflow/prompts/[id]/versions/[versionId]/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runtime.isDevelopmentMode).mockReturnValue(false);
    vi.mocked(publishVersion).mockResolvedValue(undefined as never);
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

  // ── Happy path ────────────────────────────────────────────────────────────

  it("returns 200 and calls publishVersion with correct args on success", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);

    const { POST } = await import(
      "@/app/api/workflow/prompts/[id]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(TEST_URL, mockUser, {});
    const response = await POST(request, mockParams("prompt-123", "version-456"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(publishVersion).toHaveBeenCalledWith("prompt-123", "version-456", "ws-1");
    // Assert correct userId was resolved from middleware headers
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

  it("calls artifact update when artifactId is supplied in body", async () => {
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
    // Workspace membership check must NOT run in dev mode
    expect(db.workspace.findFirst).not.toHaveBeenCalled();
    // publishVersion still called directly (no dev-mode mock delegation)
    expect(publishVersion).toHaveBeenCalledWith("prompt-123", "version-456", undefined);
  });
});
