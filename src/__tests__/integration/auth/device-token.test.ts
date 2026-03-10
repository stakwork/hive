/**
 * Integration tests for POST /api/auth/device-token
 *
 * Exercises the full request cycle against a real test-DB user record,
 * verifying DB state after each operation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { POST } from "@/app/api/auth/device-token/route";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { resetDatabase } from "@/__tests__/support/utilities/database";

// Mock middleware/utils so we can control auth in tests
const getMockedRequireAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: getMockedRequireAuth,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/device-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("POST /api/auth/device-token — integration", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    const user = await createTestUser({ email: "device-test@example.com" });
    userId = user.id;
  });

  it("stores a device token on the user record", async () => {
    getMockedRequireAuth.mockReturnValue({ id: userId, email: "device-test@example.com", name: "Test" });

    const res = await POST(makeRequest({ ios_device_token: "device-token-xyz" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    const updated = await db.user.findUnique({ where: { id: userId } });
    expect(updated?.iosDeviceToken).toBe("device-token-xyz");
  });

  it("clears (nulls) the device token when empty string is sent", async () => {
    // Pre-set a token directly in DB
    await db.user.update({ where: { id: userId }, data: { iosDeviceToken: "existing-token" } });

    getMockedRequireAuth.mockReturnValue({ id: userId, email: "device-test@example.com", name: "Test" });

    const res = await POST(makeRequest({ ios_device_token: "" }));

    expect(res.status).toBe(200);

    const updated = await db.user.findUnique({ where: { id: userId } });
    expect(updated?.iosDeviceToken).toBeNull();
  });

  it("does not modify the record when ios_device_token field is absent", async () => {
    await db.user.update({ where: { id: userId }, data: { iosDeviceToken: "keep-me" } });

    getMockedRequireAuth.mockReturnValue({ id: userId, email: "device-test@example.com", name: "Test" });

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(200);

    const updated = await db.user.findUnique({ where: { id: userId } });
    expect(updated?.iosDeviceToken).toBe("keep-me");
  });

  it("returns 401 and does not modify DB when unauthenticated", async () => {
    await db.user.update({ where: { id: userId }, data: { iosDeviceToken: "keep-me" } });

    getMockedRequireAuth.mockReturnValue(
      new (await import("next/server")).NextResponse(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401 }
      )
    );

    const res = await POST(makeRequest({ ios_device_token: "hacked" }));

    expect(res.status).toBe(401);

    const unchanged = await db.user.findUnique({ where: { id: userId } });
    expect(unchanged?.iosDeviceToken).toBe("keep-me");
  });

  it("silently ignores unknown token fields and does not modify DB", async () => {
    await db.user.update({ where: { id: userId }, data: { iosDeviceToken: "keep-me" } });

    getMockedRequireAuth.mockReturnValue({ id: userId, email: "device-test@example.com", name: "Test" });

    const res = await POST(makeRequest({ android_device_token: "android-tok" }));

    expect(res.status).toBe(200);

    const unchanged = await db.user.findUnique({ where: { id: userId } });
    expect(unchanged?.iosDeviceToken).toBe("keep-me");
  });
});
