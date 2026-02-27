import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/factories";
import { createAuthenticatedGetRequest, createAuthenticatedPostRequest, createDeleteRequest, addMiddlewareHeaders } from "@/__tests__/support/helpers/request-builders";

describe("Admin Users API", () => {
  let superAdminUser: { id: string; email: string };
  let regularUser: { id: string; email: string };
  let targetUser: { id: string; email: string };

  beforeEach(async () => {
    // Create test users (beforeEach because resetDatabase runs beforeEach)
    superAdminUser = await createTestUser({ role: "SUPER_ADMIN", email: "superadmin@test.com" });
    regularUser = await createTestUser({ role: "USER", email: "regular@test.com" });
    targetUser = await createTestUser({ role: "USER", email: "target@test.com" });
  });

  describe("GET /api/admin/users", () => {
    it("should return 403 for regular users", async () => {
      const request = createAuthenticatedGetRequest("/api/admin/users", regularUser);
      const { GET } = await import("@/app/api/admin/users/route");
      const response = await GET(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Forbidden");
    });

    it("should return 200 with superadmins list for superadmin users", async () => {
      const request = createAuthenticatedGetRequest("/api/admin/users", superAdminUser);
      const { GET } = await import("@/app/api/admin/users/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.users).toBeDefined();
      expect(Array.isArray(data.users)).toBe(true);
      expect(data.users.some((u: { id: string }) => u.id === superAdminUser.id)).toBe(true);
    });
  });

  describe("POST /api/admin/users", () => {
    it("should return 403 for regular users", async () => {
      const request = createAuthenticatedPostRequest(
        "/api/admin/users",
        regularUser,
        { email: targetUser.email }
      );
      const { POST } = await import("@/app/api/admin/users/route");
      const response = await POST(request);

      expect(response.status).toBe(403);
    });

    it("should promote a user to superadmin by email", async () => {
      const request = createAuthenticatedPostRequest(
        "/api/admin/users",
        superAdminUser,
        { email: targetUser.email }
      );
      const { POST } = await import("@/app/api/admin/users/route");
      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Verify user was promoted
      const updatedUser = await db.user.findUnique({
        where: { id: targetUser.id },
        select: { role: true },
      });
      expect(updatedUser?.role).toBe("SUPER_ADMIN");
    });

    it("should promote a user to superadmin by userId", async () => {
      // Create a new user for this test
      const newUser = await createTestUser({ role: "USER", email: "newuser@test.com" });

      const request = createAuthenticatedPostRequest(
        "/api/admin/users",
        superAdminUser,
        { userId: newUser.id }
      );
      const { POST } = await import("@/app/api/admin/users/route");
      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify user was promoted
      const updatedUser = await db.user.findUnique({
        where: { id: newUser.id },
        select: { role: true },
      });
      expect(updatedUser?.role).toBe("SUPER_ADMIN");
    });

    it("should return 404 for non-existent user", async () => {
      const request = createAuthenticatedPostRequest(
        "/api/admin/users",
        superAdminUser,
        { email: "nonexistent@test.com" }
      );
      const { POST } = await import("@/app/api/admin/users/route");
      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("User not found");
    });

    it("should return 400 if user is already a superadmin", async () => {
      const request = createAuthenticatedPostRequest(
        "/api/admin/users",
        superAdminUser,
        { email: superAdminUser.email }
      );
      const { POST } = await import("@/app/api/admin/users/route");
      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("User is already a superadmin");
    });
  });

  describe("DELETE /api/admin/users", () => {
    let promotedUser: { id: string; email: string };

    beforeEach(async () => {
      // Create and promote a user for deletion tests (beforeEach because resetDatabase runs beforeEach)
      promotedUser = await createTestUser({ role: "SUPER_ADMIN", email: "promoted@test.com" });
    });

    it("should return 403 for regular users", async () => {
      const baseRequest = createDeleteRequest("/api/admin/users", { userId: promotedUser.id });
      const request = addMiddlewareHeaders(baseRequest, regularUser);
      const { DELETE } = await import("@/app/api/admin/users/route");
      const response = await DELETE(request);

      expect(response.status).toBe(403);
    });

    it("should demote a superadmin to regular user", async () => {
      const baseRequest = createDeleteRequest("/api/admin/users", { userId: promotedUser.id });
      const request = addMiddlewareHeaders(baseRequest, superAdminUser);
      const { DELETE } = await import("@/app/api/admin/users/route");
      const response = await DELETE(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Verify user was demoted
      const updatedUser = await db.user.findUnique({
        where: { id: promotedUser.id },
        select: { role: true },
      });
      expect(updatedUser?.role).toBe("USER");
    });

    it("should return 400 when trying to demote self", async () => {
      const baseRequest = createDeleteRequest("/api/admin/users", { userId: superAdminUser.id });
      const request = addMiddlewareHeaders(baseRequest, superAdminUser);
      const { DELETE } = await import("@/app/api/admin/users/route");
      const response = await DELETE(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Cannot demote yourself");
    });

    it("should return 404 for non-existent user", async () => {
      const baseRequest = createDeleteRequest("/api/admin/users", { userId: "cm00000000000000000000000" });
      const request = addMiddlewareHeaders(baseRequest, superAdminUser);
      const { DELETE } = await import("@/app/api/admin/users/route");
      const response = await DELETE(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("User not found");
    });

    it("should return 400 if user is not a superadmin", async () => {
      const baseRequest = createDeleteRequest("/api/admin/users", { userId: regularUser.id });
      const request = addMiddlewareHeaders(baseRequest, superAdminUser);
      const { DELETE } = await import("@/app/api/admin/users/route");
      const response = await DELETE(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("User is not a superadmin");
    });
  });
});
