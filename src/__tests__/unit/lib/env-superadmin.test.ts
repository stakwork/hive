import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isSuperAdmin, isSuperAdminUserId } from "@/config/env";

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

describe("isSuperAdminUserId", () => {
  const originalEnv = process.env.SUPER_ADMIN_USER_IDS;

  afterEach(() => {
    // Restore original env var
    if (originalEnv !== undefined) {
      process.env.SUPER_ADMIN_USER_IDS = originalEnv;
    } else {
      delete process.env.SUPER_ADMIN_USER_IDS;
    }
  });

  it("should return true for exact match", () => {
    process.env.SUPER_ADMIN_USER_IDS = "user-123,user-456,user-789";
    expect(isSuperAdminUserId("user-123")).toBe(true);
    expect(isSuperAdminUserId("user-456")).toBe(true);
    expect(isSuperAdminUserId("user-789")).toBe(true);
  });

  it("should return false for non-matching user ID", () => {
    process.env.SUPER_ADMIN_USER_IDS = "user-123,user-456";
    expect(isSuperAdminUserId("user-999")).toBe(false);
    expect(isSuperAdminUserId("user-789")).toBe(false);
  });

  it("should be case-sensitive for user IDs", () => {
    process.env.SUPER_ADMIN_USER_IDS = "User-123,USER-456";
    expect(isSuperAdminUserId("User-123")).toBe(true);
    expect(isSuperAdminUserId("user-123")).toBe(false);
    expect(isSuperAdminUserId("USER-456")).toBe(true);
    expect(isSuperAdminUserId("user-456")).toBe(false);
  });

  it("should trim whitespace from env var entries", () => {
    process.env.SUPER_ADMIN_USER_IDS = " user-123 , user-456  ,  user-789 ";
    expect(isSuperAdminUserId("user-123")).toBe(true);
    expect(isSuperAdminUserId("user-456")).toBe(true);
    expect(isSuperAdminUserId("user-789")).toBe(true);
  });

  it("should trim whitespace from input user ID", () => {
    process.env.SUPER_ADMIN_USER_IDS = "user-123,user-456";
    expect(isSuperAdminUserId(" user-123 ")).toBe(true);
    expect(isSuperAdminUserId("  user-456  ")).toBe(true);
  });

  it("should return false when env var is empty string", () => {
    process.env.SUPER_ADMIN_USER_IDS = "";
    expect(isSuperAdminUserId("user-123")).toBe(false);
  });

  it("should return false when env var is undefined", () => {
    delete process.env.SUPER_ADMIN_USER_IDS;
    expect(isSuperAdminUserId("user-123")).toBe(false);
  });

  it("should handle single user ID without comma", () => {
    process.env.SUPER_ADMIN_USER_IDS = "user-only";
    expect(isSuperAdminUserId("user-only")).toBe(true);
    expect(isSuperAdminUserId("user-other")).toBe(false);
  });

  it("should filter out empty entries from comma-separated list", () => {
    process.env.SUPER_ADMIN_USER_IDS = "user-123,,user-456,,,user-789";
    expect(isSuperAdminUserId("user-123")).toBe(true);
    expect(isSuperAdminUserId("user-456")).toBe(true);
    expect(isSuperAdminUserId("user-789")).toBe(true);
    expect(isSuperAdminUserId("")).toBe(false);
  });

  it("should handle whitespace-only entries", () => {
    process.env.SUPER_ADMIN_USER_IDS = "user-123,  ,user-456,   ";
    expect(isSuperAdminUserId("user-123")).toBe(true);
    expect(isSuperAdminUserId("user-456")).toBe(true);
    expect(isSuperAdminUserId("")).toBe(false);
    expect(isSuperAdminUserId("  ")).toBe(false);
  });

  it("should handle UUIDs and special characters in user IDs", () => {
    process.env.SUPER_ADMIN_USER_IDS = "clx1234567890,cm-abc-def,user_test-123";
    expect(isSuperAdminUserId("clx1234567890")).toBe(true);
    expect(isSuperAdminUserId("cm-abc-def")).toBe(true);
    expect(isSuperAdminUserId("user_test-123")).toBe(true);
  });

  it("should not do partial matching", () => {
    process.env.SUPER_ADMIN_USER_IDS = "user-123";
    expect(isSuperAdminUserId("user-123")).toBe(true);
    expect(isSuperAdminUserId("user-1234")).toBe(false);
    expect(isSuperAdminUserId("user-12")).toBe(false);
    expect(isSuperAdminUserId("123")).toBe(false);
  });

  it("should handle empty string input", () => {
    process.env.SUPER_ADMIN_USER_IDS = "user-123,user-456";
    expect(isSuperAdminUserId("")).toBe(false);
  });

  it("should handle cuid-style IDs", () => {
    process.env.SUPER_ADMIN_USER_IDS = "clx1a2b3c4d5e6f7g8h9,clx9z8y7x6w5v4u3t2s1";
    expect(isSuperAdminUserId("clx1a2b3c4d5e6f7g8h9")).toBe(true);
    expect(isSuperAdminUserId("clx9z8y7x6w5v4u3t2s1")).toBe(true);
    expect(isSuperAdminUserId("clx9z8y7x6w5v4u3t2s2")).toBe(false);
  });
});
