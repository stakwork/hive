import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/users/search/route";
import { db } from "@/lib/db";
import { createAuthenticatedGetRequest } from "@/__tests__/support/helpers/request-builders";

describe("GET /api/admin/users/search", () => {
  let superadminUser: { id: string; email: string };
  let regularUser1: { id: string; email: string; name: string };
  let regularUser2: { id: string; email: string; name: string };
  let regularUser3: { id: string; email: string; name: string };

  beforeEach(async () => {
    // Create a superadmin user
    superadminUser = await db.user.create({
      data: {
        email: "superadmin@test.com",
        role: "SUPER_ADMIN",
        name: "Super Admin",
      },
    });

    // Create regular users
    regularUser1 = await db.user.create({
      data: {
        email: "alice@example.com",
        name: "Alice Smith",
        role: "USER",
      },
    });

    regularUser2 = await db.user.create({
      data: {
        email: "bob@example.com",
        name: "Bob Jones",
        role: "USER",
      },
    });

    regularUser3 = await db.user.create({
      data: {
        email: "charlie@test.org",
        name: "Charlie Brown",
        role: "USER",
      },
    });
  });

  afterEach(async () => {
    await db.user.deleteMany({
      where: {
        id: {
          in: [
            superadminUser.id,
            regularUser1.id,
            regularUser2.id,
            regularUser3.id,
          ],
        },
      },
    });
  });

  it("returns 403 for non-superadmin users", async () => {
    const request = createAuthenticatedGetRequest(
      "/api/admin/users/search",
      regularUser1
    );

    const response = await GET(request as NextRequest);
    expect(response.status).toBe(403);
  });

  it("returns only non-superadmin users", async () => {
    const request = createAuthenticatedGetRequest(
      "/api/admin/users/search",
      superadminUser
    );

    const response = await GET(request as NextRequest);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.users).toBeDefined();
    expect(data.users.length).toBe(3);

    const userIds = data.users.map((u: any) => u.id);
    expect(userIds).toContain(regularUser1.id);
    expect(userIds).toContain(regularUser2.id);
    expect(userIds).toContain(regularUser3.id);
    expect(userIds).not.toContain(superadminUser.id);
  });

  it("filters users by name using ?q= parameter", async () => {
    const request = createAuthenticatedGetRequest(
      "/api/admin/users/search",
      superadminUser,
      { q: "alice" }
    );

    const response = await GET(request as NextRequest);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.users.length).toBe(1);
    expect(data.users[0].id).toBe(regularUser1.id);
    expect(data.users[0].name).toBe("Alice Smith");
  });

  it("filters users by email using ?q= parameter", async () => {
    const request = createAuthenticatedGetRequest(
      "/api/admin/users/search",
      superadminUser,
      { q: "example.com" }
    );

    const response = await GET(request as NextRequest);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.users.length).toBe(2);

    const emails = data.users.map((u: any) => u.email);
    expect(emails).toContain("alice@example.com");
    expect(emails).toContain("bob@example.com");
    expect(emails).not.toContain("charlie@test.org");
  });

  it("performs case-insensitive search", async () => {
    const request = createAuthenticatedGetRequest(
      "/api/admin/users/search",
      superadminUser,
      { q: "ALICE" }
    );

    const response = await GET(request as NextRequest);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.users.length).toBe(1);
    expect(data.users[0].id).toBe(regularUser1.id);
  });

  it("limits results to 20 users", async () => {
    // Create 25 users
    const createdUsers = [];
    for (let i = 0; i < 25; i++) {
      const user = await db.user.create({
        data: {
          email: `user${i}@test.com`,
          name: `User ${i}`,
          role: "USER",
        },
      });
      createdUsers.push(user);
    }

    try {
      const request = createAuthenticatedGetRequest(
        "/api/admin/users/search",
        superadminUser
      );

      const response = await GET(request as NextRequest);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.users.length).toBe(20);
    } finally {
      // Cleanup
      await db.user.deleteMany({
        where: {
          id: { in: createdUsers.map((u) => u.id) },
        },
      });
    }
  });

  it("returns all fields (id, name, email)", async () => {
    const request = createAuthenticatedGetRequest(
      "/api/admin/users/search",
      superadminUser
    );

    const response = await GET(request as NextRequest);
    expect(response.status).toBe(200);

    const data = await response.json();
    const user = data.users[0];

    expect(user).toHaveProperty("id");
    expect(user).toHaveProperty("name");
    expect(user).toHaveProperty("email");
    expect(Object.keys(user).length).toBe(3);
  });
});
