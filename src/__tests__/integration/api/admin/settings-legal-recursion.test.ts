import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, upsertTestPlatformConfig } from "@/__tests__/support/factories";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPatchRequest,
} from "@/__tests__/support/helpers/request-builders";
import {
  RECURSION_MAX_CONCURRENT_KEY,
  RECURSION_MAX_ATTEMPTS_KEY,
  RECURSION_PLATEAU_LIMIT_KEY,
} from "@/services/legal-recursion-cron";

describe("Admin Settings Legal Recursion API", () => {
  let superAdminUser: { id: string; email: string; name: string };
  let regularUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    superAdminUser = await createTestUser({
      role: "SUPER_ADMIN",
      email: "superadmin-recursion@test.com",
      name: "Super Admin Recursion",
    });
    regularUser = await createTestUser({
      role: "USER",
      email: "regular-recursion@test.com",
      name: "Regular User Recursion",
    });

    // Clean up any existing config rows so tests start fresh
    await db.platformConfig.deleteMany({
      where: { key: { in: [RECURSION_MAX_CONCURRENT_KEY, RECURSION_MAX_ATTEMPTS_KEY, RECURSION_PLATEAU_LIMIT_KEY] } },
    });
  });

  describe("GET /api/admin/settings/legal-recursion", () => {
    it("should return 401 for unauthenticated requests", async () => {
      const { GET } = await import("@/app/api/admin/settings/legal-recursion/route");
      // No auth headers — use a bare NextRequest
      const { NextRequest } = await import("next/server");
      const request = new NextRequest("http://localhost/api/admin/settings/legal-recursion");
      const response = await GET(request);
      expect(response.status).toBe(401);
    });

    it("should return 403 for non-superadmin users", async () => {
      const request = createAuthenticatedGetRequest(
        "/api/admin/settings/legal-recursion",
        regularUser
      );
      const { GET } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await GET(request);
      expect(response.status).toBe(403);
    });

    it("should return default 3 when no PlatformConfig row exists", async () => {
      const request = createAuthenticatedGetRequest(
        "/api/admin/settings/legal-recursion",
        superAdminUser
      );
      const { GET } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      // GET now returns { settings: [...] } with all three keys
      expect(Array.isArray(data.settings)).toBe(true);
      const concurrent = data.settings.find((s: { key: string; value: number }) => s.key === RECURSION_MAX_CONCURRENT_KEY);
      expect(concurrent).toEqual({ key: RECURSION_MAX_CONCURRENT_KEY, value: 3 });
      expect(concurrent.key).toBe("recursionMaxConcurrent");
    });

    it("should return the stored value when a PlatformConfig row exists", async () => {
      await upsertTestPlatformConfig(RECURSION_MAX_CONCURRENT_KEY, "7");

      const request = createAuthenticatedGetRequest(
        "/api/admin/settings/legal-recursion",
        superAdminUser
      );
      const { GET } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      // GET now returns { settings: [...] } with all three keys
      expect(Array.isArray(data.settings)).toBe(true);
      const concurrent = data.settings.find((s: { key: string; value: number }) => s.key === RECURSION_MAX_CONCURRENT_KEY);
      expect(concurrent).toEqual({ key: RECURSION_MAX_CONCURRENT_KEY, value: 7 });
    });
  });

  describe("PATCH /api/admin/settings/legal-recursion", () => {
    it("should return 401 for unauthenticated requests", async () => {
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const { NextRequest } = await import("next/server");
      const request = new NextRequest("http://localhost/api/admin/settings/legal-recursion", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: 5 }),
      });
      const response = await PATCH(request);
      expect(response.status).toBe(401);
    });

    it("should return 403 for non-superadmin users", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { value: 5 },
        regularUser
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await PATCH(request);
      expect(response.status).toBe(403);
    });

    it("should return 400 for non-integer value (float)", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { value: 2.5 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await PATCH(request);
      expect(response.status).toBe(400);
    });

    it("should return 400 for non-integer value (string)", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { value: "five" },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await PATCH(request);
      expect(response.status).toBe(400);
    });

    it("should return 400 for value of 0", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { value: 0 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await PATCH(request);
      expect(response.status).toBe(400);
    });

    it("should return 400 for negative value", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { value: -1 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await PATCH(request);
      expect(response.status).toBe(400);
    });

    it("should upsert and return the new value for a valid positive integer", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { key: RECURSION_MAX_CONCURRENT_KEY, value: 5 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await PATCH(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ key: RECURSION_MAX_CONCURRENT_KEY, value: 5 });

      // Verify it writes to the exact same PlatformConfig key the cron reads
      const record = await db.platformConfig.findUnique({
        where: { key: RECURSION_MAX_CONCURRENT_KEY },
      });
      expect(record?.value).toBe("5");
      expect(record?.key).toBe("recursionMaxConcurrent");
    });

    it("should upsert over an existing row", async () => {
      await upsertTestPlatformConfig(RECURSION_MAX_CONCURRENT_KEY, "3");

      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { key: RECURSION_MAX_CONCURRENT_KEY, value: 10 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await PATCH(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ key: RECURSION_MAX_CONCURRENT_KEY, value: 10 });

      const record = await db.platformConfig.findUnique({
        where: { key: RECURSION_MAX_CONCURRENT_KEY },
      });
      expect(record?.value).toBe("10");
    });

    it("should write to the exact same key constant the cron reads", async () => {
      // This test explicitly asserts the key string to prevent key drift
      expect(RECURSION_MAX_CONCURRENT_KEY).toBe("recursionMaxConcurrent");

      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { key: RECURSION_MAX_CONCURRENT_KEY, value: 4 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await PATCH(request);

      expect(response.status).toBe(200);

      const record = await db.platformConfig.findUnique({
        where: { key: "recursionMaxConcurrent" },
      });
      expect(record?.value).toBe("4");
    });
  });

  // ── Allowlist validation (PATCH rejects non-allowlisted keys) ─────────────

  describe("PATCH allowlist validation", () => {
    it("should return 400 for a non-allowlisted key", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { key: "someArbitraryKey", value: 5 },
        superAdminUser,
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await PATCH(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toMatch(/Invalid key/);
    });

    it("should return 400 for an empty-string key", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { key: "", value: 5 },
        superAdminUser,
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await PATCH(request);
      expect(response.status).toBe(400);
    });

    it("should NOT allow writing arbitrary keys to PlatformConfig", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { key: "dangerousKey", value: 99 },
        superAdminUser,
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      await PATCH(request);

      // The key must NOT have been written
      const record = await db.platformConfig.findUnique({
        where: { key: "dangerousKey" },
      });
      expect(record).toBeNull();
    });
  });

  // ── RECURSION_MAX_ATTEMPTS_KEY happy path ──────────────────────────────────

  describe("PATCH RECURSION_MAX_ATTEMPTS_KEY", () => {
    it("should return 400 for value = 0", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { key: RECURSION_MAX_ATTEMPTS_KEY, value: 0 },
        superAdminUser,
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await PATCH(request);
      expect(response.status).toBe(400);
    });

    it("should return 400 for negative value", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { key: RECURSION_MAX_ATTEMPTS_KEY, value: -1 },
        superAdminUser,
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await PATCH(request);
      expect(response.status).toBe(400);
    });

    it("should upsert and return the new value for a valid positive integer", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { key: RECURSION_MAX_ATTEMPTS_KEY, value: 15 },
        superAdminUser,
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await PATCH(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.key).toBe(RECURSION_MAX_ATTEMPTS_KEY);
      expect(data.value).toBe(15);

      const record = await db.platformConfig.findUnique({
        where: { key: RECURSION_MAX_ATTEMPTS_KEY },
      });
      expect(record?.value).toBe("15");
    });
  });

  // ── RECURSION_PLATEAU_LIMIT_KEY happy path ─────────────────────────────────

  describe("PATCH RECURSION_PLATEAU_LIMIT_KEY", () => {
    it("should return 400 for value = 0", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { key: RECURSION_PLATEAU_LIMIT_KEY, value: 0 },
        superAdminUser,
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await PATCH(request);
      expect(response.status).toBe(400);
    });

    it("should return 400 for non-integer value", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { key: RECURSION_PLATEAU_LIMIT_KEY, value: 2.7 },
        superAdminUser,
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await PATCH(request);
      expect(response.status).toBe(400);
    });

    it("should upsert and return the new value for a valid positive integer", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/legal-recursion",
        { key: RECURSION_PLATEAU_LIMIT_KEY, value: 5 },
        superAdminUser,
      );
      const { PATCH } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await PATCH(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.key).toBe(RECURSION_PLATEAU_LIMIT_KEY);
      expect(data.value).toBe(5);

      const record = await db.platformConfig.findUnique({
        where: { key: RECURSION_PLATEAU_LIMIT_KEY },
      });
      expect(record?.value).toBe("5");
    });
  });

  // ── GET returns all three settings ────────────────────────────────────────

  describe("GET returns all three config settings", () => {
    it("returns settings array with all three keys including defaults", async () => {
      const request = createAuthenticatedGetRequest(
        "/api/admin/settings/legal-recursion",
        superAdminUser,
      );
      const { GET } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.settings)).toBe(true);
      expect(data.settings).toHaveLength(3);

      const keys = data.settings.map((s: { key: string }) => s.key);
      expect(keys).toContain(RECURSION_MAX_CONCURRENT_KEY);
      expect(keys).toContain(RECURSION_MAX_ATTEMPTS_KEY);
      expect(keys).toContain(RECURSION_PLATEAU_LIMIT_KEY);
    });

    it("returns correct defaults for maxAttempts (10) and plateauLimit (3) when absent", async () => {
      const request = createAuthenticatedGetRequest(
        "/api/admin/settings/legal-recursion",
        superAdminUser,
      );
      const { GET } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();

      const maxAttempts = data.settings.find((s: { key: string; value: number }) => s.key === RECURSION_MAX_ATTEMPTS_KEY);
      const plateau = data.settings.find((s: { key: string; value: number }) => s.key === RECURSION_PLATEAU_LIMIT_KEY);
      expect(maxAttempts?.value).toBe(10);
      expect(plateau?.value).toBe(3);
    });

    it("returns stored values when all three keys exist", async () => {
      await upsertTestPlatformConfig(RECURSION_MAX_CONCURRENT_KEY, "4");
      await upsertTestPlatformConfig(RECURSION_MAX_ATTEMPTS_KEY, "12");
      await upsertTestPlatformConfig(RECURSION_PLATEAU_LIMIT_KEY, "2");

      const request = createAuthenticatedGetRequest(
        "/api/admin/settings/legal-recursion",
        superAdminUser,
      );
      const { GET } = await import("@/app/api/admin/settings/legal-recursion/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();

      const concurrent = data.settings.find((s: { key: string; value: number }) => s.key === RECURSION_MAX_CONCURRENT_KEY);
      const maxAttempts = data.settings.find((s: { key: string; value: number }) => s.key === RECURSION_MAX_ATTEMPTS_KEY);
      const plateau = data.settings.find((s: { key: string; value: number }) => s.key === RECURSION_PLATEAU_LIMIT_KEY);
      expect(concurrent?.value).toBe(4);
      expect(maxAttempts?.value).toBe(12);
      expect(plateau?.value).toBe(2);
    });
  });
});
