import { describe, test, expect } from "vitest";
import { Group } from "three";
import { calculateRadius } from "@/components/knowledge-graph/Universe/Graph/utils/calculateGroupRadius";
import { createBox, createGroupWithMeshes } from "./test-helpers";

describe("calculateRadius", () => {
  describe("Edge Cases - Empty Groups", () => {
    test("returns -1 for empty group with no objects", () => {
      const group = new Group();
      const radius = calculateRadius(group);
      expect(radius).toBe(-1);
    });
  });

  describe("Single Object", () => {
    test("calculates radius for centered 10x10x10 cube", () => {
      const group = createGroupWithMeshes(createBox(10, 10, 10, [0, 0, 0]));
      const radius = calculateRadius(group);

      // Bounding sphere radius for a 10x10x10 cube centered at origin
      // Should be √(5²+5²+5²) ≈ 8.66
      expect(radius).toBeGreaterThan(0);
      expect(radius).toBeCloseTo(8.66, 1);
    });

    test("calculates radius for offset cube", () => {
      const group = createGroupWithMeshes(createBox(10, 10, 10, [50, 50, 50]));
      const radius = calculateRadius(group);

      // Offset cube should have larger radius than centered cube
      expect(radius).toBeGreaterThan(8.66);
    });

    test("calculates radius for small 1x1x1 cube", () => {
      const group = createGroupWithMeshes(createBox(1, 1, 1));
      const radius = calculateRadius(group);

      // Small cube radius should be √(0.5²+0.5²+0.5²) ≈ 0.866
      expect(radius).toBeCloseTo(0.866, 2);
    });

    test("calculates radius for large 100x100x100 cube", () => {
      const group = createGroupWithMeshes(createBox(100, 100, 100));
      const radius = calculateRadius(group);

      // Large cube radius should be √(50²+50²+50²) ≈ 86.6
      expect(radius).toBeCloseTo(86.6, 1);
    });
  });

  describe("Multiple Objects", () => {
    test("calculates radius for two cubes separated horizontally", () => {
      const group = createGroupWithMeshes(
        createBox(5, 5, 5, [-10, 0, 0]),
        createBox(5, 5, 5, [10, 0, 0])
      );
      const radius = calculateRadius(group);

      // Two separated cubes should have larger radius
      expect(radius).toBeGreaterThan(10);
    });

    test("calculates radius for widely dispersed objects", () => {
      const group = createGroupWithMeshes(
        createBox(5, 5, 5, [-100, 0, 0]),
        createBox(5, 5, 5, [100, 0, 0]),
        createBox(5, 5, 5, [0, 100, 0])
      );
      const radius = calculateRadius(group);

      // Widely dispersed objects should have large radius
      expect(radius).toBeGreaterThan(100);
    });

    test("calculates radius for three objects in 3D space", () => {
      const group = createGroupWithMeshes(
        createBox(10, 10, 10, [0, 0, 0]),
        createBox(10, 10, 10, [20, 0, 0]),
        createBox(10, 10, 10, [0, 20, 0])
      );
      const radius = calculateRadius(group);

      // Multiple objects in 3D space
      expect(radius).toBeGreaterThan(0);
      expect(radius).toBeGreaterThan(10);
    });

    test("calculates radius for clustered objects", () => {
      const group = new Group();

      // Create 5 small cubes close together
      for (let i = 0; i < 5; i++) {
        group.add(createBox(2, 2, 2, [i * 3, 0, 0]));
      }

      const radius = calculateRadius(group);

      // Clustered objects should have moderate radius
      expect(radius).toBeGreaterThan(0);
      expect(radius).toBeLessThan(20);
    });
  });

  describe("Non-uniform Geometries", () => {
    test("calculates radius for rectangular box", () => {
      const group = createGroupWithMeshes(createBox(20, 5, 5));
      const radius = calculateRadius(group);

      // Elongated box should have radius based on longest dimension
      expect(radius).toBeGreaterThan(0);
      expect(radius).toBeCloseTo(10.6, 1);
    });

    test("calculates radius for mixed size objects", () => {
      const group = createGroupWithMeshes(
        createBox(1, 1, 1, [0, 0, 0]),
        createBox(50, 50, 50, [30, 30, 30])
      );
      const radius = calculateRadius(group);

      // Mixed sizes - radius dominated by larger object
      expect(radius).toBeGreaterThan(25);
    });
  });

  describe("Consistency", () => {
    test("returns same radius for identical groups", () => {
      const group1 = createGroupWithMeshes(createBox(10, 10, 10));
      const group2 = createGroupWithMeshes(createBox(10, 10, 10));

      const radius1 = calculateRadius(group1);
      const radius2 = calculateRadius(group2);

      expect(radius1).toBe(radius2);
    });

    test("returns deterministic results for same configuration", () => {
      const group = createGroupWithMeshes(createBox(10, 10, 10));

      const radius1 = calculateRadius(group);
      const radius2 = calculateRadius(group);
      const radius3 = calculateRadius(group);

      expect(radius1).toBe(radius2);
      expect(radius2).toBe(radius3);
    });
  });

  describe("Nested Groups", () => {
    test("calculates radius for nested groups", () => {
      const childGroup = new Group();
      childGroup.add(createBox(10, 10, 10));
      
      const parentGroup = new Group();
      parentGroup.add(childGroup);

      const radius = calculateRadius(parentGroup);

      // Nested groups should still calculate correctly
      expect(radius).toBeGreaterThan(0);
      expect(radius).toBeCloseTo(8.66, 1);
    });

    test("calculates radius for deeply nested structure", () => {
      const level2 = new Group();
      level2.add(createBox(5, 5, 5, [0, 0, 0]));

      const level1 = new Group();
      level1.add(level2);
      level1.add(createBox(5, 5, 5, [20, 0, 0]));

      const rootGroup = new Group();
      rootGroup.add(level1);

      const radius = calculateRadius(rootGroup);

      // Deeply nested structure should encompass all objects
      expect(radius).toBeGreaterThan(10);
    });
  });
});