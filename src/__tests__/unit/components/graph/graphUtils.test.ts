import { describe, test, expect, vi, beforeEach } from "vitest";
import * as d3 from "d3";
import {
  createNodeElements,
  getNodeColor,
  DEFAULT_COLORS,
  D3Node,
} from "@/components/graph/graphUtils";

// Mock D3.js
vi.mock("d3", async () => {
  const actual = await vi.importActual<typeof d3>("d3");
  return {
    ...actual,
    select: vi.fn(),
    drag: vi.fn(),
  };
});

// Helper to create mock D3 selection with chainable methods
const createMockSelection = () => {
  const mockSelection: any = {
    append: vi.fn().mockReturnThis(),
    attr: vi.fn().mockReturnThis(),
    style: vi.fn().mockReturnThis(),
    text: vi.fn().mockReturnThis(),
    selectAll: vi.fn().mockReturnThis(),
    data: vi.fn().mockReturnThis(),
    enter: vi.fn().mockReturnThis(),
    call: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    size: vi.fn().mockReturnValue(0),
    nodes: vi.fn().mockReturnValue([]),
  };
  return mockSelection;
};

// Helper to create mock drag behavior
const createMockDragBehavior = () => {
  const mockDrag: any = {
    on: vi.fn().mockReturnThis(),
  };
  return mockDrag;
};

// Helper to create test nodes
const createTestNodes = (count: number = 1): D3Node[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: `node-${i}`,
    name: `TestNode${i}`,
    type: "Function",
    x: 0,
    y: 0,
  }));
};

// Helper to create node with specific properties
const createNodeWithProps = (props: Partial<D3Node> = {}): D3Node => ({
  id: "test-node",
  name: "TestNode",
  type: "Function",
  x: 0,
  y: 0,
  ...props,
});

describe("getNodeColor", () => {
  describe("Known Node Types", () => {
    const nodeTypeColors: Array<[string, string]> = [
      ["Hint", "#3b82f6"],
      ["Prompt", "#10b981"],
      ["File", "#f59e0b"],
      ["Function", "#8b5cf6"],
      ["Endpoint", "#ef4444"],
      ["Datamodel", "#06b6d4"],
      ["Request", "#ec4899"],
      ["Learning", "#84cc16"],
      ["Task", "#f97316"],
      ["Repository", "#1e40af"],
      ["Package", "#0891b2"],
      ["Language", "#0d9488"],
      ["Directory", "#f59e0b"],
      ["Import", "#7c3aed"],
      ["Library", "#9333ea"],
      ["Class", "#a855f7"],
      ["Trait", "#c084fc"],
      ["Instance", "#d8b4fe"],
      ["Feature", "#059669"],
      ["Page", "#10b981"],
      ["Var", "#34d399"],
      ["UnitTest", "#fbbf24"],
      ["IntegrationTest", "#f59e0b"],
      ["E2eTest", "#f97316"],
    ];

    test.each(nodeTypeColors)(
      "returns correct color for %s node type",
      (type, expectedColor) => {
        expect(getNodeColor(type)).toBe(expectedColor);
      }
    );

    test("returns correct color from DEFAULT_COLORS constant", () => {
      expect(getNodeColor("Function")).toBe(DEFAULT_COLORS.Function);
      expect(getNodeColor("Endpoint")).toBe(DEFAULT_COLORS.Endpoint);
      expect(getNodeColor("File")).toBe(DEFAULT_COLORS.File);
    });
  });

  describe("Unknown Node Types", () => {
    test("returns gray color for unknown type", () => {
      expect(getNodeColor("UnknownType")).toBe("#6b7280");
    });

    test("returns gray color for empty string type", () => {
      expect(getNodeColor("")).toBe("#6b7280");
    });

    test("returns gray color for type not in DEFAULT_COLORS", () => {
      expect(getNodeColor("CustomType123")).toBe("#6b7280");
    });
  });

  describe("Custom Color Map", () => {
    test("uses custom colorMap when provided", () => {
      const customMap = { Function: "#ff0000" };
      expect(getNodeColor("Function", customMap)).toBe("#ff0000");
    });

    test("falls back to custom map default for unknown types", () => {
      const customMap = { UnknownType: "#00ff00" };
      expect(getNodeColor("UnknownType", customMap)).toBe("#00ff00");
    });

    test("returns gray when type not in custom map", () => {
      const customMap = { Function: "#ff0000" };
      expect(getNodeColor("Endpoint", customMap)).toBe("#6b7280");
    });

    test("custom colorMap overrides DEFAULT_COLORS", () => {
      const customMap = { Function: "#custom" };
      expect(getNodeColor("Function", customMap)).toBe("#custom");
      expect(getNodeColor("Function", customMap)).not.toBe(
        DEFAULT_COLORS.Function
      );
    });
  });

  describe("Edge Cases", () => {
    test("handles undefined colorMap parameter", () => {
      expect(getNodeColor("Function", undefined)).toBe(DEFAULT_COLORS.Function);
    });

    test("handles empty colorMap object", () => {
      expect(getNodeColor("Function", {})).toBe("#6b7280");
    });

    test("is case-sensitive for node types", () => {
      expect(getNodeColor("function")).toBe("#6b7280"); // lowercase not in map
      expect(getNodeColor("Function")).toBe(DEFAULT_COLORS.Function);
    });
  });
});

describe("createNodeElements", () => {
  let mockContainer: any;
  let mockNodeGroup: any;
  let mockDragBehavior: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContainer = createMockSelection();
    mockNodeGroup = createMockSelection();
    mockDragBehavior = createMockDragBehavior();

    // Setup container.append chain
    mockContainer.append.mockReturnValue(mockNodeGroup);
    mockNodeGroup.selectAll.mockReturnValue(mockNodeGroup);
    mockNodeGroup.data.mockReturnValue(mockNodeGroup);
    mockNodeGroup.enter.mockReturnValue(mockNodeGroup);
    mockNodeGroup.append.mockReturnValue(mockNodeGroup);
    mockNodeGroup.call.mockReturnValue(mockNodeGroup);
  });

  describe("Basic DOM Structure", () => {
    test("creates container group with 'nodes' class", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockContainer.append).toHaveBeenCalledWith("g");
      expect(mockNodeGroup.attr).toHaveBeenCalledWith("class", "nodes");
    });

    test("creates node group for each node", () => {
      const nodes = createTestNodes(3);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockNodeGroup.data).toHaveBeenCalledWith(nodes);
      expect(mockNodeGroup.enter).toHaveBeenCalled();
      expect(mockNodeGroup.append).toHaveBeenCalledWith("g");
    });

    test("attaches drag behavior to node groups", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockNodeGroup.call).toHaveBeenCalledWith(mockDragBehavior);
    });

    test("returns the node selection", () => {
      const nodes = createTestNodes(1);
      const result = createNodeElements(
        mockContainer,
        nodes,
        undefined,
        undefined,
        mockDragBehavior
      );

      expect(result).toBe(mockNodeGroup);
    });
  });

  describe("Circle Elements", () => {
    test("appends circle element to each node group", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockNodeGroup.append).toHaveBeenCalledWith("circle");
    });

    test("sets circle radius to 12", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockNodeGroup.attr).toHaveBeenCalledWith("r", 12);
    });

    test("applies correct fill color based on node type", () => {
      const nodes = [createNodeWithProps({ type: "Function" })];
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      // Verify attr was called with "fill" and a function
      const fillCall = vi.mocked(mockNodeGroup.attr).mock.calls.find(
        (call) => call[0] === "fill"
      );
      expect(fillCall).toBeDefined();
      expect(typeof fillCall?.[1]).toBe("function");

      // Test the fill function
      const fillFunction = fillCall?.[1] as (d: D3Node) => string;
      expect(fillFunction(nodes[0])).toBe(DEFAULT_COLORS.Function);
    });

    test("applies white stroke with 2px width", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockNodeGroup.attr).toHaveBeenCalledWith("stroke", "#fff");
      expect(mockNodeGroup.attr).toHaveBeenCalledWith("stroke-width", 2);
    });

    test("applies drop shadow filter", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockNodeGroup.style).toHaveBeenCalledWith(
        "filter",
        "drop-shadow(1px 1px 2px rgba(0,0,0,0.2))"
      );
    });
  });

  describe("Text Labels", () => {
    test("appends text element for node name", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockNodeGroup.append).toHaveBeenCalledWith("text");
    });

    test("displays full name for names <= 20 characters", () => {
      const shortName = "ShortNodeName";
      const nodes = [createNodeWithProps({ name: shortName })];
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      const textCall = vi.mocked(mockNodeGroup.text).mock.calls[0];
      expect(textCall).toBeDefined();
      expect(typeof textCall?.[0]).toBe("function");

      const textFunction = textCall?.[0] as (d: D3Node) => string;
      expect(textFunction(nodes[0])).toBe(shortName);
    });

    test("truncates names longer than 20 characters with ellipsis", () => {
      const longName = "ThisIsAVeryLongNodeNameThatExceedsTwentyCharacters";
      const nodes = [createNodeWithProps({ name: longName })];
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      const textCall = vi.mocked(mockNodeGroup.text).mock.calls[0];
      const textFunction = textCall?.[0] as (d: D3Node) => string;
      const result = textFunction(nodes[0]);

      expect(result.length).toBe(23); // 20 chars + "..."
      expect(result).toBe(`${longName.slice(0, 20)}...`);
      expect(result.endsWith("...")).toBe(true);
    });

    test("truncates name with exactly 21 characters", () => {
      const exactlyTooLong = "ExactlyTwentyOneChars";
      const nodes = [createNodeWithProps({ name: exactlyTooLong })];
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      const textCall = vi.mocked(mockNodeGroup.text).mock.calls[0];
      const textFunction = textCall?.[0] as (d: D3Node) => string;
      const result = textFunction(nodes[0]);

      expect(result).toBe(`${exactlyTooLong.slice(0, 20)}...`);
    });

    test("does not truncate name with exactly 20 characters", () => {
      const exactlyTwenty = "ExactlyTwentyCharsNo";
      const nodes = [createNodeWithProps({ name: exactlyTwenty })];
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      const textCall = vi.mocked(mockNodeGroup.text).mock.calls[0];
      const textFunction = textCall?.[0] as (d: D3Node) => string;
      const result = textFunction(nodes[0]);

      expect(result).toBe(exactlyTwenty);
      expect(result.endsWith("...")).toBe(false);
    });

    test("positions name label at y=-18", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      // First text element is the name label
      expect(mockNodeGroup.attr).toHaveBeenCalledWith("y", -18);
    });

    test("centers name label horizontally", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockNodeGroup.attr).toHaveBeenCalledWith("x", 0);
      expect(mockNodeGroup.attr).toHaveBeenCalledWith("text-anchor", "middle");
    });

    test("applies correct font styling to name label", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockNodeGroup.attr).toHaveBeenCalledWith("font-size", "11px");
      expect(mockNodeGroup.attr).toHaveBeenCalledWith("font-weight", "500");
      expect(mockNodeGroup.attr).toHaveBeenCalledWith("fill", "currentColor");
    });

    test("disables pointer events on text labels", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockNodeGroup.style).toHaveBeenCalledWith("pointer-events", "none");
    });
  });

  describe("Type Labels", () => {
    test("appends second text element for node type", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      const appendCalls = vi.mocked(mockNodeGroup.append).mock.calls.filter(
        (call) => call[0] === "text"
      );
      expect(appendCalls.length).toBeGreaterThanOrEqual(2);
    });

    test("displays node type", () => {
      const nodes = [createNodeWithProps({ type: "Endpoint" })];
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      const textCalls = vi.mocked(mockNodeGroup.text).mock.calls;
      const typeTextCall = textCalls[1]; // Second text call is for type
      expect(typeTextCall).toBeDefined();
      expect(typeof typeTextCall?.[0]).toBe("function");

      const textFunction = typeTextCall?.[0] as (d: D3Node) => string;
      expect(textFunction(nodes[0])).toBe("Endpoint");
    });

    test("positions type label at y=25", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockNodeGroup.attr).toHaveBeenCalledWith("y", 25);
    });

    test("applies smaller font size to type label", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockNodeGroup.attr).toHaveBeenCalledWith("font-size", "9px");
    });

    test("applies gray color to type label", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockNodeGroup.attr).toHaveBeenCalledWith("fill", "#666");
    });
  });

  describe("Cursor Styling", () => {
    test("sets cursor to pointer when click handler provided", () => {
      const nodes = createTestNodes(1);
      const onClick = vi.fn();
      createNodeElements(mockContainer, nodes, undefined, onClick, mockDragBehavior);

      expect(mockNodeGroup.style).toHaveBeenCalledWith("cursor", "pointer");
    });

    test("sets cursor to grab when no click handler", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockNodeGroup.style).toHaveBeenCalledWith("cursor", "grab");
    });
  });

  describe("Click Handler", () => {
    test("attaches click handler when onNodeClick provided", () => {
      const nodes = createTestNodes(1);
      const onClick = vi.fn();
      createNodeElements(mockContainer, nodes, undefined, onClick, mockDragBehavior);

      expect(mockNodeGroup.on).toHaveBeenCalledWith("click", expect.any(Function));
    });

    test("does not attach click handler when onNodeClick is undefined", () => {
      const nodes = createTestNodes(1);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      const clickCalls = vi.mocked(mockNodeGroup.on).mock.calls.filter(
        (call) => call[0] === "click"
      );
      expect(clickCalls.length).toBe(0);
    });

    test("click handler calls onNodeClick with node data", () => {
      const nodes = createTestNodes(1);
      const onClick = vi.fn();
      createNodeElements(mockContainer, nodes, undefined, onClick, mockDragBehavior);

      const clickCall = vi.mocked(mockNodeGroup.on).mock.calls.find(
        (call) => call[0] === "click"
      );
      expect(clickCall).toBeDefined();

      // Simulate click event
      const clickHandler = clickCall?.[1] as (event: any, d: D3Node) => void;
      const mockEvent = { stopPropagation: vi.fn() };
      clickHandler(mockEvent, nodes[0]);

      expect(mockEvent.stopPropagation).toHaveBeenCalled();
      expect(onClick).toHaveBeenCalledWith(nodes[0]);
    });
  });

  describe("Custom Color Map", () => {
    test("uses custom color map for node fill", () => {
      const customMap = { Function: "#custom-color" };
      const nodes = [createNodeWithProps({ type: "Function" })];
      createNodeElements(
        mockContainer,
        nodes,
        customMap,
        undefined,
        mockDragBehavior
      );

      const fillCall = vi.mocked(mockNodeGroup.attr).mock.calls.find(
        (call) => call[0] === "fill"
      );
      const fillFunction = fillCall?.[1] as (d: D3Node) => string;
      expect(fillFunction(nodes[0])).toBe("#custom-color");
    });

    test("falls back to gray for types not in custom map", () => {
      const customMap = { Function: "#custom-color" };
      const nodes = [createNodeWithProps({ type: "Endpoint" })];
      createNodeElements(
        mockContainer,
        nodes,
        customMap,
        undefined,
        mockDragBehavior
      );

      const fillCall = vi.mocked(mockNodeGroup.attr).mock.calls.find(
        (call) => call[0] === "fill"
      );
      const fillFunction = fillCall?.[1] as (d: D3Node) => string;
      expect(fillFunction(nodes[0])).toBe("#6b7280");
    });
  });

  describe("Multiple Nodes", () => {
    test("handles empty nodes array", () => {
      const nodes: D3Node[] = [];
      expect(() => {
        createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);
      }).not.toThrow();
    });

    test("creates elements for multiple nodes", () => {
      const nodes = createTestNodes(5);
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockNodeGroup.data).toHaveBeenCalledWith(nodes);
    });

    test("processes each node independently", () => {
      const nodes = [
        createNodeWithProps({ id: "1", name: "Node1", type: "Function" }),
        createNodeWithProps({ id: "2", name: "Node2", type: "Endpoint" }),
        createNodeWithProps({ id: "3", name: "VeryLongNodeNameThatWillBeTruncated", type: "File" }),
      ];
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      expect(mockNodeGroup.data).toHaveBeenCalledWith(nodes);
    });
  });

  describe("Edge Cases", () => {
    test("handles node with empty name", () => {
      const nodes = [createNodeWithProps({ name: "" })];
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      const textCall = vi.mocked(mockNodeGroup.text).mock.calls[0];
      const textFunction = textCall?.[0] as (d: D3Node) => string;
      expect(textFunction(nodes[0])).toBe("");
    });

    test("handles node with special characters in name", () => {
      const specialName = "Node<>Test&Symbols";
      const nodes = [createNodeWithProps({ name: specialName })];
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      const textCall = vi.mocked(mockNodeGroup.text).mock.calls[0];
      const textFunction = textCall?.[0] as (d: D3Node) => string;
      expect(textFunction(nodes[0])).toBe(specialName);
    });

    test("handles node with unicode characters in name", () => {
      const unicodeName = "测试节点🔥";
      const nodes = [createNodeWithProps({ name: unicodeName })];
      createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);

      const textCall = vi.mocked(mockNodeGroup.text).mock.calls[0];
      const textFunction = textCall?.[0] as (d: D3Node) => string;
      expect(textFunction(nodes[0])).toBe(unicodeName);
    });

    test("handles undefined custom colorMap gracefully", () => {
      const nodes = createTestNodes(1);
      expect(() => {
        createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);
      }).not.toThrow();
    });

    test("handles nodes with additional properties", () => {
      const nodes = [
        createNodeWithProps({
          id: "test",
          name: "Test",
          type: "Function",
          customProp: "value",
          layer: 1,
        }),
      ];
      expect(() => {
        createNodeElements(mockContainer, nodes, undefined, undefined, mockDragBehavior);
      }).not.toThrow();
    });
  });

  describe("Node Type Color Mapping Integration", () => {
    test("applies correct colors for all 26 node types", () => {
      const nodeTypes = [
        "Hint", "Prompt", "File", "Function", "Endpoint", "Datamodel",
        "Request", "Learning", "Task", "Repository", "Package", "Language",
        "Directory", "Import", "Library", "Class", "Trait", "Instance",
        "Feature", "Page", "Var", "UnitTest", "IntegrationTest", "E2eTest"
      ];

      nodeTypes.forEach((type) => {
        const nodes = [createNodeWithProps({ type })];
        vi.clearAllMocks();
        mockNodeGroup.append.mockReturnValue(mockNodeGroup);

        createNodeElements(
          mockContainer,
          nodes,
          undefined,
          undefined,
          mockDragBehavior
        );

        const fillCall = vi.mocked(mockNodeGroup.attr).mock.calls.find(
          (call) => call[0] === "fill"
        );
        const fillFunction = fillCall?.[1] as (d: D3Node) => string;
        expect(fillFunction(nodes[0])).toBe(DEFAULT_COLORS[type]);
      });
    });
  });
});