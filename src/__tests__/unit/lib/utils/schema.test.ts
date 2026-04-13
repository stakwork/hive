import { describe, it, expect } from "vitest";
import { getSearchableAttributesFromSchema } from "@/lib/utils/schema";
import type { SchemaDefinition } from "@/lib/utils/schema";

describe("getSearchableAttributesFromSchema", () => {
  // ── Priority 1: index field ──────────────────────────────────────────────

  describe("when index is a string", () => {
    it("returns [index] and ignores all string properties", () => {
      const schema: SchemaDefinition = {
        index: "name",
        node_key: "ref_id",
        title: "Chapter One",
        description: "A chapter",
      };
      expect(getSearchableAttributesFromSchema(schema)).toEqual(["name"]);
    });

    it("returns [index] even when there are many string fields", () => {
      const schema: SchemaDefinition = {
        index: "title",
        uuid: "abc-123",
        embedding: "vec...",
        bookmark_count: "42",
        name: "foo",
      };
      expect(getSearchableAttributesFromSchema(schema)).toEqual(["title"]);
    });
  });

  describe("when index is a list of strings", () => {
    it("returns all listed fields", () => {
      const schema: SchemaDefinition = {
        index: ["name", "description"],
        node_key: "ref_id",
        title: "Some node",
      };
      expect(getSearchableAttributesFromSchema(schema)).toEqual(["name", "description"]);
    });

    it("returns single-element list when index array has one item", () => {
      const schema: SchemaDefinition = {
        index: ["summary"],
        title: "Ignored",
      };
      expect(getSearchableAttributesFromSchema(schema)).toEqual(["summary"]);
    });

    it("filters out empty strings from index array", () => {
      const schema: SchemaDefinition = {
        index: ["name", "", "description"],
        node_key: "ref_id",
      };
      expect(getSearchableAttributesFromSchema(schema)).toEqual(["name", "description"]);
    });
  });

  // ── Priority 2: node_key fallback ────────────────────────────────────────

  describe("when index is not set but node_key is", () => {
    it("returns [node_key]", () => {
      const schema: SchemaDefinition = {
        node_key: "id",
        title: "A node",
        description: "desc",
      };
      expect(getSearchableAttributesFromSchema(schema)).toEqual(["id"]);
    });

    it("returns [node_key] even when many string fields exist", () => {
      const schema: SchemaDefinition = {
        node_key: "unique_id",
        name: "foo",
        description: "bar",
        uuid: "abc",
        embedding: "vec",
      };
      expect(getSearchableAttributesFromSchema(schema)).toEqual(["unique_id"]);
    });

    it("ignores index when index is an empty string", () => {
      const schema: SchemaDefinition = {
        index: "",
        node_key: "key_field",
        name: "test",
      };
      expect(getSearchableAttributesFromSchema(schema)).toEqual(["key_field"]);
    });

    it("ignores index when index is an empty array", () => {
      const schema: SchemaDefinition = {
        index: [],
        node_key: "key_field",
        name: "test",
      };
      expect(getSearchableAttributesFromSchema(schema)).toEqual(["key_field"]);
    });
  });

  // ── Priority 3: fallback — string-scraping ───────────────────────────────

  describe("when neither index nor node_key is set (fallback)", () => {
    it("returns all string-typed properties", () => {
      const schema: SchemaDefinition = {
        name: "foo",
        description: "bar",
        count: 42,
        active: true,
        tags: ["a", "b"],
      };
      const result = getSearchableAttributesFromSchema(schema);
      expect(result).toContain("name");
      expect(result).toContain("description");
      // non-string fields must be excluded
      expect(result).not.toContain("count");
      expect(result).not.toContain("active");
      expect(result).not.toContain("tags");
    });

    it("returns empty array when schema has no string properties", () => {
      const schema: SchemaDefinition = {
        count: 5,
        active: false,
      };
      expect(getSearchableAttributesFromSchema(schema)).toEqual([]);
    });

    it("excludes index and node_key keys from fallback result", () => {
      // index/node_key are undefined here, but the keys themselves should not
      // appear in the fallback list
      const schema: SchemaDefinition = {
        name: "test",
      };
      const result = getSearchableAttributesFromSchema(schema);
      expect(result).not.toContain("index");
      expect(result).not.toContain("node_key");
      expect(result).toContain("name");
    });

    it("handles schema with only non-string fields gracefully", () => {
      const schema: SchemaDefinition = {
        age: 3,
        is_deleted: false,
        children: ["a", "b"],
      };
      expect(getSearchableAttributesFromSchema(schema)).toEqual([]);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty schema object", () => {
      expect(getSearchableAttributesFromSchema({})).toEqual([]);
    });

    it("handles schema with only type field", () => {
      const schema: SchemaDefinition = { type: "Chapter" };
      const result = getSearchableAttributesFromSchema(schema);
      expect(result).toContain("type");
    });

    it("index takes precedence over node_key", () => {
      const schema: SchemaDefinition = {
        index: "name",
        node_key: "id",
      };
      expect(getSearchableAttributesFromSchema(schema)).toEqual(["name"]);
    });

    it("index array takes precedence over node_key", () => {
      const schema: SchemaDefinition = {
        index: ["name", "description"],
        node_key: "id",
      };
      expect(getSearchableAttributesFromSchema(schema)).toEqual(["name", "description"]);
    });
  });
});
