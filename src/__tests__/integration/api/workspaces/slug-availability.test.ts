import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/slug-availability/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  generateUniqueSlug,
  createGetRequest,
} from "@/__tests__/support/helpers";

describe("GET /api/workspaces/slug-availability Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    test("should return 401 for unauthenticated users", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { slug: "test-slug" }
      );
      const response = await GET(request);

      await expectUnauthorized(response);
    });

    test("should allow authenticated users to check slug availability", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const uniqueSlug = generateUniqueSlug("available");
      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { slug: uniqueSlug }
      );
      const response = await GET(request);

      expect(response.status).not.toBe(401);
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty("slug");
      expect(data.data).toHaveProperty("isAvailable");
    });
  });

  describe("Slug Availability", () => {
    test("should return isAvailable: true for non-existent slug", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const uniqueSlug = generateUniqueSlug("available");
      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { slug: uniqueSlug }
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.data.slug).toBe(uniqueSlug);
      expect(data.data.isAvailable).toBe(true);
      expect(data.data.message).toBe("Slug is available");
    });

    test("should return isAvailable: false for existing active workspace", async () => {
      const user = await createTestUser();
      const existingSlug = generateUniqueSlug("taken");
      await createTestWorkspace({
        ownerId: user.id,
        slug: existingSlug,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { slug: existingSlug }
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.data.slug).toBe(existingSlug);
      expect(data.data.isAvailable).toBe(false);
      expect(data.data.message).toContain("already exists");
    });

    test("should return isAvailable: false for soft-deleted workspace", async () => {
      const user = await createTestUser();
      const deletedSlug = generateUniqueSlug("deleted");
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: deletedSlug,
      });

      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { slug: deletedSlug }
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.data.slug).toBe(deletedSlug);
      expect(data.data.isAvailable).toBe(false);
      expect(data.data.message).toContain("already exists");
    });

    test("should check availability across different users", async () => {
      const user1 = await createTestUser({ name: "User 1" });
      const user2 = await createTestUser({ name: "User 2" });
      
      const sharedSlug = generateUniqueSlug("shared");
      await createTestWorkspace({
        ownerId: user1.id,
        slug: sharedSlug,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user2));

      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { slug: sharedSlug }
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.data.isAvailable).toBe(false);
    });
  });

  describe("Slug Normalization", () => {
    test.each([
      { input: "TestSlug", description: "mixed case" },
      { input: "UPPERCASE", description: "all uppercase" },
      { input: "lowercase", description: "all lowercase" },
      { input: "test-slug-123", description: "with hyphens and numbers" },
    ])(
      "should normalize '$description' slug when checking availability",
      async ({ input }) => {
        const user = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/slug-availability",
          { slug: input }
        );
        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data.data.slug).toBe(input);
        expect(data.data.isAvailable).toBe(true);
      }
    );

    test("should detect existing workspace regardless of input case", async () => {
      const user = await createTestUser();
      const baseSlug = generateUniqueSlug("casetest");
      await createTestWorkspace({
        ownerId: user.id,
        slug: baseSlug.toLowerCase(),
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const caseVariations = [
        baseSlug.toUpperCase(),
        baseSlug.toLowerCase(),
        baseSlug.charAt(0).toUpperCase() + baseSlug.slice(1).toLowerCase(),
      ];

      for (const variation of caseVariations) {
        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/slug-availability",
          { slug: variation }
        );
        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data.data.isAvailable).toBe(false);
        expect(data.data.message).toContain("already exists");
      }
    });
  });

  describe("Edge Cases", () => {
    test("should return 400 for missing slug parameter", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability"
      );
      const response = await GET(request);

      await expectError(response, "Slug parameter is required", 400);
    });

    test("should return 400 for empty slug parameter", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { slug: "" }
      );
      const response = await GET(request);

      await expectError(response, "Slug parameter is required", 400);
    });

    test("should handle very long slugs", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const longSlug = "a".repeat(100);
      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { slug: longSlug }
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.data.slug).toBe(longSlug);
      expect(data.data).toHaveProperty("isAvailable");
    });

    test("should handle slugs with special characters", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const specialSlug = "test-slug_with.special@chars";
      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { slug: specialSlug }
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.data.slug).toBe(specialSlug);
      expect(data.data).toHaveProperty("isAvailable");
    });

    test("should handle slugs with whitespace", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const slugWithSpaces = "test slug with spaces";
      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { slug: slugWithSpaces }
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data.data.slug).toBe(slugWithSpaces);
      expect(data.data).toHaveProperty("isAvailable");
    });
  });

  describe("Response Structure Validation", () => {
    test("should return correct response structure for available slug", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const uniqueSlug = generateUniqueSlug("response-test");
      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { slug: uniqueSlug }
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toMatchObject({
        success: true,
        data: {
          slug: uniqueSlug,
          isAvailable: true,
          message: "Slug is available",
        },
      });
    });

    test("should return correct response structure for unavailable slug", async () => {
      const user = await createTestUser();
      const takenSlug = generateUniqueSlug("taken-response");
      await createTestWorkspace({
        ownerId: user.id,
        slug: takenSlug,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { slug: takenSlug }
      );
      const response = await GET(request);

      const data = await expectSuccess(response, 200);
      expect(data).toMatchObject({
        success: true,
        data: {
          slug: takenSlug,
          isAvailable: false,
          message: "A workspace with this slug already exists",
        },
      });
    });

    test("should always return 200 status for successful checks", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const slugs = [
        generateUniqueSlug("available-1"),
        generateUniqueSlug("available-2"),
      ];

      await createTestWorkspace({
        ownerId: user.id,
        slug: slugs[1],
      });

      for (const slug of slugs) {
        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/slug-availability",
          { slug }
        );
        const response = await GET(request);

        expect(response.status).toBe(200);
        const data = await expectSuccess(response, 200);
        expect(data.success).toBe(true);
      }
    });
  });

  describe("Error Handling", () => {
    test("should return 500 for database errors", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      vi.spyOn(db.workspace, "findUnique").mockRejectedValueOnce(
        new Error("Database connection failed")
      );

      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { slug: "test-slug" }
      );
      const response = await GET(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    test("should handle session without user ID", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" },
      });

      const request = createGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { slug: "test-slug" }
      );
      const response = await GET(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });
  });
});