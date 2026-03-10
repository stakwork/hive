import { NextRequest } from "next/server";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/auth/device-token/route";

// --- mocks -----------------------------------------------------------

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth/nextauth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  db: { user: { update: vi.fn() } },
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import { getServerSession } from "next-auth";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/device-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("POST /api/auth/device-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const res = await POST(makeRequest({ ios_device_token: "abc" }));

    expect(res.status).toBe(401);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("stores the token when ios_device_token is a non-empty string", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } } as any);
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
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } } as any);
    vi.mocked(db.user.update).mockResolvedValue({} as any);

    const res = await POST(makeRequest({ ios_device_token: "" }));

    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { iosDeviceToken: null },
    });
  });

  it("is a no-op and returns 200 when ios_device_token is absent from body", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } } as any);

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("is a no-op and returns 200 when body is empty / non-JSON", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } } as any);

    const req = new NextRequest("http://localhost/api/auth/device-token", {
      method: "POST",
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("silently ignores unknown fields and does not write to DB", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } } as any);

    const res = await POST(makeRequest({ android_device_token: "android-tok" }));

    expect(res.status).toBe(200);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("returns 500 when DB update fails", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "user-1" } } as any);
    vi.mocked(db.user.update).mockRejectedValue(new Error("DB error"));

    const res = await POST(makeRequest({ ios_device_token: "tok" }));

    expect(res.status).toBe(500);
  });
});
