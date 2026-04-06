import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { upsertTestPlatformConfig } from "@/__tests__/support/factories";
import { createGetRequest } from "@/__tests__/support/helpers/request-builders";

describe("Public Price Config API", () => {
  beforeEach(async () => {
    // Clean up any existing records to allow testing missing-record 503
    await db.platformConfig.deleteMany({
      where: { key: { in: ["hiveAmountUsd", "graphmindsetAmountUsd"] } },
    });
  });

  describe("GET /api/config/price?type=hive", () => {
    it("should return hive price when record exists", async () => {
      await upsertTestPlatformConfig("hiveAmountUsd", "75");

      const request = createGetRequest("/api/config/price", { type: "hive" });
      const { GET } = await import("@/app/api/config/price/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ type: "hive", amountUsd: 75 });
    });

    it("should return 503 when hive config is missing", async () => {
      const request = createGetRequest("/api/config/price", { type: "hive" });
      const { GET } = await import("@/app/api/config/price/route");
      const response = await GET(request);

      expect(response.status).toBe(503);
    });
  });

  describe("GET /api/config/price?type=graphmindset", () => {
    it("should return graphmindset price when record exists", async () => {
      await upsertTestPlatformConfig("graphmindsetAmountUsd", "99");

      const request = createGetRequest("/api/config/price", { type: "graphmindset" });
      const { GET } = await import("@/app/api/config/price/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ type: "graphmindset", amountUsd: 99 });
    });

    it("should return 503 when graphmindset config is missing", async () => {
      const request = createGetRequest("/api/config/price", { type: "graphmindset" });
      const { GET } = await import("@/app/api/config/price/route");
      const response = await GET(request);

      expect(response.status).toBe(503);
    });
  });

  describe("GET /api/config/price (no type param)", () => {
    it("should return all prices in prices array", async () => {
      await upsertTestPlatformConfig("hiveAmountUsd", "50");
      await upsertTestPlatformConfig("graphmindsetAmountUsd", "60");

      const request = createGetRequest("/api/config/price");
      const { GET } = await import("@/app/api/config/price/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.prices)).toBe(true);

      const hive = data.prices.find((p: { type: string }) => p.type === "hive");
      const graphmindset = data.prices.find((p: { type: string }) => p.type === "graphmindset");
      expect(hive).toEqual({ type: "hive", amountUsd: 50 });
      expect(graphmindset).toEqual({ type: "graphmindset", amountUsd: 60 });
    });

    it("should return 400 for invalid type param", async () => {
      const request = createGetRequest("/api/config/price", { type: "unknown" });
      const { GET } = await import("@/app/api/config/price/route");
      const response = await GET(request);

      expect(response.status).toBe(400);
    });
  });
});
