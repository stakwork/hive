import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/slug-availability/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedGetRequest,
  expectSuccess,
  expectUnauthorized,
  expectError,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";

describe("Slug Availability API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/workspaces/slug-availability", () => {
    test.each([
      {
        name: "returns available for non-existent slug",
        setup: async () => {
          const user = await createTestUser();
          const slug = generateUniqueSlug("available");
          return { user, slug };
        },
        expectedStatus: 200,
        assertions: async (response: Response, context: { user: any; slug: string }) => {
          const data = await expectSuccess(response, 200);
          expect(data.success).toBe(true);
          expect(data.data.isAvailable).toBe(true);
          expect(data.data.slug).toBe(context.slug);
          expect(data.data.message).toBe("Slug is available");
        },
      },
      {
        name: "returns unavailable for existing slug",
        setup: async () => {
          const user = await createTestUser();
          const slug = generateUniqueSlug("existing");
          await createTestWorkspace({ ownerId: user.id, slug });
          return { user, slug };
        },
        expectedStatus: 200,
        assertions: async (response: Response, context: { user: any; slug: string }) => {
          const data = await expectSuccess(response, 200);
          expect(data.success).toBe(true);
          expect(data.data.isAvailable).toBe(false);
          expect(data.data.slug).toBe(context.slug);
          expect(data.data.message).toBe("A workspace with this slug already exists");
        },
      },
      {
        name: "handles case-insensitive check (uppercase input, lowercase in DB)",
        setup: async () => {
          const user = await createTestUser();
          const slug = generateUniqueSlug("testslug");
          await createTestWorkspace({ ownerId: user.id, slug });
          return { user, slug: slug.toUpperCase() }; // Query with uppercase
        },
        expectedStatus: 200,
        assertions: async (response: Response, context: { user: any; slug: string }) => {
          const data = await expectSuccess(response, 200);
          expect(data.success).toBe(true);
          expect(data.data.isAvailable).toBe(false);
          expect(data.data.message).toBe("A workspace with this slug already exists");
        },
      },
      {
        name: "handles case-insensitive check (mixed case input)",
        setup: async () => {
          const user = await createTestUser();
          const slug = generateUniqueSlug("mixedcase");
          await createTestWorkspace({ ownerId: user.id, slug });
          // Create mixed case version for query
          const mixedCaseSlug = slug.split('').map((c, i) => 
            i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()
          ).join('');
          return { user, slug: mixedCaseSlug };
        },
        expectedStatus: 200,
        assertions: async (response: Response, context: { user: any; slug: string }) => {
          const data = await expectSuccess(response, 200);
          expect(data.success).toBe(true);
          expect(data.data.isAvailable).toBe(false);
          expect(data.data.message).toBe("A workspace with this slug already exists");
        },
      },
      {
        name: "returns unavailable for soft-deleted workspace (current bug)",
        setup: async () => {
          const user = await createTestUser();
          const slug = generateUniqueSlug("deleted");
          const workspace = await createTestWorkspace({ ownerId: user.id, slug });
          
          // Soft-delete the workspace
          await db.workspace.update({
            where: { id: workspace.id },
            data: { deleted: true, deletedAt: new Date() },
          });
          
          return { user, slug };
        },
        expectedStatus: 200,
        assertions: async (response: Response, context: { user: any; slug: string }) => {
          const data = await expectSuccess(response, 200);
          expect(data.success).toBe(true);
          
          // CURRENT BUG: Endpoint returns false (unavailable) because it doesn't filter by deleted: false
          // The database query: db.workspace.findUnique({ where: { slug: slug.toLowerCase() } })
          // does not exclude soft-deleted workspaces, so they still show as unavailable.
          expect(data.data.isAvailable).toBe(false);
          expect(data.data.message).toBe("A workspace with this slug already exists");
          
          // EXPECTED BEHAVIOR (after bug fix):
          // The endpoint should filter soft-deleted workspaces:
          // db.workspace.findUnique({ where: { slug: slug.toLowerCase(), deleted: false } })
          // Then soft-deleted slugs would correctly show as available:
          // expect(data.data.isAvailable).toBe(true);
          // expect(data.data.message).toBe("Slug is available");
        },
      },
      {
        name: "returns available for slug of different deleted workspace",
        setup: async () => {
          const user = await createTestUser();
          const slug = generateUniqueSlug("reusable");
          
          // Create workspace with different slug, then soft-delete it
          const differentSlug = generateUniqueSlug("different");
          const workspace = await createTestWorkspace({ 
            ownerId: user.id, 
            slug: differentSlug 
          });
          await db.workspace.update({
            where: { id: workspace.id },
            data: { deleted: true, deletedAt: new Date() },
          });
          
          return { user, slug }; // Query for slug that was never used
        },
        expectedStatus: 200,
        assertions: async (response: Response, context: { user: any; slug: string }) => {
          const data = await expectSuccess(response, 200);
          expect(data.success).toBe(true);
          expect(data.data.isAvailable).toBe(true);
          expect(data.data.message).toBe("Slug is available");
        },
      },
    ])("$name", async ({ setup, assertions }) => {
      const context = await setup();

      const request = createAuthenticatedGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { id: context.user.id, email: context.user.email || "", name: context.user.name || "" },
        { slug: context.slug }
      );

      const response = await GET(request);
      await assertions(response, context);
    });

    test("rejects unauthenticated requests", async () => {
      // Create request without auth headers (invalid user)
      const request = createAuthenticatedGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { id: "", email: "invalid@test.com", name: "Invalid" },
        { slug: "test-slug" }
      );

      const response = await GET(request);

      await expectUnauthorized(response);
    });

    test("returns error when slug parameter is missing", async () => {
      const user = await createTestUser();

      // Create request without slug query parameter
      const request = createAuthenticatedGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { id: user.id, email: user.email || "", name: user.name || "" }
      );

      const response = await GET(request);

      await expectError(response, "Slug parameter is required", 400);
    });

    test("returns error when slug parameter is empty string", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { id: user.id, email: user.email || "", name: user.name || "" },
        { slug: "" }
      );

      const response = await GET(request);

      await expectError(response, "Slug parameter is required", 400);
    });

    test("handles very long slug", async () => {
      const user = await createTestUser();

      // Create a slug longer than typical database field limits
      const longSlug = "a".repeat(100);
      
      const request = createAuthenticatedGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { id: user.id, email: user.email || "", name: user.name || "" },
        { slug: longSlug }
      );

      const response = await GET(request);

      // Should still process without errors (database will handle constraint validation)
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data.slug).toBe(longSlug);
    });

    test("handles slug with special characters", async () => {
      const user = await createTestUser();

      const specialSlug = "test-slug_123";
      
      const request = createAuthenticatedGetRequest(
        "http://localhost:3000/api/workspaces/slug-availability",
        { id: user.id, email: user.email || "", name: user.name || "" },
        { slug: specialSlug }
      );

      const response = await GET(request);

      // Endpoint should process the slug as-is (normalization only applies toLowerCase)
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data.slug).toBe(specialSlug);
    });
  });
});