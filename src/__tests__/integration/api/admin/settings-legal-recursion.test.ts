import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, upsertTestPlatformConfig } from "@/__tests__/support/factories";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPatchRequest,
} from "@/__tests__/support/helpers/request-builders";
import { RECURSION_MAX_CONCURRENT_KEY } from "@/services/legal-recursion-cron";

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

    // Clean up any existing config row so tests start fresh
    await db.platformConfig.deleteMany({ where: { key: RECURSION_MAX_CONCURRENT_KEY } });
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
      expect(data).toEqual({ key: RECURSION_MAX_CONCURRENT_KEY, value: 3 });
      expect(data.key).toBe("recursionMaxConcurrent");
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
      expect(data).toEqual({ key: RECURSION_MAX_CONCURRENT_KEY, value: 7 });
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
        { value: 5 },
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
        { value: 10 },
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
        { value: 4 },
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
});
