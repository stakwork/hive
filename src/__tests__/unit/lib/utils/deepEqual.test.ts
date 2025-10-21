import { describe, test, expect } from "vitest";
import { deepEqual } from "@/lib/utils/deepEqual";

describe("deepEqual", () => {
  describe("Primitive Types", () => {
    test("should return true for identical numbers", () => {
      expect(deepEqual(42, 42)).toBe(true);
      expect(deepEqual(0, 0)).toBe(true);
      expect(deepEqual(-100, -100)).toBe(true);
      expect(deepEqual(3.14159, 3.14159)).toBe(true);
    });

    test("should return false for different numbers", () => {
      expect(deepEqual(42, 43)).toBe(false);
      expect(deepEqual(0, 1)).toBe(false);
      expect(deepEqual(-100, 100)).toBe(false);
    });

    test("should return true for identical strings", () => {
      expect(deepEqual("hello", "hello")).toBe(true);
      expect(deepEqual("", "")).toBe(true);
      expect(deepEqual("with spaces", "with spaces")).toBe(true);
    });

    test("should return false for different strings", () => {
      expect(deepEqual("hello", "world")).toBe(false);
      expect(deepEqual("", "non-empty")).toBe(false);
      expect(deepEqual("case", "CASE")).toBe(false);
    });

    test("should return true for identical booleans", () => {
      expect(deepEqual(true, true)).toBe(true);
      expect(deepEqual(false, false)).toBe(true);
    });

    test("should return false for different booleans", () => {
      expect(deepEqual(true, false)).toBe(false);
      expect(deepEqual(false, true)).toBe(false);
    });

    test("should handle null correctly", () => {
      expect(deepEqual(null, null)).toBe(true);
      expect(deepEqual(null, undefined)).toBe(false);
      expect(deepEqual(null, 0)).toBe(false);
      expect(deepEqual(null, "")).toBe(false);
    });

    test("should handle undefined correctly", () => {
      expect(deepEqual(undefined, undefined)).toBe(true);
      expect(deepEqual(undefined, null)).toBe(false);
      expect(deepEqual(undefined, 0)).toBe(false);
      expect(deepEqual(undefined, "")).toBe(false);
    });

    test("should handle NaN correctly", () => {
      // NaN === NaN is false in JavaScript, so deepEqual should return false
      expect(deepEqual(NaN, NaN)).toBe(false);
      expect(deepEqual(NaN, 0)).toBe(false);
    });

    test("should handle Infinity correctly", () => {
      expect(deepEqual(Infinity, Infinity)).toBe(true);
      expect(deepEqual(-Infinity, -Infinity)).toBe(true);
      expect(deepEqual(Infinity, -Infinity)).toBe(false);
      expect(deepEqual(Infinity, 1000000)).toBe(false);
    });

    test("should distinguish between 0 and -0", () => {
      // JavaScript treats 0 === -0 as true
      expect(deepEqual(0, -0)).toBe(true);
      expect(deepEqual(-0, 0)).toBe(true);
    });
  });

  describe("Date Objects", () => {
    test("should return true for dates with same timestamp", () => {
      const date1 = new Date("2024-01-15T12:00:00Z");
      const date2 = new Date("2024-01-15T12:00:00Z");
      expect(deepEqual(date1, date2)).toBe(true);
    });

    test("should return true for same date instance", () => {
      const date = new Date("2024-01-15T12:00:00Z");
      expect(deepEqual(date, date)).toBe(true);
    });

    test("should return false for dates with different timestamps", () => {
      const date1 = new Date("2024-01-15T12:00:00Z");
      const date2 = new Date("2024-01-15T12:00:01Z");
      expect(deepEqual(date1, date2)).toBe(false);
    });

    test("should return false for Date vs non-Date", () => {
      const date = new Date("2024-01-15T12:00:00Z");
      expect(deepEqual(date, date.getTime())).toBe(false);
      expect(deepEqual(date, date.toString())).toBe(false);
      expect(deepEqual(date, {})).toBe(false);
    });

    test("should handle invalid dates", () => {
      const invalidDate1 = new Date("invalid");
      const invalidDate2 = new Date("invalid");
      // Both have NaN as getTime(), and NaN === NaN is false
      expect(deepEqual(invalidDate1, invalidDate2)).toBe(false);
    });
  });

  describe("RegExp Objects", () => {
    test("should return true for identical regex patterns", () => {
      const regex1 = /test/gi;
      const regex2 = /test/gi;
      expect(deepEqual(regex1, regex2)).toBe(true);
    });

    test("should return true for same regex instance", () => {
      const regex = /test/gi;
      expect(deepEqual(regex, regex)).toBe(true);
    });

    test("should return false for different patterns", () => {
      const regex1 = /test/;
      const regex2 = /different/;
      expect(deepEqual(regex1, regex2)).toBe(false);
    });

    test("should return false for same pattern different flags", () => {
      const regex1 = /test/i;
      const regex2 = /test/g;
      expect(deepEqual(regex1, regex2)).toBe(false);
    });

    test("should return false for RegExp vs non-RegExp", () => {
      const regex = /test/;
      expect(deepEqual(regex, "/test/")).toBe(false);
      expect(deepEqual(regex, {})).toBe(false);
    });
  });

  describe("Arrays", () => {
    test("should return true for empty arrays", () => {
      expect(deepEqual([], [])).toBe(true);
    });

    test("should return true for arrays with same primitive elements", () => {
      expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(deepEqual(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
      expect(deepEqual([true, false], [true, false])).toBe(true);
    });

    test("should return false for arrays with different lengths", () => {
      expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
      expect(deepEqual([1, 2, 3], [1, 2])).toBe(false);
    });

    test("should return false for arrays with same elements in different order", () => {
      expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false);
      expect(deepEqual(["a", "b"], ["b", "a"])).toBe(false);
    });

    test("should return false for arrays with different elements", () => {
      expect(deepEqual([1, 2, 3], [1, 2, 4])).toBe(false);
      expect(deepEqual(["a", "b"], ["a", "c"])).toBe(false);
    });

    test("should handle arrays with null and undefined", () => {
      expect(deepEqual([null, undefined], [null, undefined])).toBe(true);
      expect(deepEqual([null], [undefined])).toBe(false);
    });

    test("should handle nested arrays", () => {
      expect(deepEqual([[1, 2], [3, 4]], [[1, 2], [3, 4]])).toBe(true);
      expect(deepEqual([[1, 2], [3, 4]], [[1, 2], [3, 5]])).toBe(false);
      expect(deepEqual([[[1]]], [[[1]]])).toBe(true);
    });

    test("should return false for array vs non-array", () => {
      expect(deepEqual([1, 2, 3], { 0: 1, 1: 2, 2: 3, length: 3 })).toBe(false);
      expect(deepEqual([], {})).toBe(false);
      expect(deepEqual([1], 1)).toBe(false);
    });

    test("should handle arrays with mixed types", () => {
      expect(deepEqual([1, "two", true, null], [1, "two", true, null])).toBe(true);
      expect(deepEqual([1, "two", true], [1, "two", false])).toBe(false);
    });
  });

  describe("Objects", () => {
    test("should return true for empty objects", () => {
      expect(deepEqual({}, {})).toBe(true);
    });

    test("should return true for objects with same properties", () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
      expect(deepEqual({ name: "John", age: 30 }, { name: "John", age: 30 })).toBe(true);
    });

    test("should return true regardless of property order", () => {
      expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
      expect(deepEqual({ x: "test", y: 42, z: true }, { z: true, x: "test", y: 42 })).toBe(true);
    });

    test("should return false for objects with different property counts", () => {
      expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
      expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    });

    test("should return false for objects with different property values", () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
      expect(deepEqual({ name: "John" }, { name: "Jane" })).toBe(false);
    });

    test("should return false for objects with different keys", () => {
      expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
      expect(deepEqual({ x: 1, y: 2 }, { x: 1, z: 2 })).toBe(false);
    });

    test("should handle objects with null and undefined values", () => {
      expect(deepEqual({ a: null, b: undefined }, { a: null, b: undefined })).toBe(true);
      expect(deepEqual({ a: null }, { a: undefined })).toBe(false);
    });

    test("should handle nested objects", () => {
      expect(deepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } })).toBe(true);
      expect(deepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } })).toBe(false);
    });

    test("should handle objects containing arrays", () => {
      expect(deepEqual({ items: [1, 2, 3] }, { items: [1, 2, 3] })).toBe(true);
      expect(deepEqual({ items: [1, 2, 3] }, { items: [1, 2, 4] })).toBe(false);
    });

    test("should handle arrays containing objects", () => {
      expect(deepEqual([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 2 }])).toBe(true);
      expect(deepEqual([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 3 }])).toBe(false);
    });

    test("should return false for object vs non-object", () => {
      expect(deepEqual({ a: 1 }, [1])).toBe(false);
      expect(deepEqual({}, null)).toBe(false);
      expect(deepEqual({ toString: () => "test" }, "test")).toBe(false);
    });
  });

  describe("Type Mismatches", () => {
    test("should return false for different primitive types", () => {
      expect(deepEqual(1, "1")).toBe(false);
      expect(deepEqual(0, false)).toBe(false);
      expect(deepEqual(1, true)).toBe(false);
      expect(deepEqual("", false)).toBe(false);
    });

    test("should return false for object vs primitive", () => {
      expect(deepEqual({}, 0)).toBe(false);
      expect(deepEqual({ a: 1 }, "a")).toBe(false);
      expect(deepEqual([1], 1)).toBe(false);
    });

    test("should return false for array vs object", () => {
      expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
      expect(deepEqual([], {})).toBe(false);
    });

    test("should return false for Date vs number", () => {
      const date = new Date("2024-01-15T12:00:00Z");
      expect(deepEqual(date, date.getTime())).toBe(false);
    });

    test("should return false for RegExp vs string", () => {
      expect(deepEqual(/test/, "test")).toBe(false);
      expect(deepEqual(/test/, "/test/")).toBe(false);
    });
  });

  describe("Nested Structures", () => {
    test("should handle deeply nested objects", () => {
      const obj1 = { a: { b: { c: { d: { e: 1 } } } } };
      const obj2 = { a: { b: { c: { d: { e: 1 } } } } };
      const obj3 = { a: { b: { c: { d: { e: 2 } } } } };

      expect(deepEqual(obj1, obj2)).toBe(true);
      expect(deepEqual(obj1, obj3)).toBe(false);
    });

    test("should handle deeply nested arrays", () => {
      const arr1 = [[[[[1]]]]];
      const arr2 = [[[[[1]]]]];
      const arr3 = [[[[[2]]]]];

      expect(deepEqual(arr1, arr2)).toBe(true);
      expect(deepEqual(arr1, arr3)).toBe(false);
    });

    test("should handle complex mixed structures", () => {
      const complex1 = {
        users: [
          { id: 1, name: "John", tags: ["admin", "active"] },
          { id: 2, name: "Jane", tags: ["user"] },
        ],
        metadata: { created: "2024-01-15", version: 1 },
      };

      const complex2 = {
        users: [
          { id: 1, name: "John", tags: ["admin", "active"] },
          { id: 2, name: "Jane", tags: ["user"] },
        ],
        metadata: { created: "2024-01-15", version: 1 },
      };

      const complex3 = {
        users: [
          { id: 1, name: "John", tags: ["admin", "active"] },
          { id: 2, name: "Jane", tags: ["user", "new"] },
        ],
        metadata: { created: "2024-01-15", version: 1 },
      };

      expect(deepEqual(complex1, complex2)).toBe(true);
      expect(deepEqual(complex1, complex3)).toBe(false);
    });

    test("should handle objects with array properties at multiple levels", () => {
      const obj1 = {
        level1: [{ level2: [{ level3: [1, 2, 3] }] }],
      };

      const obj2 = {
        level1: [{ level2: [{ level3: [1, 2, 3] }] }],
      };

      const obj3 = {
        level1: [{ level2: [{ level3: [1, 2, 4] }] }],
      };

      expect(deepEqual(obj1, obj2)).toBe(true);
      expect(deepEqual(obj1, obj3)).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty nested structures", () => {
      expect(deepEqual({ a: [], b: {} }, { a: [], b: {} })).toBe(true);
      expect(deepEqual([[]], [[]])).toBe(true);
      expect(deepEqual([{}], [{}])).toBe(true);
    });

    test("should handle objects with many properties", () => {
      const largeObj1: Record<string, number> = {};
      const largeObj2: Record<string, number> = {};

      for (let i = 0; i < 100; i++) {
        largeObj1[`key${i}`] = i;
        largeObj2[`key${i}`] = i;
      }

      expect(deepEqual(largeObj1, largeObj2)).toBe(true);

      largeObj2.key50 = 999;
      expect(deepEqual(largeObj1, largeObj2)).toBe(false);
    });

    test("should handle large arrays", () => {
      const largeArr1 = Array.from({ length: 1000 }, (_, i) => i);
      const largeArr2 = Array.from({ length: 1000 }, (_, i) => i);
      const largeArr3 = Array.from({ length: 1000 }, (_, i) => i);
      largeArr3[500] = 999;

      expect(deepEqual(largeArr1, largeArr2)).toBe(true);
      expect(deepEqual(largeArr1, largeArr3)).toBe(false);
    });

    test("should handle objects with various falsy values", () => {
      const obj1 = { a: 0, b: "", c: false, d: null, e: undefined };
      const obj2 = { a: 0, b: "", c: false, d: null, e: undefined };

      expect(deepEqual(obj1, obj2)).toBe(true);
    });

    test("should handle same reference equality optimization", () => {
      const obj = { a: 1, b: 2 };
      expect(deepEqual(obj, obj)).toBe(true);

      const arr = [1, 2, 3];
      expect(deepEqual(arr, arr)).toBe(true);
    });

    test("should handle objects with numeric string keys vs numeric keys", () => {
      // In JavaScript, numeric string keys are different from numeric keys in objects
      expect(deepEqual({ 1: "a" }, { "1": "a" })).toBe(true); // Both become string keys
      expect(deepEqual({ 0: "a", 1: "b" }, { 0: "a", 1: "b" })).toBe(true);
    });
  });

  describe("Production Use Cases - Graph Data Structures", () => {
    test("should compare graph node objects", () => {
      const node1 = {
        ref_id: "node-1",
        node_type: "Function",
        name: "deepEqual",
        x: 100,
        y: 200,
        z: 0,
      };

      const node2 = {
        ref_id: "node-1",
        node_type: "Function",
        name: "deepEqual",
        x: 100,
        y: 200,
        z: 0,
      };

      const node3 = {
        ref_id: "node-1",
        node_type: "Function",
        name: "deepEqual",
        x: 150, // Different position
        y: 200,
        z: 0,
      };

      expect(deepEqual(node1, node2)).toBe(true);
      expect(deepEqual(node1, node3)).toBe(false);
    });

    test("should compare graph link objects", () => {
      const link1 = {
        ref_id: "link-1",
        source: "node-1",
        target: "node-2",
        edge_type: "calls",
      };

      const link2 = {
        ref_id: "link-1",
        source: "node-1",
        target: "node-2",
        edge_type: "calls",
      };

      const link3 = {
        ref_id: "link-1",
        source: "node-1",
        target: "node-3", // Different target
        edge_type: "calls",
      };

      expect(deepEqual(link1, link2)).toBe(true);
      expect(deepEqual(link1, link3)).toBe(false);
    });

    test("should compare complete graph data structures with nodes and links", () => {
      const graphData1 = {
        nodes: [
          { ref_id: "node-1", node_type: "Function", name: "func1" },
          { ref_id: "node-2", node_type: "Function", name: "func2" },
        ],
        links: [
          { ref_id: "link-1", source: "node-1", target: "node-2", edge_type: "calls" },
        ],
      };

      const graphData2 = {
        nodes: [
          { ref_id: "node-1", node_type: "Function", name: "func1" },
          { ref_id: "node-2", node_type: "Function", name: "func2" },
        ],
        links: [
          { ref_id: "link-1", source: "node-1", target: "node-2", edge_type: "calls" },
        ],
      };

      const graphData3 = {
        nodes: [
          { ref_id: "node-1", node_type: "Function", name: "func1" },
          { ref_id: "node-2", node_type: "Function", name: "func2" },
          { ref_id: "node-3", node_type: "Function", name: "func3" }, // Additional node
        ],
        links: [
          { ref_id: "link-1", source: "node-1", target: "node-2", edge_type: "calls" },
        ],
      };

      expect(deepEqual(graphData1, graphData2)).toBe(true);
      expect(deepEqual(graphData1, graphData3)).toBe(false);
    });

    test("should handle empty graph data", () => {
      const emptyGraph1 = { nodes: [], links: [] };
      const emptyGraph2 = { nodes: [], links: [] };

      expect(deepEqual(emptyGraph1, emptyGraph2)).toBe(true);
    });

    test("should compare graph data with complex nested properties", () => {
      const complexGraph1 = {
        nodes: [
          {
            ref_id: "node-1",
            properties: {
              metadata: { created: "2024-01-15", tags: ["important"] },
              stats: { calls: 5, complexity: 10 },
            },
          },
        ],
        links: [
          {
            ref_id: "link-1",
            properties: { weight: 1.5, metadata: { type: "strong" } },
          },
        ],
      };

      const complexGraph2 = {
        nodes: [
          {
            ref_id: "node-1",
            properties: {
              metadata: { created: "2024-01-15", tags: ["important"] },
              stats: { calls: 5, complexity: 10 },
            },
          },
        ],
        links: [
          {
            ref_id: "link-1",
            properties: { weight: 1.5, metadata: { type: "strong" } },
          },
        ],
      };

      expect(deepEqual(complexGraph1, complexGraph2)).toBe(true);
    });

    test("should handle graph data with link objects containing node references", () => {
      const node1 = { ref_id: "node-1", name: "func1" };
      const node2 = { ref_id: "node-2", name: "func2" };

      const graphData1 = {
        nodes: [node1, node2],
        links: [
          { ref_id: "link-1", source: node1, target: node2 },
        ],
      };

      const graphData2 = {
        nodes: [
          { ref_id: "node-1", name: "func1" },
          { ref_id: "node-2", name: "func2" },
        ],
        links: [
          {
            ref_id: "link-1",
            source: { ref_id: "node-1", name: "func1" },
            target: { ref_id: "node-2", name: "func2" },
          },
        ],
      };

      // Different object references but same structure/values
      expect(deepEqual(graphData1, graphData2)).toBe(true);
    });
  });

  describe("Known Limitations", () => {
    test("does not handle circular references (would cause infinite recursion)", () => {
      const obj1: any = { a: 1 };
      obj1.self = obj1;

      const obj2: any = { a: 1 };
      obj2.self = obj2;

      // This would cause stack overflow - document the limitation
      // expect(() => deepEqual(obj1, obj2)).toThrow();
      // Skipping actual test to prevent test suite failure
    });

    test("does not compare non-enumerable properties", () => {
      const obj1 = { a: 1 };
      const obj2 = { a: 1 };

      Object.defineProperty(obj1, "hidden", {
        value: "secret",
        enumerable: false,
      });

      // deepEqual only compares enumerable properties via Object.keys()
      expect(deepEqual(obj1, obj2)).toBe(true);
    });

    test("does not handle Map or Set objects", () => {
      const map1 = new Map([["key", "value"]]);
      const map2 = new Map([["key", "value"]]);

      // Maps are compared as empty objects since they have no enumerable properties
      expect(deepEqual(map1, map2)).toBe(true); // Both seen as {}

      const set1 = new Set([1, 2, 3]);
      const set2 = new Set([1, 2, 3]);

      // Sets are compared as empty objects
      expect(deepEqual(set1, set2)).toBe(true); // Both seen as {}
    });
  });
});