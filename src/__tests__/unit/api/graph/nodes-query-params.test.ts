import { describe, it, expect } from "vitest";

describe("Query Parameter Filtering Logic", () => {
  describe("null and undefined filtering", () => {
    it("should filter out null values from query parameters", () => {
      const apiParams: Record<string, string | null | undefined> = {
        output: "json",
        node_type: null,
        edges: "true",
        limit: "100",
      };

      // This is the logic from the route
      const filteredParams = Object.entries(apiParams).reduce((acc, [key, value]) => {
        if (value !== null && value !== undefined) {
          acc[key] = value as string;
        }
        return acc;
      }, {} as Record<string, string>);

      expect(filteredParams).toEqual({
        output: "json",
        edges: "true",
        limit: "100",
      });
      expect(filteredParams).not.toHaveProperty("node_type");
    });

    it("should filter out undefined values from query parameters", () => {
      const apiParams: Record<string, string | null | undefined> = {
        output: "json",
        node_type: undefined,
        edges: "true",
        ref_ids: undefined,
      };

      const filteredParams = Object.entries(apiParams).reduce((acc, [key, value]) => {
        if (value !== null && value !== undefined) {
          acc[key] = value as string;
        }
        return acc;
      }, {} as Record<string, string>);

      expect(filteredParams).toEqual({
        output: "json",
        edges: "true",
      });
      expect(filteredParams).not.toHaveProperty("node_type");
      expect(filteredParams).not.toHaveProperty("ref_ids");
    });

    it("should keep all valid string values", () => {
      const apiParams: Record<string, string | null | undefined> = {
        output: "json",
        node_types: "Task,Epic",
        edges: "true",
        limit: "50",
        limit_mode: "total",
      };

      const filteredParams = Object.entries(apiParams).reduce((acc, [key, value]) => {
        if (value !== null && value !== undefined) {
          acc[key] = value as string;
        }
        return acc;
      }, {} as Record<string, string>);

      expect(filteredParams).toEqual(apiParams);
      expect(Object.keys(filteredParams)).toHaveLength(5);
    });

    it("should handle empty string values (keep them)", () => {
      const apiParams: Record<string, string | null | undefined> = {
        output: "json",
        node_type: "",
        edges: "true",
      };

      const filteredParams = Object.entries(apiParams).reduce((acc, [key, value]) => {
        if (value !== null && value !== undefined) {
          acc[key] = value as string;
        }
        return acc;
      }, {} as Record<string, string>);

      // Empty strings are kept (only null and undefined are filtered)
      expect(filteredParams).toEqual({
        output: "json",
        node_type: "",
        edges: "true",
      });
    });

    it("should produce valid URLSearchParams without null or undefined", () => {
      const apiParams: Record<string, string | null | undefined> = {
        output: "json",
        node_type: null,
        edges: "true",
        ref_ids: undefined,
        limit: "100",
      };

      const filteredParams = Object.entries(apiParams).reduce((acc, [key, value]) => {
        if (value !== null && value !== undefined) {
          acc[key] = value as string;
        }
        return acc;
      }, {} as Record<string, string>);

      const searchParams = new URLSearchParams(filteredParams);
      const queryString = searchParams.toString();

      // Verify null and undefined don't appear in the query string
      expect(queryString).not.toContain("null");
      expect(queryString).not.toContain("undefined");
      expect(queryString).toContain("output=json");
      expect(queryString).toContain("edges=true");
      expect(queryString).toContain("limit=100");
    });
  });
});
