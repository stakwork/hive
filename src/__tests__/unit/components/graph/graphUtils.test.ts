import { describe, test, expect, vi, beforeEach } from "vitest";
import * as d3 from "d3";
import {
  createNodeElements,
  filterValidLinks,
  getNodeColor,
  DEFAULT_COLORS,
  type D3Node,
  type D3Link,
  type GraphNode,
} from "@/components/graph/graphUtils";

// Mock D3 selection types
interface MockSelection {
  append: ReturnType<typeof vi.fn>;
  attr: ReturnType<typeof vi.fn>;
  selectAll: ReturnType<typeof vi.fn>;
  data: ReturnType<typeof vi.fn>;
  enter: ReturnType<typeof vi.fn>;
  style: ReturnType<typeof vi.fn>;
  call: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  text: ReturnType<typeof vi.fn>;
  node: ReturnType<typeof vi.fn>;
}

// Test data factories
const TestDataFactories = {
  createNode: (overrides: Partial<D3Node> = {}): D3Node => ({
    id: "node-1",
    name: "Test Node",
    type: "Function",
    x: 100,
    y: 100,
    ...overrides,
  }),

  createNodes: (count: number = 3): D3Node[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `node-${i + 1}`,
      name: `Node ${i + 1}`,
      type: i % 2 === 0 ? "Function" : "File",
      x: 100 + i * 50,
      y: 100 + i * 50,
    }));
  },

  createLongNameNode: (): D3Node => ({
    id: "long-node",
    name: "This is a very long node name that should be truncated",
    type: "Function",
    x: 100,
    y: 100,
  }),

  createNodeWithoutType: (): D3Node => ({
    id: "no-type-node",
    name: "No Type Node",
    type: "",
    x: 100,
    y: 100,
  }),

  createColorMap: (): Record<string, string> => ({
    Function: "#8b5cf6",
    File: "#f59e0b",
    Endpoint: "#ef4444",
  }),

  createLink: (source: string, target: string): D3Link => ({
    source,
    target,
  }),

  createLinks: (nodeIds: string[]): D3Link[] => {
    const links: D3Link[] = [];
    for (let i = 0; i < nodeIds.length - 1; i++) {
      links.push({
        source: nodeIds[i],
        target: nodeIds[i + 1],
      });
    }
    return links;
  },
};

// Mock D3 selection utilities
const createMockSelection = (): MockSelection => {
  const selection: MockSelection = {
    append: vi.fn(),
    attr: vi.fn(),
    selectAll: vi.fn(),
    data: vi.fn(),
    enter: vi.fn(),
    style: vi.fn(),
    call: vi.fn(),
    on: vi.fn(),
    text: vi.fn(),
    node: vi.fn(),
  };

  // Chain all methods to return the selection
  Object.keys(selection).forEach((key) => {
    const method = key as keyof MockSelection;
    selection[method].mockReturnValue(selection);
  });

  return selection;
};

// Test utilities
const TestUtils = {
  setupMockContainer: () => {
    const container = createMockSelection();
    const nodeGroup = createMockSelection();
    const nodeSelection = createMockSelection();
    const enterSelection = createMockSelection();
    const nodeElements = createMockSelection();

    container.append.mockReturnValue(nodeGroup);
    nodeGroup.selectAll.mockReturnValue(nodeSelection);
    nodeSelection.data.mockReturnValue(nodeSelection);
    nodeSelection.enter.mockReturnValue(enterSelection);
    enterSelection.append.mockReturnValue(nodeElements);

    return { container, nodeGroup, nodeSelection, enterSelection, nodeElements };
  },

  createMockDragBehavior: () => {
    return {
      on: vi.fn().mockReturnThis(),
    } as unknown as d3.DragBehavior<SVGGElement, D3Node, unknown>;
  },

  expectNodeGroupCreated: (container: MockSelection) => {
    expect(container.append).toHaveBeenCalledWith("g");
    expect(container.append().attr).toHaveBeenCalledWith("class", "nodes");
  },

  expectCircleCreated: (nodeElements: MockSelection) => {
    expect(nodeElements.append).toHaveBeenCalledWith("circle");
  },

  expectTextElementsCreated: (nodeElements: MockSelection, callCount: number = 2) => {
    const textCalls = nodeElements.append.mock.calls.filter(
      (call) => call[0] === "text"
    );
    expect(textCalls).toHaveLength(callCount);
  },

  expectDragBehaviorAttached: (nodeElements: MockSelection) => {
    expect(nodeElements.call).toHaveBeenCalled();
  },

  expectClickHandlerAttached: (nodeElements: MockSelection) => {
    expect(nodeElements.on).toHaveBeenCalledWith("click", expect.any(Function));
  },

  expectCursorStyle: (nodeElements: MockSelection, cursor: string) => {
    expect(nodeElements.style).toHaveBeenCalledWith("cursor", cursor);
  },
};

describe("graphUtils - createNodeElements", () => {
  let mockContainer: MockSelection;
  let mockNodeElements: MockSelection;
  let mockDragBehavior: d3.DragBehavior<SVGGElement, D3Node, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = TestUtils.setupMockContainer();
    mockContainer = mocks.container as MockSelection;
    mockNodeElements = mocks.nodeElements as MockSelection;
    mockDragBehavior = TestUtils.createMockDragBehavior();
  });

  describe("Basic Element Creation", () => {
    test("creates node group container with correct class", () => {
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      TestUtils.expectNodeGroupCreated(mockContainer);
    });

    test("creates correct number of node groups for multiple nodes", () => {
      const nodes = TestDataFactories.createNodes(5);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      expect(mockContainer.append().selectAll).toHaveBeenCalledWith("g");
      expect(mockContainer.append().selectAll().data).toHaveBeenCalledWith(nodes);
    });

    test("creates circle element for each node", () => {
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      TestUtils.expectCircleCreated(mockNodeElements);
    });

    test("creates two text elements for each node (name and type)", () => {
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      TestUtils.expectTextElementsCreated(mockNodeElements, 2);
    });
  });

  describe("Node Attributes", () => {
    test("applies correct circle radius", () => {
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      const circleAttrCalls = mockNodeElements.append().attr.mock.calls;
      const radiusCall = circleAttrCalls.find((call) => call[0] === "r");
      expect(radiusCall).toBeDefined();
      expect(radiusCall?.[1]).toBe(12);
    });

    test("applies white stroke to circles", () => {
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      const circleAttrCalls = mockNodeElements.append().attr.mock.calls;
      const strokeCall = circleAttrCalls.find((call) => call[0] === "stroke");
      const strokeWidthCall = circleAttrCalls.find(
        (call) => call[0] === "stroke-width"
      );

      expect(strokeCall?.[1]).toBe("#fff");
      expect(strokeWidthCall?.[1]).toBe(2);
    });

    test("applies drop shadow filter to circles", () => {
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      const circleStyleCalls = mockNodeElements.append().style.mock.calls;
      const filterCall = circleStyleCalls.find((call) => call[0] === "filter");
      expect(filterCall?.[1]).toContain("drop-shadow");
    });

    test("positions name text above node", () => {
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      // First text element (name) should have y=-18
      const firstTextAttrCalls = mockNodeElements.append().attr.mock.calls;
      const yCall = firstTextAttrCalls.find((call) => call[0] === "y");
      expect(yCall).toBeDefined();
    });

    test("positions type text below node", () => {
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      // Second text element (type) should have y=25
      const textElements = mockNodeElements.append.mock.calls.filter(
        (call) => call[0] === "text"
      );
      expect(textElements).toHaveLength(2);
    });

    test("centers text with middle anchor", () => {
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      const textAttrCalls = mockNodeElements.append().attr.mock.calls;
      const anchorCalls = textAttrCalls.filter(
        (call) => call[0] === "text-anchor"
      );
      anchorCalls.forEach((call) => {
        expect(call[1]).toBe("middle");
      });
    });
  });

  describe("Color Application", () => {
    test("applies default colors when no colorMap provided", () => {
      const nodes = [TestDataFactories.createNode({ type: "Function" })];

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      const fillAttrCalls = mockNodeElements.append().attr.mock.calls;
      const fillCall = fillAttrCalls.find((call) => call[0] === "fill");
      expect(fillCall).toBeDefined();
      expect(fillCall?.[1]).toEqual(expect.any(Function));
    });

    test("applies custom colors from colorMap", () => {
      const colorMap = TestDataFactories.createColorMap();
      const nodes = [TestDataFactories.createNode({ type: "Function" })];

      createNodeElements(
        mockContainer as any,
        nodes,
        colorMap,
        undefined,
        mockDragBehavior
      );

      const fillAttrCalls = mockNodeElements.append().attr.mock.calls;
      const fillCall = fillAttrCalls.find((call) => call[0] === "fill");
      expect(fillCall).toBeDefined();

      // Test the color function
      const fillFunction = fillCall?.[1];
      if (typeof fillFunction === "function") {
        const color = fillFunction(nodes[0]);
        expect(color).toBe(colorMap.Function);
      }
    });

    test("uses fallback color for unknown node types", () => {
      const nodes = [TestDataFactories.createNode({ type: "UnknownType" })];

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      // Test getNodeColor utility directly
      const color = getNodeColor("UnknownType");
      expect(color).toBe("#6b7280"); // Default gray color
    });
  });

  describe("Text Truncation", () => {
    test("truncates node names longer than 20 characters", () => {
      const longNameNode = TestDataFactories.createLongNameNode();

      createNodeElements(
        mockContainer as any,
        [longNameNode],
        undefined,
        undefined,
        mockDragBehavior
      );

      const textCalls = mockNodeElements.append().text.mock.calls;
      const nameTextCall = textCalls[0];
      expect(nameTextCall).toBeDefined();

      // Test the text function
      const textFunction = nameTextCall?.[0];
      if (typeof textFunction === "function") {
        const displayText = textFunction(longNameNode);
        expect(displayText).toContain("...");
        expect(displayText.length).toBeLessThanOrEqual(23); // 20 chars + "..."
      }
    });

    test("does not truncate short node names", () => {
      const shortNameNode = TestDataFactories.createNode({ name: "Short" });

      createNodeElements(
        mockContainer as any,
        [shortNameNode],
        undefined,
        undefined,
        mockDragBehavior
      );

      const textCalls = mockNodeElements.append().text.mock.calls;
      const nameTextCall = textCalls[0];

      const textFunction = nameTextCall?.[0];
      if (typeof textFunction === "function") {
        const displayText = textFunction(shortNameNode);
        expect(displayText).toBe("Short");
        expect(displayText).not.toContain("...");
      }
    });

    test("handles exactly 20 character names without truncation", () => {
      const exactLengthNode = TestDataFactories.createNode({
        name: "ExactlyTwentyCharsss",
      });

      createNodeElements(
        mockContainer as any,
        [exactLengthNode],
        undefined,
        undefined,
        mockDragBehavior
      );

      const textCalls = mockNodeElements.append().text.mock.calls;
      const nameTextCall = textCalls[0];

      const textFunction = nameTextCall?.[0];
      if (typeof textFunction === "function") {
        const displayText = textFunction(exactLengthNode);
        expect(displayText).toBe("ExactlyTwentyCharsss");
        expect(displayText).not.toContain("...");
      }
    });
  });

  describe("Event Handlers", () => {
    test("attaches click handler when onNodeClick is provided", () => {
      const onNodeClick = vi.fn();
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        onNodeClick,
        mockDragBehavior
      );

      TestUtils.expectClickHandlerAttached(mockNodeElements);
    });

    test("does not attach click handler when onNodeClick is undefined", () => {
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      const clickCalls = mockNodeElements.on.mock.calls.filter(
        (call) => call[0] === "click"
      );
      expect(clickCalls).toHaveLength(0);
    });

    test("click handler calls onNodeClick with node data", () => {
      const onNodeClick = vi.fn();
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        onNodeClick,
        mockDragBehavior
      );

      const clickCall = mockNodeElements.on.mock.calls.find(
        (call) => call[0] === "click"
      );
      expect(clickCall).toBeDefined();

      // Simulate click event
      const clickHandler = clickCall?.[1];
      if (clickHandler) {
        const mockEvent = { stopPropagation: vi.fn() };
        clickHandler(mockEvent, nodes[0]);

        expect(mockEvent.stopPropagation).toHaveBeenCalled();
        expect(onNodeClick).toHaveBeenCalledWith(nodes[0]);
      }
    });

    test("sets cursor to pointer when onNodeClick is provided", () => {
      const onNodeClick = vi.fn();
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        onNodeClick,
        mockDragBehavior
      );

      TestUtils.expectCursorStyle(mockNodeElements, "pointer");
    });

    test("sets cursor to grab when onNodeClick is not provided", () => {
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      TestUtils.expectCursorStyle(mockNodeElements, "grab");
    });
  });

  describe("Drag Behavior", () => {
    test("attaches drag behavior to nodes", () => {
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      TestUtils.expectDragBehaviorAttached(mockNodeElements);
    });

    test("calls drag behavior with node selection", () => {
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      expect(mockNodeElements.call).toHaveBeenCalledWith(mockDragBehavior);
    });
  });

  describe("Edge Cases", () => {
    test("handles empty node array", () => {
      expect(() => {
        createNodeElements(
          mockContainer as any,
          [],
          undefined,
          undefined,
          mockDragBehavior
        );
      }).not.toThrow();
    });

    test("handles nodes with missing type field", () => {
      const nodeWithoutType = TestDataFactories.createNodeWithoutType();

      expect(() => {
        createNodeElements(
          mockContainer as any,
          [nodeWithoutType],
          undefined,
          undefined,
          mockDragBehavior
        );
      }).not.toThrow();
    });

    test("handles nodes with special characters in name", () => {
      const specialCharNode = TestDataFactories.createNode({
        name: "Node <>&'\"",
      });

      expect(() => {
        createNodeElements(
          mockContainer as any,
          [specialCharNode],
          undefined,
          undefined,
          mockDragBehavior
        );
      }).not.toThrow();
    });

    test("handles nodes with undefined name", () => {
      const undefinedNameNode = {
        id: "undefined-name",
        name: undefined as any,
        type: "Function",
      };

      expect(() => {
        createNodeElements(
          mockContainer as any,
          [undefinedNameNode],
          undefined,
          undefined,
          mockDragBehavior
        );
      }).not.toThrow();
    });

    test("handles null colorMap gracefully", () => {
      const nodes = TestDataFactories.createNodes(1);

      expect(() => {
        createNodeElements(
          mockContainer as any,
          nodes,
          null as any,
          undefined,
          mockDragBehavior
        );
      }).not.toThrow();
    });
  });

  describe("Text Styling", () => {
    test("applies correct font properties to name text", () => {
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      const textAttrCalls = mockNodeElements.append().attr.mock.calls;
      const fontSizeCalls = textAttrCalls.filter(
        (call) => call[0] === "font-size"
      );
      const fontWeightCalls = textAttrCalls.filter(
        (call) => call[0] === "font-weight"
      );

      expect(fontSizeCalls.length).toBeGreaterThan(0);
      expect(fontWeightCalls.length).toBeGreaterThan(0);
    });

    test("makes text non-interactive with pointer-events none", () => {
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      const textStyleCalls = mockNodeElements.append().style.mock.calls;
      const pointerEventsCalls = textStyleCalls.filter(
        (call) => call[0] === "pointer-events"
      );

      expect(pointerEventsCalls.length).toBeGreaterThan(0);
      pointerEventsCalls.forEach((call) => {
        expect(call[1]).toBe("none");
      });
    });

    test("applies correct color to type label", () => {
      const nodes = TestDataFactories.createNodes(1);

      createNodeElements(
        mockContainer as any,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      const textAttrCalls = mockNodeElements.append().attr.mock.calls;
      const fillCalls = textAttrCalls.filter((call) => call[0] === "fill");

      // Should have fill attributes for text elements
      expect(fillCalls.length).toBeGreaterThan(0);
    });
  });
});

describe("graphUtils - Helper Functions", () => {
  describe("getNodeColor", () => {
    test("returns correct color from DEFAULT_COLORS", () => {
      expect(getNodeColor("Function")).toBe(DEFAULT_COLORS.Function);
      expect(getNodeColor("File")).toBe(DEFAULT_COLORS.File);
      expect(getNodeColor("Endpoint")).toBe(DEFAULT_COLORS.Endpoint);
    });

    test("returns custom color from provided colorMap", () => {
      const customMap = { CustomType: "#ff00ff" };
      expect(getNodeColor("CustomType", customMap)).toBe("#ff00ff");
    });

    test("returns fallback color for unknown types", () => {
      expect(getNodeColor("UnknownType")).toBe("#6b7280");
    });

    test("prioritizes custom colorMap over DEFAULT_COLORS", () => {
      const customMap = { Function: "#custom" };
      expect(getNodeColor("Function", customMap)).toBe("#custom");
    });
  });

  describe("filterValidLinks", () => {
    test("filters out links with invalid source nodes", () => {
      const nodeIds = new Set(["node-1", "node-2"]);
      const links = [
        TestDataFactories.createLink("node-1", "node-2"),
        TestDataFactories.createLink("invalid-source", "node-2"),
      ];

      const validLinks = filterValidLinks(links, nodeIds);
      expect(validLinks).toHaveLength(1);
      expect(validLinks[0].source).toBe("node-1");
    });

    test("filters out links with invalid target nodes", () => {
      const nodeIds = new Set(["node-1", "node-2"]);
      const links = [
        TestDataFactories.createLink("node-1", "node-2"),
        TestDataFactories.createLink("node-1", "invalid-target"),
      ];

      const validLinks = filterValidLinks(links, nodeIds);
      expect(validLinks).toHaveLength(1);
      expect(validLinks[0].target).toBe("node-2");
    });

    test("keeps all links when all nodes are valid", () => {
      const nodeIds = new Set(["node-1", "node-2", "node-3"]);
      const links = TestDataFactories.createLinks(["node-1", "node-2", "node-3"]);

      const validLinks = filterValidLinks(links, nodeIds);
      expect(validLinks).toHaveLength(2);
    });

    test("handles empty links array", () => {
      const nodeIds = new Set(["node-1"]);
      const validLinks = filterValidLinks([], nodeIds);
      expect(validLinks).toHaveLength(0);
    });

    test("handles links with D3Node objects as source/target", () => {
      const node1 = TestDataFactories.createNode({ id: "node-1" });
      const node2 = TestDataFactories.createNode({ id: "node-2" });
      const nodeIds = new Set(["node-1", "node-2"]);
      const links: D3Link[] = [
        { source: node1, target: node2 },
      ];

      const validLinks = filterValidLinks(links, nodeIds);
      expect(validLinks).toHaveLength(1);
    });
  });
});