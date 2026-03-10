/**
 * Integration tests for POST /api/auth/device-token
 *
 * Exercises the full request cycle against a real test-DB user record,
 * verifying DB state after each operation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { POST } from "@/app/api/auth/device-token/route";
import { invokeRoute } from "@/__tests__/harness/route";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { resetDatabase } from "@/__tests__/support/utilities/database";

// next-auth needs to be mocked so invokeRoute can inject the session
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth/nextauth", () => ({ authOptions: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

describe("POST /api/auth/device-token — integration", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    const user = await createTestUser({ email: "device-test@example.com" });
    userId = user.id;
  });

  it("stores a device token on the user record", async () => {
    const result = await invokeRoute(POST, {
      method: "POST",
      session: { user: { id: userId } },
      body: { ios_device_token: "device-token-xyz" },
    });

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ success: true });

    const updated = await db.user.findUnique({ where: { id: userId } });
    expect(updated?.iosDeviceToken).toBe("device-token-xyz");
  });

  it("clears (nulls) the device token when empty string is sent", async () => {
    // Pre-set a token directly in DB
    await db.user.update({ where: { id: userId }, data: { iosDeviceToken: "existing-token" } });

    const result = await invokeRoute(POST, {
      method: "POST",
      session: { user: { id: userId } },
      body: { ios_device_token: "" },
    });

    expect(result.status).toBe(200);

    const updated = await db.user.findUnique({ where: { id: userId } });
    expect(updated?.iosDeviceToken).toBeNull();
  });

  it("does not modify the record when ios_device_token field is absent", async () => {
    // Pre-set a token
    await db.user.update({ where: { id: userId }, data: { iosDeviceToken: "keep-me" } });

    const result = await invokeRoute(POST, {
      method: "POST",
      session: { user: { id: userId } },
      body: {},
    });

    expect(result.status).toBe(200);

    const updated = await db.user.findUnique({ where: { id: userId } });
    expect(updated?.iosDeviceToken).toBe("keep-me");
  });

  it("returns 401 and does not modify DB when unauthenticated", async () => {
    await db.user.update({ where: { id: userId }, data: { iosDeviceToken: "keep-me" } });

    const result = await invokeRoute(POST, {
      method: "POST",
      session: null,
      body: { ios_device_token: "hacked" },
    });

    expect(result.status).toBe(401);

    const unchanged = await db.user.findUnique({ where: { id: userId } });
    expect(unchanged?.iosDeviceToken).toBe("keep-me");
  });

  it("silently ignores unknown token fields and does not modify DB", async () => {
    await db.user.update({ where: { id: userId }, data: { iosDeviceToken: "keep-me" } });

    const result = await invokeRoute(POST, {
      method: "POST",
      session: { user: { id: userId } },
      body: { android_device_token: "android-tok" },
    });

    expect(result.status).toBe(200);

    const unchanged = await db.user.findUnique({ where: { id: userId } });
    expect(unchanged?.iosDeviceToken).toBe("keep-me");
  });
});
