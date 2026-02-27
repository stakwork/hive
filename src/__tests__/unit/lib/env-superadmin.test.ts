import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isSuperAdmin } from "@/config/env";

describe("isSuperAdmin", () => {
  const originalEnv = process.env.POOL_SUPERADMINS;

  afterEach(() => {
    // Restore original env var
    if (originalEnv !== undefined) {
      process.env.POOL_SUPERADMINS = originalEnv;
    } else {
      delete process.env.POOL_SUPERADMINS;
    }
  });

  it("should return true for exact match", () => {
    process.env.POOL_SUPERADMINS = "admin1,admin2,admin3";
    expect(isSuperAdmin("admin1")).toBe(true);
    expect(isSuperAdmin("admin2")).toBe(true);
    expect(isSuperAdmin("admin3")).toBe(true);
  });

  it("should return false for non-matching username", () => {
    process.env.POOL_SUPERADMINS = "admin1,admin2";
    expect(isSuperAdmin("regularuser")).toBe(false);
    expect(isSuperAdmin("admin3")).toBe(false);
  });

  it("should be case-insensitive", () => {
    process.env.POOL_SUPERADMINS = "Admin1,ADMIN2,aDmIn3";
    expect(isSuperAdmin("admin1")).toBe(true);
    expect(isSuperAdmin("ADMIN1")).toBe(true);
    expect(isSuperAdmin("Admin1")).toBe(true);
    expect(isSuperAdmin("admin2")).toBe(true);
    expect(isSuperAdmin("ADMIN3")).toBe(true);
    expect(isSuperAdmin("admin3")).toBe(true);
  });

  it("should trim whitespace from env var entries", () => {
    process.env.POOL_SUPERADMINS = " admin1 , admin2  ,  admin3";
    expect(isSuperAdmin("admin1")).toBe(true);
    expect(isSuperAdmin("admin2")).toBe(true);
    expect(isSuperAdmin("admin3")).toBe(true);
  });

  it("should trim whitespace from input username", () => {
    process.env.POOL_SUPERADMINS = "admin1,admin2";
    expect(isSuperAdmin(" admin1 ")).toBe(true);
    expect(isSuperAdmin("  admin2  ")).toBe(true);
  });

  it("should return false when env var is empty string", () => {
    process.env.POOL_SUPERADMINS = "";
    expect(isSuperAdmin("admin1")).toBe(false);
  });

  it("should return false when env var is undefined", () => {
    delete process.env.POOL_SUPERADMINS;
    expect(isSuperAdmin("admin1")).toBe(false);
  });

  it("should handle single username without comma", () => {
    process.env.POOL_SUPERADMINS = "singleadmin";
    expect(isSuperAdmin("singleadmin")).toBe(true);
    expect(isSuperAdmin("other")).toBe(false);
  });

  it("should filter out empty entries from comma-separated list", () => {
    process.env.POOL_SUPERADMINS = "admin1,,admin2,,,admin3";
    expect(isSuperAdmin("admin1")).toBe(true);
    expect(isSuperAdmin("admin2")).toBe(true);
    expect(isSuperAdmin("admin3")).toBe(true);
    expect(isSuperAdmin("")).toBe(false);
  });

  it("should handle whitespace-only entries", () => {
    process.env.POOL_SUPERADMINS = "admin1,  ,admin2,   ";
    expect(isSuperAdmin("admin1")).toBe(true);
    expect(isSuperAdmin("admin2")).toBe(true);
    expect(isSuperAdmin("")).toBe(false);
    expect(isSuperAdmin("  ")).toBe(false);
  });

  it("should handle special characters in usernames", () => {
    process.env.POOL_SUPERADMINS = "admin-1,admin_2,admin.3";
    expect(isSuperAdmin("admin-1")).toBe(true);
    expect(isSuperAdmin("admin_2")).toBe(true);
    expect(isSuperAdmin("admin.3")).toBe(true);
  });

  it("should not do partial matching", () => {
    process.env.POOL_SUPERADMINS = "admin";
    expect(isSuperAdmin("admin")).toBe(true);
    expect(isSuperAdmin("admin123")).toBe(false);
    expect(isSuperAdmin("123admin")).toBe(false);
    expect(isSuperAdmin("adm")).toBe(false);
  });

  it("should handle empty string input", () => {
    process.env.POOL_SUPERADMINS = "admin1,admin2";
    expect(isSuperAdmin("")).toBe(false);
  });

  it("should handle combined whitespace and case variations", () => {
    process.env.POOL_SUPERADMINS = " Admin1 , ADMIN2  ,  aDmIn3 ";
    expect(isSuperAdmin("  admin1  ")).toBe(true);
    expect(isSuperAdmin("ADMIN2")).toBe(true);
    expect(isSuperAdmin("admin3")).toBe(true);
  });
});
