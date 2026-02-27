import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestUser } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { authOptions } from "@/lib/auth/nextauth";

describe("Admin Access - Integration", () => {
  let adminUser: { id: string; email: string };
  let regularUser: { id: string; email: string };

  beforeEach(async () => {
    // Create an admin user
    adminUser = await createTestUser({ role: "ADMIN" });
    
    // Create a regular user
    regularUser = await createTestUser({ role: "USER" });
  });

  afterEach(async () => {
    // Cleanup
    await db.user.deleteMany({
      where: {
        OR: [
          { id: adminUser.id },
          { id: regularUser.id },
        ],
      },
    });
  });

  describe("Session callback - isSuperAdmin field", () => {
    it("should set isSuperAdmin=true for admin user", async () => {
      // Test the session callback directly
      const mockSession = {
        user: {
          id: adminUser.id,
          email: adminUser.email,
        },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };

      const mockToken = {
        id: adminUser.id,
        email: adminUser.email,
        sub: adminUser.id,
      };

      // Call the session callback
      const result = await authOptions.callbacks!.session!({
        session: mockSession,
        token: mockToken,
      } as any);

      expect(result.user.isSuperAdmin).toBe(true);
    });

    it("should set isSuperAdmin=false for regular user", async () => {
      const mockSession = {
        user: {
          id: regularUser.id,
          email: regularUser.email,
        },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };

      const mockToken = {
        id: regularUser.id,
        email: regularUser.email,
        sub: regularUser.id,
      };

      const result = await authOptions.callbacks!.session!({
        session: mockSession,
        token: mockToken,
      } as any);

      expect(result.user.isSuperAdmin).toBe(false);
    });
  });

  describe("Database role queries", () => {
    it("should retrieve ADMIN role for admin user", async () => {
      const user = await db.user.findUnique({
        where: { id: adminUser.id },
        select: { role: true },
      });

      expect(user?.role).toBe("ADMIN");
    });

    it("should retrieve USER role for regular user", async () => {
      const user = await db.user.findUnique({
        where: { id: regularUser.id },
        select: { role: true },
      });

      expect(user?.role).toBe("USER");
    });
  });
});
