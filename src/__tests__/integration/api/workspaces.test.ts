import { describe, test, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/workspaces/route";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { 
  WORKSPACE_ERRORS,
  WORKSPACE_LIMITS
} from "@/lib/constants";
import type { User } from "@prisma/client";

// Mock next-auth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock authOptions (not used directly but imported by route)
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

describe("Workspace API - Integration Tests", () => {
  const generateRandomString = (length = 8) => {
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  };

  let testUser: User;

  beforeEach(async () => {
    // Create test user
    testUser = await db.user.create({
      data: {
        name: "Test User",
        email: `user_${generateRandomString()}@example.com`,
      },
    });

    // Mock session for authenticated user
    (getServerSession as vi.Mock).mockResolvedValue({
      user: { id: testUser.id, email: testUser.email },
    });
  });

  describe("POST /api/workspaces", () => {
    test("should create workspace successfully", async () => {
      const slug = `test-workspace-${generateRandomString()}`;
      const request = new NextRequest("http://localhost:3000/api/workspaces", {
        method: "POST",
        body: JSON.stringify({
          name: "Test Workspace",
          description: "A test workspace",
          slug: slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.workspace).toMatchObject({
        name: "Test Workspace",
        description: "A test workspace",
        slug: slug,
        ownerId: testUser.id,
      });
    });

    test("should enforce workspace limit", async () => {
      // Create max workspaces for the user
      for (let i = 0; i < WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER; i++) {
        await db.workspace.create({
          data: {
            name: `Workspace ${i + 1}`,
            slug: `workspace-${i + 1}-${generateRandomString()}`,
            ownerId: testUser.id,
          },
        });
      }

      // Try to create another workspace via API
      const slug = `extra-workspace-${generateRandomString()}`;
      const request = new NextRequest("http://localhost:3000/api/workspaces", {
        method: "POST",
        body: JSON.stringify({
          name: "Extra Workspace",
          description: "This should fail",
          slug: slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe(WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED);
    });

    test("should allow creation after workspace deletion", async () => {
      // Create max workspaces
      const workspaces = [];
      for (let i = 0; i < WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER; i++) {
        const workspace = await db.workspace.create({
          data: {
            name: `Workspace ${i + 1}`,
            slug: `workspace-${i + 1}-${generateRandomString()}`,
            ownerId: testUser.id,
          },
        });
        workspaces.push(workspace);
      }

      // Delete one workspace
      await db.workspace.update({
        where: { id: workspaces[0].id },
        data: { deleted: true, deletedAt: new Date() }
      });

      // Now should be able to create via API
      const slug = `new-workspace-${generateRandomString()}`;
      const request = new NextRequest("http://localhost:3000/api/workspaces", {
        method: "POST",
        body: JSON.stringify({
          name: "New Workspace",
          slug: slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.workspace.name).toBe("New Workspace");
      expect(data.workspace.slug).toBe(slug);
    });

    test("should return 401 for unauthenticated user", async () => {
      (getServerSession as vi.Mock).mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/workspaces", {
        method: "POST",
        body: JSON.stringify({
          name: "Test Workspace",
          slug: "test-workspace",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 400 for missing required fields", async () => {
      const request = new NextRequest("http://localhost:3000/api/workspaces", {
        method: "POST",
        body: JSON.stringify({
          description: "Missing name and slug",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing required fields");
    });

    test("should return 400 for duplicate slug", async () => {
      const slug = `duplicate-${generateRandomString()}`;
      
      // Create first workspace
      await db.workspace.create({
        data: {
          name: "First Workspace",
          slug: slug,
          ownerId: testUser.id,
        },
      });

      // Try to create another with same slug
      const request = new NextRequest("http://localhost:3000/api/workspaces", {
        method: "POST",
        body: JSON.stringify({
          name: "Duplicate Workspace",
          slug: slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe(WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS);
    });
  });
});