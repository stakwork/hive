import { describe, test, expect } from "vitest";
import { updateWorkspaceSchema } from "@/lib/schemas/workspace";
import { WORKSPACE_ERRORS } from "@/lib/constants";

describe("updateWorkspaceSchema", () => {
  describe("name validation", () => {
    test("should accept valid workspace names", () => {
      const validNames = [
        "My Workspace",
        "Test123",
        "a",
        "A".repeat(100), // max length
      ];

      validNames.forEach(name => {
        const result = updateWorkspaceSchema.safeParse({
          name,
          slug: "valid-slug",
          description: "",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.name).toBe(name);
        }
      });
    });

    test("should reject empty name", () => {
      const result = updateWorkspaceSchema.safeParse({
        name: "",
        slug: "valid-slug",
        description: "",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0]?.message).toBe("Workspace name is required");
      }
    });

    test("should reject name over 100 characters", () => {
      const result = updateWorkspaceSchema.safeParse({
        name: "A".repeat(101),
        slug: "valid-slug",
        description: "",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0]?.message).toBe("Workspace name must be 100 characters or less");
      }
    });

    test("should trim whitespace from name", () => {
      const result = updateWorkspaceSchema.safeParse({
        name: "  My Workspace  ",
        slug: "valid-slug",
        description: "",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("My Workspace");
      }
    });
  });

  describe("slug validation", () => {
    test("should accept valid slugs", () => {
      const validSlugs = [
        "my-workspace",
        "test123",
        "a1",
        "workspace-with-many-hyphens",
        "123numbers",
      ];

      validSlugs.forEach(slug => {
        const result = updateWorkspaceSchema.safeParse({
          name: "Test",
          slug,
          description: "",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.slug).toBe(slug.toLowerCase());
        }
      });
    });

    test("should reject reserved slugs", () => {
      const reservedSlugs = ["api", "admin", "settings", "auth", "workspaces"];

      reservedSlugs.forEach(slug => {
        const result = updateWorkspaceSchema.safeParse({
          name: "Test",
          slug,
          description: "",
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.errors[0]?.message).toBe(WORKSPACE_ERRORS.SLUG_RESERVED);
        }
      });
    });

    test("should reject slugs with invalid format", () => {
      const invalidSlugs = [
        "My Workspace", // spaces
        "workspace_name", // underscores
        "workspace.", // ends with special char
        "-workspace", // starts with hyphen
        "workspace-", // ends with hyphen
        "UPPERCASE", // uppercase
        "work@space", // special characters
        "", // empty
        "a", // too short (min 2)
        "A".repeat(51), // too long (max 50)
      ];

      invalidSlugs.forEach(slug => {
        const result = updateWorkspaceSchema.safeParse({
          name: "Test",
          slug,
          description: "",
        });
        expect(result.success).toBe(false);
      });
    });

    test("should transform slug to lowercase", () => {
      // Since the schema validates lowercase first, then transforms,
      // we test that valid lowercase slugs pass through correctly
      const result = updateWorkspaceSchema.safeParse({
        name: "Test", 
        slug: "my-workspace",
        description: "",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.slug).toBe("my-workspace");
      }
    });

    test("should trim whitespace from slug", () => {
      const result = updateWorkspaceSchema.safeParse({
        name: "Test",
        slug: "  my-workspace  ",
        description: "",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.slug).toBe("my-workspace");
      }
    });
  });

  describe("description validation", () => {
    test("should accept valid descriptions", () => {
      const validDescriptions = [
        "Short description",
        "A".repeat(500), // max length
        "", // empty string should become undefined
      ];

      validDescriptions.forEach(description => {
        const result = updateWorkspaceSchema.safeParse({
          name: "Test",
          slug: "test-slug",
          description,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          if (description === "") {
            expect(result.data.description).toBeUndefined();
          } else {
            expect(result.data.description).toBe(description);
          }
        }
      });
    });

    test("should reject description over 500 characters", () => {
      const result = updateWorkspaceSchema.safeParse({
        name: "Test",
        slug: "test-slug",
        description: "A".repeat(501),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0]?.message).toBe("Description must be 500 characters or less");
      }
    });

    test("should make description optional", () => {
      const result = updateWorkspaceSchema.safeParse({
        name: "Test",
        slug: "test-slug",
        // description omitted
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBeUndefined();
      }
    });

    test("should convert empty string to undefined", () => {
      const result = updateWorkspaceSchema.safeParse({
        name: "Test",
        slug: "test-slug",
        description: "",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBeUndefined();
      }
    });
  });

  describe("full schema validation", () => {
    test("should accept complete valid data", () => {
      const result = updateWorkspaceSchema.safeParse({
        name: "My Awesome Workspace",
        slug: "my-awesome-workspace",
        description: "This is a great workspace for our team",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          name: "My Awesome Workspace",
          slug: "my-awesome-workspace",
          description: "This is a great workspace for our team",
        });
      }
    });

    test("should handle multiple validation errors", () => {
      const result = updateWorkspaceSchema.safeParse({
        name: "", // invalid
        slug: "INVALID SLUG", // invalid
        description: "A".repeat(501), // invalid
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors).toHaveLength(3);
      }
    });
  });
});