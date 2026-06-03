import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth/next");
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

import * as nextAuth from "next-auth/next";
import { db } from "@/lib/db";
import * as runtime from "@/lib/runtime";

function createPostRequest(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: "POST" });
}

async function importRoute() {
  // Re-import to get fresh module each time
  const mod = await import("@/app/api/workflow/scripts/versions/[versionId]/publish/route");
  return mod.POST;
}

const mockParams = (versionId: string) => ({
  params: Promise.resolve({ versionId }),
});

describe("POST /api/workflow/scripts/versions/[versionId]/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runtime.isDevelopmentMode).mockReturnValue(false);
  });

  it("returns 401 when session is null", async () => {
    vi.mocked(nextAuth.getServerSession).mockResolvedValue(null);

    const { POST } = await import(
      "@/app/api/workflow/scripts/versions/[versionId]/publish/route"
    );
    const request = createPostRequest("/api/workflow/scripts/versions/123/publish");
    const response = await POST(request, mockParams("123"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 401 when session has no user id", async () => {
    vi.mocked(nextAuth.getServerSession).mockResolvedValue({
      user: { name: "test" },
      expires: "2099-01-01",
    });

    const { POST } = await import(
      "@/app/api/workflow/scripts/versions/[versionId]/publish/route"
    );
    const request = createPostRequest("/api/workflow/scripts/versions/123/publish");
    const response = await POST(request, mockParams("123"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Invalid user session");
  });

  it("returns 403 when user is not a stakwork workspace member (non-dev mode)", async () => {
    vi.mocked(nextAuth.getServerSession).mockResolvedValue({
      user: { id: "user-1", name: "test" },
      expires: "2099-01-01",
    });
    vi.mocked(runtime.isDevelopmentMode).mockReturnValue(false);
    vi.mocked(db.workspace.findFirst).mockResolvedValue(null);

    const { POST } = await import(
      "@/app/api/workflow/scripts/versions/[versionId]/publish/route"
    );
    const request = createPostRequest("/api/workflow/scripts/versions/123/publish");
    const response = await POST(request, mockParams("123"));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain("Access denied");
  });

  it("returns { success: true } in dev mode by delegating to mock handler", async () => {
    vi.mocked(nextAuth.getServerSession).mockResolvedValue({
      user: { id: "user-1", name: "test" },
      expires: "2099-01-01",
    });
    vi.mocked(runtime.isDevelopmentMode).mockReturnValue(true);
    // workspace query may return null in dev mode — it's bypassed
    vi.mocked(db.workspace.findFirst).mockResolvedValue(null);

    const { POST } = await import(
      "@/app/api/workflow/scripts/versions/[versionId]/publish/route"
    );
    const request = createPostRequest("/api/workflow/scripts/versions/456/publish");
    const response = await POST(request, mockParams("456"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
  });

  it("propagates error when Stakwork API returns non-ok in production mode", async () => {
    vi.mocked(nextAuth.getServerSession).mockResolvedValue({
      user: { id: "user-1", name: "test" },
      expires: "2099-01-01",
    });
    vi.mocked(runtime.isDevelopmentMode).mockReturnValue(false);
    vi.mocked(db.workspace.findFirst).mockResolvedValue({
      id: "ws-1",
      slug: "stakwork",
    } as never);

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Unprocessable Entity",
    } as never);

    const { POST } = await import(
      "@/app/api/workflow/scripts/versions/[versionId]/publish/route"
    );
    const request = createPostRequest("/api/workflow/scripts/versions/789/publish");
    const response = await POST(request, mockParams("789"));
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toContain("Failed to publish script version");
    expect(data.details).toBe("Unprocessable Entity");
  });

  it("returns { success: true } when Stakwork API succeeds in production mode", async () => {
    vi.mocked(nextAuth.getServerSession).mockResolvedValue({
      user: { id: "user-1", name: "test" },
      expires: "2099-01-01",
    });
    vi.mocked(runtime.isDevelopmentMode).mockReturnValue(false);
    vi.mocked(db.workspace.findFirst).mockResolvedValue({
      id: "ws-1",
      slug: "stakwork",
    } as never);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as never);

    const { POST } = await import(
      "@/app/api/workflow/scripts/versions/[versionId]/publish/route"
    );
    const request = createPostRequest("/api/workflow/scripts/versions/789/publish");
    const response = await POST(request, mockParams("789"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true });
  });
});
