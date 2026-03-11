import { NextRequest, NextResponse } from "next/server";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/device-token/route";

// --- mocks -----------------------------------------------------------

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { user: { update: vi.fn() } },
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------

const MOCK_USER = { id: "user-1", email: "u@test.com", name: "Test" };

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/device-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function authenticatedAs(user = MOCK_USER) {
  vi.mocked(getMiddlewareContext).mockReturnValue({ authStatus: "authenticated", user } as any);
  vi.mocked(requireAuth).mockReturnValue(user as any);
}

function unauthenticated() {
  vi.mocked(getMiddlewareContext).mockReturnValue({ authStatus: "error" } as any);
  vi.mocked(requireAuth).mockReturnValue(
    NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  );
}

describe("POST /api/device-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    unauthenticated();

    const res = await POST(makeRequest({ ios_device_token: "abc" }));

    expect(res.status).toBe(401);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("stores the token when ios_device_token is a non-empty string", async () => {
    authenticatedAs();
    vi.mocked(db.user.update).mockResolvedValue({} as any);

    const res = await POST(makeRequest({ ios_device_token: "token-abc123" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { iosDeviceToken: "token-abc123" },
    });
  });

  it("clears the token when ios_device_token is an empty string", async () => {
    authenticatedAs();
    vi.mocked(db.user.update).mockResolvedValue({} as any);

    const res = await POST(makeRequest({ ios_device_token: "" }));

    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { iosDeviceToken: null },
    });
  });

  it("is a no-op and returns 200 when ios_device_token is absent from body", async () => {
    authenticatedAs();

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("is a no-op and returns 200 when body is empty / non-JSON", async () => {
    authenticatedAs();

    const req = new NextRequest("http://localhost/api/device-token", {
      method: "POST",
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("silently ignores unknown fields and does not write to DB", async () => {
    authenticatedAs();

    const res = await POST(makeRequest({ android_device_token: "android-tok" }));

    expect(res.status).toBe(200);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("returns 500 when DB update fails", async () => {
    authenticatedAs();
    vi.mocked(db.user.update).mockRejectedValue(new Error("DB error"));

    const res = await POST(makeRequest({ ios_device_token: "tok" }));

    expect(res.status).toBe(500);
  });
});
