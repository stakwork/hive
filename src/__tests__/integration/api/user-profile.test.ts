import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { PATCH } from "@/app/api/user/profile/route";
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { generateUniqueId } from "@/__tests__/support/helpers";

// Mock next-auth
import { vi } from "vitest";
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

describe("PATCH /api/user/profile - Integration", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    // Cleanup
    if (createdUserIds.length > 0) {
      await db.session.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await db.account.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await db.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
      createdUserIds.length = 0;
    }
  });

  test("persists sphinxAlias to database and includes in session", async () => {
    // Create test user
    const userId = generateUniqueId("user");
    const user = await db.user.create({
      data: {
        id: userId,
        email: "test@example.com",
        name: "Test User",
      },
    });
    createdUserIds.push(userId);

    // Mock session
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: userId, email: user.email },
    } as any);

    // Update sphinxAlias
    const request = new NextRequest("http://localhost/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ sphinxAlias: "mytribealias" }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sphinxAlias).toBe("mytribealias");

    // Verify it's in the database
    const updatedUser = await db.user.findUnique({
      where: { id: userId },
      select: { sphinxAlias: true },
    });

    expect(updatedUser?.sphinxAlias).toBe("mytribealias");
  });

  test("clears sphinxAlias when set to null", async () => {
    // Create test user with existing alias
    const userId = generateUniqueId("user");
    const user = await db.user.create({
      data: {
        id: userId,
        email: "test2@example.com",
        name: "Test User 2",
        sphinxAlias: "existingalias",
      },
    });
    createdUserIds.push(userId);

    // Mock session
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: userId, email: user.email },
    } as any);

    // Clear sphinxAlias
    const request = new NextRequest("http://localhost/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ sphinxAlias: null }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sphinxAlias).toBeNull();

    // Verify it's cleared in the database
    const updatedUser = await db.user.findUnique({
      where: { id: userId },
      select: { sphinxAlias: true },
    });

    expect(updatedUser?.sphinxAlias).toBeNull();
  });

  test("updates existing sphinxAlias", async () => {
    // Create test user with existing alias
    const userId = generateUniqueId("user");
    const user = await db.user.create({
      data: {
        id: userId,
        email: "test3@example.com",
        name: "Test User 3",
        sphinxAlias: "oldalias",
      },
    });
    createdUserIds.push(userId);

    // Mock session
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: userId, email: user.email },
    } as any);

    // Update to new alias
    const request = new NextRequest("http://localhost/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ sphinxAlias: "newalias" }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.sphinxAlias).toBe("newalias");

    // Verify it's updated in the database
    const updatedUser = await db.user.findUnique({
      where: { id: userId },
      select: { sphinxAlias: true },
    });

    expect(updatedUser?.sphinxAlias).toBe("newalias");
  });
});
