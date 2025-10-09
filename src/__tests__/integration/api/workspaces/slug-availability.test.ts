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

describe("Workspace Slug Availability API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/workspaces/slug-availability", () => {
    describe("Authentication", () => {
      test("rejects unauthenticated requests", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/slug-availability",
          { slug: "test-slug" }
        );

        const response = await GET(request);

        await expectUnauthorized(response);
      });

      test("allows authenticated requests", async () => {
        const user = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        const slug = generateUniqueSlug("available");
        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/slug-availability",
          { slug }
        );

        const response = await GET(request);

        expect(response.status).not.toBe(401);
      });
    });

    describe("Slug Availability Checks", () => {
      test.each([
        {
          name: "returns available for non-existent slug",
          setup: async () => {
            const user = await createTestUser();
            const slug = generateUniqueSlug("available");
            return { user, slug };
          },
          expectedAvailable: true,
          expectedMessage: "Slug is available",
        },
        {
          name: "returns unavailable for existing slug",
          setup: async () => {
            const user = await createTestUser();
            const slug = generateUniqueSlug("taken");
            await createTestWorkspace({
              ownerId: user.id,
              name: "Existing Workspace",
              slug,
            });
            return { user, slug };
          },
          expectedAvailable: false,
          expectedMessage: "A workspace with this slug already exists",
        },
        {
          name: "returns unavailable for soft-deleted workspace slug",
          setup: async () => {
            const user = await createTestUser();
            const slug = generateUniqueSlug("soft-deleted");
            const workspace = await createTestWorkspace({
              ownerId: user.id,
              name: "Deleted Workspace",
              slug,
            });
            // Soft-delete the workspace
            await db.workspace.update({
              where: { id: workspace.id },
              data: { deleted: true, deletedAt: new Date() },
            });
            return { user, slug };
          },
          expectedAvailable: false,
          expectedMessage: "A workspace with this slug already exists",
        },
      ])("$name", async ({ setup, expectedAvailable, expectedMessage }) => {
        const { user, slug } = await setup();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/slug-availability",
          { slug }
        );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data.data.slug).toBe(slug);
        expect(data.data.isAvailable).toBe(expectedAvailable);
        expect(data.data.message).toBe(expectedMessage);
      });
    });

    describe("Case Normalization", () => {
      test.each([
        {
          name: "normalizes uppercase slug to lowercase",
          inputSlug: "UPPERCASE-SLUG",
          expectedSlug: "UPPERCASE-SLUG", // Response returns original input
          dbQuerySlug: "uppercase-slug", // But DB query uses lowercase
        },
        {
          name: "normalizes mixed-case slug to lowercase",
          inputSlug: "MixedCase-Slug",
          expectedSlug: "MixedCase-Slug",
          dbQuerySlug: "mixedcase-slug",
        },
      ])("$name", async ({ inputSlug, expectedSlug, dbQuerySlug }) => {
        const user = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        // Create workspace with lowercase slug
        await createTestWorkspace({
          ownerId: user.id,
          name: "Test Workspace",
          slug: dbQuerySlug,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/slug-availability",
          { slug: inputSlug }
        );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data.data.slug).toBe(expectedSlug); // Returns original input
        expect(data.data.isAvailable).toBe(false); // But found the lowercase match
      });

      test("case-insensitive matching works for available slugs", async () => {
        const user = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        const slug = generateUniqueSlug("AVAILABLE");
        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/slug-availability",
          { slug }
        );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data.data.isAvailable).toBe(true);
      });
    });

    describe("Edge Cases", () => {
      test("returns 400 for missing slug parameter", async () => {
        const user = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/slug-availability"
          // No slug parameter
        );

        const response = await GET(request);

        await expectError(response, "Slug parameter is required", 400);
      });

      test("returns 400 for empty slug parameter", async () => {
        const user = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/slug-availability",
          { slug: "" }
        );

        const response = await GET(request);

        await expectError(response, "Slug parameter is required", 400);
      });

      test("handles slugs with special characters", async () => {
        const user = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        const slug = "test-slug-with-special!@#$%";
        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/slug-availability",
          { slug }
        );

        const response = await GET(request);

        // Should return 200 (endpoint doesn't validate format, just checks DB)
        const data = await expectSuccess(response, 200);
        expect(data.data.slug).toBe(slug);
        expect(data.data.isAvailable).toBe(true);
      });

      test("handles very long slugs", async () => {
        const user = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        const slug = "a".repeat(100); // Much longer than 50 char limit
        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/slug-availability",
          { slug }
        );

        const response = await GET(request);

        // Should return 200 (endpoint doesn't validate length)
        const data = await expectSuccess(response, 200);
        expect(data.data.isAvailable).toBe(true);
      });

      test("handles slugs with consecutive hyphens", async () => {
        const user = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        const slug = "test--slug--with--hyphens";
        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/slug-availability",
          { slug }
        );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data.data.slug).toBe(slug);
        expect(data.data.isAvailable).toBe(true);
      });
    });

    describe("Response Format", () => {
      test("returns correct response structure for available slug", async () => {
        const user = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        const slug = generateUniqueSlug("available");
        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/slug-availability",
          { slug }
        );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data).toHaveProperty("success", true);
        expect(data).toHaveProperty("data");
        expect(data.data).toHaveProperty("slug", slug);
        expect(data.data).toHaveProperty("isAvailable", true);
        expect(data.data).toHaveProperty("message", "Slug is available");
      });

      test("returns correct response structure for unavailable slug", async () => {
        const user = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        const slug = generateUniqueSlug("taken");
        await createTestWorkspace({
          ownerId: user.id,
          name: "Existing Workspace",
          slug,
        });

        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/slug-availability",
          { slug }
        );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data).toHaveProperty("success", true);
        expect(data).toHaveProperty("data");
        expect(data.data).toHaveProperty("slug", slug);
        expect(data.data).toHaveProperty("isAvailable", false);
        expect(data.data).toHaveProperty(
          "message",
          "A workspace with this slug already exists"
        );
      });
    });

    describe("Multiple Users", () => {
      test("slug availability is global across all users", async () => {
        const user1 = await createTestUser({ email: "user1@test.com" });
        const user2 = await createTestUser({ email: "user2@test.com" });

        const slug = generateUniqueSlug("shared");

        // User 1 creates workspace with slug
        await createTestWorkspace({
          ownerId: user1.id,
          name: "User 1 Workspace",
          slug,
        });

        // User 2 checks availability
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user2));

        const request = createGetRequest(
          "http://localhost:3000/api/workspaces/slug-availability",
          { slug }
        );

        const response = await GET(request);

        const data = await expectSuccess(response, 200);
        expect(data.data.isAvailable).toBe(false);
        expect(data.data.message).toBe(
          "A workspace with this slug already exists"
        );
      });
    });

    describe("Concurrent Checks", () => {
      test("handles simultaneous availability checks for same slug", async () => {
        const user = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

        const slug = generateUniqueSlug("concurrent");

        // Create multiple simultaneous requests
        const requests = Array.from({ length: 5 }, () =>
          createGetRequest(
            "http://localhost:3000/api/workspaces/slug-availability",
            { slug }
          )
        );

        const responses = await Promise.all(requests.map((req) => GET(req)));

        // All should return the same result
        for (const response of responses) {
          const data = await expectSuccess(response, 200);
          expect(data.data.isAvailable).toBe(true);
          expect(data.data.slug).toBe(slug);
        }
      });
    });
  });
});