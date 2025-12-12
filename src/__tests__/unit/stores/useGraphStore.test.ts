import { describe, test, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createGraphStore } from "@/stores/createGraphStore";
import { createDataStore } from "@/stores/createDataStore";
import { createSimulationStore } from "@/stores/createSimulationStore";
import type { TestCoverageFilter } from "@/stores/graphStore.types";

describe("GraphStore - Test Coverage Filter", () => {
  let graphStore: ReturnType<typeof createGraphStore>;
  let dataStore: ReturnType<typeof createDataStore>;
  let simulationStore: ReturnType<typeof createSimulationStore>;

  beforeEach(() => {
    // Create fresh store instances before each test
    dataStore = createDataStore();
    simulationStore = createSimulationStore(dataStore);
    graphStore = createGraphStore(dataStore, simulationStore);
  });

  describe("Initialization", () => {
    test("should initialize testCoverageFilter with 'none'", () => {
      const { result } = renderHook(() => graphStore());

      expect(result.current.testCoverageFilter).toBe("none");
    });

    test("should have setTestCoverageFilter function available", () => {
      const { result } = renderHook(() => graphStore());

      expect(result.current.setTestCoverageFilter).toBeDefined();
      expect(typeof result.current.setTestCoverageFilter).toBe("function");
    });

    test("should initialize with all other default values", () => {
      const { result } = renderHook(() => graphStore());

      expect(result.current.activeFilterTab).toBe("all");
      expect(result.current.data).toBeNull();
      expect(result.current.graphStyle).toBe("split");
      expect(result.current.testCoverageFilter).toBe("none");
    });
  });

  describe("Setting Test Coverage Filter", () => {
    test("should set testCoverageFilter to 'all'", () => {
      const { result } = renderHook(() => graphStore());

      act(() => {
        result.current.setTestCoverageFilter("all");
      });

      expect(result.current.testCoverageFilter).toBe("all");
    });

    test("should set testCoverageFilter to 'tested'", () => {
      const { result } = renderHook(() => graphStore());

      act(() => {
        result.current.setTestCoverageFilter("tested");
      });

      expect(result.current.testCoverageFilter).toBe("tested");
    });

    test("should set testCoverageFilter to 'untested'", () => {
      const { result } = renderHook(() => graphStore());

      act(() => {
        result.current.setTestCoverageFilter("untested");
      });

      expect(result.current.testCoverageFilter).toBe("untested");
    });

    test("should set testCoverageFilter back to 'none'", () => {
      const { result } = renderHook(() => graphStore());

      act(() => {
        result.current.setTestCoverageFilter("all");
      });

      expect(result.current.testCoverageFilter).toBe("all");

      act(() => {
        result.current.setTestCoverageFilter("none");
      });

      expect(result.current.testCoverageFilter).toBe("none");
    });
  });

  describe("Filter State Transitions", () => {
    test("should transition through all filter states correctly", () => {
      const { result } = renderHook(() => graphStore());

      const filterStates: TestCoverageFilter[] = ["none", "all", "tested", "untested"];

      filterStates.forEach((filter) => {
        act(() => {
          result.current.setTestCoverageFilter(filter);
        });

        expect(result.current.testCoverageFilter).toBe(filter);
      });
    });

    test("should allow rapid filter changes", () => {
      const { result } = renderHook(() => graphStore());

      act(() => {
        result.current.setTestCoverageFilter("all");
        result.current.setTestCoverageFilter("tested");
        result.current.setTestCoverageFilter("untested");
        result.current.setTestCoverageFilter("none");
      });

      expect(result.current.testCoverageFilter).toBe("none");
    });

    test("should handle setting same filter multiple times", () => {
      const { result } = renderHook(() => graphStore());

      act(() => {
        result.current.setTestCoverageFilter("tested");
        result.current.setTestCoverageFilter("tested");
        result.current.setTestCoverageFilter("tested");
      });

      expect(result.current.testCoverageFilter).toBe("tested");
    });
  });

  describe("Filter Independence", () => {
    test("should not affect activeFilterTab when changing testCoverageFilter", () => {
      const { result } = renderHook(() => graphStore());

      const initialActiveTab = result.current.activeFilterTab;

      act(() => {
        result.current.setTestCoverageFilter("all");
      });

      expect(result.current.activeFilterTab).toBe(initialActiveTab);
      expect(result.current.testCoverageFilter).toBe("all");
    });

    test("should not affect other graph state when changing testCoverageFilter", () => {
      const { result } = renderHook(() => graphStore());

      const initialState = {
        graphStyle: result.current.graphStyle,
        graphRadius: result.current.graphRadius,
        hoveredNode: result.current.hoveredNode,
        selectedNode: result.current.selectedNode,
      };

      act(() => {
        result.current.setTestCoverageFilter("tested");
      });

      expect(result.current.graphStyle).toBe(initialState.graphStyle);
      expect(result.current.graphRadius).toBe(initialState.graphRadius);
      expect(result.current.hoveredNode).toBe(initialState.hoveredNode);
      expect(result.current.selectedNode).toBe(initialState.selectedNode);
      expect(result.current.testCoverageFilter).toBe("tested");
    });

    test("should maintain testCoverageFilter when other state changes", () => {
      const { result } = renderHook(() => graphStore());

      act(() => {
        result.current.setTestCoverageFilter("tested");
      });

      expect(result.current.testCoverageFilter).toBe("tested");

      act(() => {
        result.current.setGraphStyle("force");
        result.current.setActiveFilterTab("code");
        result.current.setGraphRadius(2000);
      });

      expect(result.current.testCoverageFilter).toBe("tested");
    });
  });

  describe("Type Safety", () => {
    test("should accept valid TestCoverageFilter values", () => {
      const { result } = renderHook(() => graphStore());

      const validFilters: TestCoverageFilter[] = ["none", "all", "tested", "untested"];

      validFilters.forEach((filter) => {
        act(() => {
          result.current.setTestCoverageFilter(filter);
        });

        expect(result.current.testCoverageFilter).toBe(filter);
      });
    });
  });

  describe("Store Integration", () => {
    test("should work correctly with multiple store instances", () => {
      const store1 = createGraphStore(dataStore, simulationStore);
      const store2 = createGraphStore(dataStore, simulationStore);

      const { result: result1 } = renderHook(() => store1());
      const { result: result2 } = renderHook(() => store2());

      act(() => {
        result1.current.setTestCoverageFilter("tested");
      });

      act(() => {
        result2.current.setTestCoverageFilter("untested");
      });

      expect(result1.current.testCoverageFilter).toBe("tested");
      expect(result2.current.testCoverageFilter).toBe("untested");
    });

    test("should preserve testCoverageFilter during data updates", () => {
      const { result } = renderHook(() => graphStore());

      act(() => {
        result.current.setTestCoverageFilter("all");
      });

      expect(result.current.testCoverageFilter).toBe("all");

      act(() => {
        result.current.setData({ nodes: [], links: [] });
      });

      expect(result.current.testCoverageFilter).toBe("all");
    });
  });

  describe("Edge Cases", () => {
    test("should handle filter changes with no graph data", () => {
      const { result } = renderHook(() => graphStore());

      expect(result.current.data).toBeNull();

      act(() => {
        result.current.setTestCoverageFilter("tested");
      });

      expect(result.current.testCoverageFilter).toBe("tested");
      expect(result.current.data).toBeNull();
    });

    test("should handle filter changes with empty graph data", () => {
      const { result } = renderHook(() => graphStore());

      act(() => {
        result.current.setData({ nodes: [], links: [] });
        result.current.setTestCoverageFilter("all");
      });

      expect(result.current.testCoverageFilter).toBe("all");
      expect(result.current.data?.nodes).toHaveLength(0);
      expect(result.current.data?.links).toHaveLength(0);
    });

    test("should handle concurrent state updates", () => {
      const { result } = renderHook(() => graphStore());

      act(() => {
        result.current.setTestCoverageFilter("tested");
        result.current.setActiveFilterTab("code");
        result.current.setGraphStyle("sphere");
        result.current.setSearchQuery("test");
      });

      expect(result.current.testCoverageFilter).toBe("tested");
      expect(result.current.activeFilterTab).toBe("code");
      expect(result.current.graphStyle).toBe("sphere");
      expect(result.current.searchQuery).toBe("test");
    });
  });

  describe("Real-world Scenarios", () => {
    test("should support workflow: none -> all -> tested -> none", () => {
      const { result } = renderHook(() => graphStore());

      // User opens coverage visualization
      act(() => {
        result.current.setTestCoverageFilter("all");
      });
      expect(result.current.testCoverageFilter).toBe("all");

      // User filters to only tested nodes
      act(() => {
        result.current.setTestCoverageFilter("tested");
      });
      expect(result.current.testCoverageFilter).toBe("tested");

      // User closes coverage visualization
      act(() => {
        result.current.setTestCoverageFilter("none");
      });
      expect(result.current.testCoverageFilter).toBe("none");
    });

    test("should support workflow: none -> untested -> all -> none", () => {
      const { result } = renderHook(() => graphStore());

      // User wants to see untested nodes
      act(() => {
        result.current.setTestCoverageFilter("untested");
      });
      expect(result.current.testCoverageFilter).toBe("untested");

      // User switches to see all coverage
      act(() => {
        result.current.setTestCoverageFilter("all");
      });
      expect(result.current.testCoverageFilter).toBe("all");

      // User disables coverage view
      act(() => {
        result.current.setTestCoverageFilter("none");
      });
      expect(result.current.testCoverageFilter).toBe("none");
    });

    test("should support toggling between tested and untested", () => {
      const { result } = renderHook(() => graphStore());

      // Toggle between tested and untested multiple times
      for (let i = 0; i < 5; i++) {
        act(() => {
          result.current.setTestCoverageFilter("tested");
        });
        expect(result.current.testCoverageFilter).toBe("tested");

        act(() => {
          result.current.setTestCoverageFilter("untested");
        });
        expect(result.current.testCoverageFilter).toBe("untested");
      }
    });

    test("should maintain filter state during node selection", () => {
      const { result } = renderHook(() => graphStore());

      act(() => {
        result.current.setTestCoverageFilter("tested");
      });

      expect(result.current.testCoverageFilter).toBe("tested");

      // Simulate node interaction
      act(() => {
        result.current.setHoveredNode({
          ref_id: "test-node-1",
          label: "Test Node",
          node_type: "function",
        } as any);
      });

      expect(result.current.testCoverageFilter).toBe("tested");
      expect(result.current.hoveredNode?.ref_id).toBe("test-node-1");
    });
  });

  describe("State Persistence", () => {
    test("should maintain testCoverageFilter across re-renders", () => {
      const { result, rerender } = renderHook(() => graphStore());

      act(() => {
        result.current.setTestCoverageFilter("all");
      });

      expect(result.current.testCoverageFilter).toBe("all");

      rerender();

      expect(result.current.testCoverageFilter).toBe("all");
    });

    test("should reset to 'none' when creating new store instance", () => {
      const { result: result1 } = renderHook(() => graphStore());

      act(() => {
        result1.current.setTestCoverageFilter("tested");
      });

      expect(result1.current.testCoverageFilter).toBe("tested");

      // Create new store instance
      const newGraphStore = createGraphStore(dataStore, simulationStore);
      const { result: result2 } = renderHook(() => newGraphStore());

      expect(result2.current.testCoverageFilter).toBe("none");
    });
  });
});
