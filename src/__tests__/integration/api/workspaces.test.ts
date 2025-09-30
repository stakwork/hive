import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/workspaces/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import {
  WORKSPACE_ERRORS,
  WORKSPACE_LIMITS,
} from "@/lib/constants";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/fixtures";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  generateUniqueSlug,
} from "@/__tests__/helpers";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;

describe("Workspace API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/workspaces", () => {
    test("creates workspace successfully", async () => {
      const user = await createTestUser();
      const slug = generateUniqueSlug("test-workspace");

      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(user));

      const request = new NextRequest("http://localhost:3000/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Workspace",
          description: "A test workspace",
          slug,
        }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.workspace).toMatchObject({
        name: "Test Workspace",
        slug,
        ownerId: user.id,
      });
    });

    test("enforces workspace limit", async () => {
      const user = await createTestUser();

      for (let index = 0; index < WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER; index++) {
        await createTestWorkspace({
          ownerId: user.id,
          name: `Workspace ${index + 1}`,
          slug: generateUniqueSlug(`workspace-${index + 1}`),
        });
      }

      const slug = generateUniqueSlug("extra-workspace");

      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(user));

      const request = new NextRequest("http://localhost:3000/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Extra Workspace",
          description: "This should fail",
          slug,
        }),
      });

      const response = await POST(request);

      await expectError(response, WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED, 400);
    });

    test("permits creation after workspace deletion", async () => {
      const user = await createTestUser();

      const workspaces = [];
      for (let index = 0; index < WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER; index++) {
        const workspace = await createTestWorkspace({
          ownerId: user.id,
          name: `Workspace ${index + 1}`,
          slug: generateUniqueSlug(`workspace-${index + 1}`),
        });
        workspaces.push(workspace);
      }

      await db.workspace.update({
        where: { id: workspaces[0].id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const slug = generateUniqueSlug("new-workspace");

      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(user));

      const request = new NextRequest("http://localhost:3000/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New Workspace",
          slug,
        }),
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.workspace.name).toBe("New Workspace");
      expect(data.workspace.slug).toBe(slug);
    });

    test("rejects unauthenticated requests", async () => {
      mockGetServerSession.mockResolvedValue(mockUnauthenticatedSession());

      const request = new NextRequest("http://localhost:3000/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Workspace",
          slug: "test-workspace",
        }),
      });

      const response = await POST(request);

      await expectUnauthorized(response);
    });

    test("rejects missing required fields", async () => {
      const user = await createTestUser();

      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(user));

      const request = new NextRequest("http://localhost:3000/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "Missing name and slug",
        }),
      });

      const response = await POST(request);

      await expectError(response, "Missing required fields", 400);
    });

    test("rejects duplicate slugs", async () => {
      const user = await createTestUser();
      const slug = generateUniqueSlug("duplicate");

      await createTestWorkspace({
        ownerId: user.id,
        name: "First Workspace",
        slug,
      });

      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(user));

      const request = new NextRequest("http://localhost:3000/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Duplicate Workspace",
          slug,
        }),
      });

      const response = await POST(request);

      await expectError(response, WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS, 400);
    });
  });
});
