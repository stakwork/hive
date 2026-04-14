import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, upsertTestPlatformConfig } from "@/__tests__/support/factories";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPatchRequest,
} from "@/__tests__/support/helpers/request-builders";
import { POD_SCALER_CONFIG_KEYS } from "@/lib/constants/pod-scaler";

describe("Admin Settings Pod Scaler API", () => {
  let superAdminUser: { id: string; email: string; name: string };
  let regularUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    superAdminUser = await createTestUser({
      role: "SUPER_ADMIN",
      email: "superadmin-podscaler@test.com",
      name: "Super Admin PodScaler",
    });
    regularUser = await createTestUser({
      role: "USER",
      email: "regular-podscaler@test.com",
      name: "Regular PodScaler",
    });

    await upsertTestPlatformConfig(POD_SCALER_CONFIG_KEYS.queueWaitMinutes, "5");
    await upsertTestPlatformConfig(POD_SCALER_CONFIG_KEYS.stalenessWindowDays, "30");
    await upsertTestPlatformConfig(POD_SCALER_CONFIG_KEYS.scaleUpBuffer, "2");
    await upsertTestPlatformConfig(POD_SCALER_CONFIG_KEYS.maxVmCeiling, "20");
    await upsertTestPlatformConfig(POD_SCALER_CONFIG_KEYS.scaleDownCooldownMinutes, "30");
  });

  describe("GET /api/admin/settings/pod-scaler", () => {
    it("should return all four settings with defaults for super-admin", async () => {
      const request = createAuthenticatedGetRequest(
        "/api/admin/settings/pod-scaler",
        superAdminUser
      );
      const { GET } = await import("@/app/api/admin/settings/pod-scaler/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.settings)).toBe(true);
      expect(data.settings).toHaveLength(5);

      const keys = data.settings.map((s: { key: string }) => s.key);
      expect(keys).toContain("queueWaitMinutes");
      expect(keys).toContain("stalenessWindowDays");
      expect(keys).toContain("scaleUpBuffer");
      expect(keys).toContain("maxVmCeiling");
      expect(keys).toContain("scaleDownCooldownMinutes");
    });

    it("should return 403 for regular user", async () => {
      const request = createAuthenticatedGetRequest(
        "/api/admin/settings/pod-scaler",
        regularUser
      );
      const { GET } = await import("@/app/api/admin/settings/pod-scaler/route");
      const response = await GET(request);

      expect(response.status).toBe(403);
    });
  });

  describe("PATCH /api/admin/settings/pod-scaler", () => {
    it("should return 403 for regular user", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/pod-scaler",
        { key: "queueWaitMinutes", value: 10 },
        regularUser
      );
      const { PATCH } = await import("@/app/api/admin/settings/pod-scaler/route");
      const response = await PATCH(request);

      expect(response.status).toBe(403);
    });

    it("should upsert a valid key+value for super-admin", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/pod-scaler",
        { key: "queueWaitMinutes", value: 10 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/settings/pod-scaler/route");
      const response = await PATCH(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ key: "queueWaitMinutes", value: 10 });

      const record = await db.platformConfig.findUnique({
        where: { key: POD_SCALER_CONFIG_KEYS.queueWaitMinutes },
      });
      expect(record?.value).toBe("10");
    });

    it("should return 400 for unknown key", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/pod-scaler",
        { key: "unknownKey", value: 5 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/settings/pod-scaler/route");
      const response = await PATCH(request);

      expect(response.status).toBe(400);
    });

    it("should return 400 for non-positive integer value", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/pod-scaler",
        { key: "queueWaitMinutes", value: -1 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/settings/pod-scaler/route");
      const response = await PATCH(request);

      expect(response.status).toBe(400);
    });

    it("should return 400 for zero value", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/pod-scaler",
        { key: "queueWaitMinutes", value: 0 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/settings/pod-scaler/route");
      const response = await PATCH(request);

      expect(response.status).toBe(400);
    });

    it("should return 400 for non-integer value", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/settings/pod-scaler",
        { key: "queueWaitMinutes", value: 1.5 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/settings/pod-scaler/route");
      const response = await PATCH(request);

      expect(response.status).toBe(400);
    });
  });
});
