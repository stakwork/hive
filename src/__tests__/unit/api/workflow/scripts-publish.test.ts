import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
    },
  },
}));
vi.mock("@/lib/runtime");
vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://jobs.stakwork.com/api/v1",
    STAKWORK_API_KEY: "test-api-key",
  },
}));

import { db } from "@/lib/db";
import * as runtime from "@/lib/runtime";
import {
  createAuthenticatedPostRequest,
  createPostRequest,
} from "@/__tests__/support/helpers/request-builders";

const TEST_URL = "/api/workflow/scripts/405/versions/123/publish";

const mockUser = { id: "user-1", email: "test@example.com", name: "Test User" };

const mockParams = (scriptId: string, versionId: string) => ({
  params: Promise.resolve({ scriptId, versionId }),
});

describe("POST /api/workflow/scripts/[scriptId]/versions/[versionId]/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runtime.isDevelopmentMode).mockReturnValue(false);
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("returns 401 when no middleware auth headers are present", async () => {
    const { POST } = await import(
      "@/app/api/workflow/scripts/[scriptId]/versions/[versionId]/publish/route"
    );
    const request = new NextRequest(`http://localhost${TEST_URL}`, { method: "POST" });
    const response = await POST(request, mockParams("405", "123"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 401 when authStatus is authenticated but name is missing (incomplete identity)", async () => {
    const { POST } = await import(
      "@/app/api/workflow/scripts/[scriptId]/versions/[versionId]/publish/route"
    );
    // Build a request with auth headers but omit the name field
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

    const response = await POST(request, mockParams("405", "123"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 401 when authStatus is authenticated but email is missing (incomplete identity)", async () => {
    const { POST } = await import(
      "@/app/api/workflow/scripts/[scriptId]/versions/[versionId]/publish/route"
    );
    const base = createPostRequest(TEST_URL, {});
    const headers = new Headers(base.headers);
    headers.set("x-middleware-auth-status", "authenticated");
    headers.set("x-middleware-user-id", "user-1");
    // x-middleware-user-email intentionally omitted
    headers.set("x-middleware-user-name", "Test User");
    const request = new NextRequest(`http://localhost${TEST_URL}`, {
      method: "POST",
      headers,
    });

    const response = await POST(request, mockParams("405", "123"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  // ── Membership ────────────────────────────────────────────────────────────

  it("returns 403 when authenticated user is not a stakwork workspace member", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue(null);

    const { POST } = await import(
      "@/app/api/workflow/scripts/[scriptId]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(TEST_URL, mockUser, {});
    const response = await POST(request, mockParams("405", "123"));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain("Access denied");
  });

  // ── Param validation ──────────────────────────────────────────────────────

  it("returns 400 when scriptId is empty", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);

    const { POST } = await import(
      "@/app/api/workflow/scripts/[scriptId]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(
      "/api/workflow/scripts//versions/339/publish",
      mockUser,
      {}
    );
    const response = await POST(request, mockParams("", "339"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Script ID is required");
  });

  it("returns 400 when scriptId contains path traversal characters", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);

    const { POST } = await import(
      "@/app/api/workflow/scripts/[scriptId]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(
      "/api/workflow/scripts/../evil/versions/123/publish",
      mockUser,
      {}
    );
    const response = await POST(request, mockParams("../evil", "123"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid script ID format");
  });

  it("returns 400 when versionId contains path traversal characters", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);

    const { POST } = await import(
      "@/app/api/workflow/scripts/[scriptId]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(
      "/api/workflow/scripts/405/versions/../etc/publish",
      mockUser,
      {}
    );
    const response = await POST(request, mockParams("405", "../etc"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid version ID format");
  });

  it("returns 400 when scriptId contains slashes", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);

    const { POST } = await import(
      "@/app/api/workflow/scripts/[scriptId]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(TEST_URL, mockUser, {});
    const response = await POST(request, mockParams("405/inject", "123"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid script ID format");
  });

  // ── Dev mode ──────────────────────────────────────────────────────────────

  it("returns { success: true } in dev mode by delegating to mock handler (iOS-auth path)", async () => {
    vi.mocked(runtime.isDevelopmentMode).mockReturnValue(true);
    vi.mocked(db.workspace.findFirst).mockResolvedValue(null);

    const { POST } = await import(
      "@/app/api/workflow/scripts/[scriptId]/versions/[versionId]/publish/route"
    );
    // Simulate an iOS Bearer request (middleware headers already stamped)
    const request = createAuthenticatedPostRequest(
      "/api/workflow/scripts/405/versions/456/publish",
      mockUser,
      {}
    );
    const response = await POST(request, mockParams("405", "456"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
  });

  // ── Production success (iOS-path regression guard) ────────────────────────

  it("returns { success: true } when authenticated stakwork member publishes (iOS Bearer path)", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as never);

    const { POST } = await import(
      "@/app/api/workflow/scripts/[scriptId]/versions/[versionId]/publish/route"
    );
    // Use createAuthenticatedPostRequest to simulate iOS middleware-stamped headers
    const request = createAuthenticatedPostRequest(
      "/api/workflow/scripts/405/versions/339/publish",
      mockUser,
      {}
    );
    const response = await POST(request, mockParams("405", "339"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("scripts/405/versions/339/publish"),
      expect.any(Object)
    );
  });

  // ── Upstream error non-leak ───────────────────────────────────────────────

  it("does not leak upstream error details to the client on non-ok upstream response", async () => {
    vi.mocked(db.workspace.findFirst).mockResolvedValue({ id: "ws-1", slug: "stakwork" } as never);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Unprocessable Entity — internal upstream detail",
    } as never);

    const { POST } = await import(
      "@/app/api/workflow/scripts/[scriptId]/versions/[versionId]/publish/route"
    );
    const request = createAuthenticatedPostRequest(
      "/api/workflow/scripts/405/versions/789/publish",
      mockUser,
      {}
    );
    const response = await POST(request, mockParams("405", "789"));
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe("Failed to publish script version");
    // Must NOT expose raw upstream body
    expect(data.details).toBeUndefined();
  });
});
