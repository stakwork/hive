import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, upsertTestPlatformConfig } from "@/__tests__/support/factories";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPatchRequest,
} from "@/__tests__/support/helpers/request-builders";

describe("Admin Payments Config API", () => {
  let superAdminUser: { id: string; email: string; name: string };
  let regularUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    superAdminUser = await createTestUser({
      role: "SUPER_ADMIN",
      email: "superadmin-payments@test.com",
      name: "Super Admin Payments",
    });
    regularUser = await createTestUser({
      role: "USER",
      email: "regular-payments@test.com",
      name: "Regular Payments",
    });

    await upsertTestPlatformConfig("hiveAmountUsd", "50");
    await upsertTestPlatformConfig("graphmindsetAmountUsd", "50");
  });

  describe("GET /api/admin/payments-config", () => {
    it("should return both prices for super-admin", async () => {
      const request = createAuthenticatedGetRequest(
        "/api/admin/payments-config",
        superAdminUser
      );
      const { GET } = await import("@/app/api/admin/payments-config/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.prices)).toBe(true);
      expect(data.prices).toHaveLength(2);

      const hive = data.prices.find((p: { type: string }) => p.type === "hive");
      const graphmindset = data.prices.find((p: { type: string }) => p.type === "graphmindset");
      expect(hive).toEqual({ type: "hive", amountUsd: 50 });
      expect(graphmindset).toEqual({ type: "graphmindset", amountUsd: 50 });
    });

    it("should return 403 for regular user", async () => {
      const request = createAuthenticatedGetRequest(
        "/api/admin/payments-config",
        regularUser
      );
      const { GET } = await import("@/app/api/admin/payments-config/route");
      const response = await GET(request);

      expect(response.status).toBe(403);
    });
  });

  describe("PATCH /api/admin/payments-config", () => {
    it("should return 403 for regular user", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/payments-config",
        { type: "hive", amountUsd: 75 },
        regularUser
      );
      const { PATCH } = await import("@/app/api/admin/payments-config/route");
      const response = await PATCH(request);

      expect(response.status).toBe(403);
    });

    it("should upsert hiveAmountUsd for type=hive", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/payments-config",
        { type: "hive", amountUsd: 75 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/payments-config/route");
      const response = await PATCH(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ type: "hive", amountUsd: 75 });

      const record = await db.platformConfig.findUnique({ where: { key: "hiveAmountUsd" } });
      expect(record?.value).toBe("75");
    });

    it("should upsert graphmindsetAmountUsd for type=graphmindset", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/payments-config",
        { type: "graphmindset", amountUsd: 99 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/payments-config/route");
      const response = await PATCH(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ type: "graphmindset", amountUsd: 99 });

      const record = await db.platformConfig.findUnique({ where: { key: "graphmindsetAmountUsd" } });
      expect(record?.value).toBe("99");
    });

    it("should return 400 for non-positive amountUsd", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/payments-config",
        { type: "hive", amountUsd: -10 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/payments-config/route");
      const response = await PATCH(request);

      expect(response.status).toBe(400);
    });

    it("should return 400 for zero amountUsd", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/payments-config",
        { type: "hive", amountUsd: 0 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/payments-config/route");
      const response = await PATCH(request);

      expect(response.status).toBe(400);
    });

    it("should return 400 for invalid type", async () => {
      const request = createAuthenticatedPatchRequest(
        "/api/admin/payments-config",
        { type: "invalid", amountUsd: 50 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/payments-config/route");
      const response = await PATCH(request);

      expect(response.status).toBe(400);
    });
  });
});
