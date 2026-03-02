import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { authOptions } from "@/lib/auth/nextauth";

describe("JWT Callback SUPER_ADMIN Role Integration Tests", () => {
  const originalEnv = process.env.SUPER_ADMIN_USER_IDS;

  afterEach(() => {
    // Restore original env var
    if (originalEnv !== undefined) {
      process.env.SUPER_ADMIN_USER_IDS = originalEnv;
    } else {
      delete process.env.SUPER_ADMIN_USER_IDS;
    }
  });

  describe("JWT callback role assignment", () => {
    test("should assign SUPER_ADMIN role when userId is in SUPER_ADMIN_USER_IDS env var", async () => {
      // Create test user with USER role
      const testUser = await createTestUser({
        email: "superadmin@example.com",
        name: "Super Admin User",
        role: "USER",
      });

      // Set env var to include this user ID
      process.env.SUPER_ADMIN_USER_IDS = `${testUser.id},other-user-id`;

      // Get the JWT callback
      const jwtCallback = authOptions.callbacks?.jwt;
      expect(jwtCallback).toBeDefined();

      if (!jwtCallback) {
        throw new Error("JWT callback not found");
      }

      // Simulate sign-in (when user object is present)
      const mockToken = {};
      const mockUser = {
        id: testUser.id,
        email: testUser.email,
        name: testUser.name,
        image: null,
      };

      // Execute JWT callback
      const resultToken = await jwtCallback({
        token: mockToken,
        user: mockUser,
        account: null,
        profile: undefined,
        trigger: "signIn",
      });

      // Verify role was stored in token
      expect(resultToken.role).toBe("SUPER_ADMIN");

      // Verify DB was updated
      const updatedUser = await db.user.findUnique({
        where: { id: testUser.id },
        select: { role: true },
      });
      expect(updatedUser?.role).toBe("SUPER_ADMIN");
    });

    test("should keep existing SUPER_ADMIN role when userId is in env var", async () => {
      // Create test user with SUPER_ADMIN role already
      const testUser = await createTestUser({
        email: "existing-superadmin@example.com",
        name: "Existing Super Admin",
        role: "SUPER_ADMIN",
      });

      // Set env var to include this user ID
      process.env.SUPER_ADMIN_USER_IDS = testUser.id;

      // Get the JWT callback
      const jwtCallback = authOptions.callbacks?.jwt;
      expect(jwtCallback).toBeDefined();

      if (!jwtCallback) {
        throw new Error("JWT callback not found");
      }

      // Simulate sign-in
      const mockToken = {};
      const mockUser = {
        id: testUser.id,
        email: testUser.email,
        name: testUser.name,
        image: null,
      };

      // Execute JWT callback
      const resultToken = await jwtCallback({
        token: mockToken,
        user: mockUser,
        account: null,
        profile: undefined,
        trigger: "signIn",
      });

      // Verify role remains SUPER_ADMIN in token
      expect(resultToken.role).toBe("SUPER_ADMIN");

      // Verify DB still has SUPER_ADMIN (no unnecessary update)
      const updatedUser = await db.user.findUnique({
        where: { id: testUser.id },
        select: { role: true },
      });
      expect(updatedUser?.role).toBe("SUPER_ADMIN");
    });

    test("should NOT assign SUPER_ADMIN role when userId is NOT in env var", async () => {
      // Create test user with USER role
      const testUser = await createTestUser({
        email: "regular@example.com",
        name: "Regular User",
        role: "USER",
      });

      // Set env var with a different user ID
      process.env.SUPER_ADMIN_USER_IDS = "other-user-id-1,other-user-id-2";

      // Get the JWT callback
      const jwtCallback = authOptions.callbacks?.jwt;
      expect(jwtCallback).toBeDefined();

      if (!jwtCallback) {
        throw new Error("JWT callback not found");
      }

      // Simulate sign-in
      const mockToken = {};
      const mockUser = {
        id: testUser.id,
        email: testUser.email,
        name: testUser.name,
        image: null,
      };

      // Execute JWT callback
      const resultToken = await jwtCallback({
        token: mockToken,
        user: mockUser,
        account: null,
        profile: undefined,
        trigger: "signIn",
      });

      // Verify role remains USER
      expect(resultToken.role).toBe("USER");

      // Verify DB still has USER role
      const updatedUser = await db.user.findUnique({
        where: { id: testUser.id },
        select: { role: true },
      });
      expect(updatedUser?.role).toBe("USER");
    });

    test("should handle ADMIN role when userId is NOT in env var", async () => {
      // Create test user with ADMIN role
      const testUser = await createTestUser({
        email: "admin@example.com",
        name: "Admin User",
        role: "ADMIN",
      });

      // Set env var with a different user ID
      process.env.SUPER_ADMIN_USER_IDS = "other-user-id";

      // Get the JWT callback
      const jwtCallback = authOptions.callbacks?.jwt;
      expect(jwtCallback).toBeDefined();

      if (!jwtCallback) {
        throw new Error("JWT callback not found");
      }

      // Simulate sign-in
      const mockToken = {};
      const mockUser = {
        id: testUser.id,
        email: testUser.email,
        name: testUser.name,
        image: null,
      };

      // Execute JWT callback
      const resultToken = await jwtCallback({
        token: mockToken,
        user: mockUser,
        account: null,
        profile: undefined,
        trigger: "signIn",
      });

      // Verify role remains ADMIN (not promoted)
      expect(resultToken.role).toBe("ADMIN");

      // Verify DB still has ADMIN role
      const updatedUser = await db.user.findUnique({
        where: { id: testUser.id },
        select: { role: true },
      });
      expect(updatedUser?.role).toBe("ADMIN");
    });

    test("should handle empty SUPER_ADMIN_USER_IDS env var", async () => {
      // Create test user
      const testUser = await createTestUser({
        email: "user@example.com",
        name: "User",
        role: "USER",
      });

      // Set env var to empty string
      process.env.SUPER_ADMIN_USER_IDS = "";

      // Get the JWT callback
      const jwtCallback = authOptions.callbacks?.jwt;
      expect(jwtCallback).toBeDefined();

      if (!jwtCallback) {
        throw new Error("JWT callback not found");
      }

      // Simulate sign-in
      const mockToken = {};
      const mockUser = {
        id: testUser.id,
        email: testUser.email,
        name: testUser.name,
        image: null,
      };

      // Execute JWT callback
      const resultToken = await jwtCallback({
        token: mockToken,
        user: mockUser,
        account: null,
        profile: undefined,
        trigger: "signIn",
      });

      // Verify role remains USER
      expect(resultToken.role).toBe("USER");
    });

    test("should handle multiple user IDs in env var", async () => {
      // Create multiple test users
      const user1 = await createTestUser({
        email: "super1@example.com",
        name: "Super Admin 1",
        role: "USER",
      });

      const user2 = await createTestUser({
        email: "super2@example.com",
        name: "Super Admin 2",
        role: "USER",
      });

      const user3 = await createTestUser({
        email: "regular@example.com",
        name: "Regular User",
        role: "USER",
      });

      // Set env var with first two user IDs
      process.env.SUPER_ADMIN_USER_IDS = `${user1.id},${user2.id}`;

      // Get the JWT callback
      const jwtCallback = authOptions.callbacks?.jwt;
      expect(jwtCallback).toBeDefined();

      if (!jwtCallback) {
        throw new Error("JWT callback not found");
      }

      // Test user1 (should become SUPER_ADMIN)
      const token1 = await jwtCallback({
        token: {},
        user: { id: user1.id, email: user1.email, name: user1.name, image: null },
        account: null,
        profile: undefined,
        trigger: "signIn",
      });
      expect(token1.role).toBe("SUPER_ADMIN");

      // Test user2 (should become SUPER_ADMIN)
      const token2 = await jwtCallback({
        token: {},
        user: { id: user2.id, email: user2.email, name: user2.name, image: null },
        account: null,
        profile: undefined,
        trigger: "signIn",
      });
      expect(token2.role).toBe("SUPER_ADMIN");

      // Test user3 (should remain USER)
      const token3 = await jwtCallback({
        token: {},
        user: { id: user3.id, email: user3.email, name: user3.name, image: null },
        account: null,
        profile: undefined,
        trigger: "signIn",
      });
      expect(token3.role).toBe("USER");

      // Verify DB updates
      const dbUser1 = await db.user.findUnique({ where: { id: user1.id }, select: { role: true } });
      const dbUser2 = await db.user.findUnique({ where: { id: user2.id }, select: { role: true } });
      const dbUser3 = await db.user.findUnique({ where: { id: user3.id }, select: { role: true } });

      expect(dbUser1?.role).toBe("SUPER_ADMIN");
      expect(dbUser2?.role).toBe("SUPER_ADMIN");
      expect(dbUser3?.role).toBe("USER");
    });
  });

  describe("Session callback isSuperAdmin surfacing", () => {
    test("should set isSuperAdmin to true when token.role is SUPER_ADMIN", async () => {
      // Create test user with SUPER_ADMIN role
      const testUser = await createTestUser({
        email: "superadmin@example.com",
        name: "Super Admin",
        role: "SUPER_ADMIN",
      });

      // Get the session callback
      const sessionCallback = authOptions.callbacks?.session;
      expect(sessionCallback).toBeDefined();

      if (!sessionCallback) {
        throw new Error("Session callback not found");
      }

      // Mock token with SUPER_ADMIN role
      const mockToken = {
        id: testUser.id,
        email: testUser.email,
        role: "SUPER_ADMIN" as const,
      };

      // Mock session
      const mockSession = {
        user: {
          id: testUser.id,
          email: testUser.email ?? undefined,
          name: testUser.name ?? undefined,
          emailVerified: null,
        } as any,
        expires: new Date(Date.now() + 86400000).toISOString(),
      };

      // Execute session callback
      const resultSession = await sessionCallback({
        session: mockSession,
        token: mockToken,
        user: mockSession.user,
      } as any);

      // Verify isSuperAdmin is set to true
      expect(resultSession.user).toBeDefined();
      if (resultSession.user && 'isSuperAdmin' in resultSession.user) {
        expect(resultSession.user.isSuperAdmin).toBe(true);
      } else {
        throw new Error("isSuperAdmin property not found in session.user");
      }
    });

    test("should set isSuperAdmin to false when token.role is USER", async () => {
      // Create test user with USER role
      const testUser = await createTestUser({
        email: "user@example.com",
        name: "Regular User",
        role: "USER",
      });

      // Get the session callback
      const sessionCallback = authOptions.callbacks?.session;
      expect(sessionCallback).toBeDefined();

      if (!sessionCallback) {
        throw new Error("Session callback not found");
      }

      // Mock token with USER role
      const mockToken = {
        id: testUser.id,
        email: testUser.email,
        role: "USER" as const,
      };

      // Mock session
      const mockSession = {
        user: {
          id: testUser.id,
          email: testUser.email ?? undefined,
          name: testUser.name ?? undefined,
          emailVerified: null,
        } as any,
        expires: new Date(Date.now() + 86400000).toISOString(),
      };

      // Execute session callback
      const resultSession = await sessionCallback({
        session: mockSession,
        token: mockToken,
        user: mockSession.user,
      } as any);

      // Verify isSuperAdmin is set to false
      expect(resultSession.user).toBeDefined();
      if (resultSession.user && 'isSuperAdmin' in resultSession.user) {
        expect(resultSession.user.isSuperAdmin).toBe(false);
      } else {
        throw new Error("isSuperAdmin property not found in session.user");
      }
    });
  });
});
