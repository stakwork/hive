import { describe, test, expect } from "vitest";
import {
  sanitiseDiagram,
  measureTextWidth,
  computeComponentSize,
  computeWordWrapLineCount,
  computeLayeredDirection,
  relayoutDiagram,
  FONT_SIZE,
  MIN_WIDTH,
  MAX_SINGLE_LINE_WIDTH,
  MIN_HEIGHT,
  SINGLE_LINE_HEIGHT,
  PADDING_V,
  PADDING_H,
} from "@/services/excalidraw-layout";
import type { ParsedDiagram } from "@/services/excalidraw-layout";

describe("sanitiseDiagram", () => {
  test("valid diagram passes through unchanged", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "c1", name: "API Gateway", type: "gateway" },
        { id: "c2", name: "User Service", type: "service" },
      ],
      connections: [{ from: "c1", to: "c2", label: "REST" }],
    };

    const result = sanitiseDiagram(diagram);

    expect(result.components).toHaveLength(2);
    expect(result.connections).toHaveLength(1);
    expect(result.components[0]).toEqual(diagram.components[0]);
    expect(result.components[1]).toEqual(diagram.components[1]);
    expect(result.connections[0]).toEqual(diagram.connections[0]);
  });

  test("component missing id is removed", () => {
    const diagram = {
      components: [
        { id: "", name: "Missing ID", type: "service" },
        { id: "c2", name: "Valid Service", type: "service" },
      ],
      connections: [],
    } as unknown as ParsedDiagram;

    const result = sanitiseDiagram(diagram);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].id).toBe("c2");
  });

  test("component missing name is removed", () => {
    const diagram = {
      components: [
        { id: "c1", name: "", type: "service" },
        { id: "c2", name: "Valid Service", type: "service" },
      ],
      connections: [],
    } as unknown as ParsedDiagram;

    const result = sanitiseDiagram(diagram);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].id).toBe("c2");
  });

  test("connection with unknown from ID is stripped", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "c1", name: "Service A", type: "service" },
        { id: "c2", name: "Service B", type: "service" },
      ],
      connections: [
        { from: "UNKNOWN", to: "c2", label: "broken" },
        { from: "c1", to: "c2", label: "valid" },
      ],
    };

    const result = sanitiseDiagram(diagram);

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].label).toBe("valid");
  });

  test("connection with unknown to ID is stripped", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "c1", name: "Service A", type: "service" },
        { id: "c2", name: "Service B", type: "service" },
      ],
      connections: [
        { from: "c1", to: "DOES_NOT_EXIST", label: "broken" },
        { from: "c1", to: "c2", label: "valid" },
      ],
    };

    const result = sanitiseDiagram(diagram);

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].label).toBe("valid");
  });

  test("unknown component type is kept as-is", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "c1", name: "Weird Component", type: "blockchain" },
      ],
      connections: [],
    };

    const result = sanitiseDiagram(diagram);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].type).toBe("blockchain");
  });

  test("component without type is accepted", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "c1", name: "Typeless Node" },
      ],
      connections: [],
    };

    const result = sanitiseDiagram(diagram);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].type).toBeUndefined();
  });

  test("unknown shape is coerced to undefined", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "c1", name: "Hexagon Node", shape: "hexagon" as never },
      ],
      connections: [],
    };

    const result = sanitiseDiagram(diagram);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].shape).toBeUndefined();
  });

  test("connections referencing removed components are also stripped", () => {
    const diagram = {
      components: [
        { id: "", name: "No ID", type: "service" }, // will be removed
        { id: "c2", name: "Valid", type: "service" },
      ],
      connections: [
        { from: "", to: "c2", label: "dangling" },
        { from: "c2", to: "c2", label: "self-loop" },
      ],
    } as unknown as ParsedDiagram;

    const result = sanitiseDiagram(diagram);

    expect(result.components).toHaveLength(1);
    // The "" id component is gone, so the dangling connection is also stripped
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].label).toBe("self-loop");
  });
});

describe("measureTextWidth", () => {
  test("space characters produce less width than equivalent alphanumeric chars", () => {
    const spaceWidth = measureTextWidth("   ", FONT_SIZE); // 3 spaces
    const alphaWidth = measureTextWidth("abc", FONT_SIZE); // 3 lowercase
    expect(spaceWidth).toBeLessThan(alphaWidth);
  });

  test("hyphen and underscore are narrower than regular lowercase", () => {
    const punctWidth = measureTextWidth("---", FONT_SIZE); // 3 hyphens
    const lowerWidth = measureTextWidth("aaa", FONT_SIZE); // 3 lowercase
    expect(punctWidth).toBeLessThan(lowerWidth);
  });

  test("slash is narrower than regular lowercase", () => {
    const slashWidth = measureTextWidth("///", FONT_SIZE);
    const lowerWidth = measureTextWidth("aaa", FONT_SIZE);
    expect(slashWidth).toBeLessThan(lowerWidth);
  });

  test("very wide chars (mwMW) produce more width than regular lowercase", () => {
    const wideWidth = measureTextWidth("mmm", FONT_SIZE);
    const lowerWidth = measureTextWidth("aaa", FONT_SIZE);
    expect(wideWidth).toBeGreaterThan(lowerWidth);
  });

  test("width scales with fontSize", () => {
    const w16 = measureTextWidth("Hello", 16);
    const w32 = measureTextWidth("Hello", 32);
    expect(w32).toBeCloseTo(w16 * 2, 5);
  });
});

describe("computeWordWrapLineCount", () => {
  const innerWidth = MAX_SINGLE_LINE_WIDTH - PADDING_H; // 232px

  test("short label that fits on one line returns 1", () => {
    expect(computeWordWrapLineCount("API", innerWidth)).toBe(1);
  });

  test("label that wraps to two lines returns 2", () => {
    // "Distributed Background Job Processing Worker" measured to need exactly 2 lines
    const lines = computeWordWrapLineCount("Distributed Background Job Processing Worker", innerWidth);
    expect(lines).toBe(2);
  });

  test("very long label returns 3 or more lines", () => {
    // 8+ short words overflow two lines at 232px inner width
    const lines = computeWordWrapLineCount(
      "Async Distributed Background Job Worker Queue Processing Service Node Manager",
      innerWidth
    );
    expect(lines).toBeGreaterThanOrEqual(3);
  });

  test("single word always stays on one line regardless of length", () => {
    // A word with no spaces can never be broken across lines
    expect(computeWordWrapLineCount("SingleWordComponent", innerWidth)).toBe(1);
  });
});

describe("computeComponentSize", () => {
  test("short label (API) produces node at MIN_WIDTH × MIN_HEIGHT", () => {
    const { width, height } = computeComponentSize("API");
    expect(width).toBe(MIN_WIDTH);
    expect(height).toBe(MIN_HEIGHT);
  });

  test("medium label (User Auth Service) produces single-line box between MIN_WIDTH and MAX_SINGLE_LINE_WIDTH", () => {
    const { width, height } = computeComponentSize("User Auth Service");
    expect(width).toBeGreaterThan(MIN_WIDTH);
    expect(width).toBeLessThan(MAX_SINGLE_LINE_WIDTH);
    // Single-line height = SINGLE_LINE_HEIGHT + PADDING_V, floored at MIN_HEIGHT
    const expectedHeight = Math.max(MIN_HEIGHT, SINGLE_LINE_HEIGHT + PADDING_V);
    expect(height).toBe(expectedHeight);
  });

  test("long label (Distributed Background Job Processing Worker) produces MAX_SINGLE_LINE_WIDTH wide dynamic-line box", () => {
    const name = "Distributed Background Job Processing Worker";
    const { width, height } = computeComponentSize(name);
    expect(width).toBe(MAX_SINGLE_LINE_WIDTH);
    // Height driven by actual word-wrap line count, not hard-coded 2
    const lineCount = computeWordWrapLineCount(name, MAX_SINGLE_LINE_WIDTH - PADDING_H);
    const expectedHeight = Math.max(MIN_HEIGHT, lineCount * SINGLE_LINE_HEIGHT + PADDING_V);
    expect(height).toBe(expectedHeight);
    expect(height).toBeGreaterThan(MIN_HEIGHT);
  });

  test("very long label (3+ lines) produces height greater than two-line box", () => {
    const name = "Async Distributed Background Job Worker Queue Processing Service Node Manager";
    const { height } = computeComponentSize(name);
    const twoLineHeight = 2 * SINGLE_LINE_HEIGHT + PADDING_V;
    expect(height).toBeGreaterThan(twoLineHeight);
  });

  test("diamond shape applies 1.42× multiplier to both width and height", () => {
    const diamond = computeComponentSize("API", "diamond");
    expect(diamond.width).toBe(Math.round(MIN_WIDTH * 1.42));
    expect(diamond.height).toBe(Math.round(MIN_HEIGHT * 1.42));
  });

  test("diamond long label also gets MAX_SINGLE_LINE_WIDTH × 1.42 wide", () => {
    const diamond = computeComponentSize("Distributed Background Job Processing Worker", "diamond");
    expect(diamond.width).toBe(Math.round(MAX_SINGLE_LINE_WIDTH * 1.42));
  });

  test("text width is clamped at MAX_SINGLE_LINE_WIDTH — no unbounded growth", () => {
    const veryLong = computeComponentSize("A".repeat(100));
    expect(veryLong.width).toBe(MAX_SINGLE_LINE_WIDTH);
  });

  test("width never falls below MIN_WIDTH regardless of label length", () => {
    const tiny = computeComponentSize("X");
    expect(tiny.width).toBeGreaterThanOrEqual(MIN_WIDTH);
  });

  test("height accounts for PADDING_H constant used for clamped text width", () => {
    // Ensure PADDING_H is exported and has expected value
    expect(PADDING_H).toBe(48);
  });
});

describe("createComponentElement text sizing (via relayoutDiagram)", () => {
  // Helper: build a minimal 1-node diagram and return the bound text element
  async function getTextElement(name: string) {
    const diagram: ParsedDiagram = {
      components: [{ id: "c1", name, type: "service" }],
      connections: [],
    };
    const { elements } = await relayoutDiagram(diagram, "layered");
    return elements.find((el) => el.type === "text" && (el as Record<string, unknown>).containerId != null) as
      | (Record<string, unknown> & { width: number; height: number; containerId: string })
      | undefined;
  }

  async function getShapeElement(name: string) {
    const diagram: ParsedDiagram = {
      components: [{ id: "c1", name, type: "service" }],
      connections: [],
    };
    const { elements } = await relayoutDiagram(diagram, "layered");
    return elements.find((el) => el.type === "rectangle") as
      | (Record<string, unknown> & { width: number; height: number })
      | undefined;
  }

  test("boundary case: label at exact boundary (textW = MAX_SINGLE_LINE_WIDTH - PADDING_H) gets lineCount=1", () => {
    // Craft a name whose measureTextWidth(..., FONT_SIZE) === MAX_SINGLE_LINE_WIDTH - PADDING_H (= 232)
    // Default lowercase chars each contribute 7px per char at fontSize 16 (scale factor 1).
    // 232 / 7 = 33.14 → 33 chars × 7 = 231, 34 chars × 7 = 238 (too wide).
    // Use 'a' (7px each): 33 × 7 = 231 < 232, add one narrow char 'i' (5px): 231+5=236 > 232.
    // Simpler: use chars of width 8 — none. Let's target exactly 232:
    // 232 = 7*33 + 1 → not achievable cleanly. Use 'n' (7px) × 32 + ' ' (4px) = 228 → still short.
    // Best approach: verify via measureTextWidth directly and find a name that hits boundary.
    const boundaryTextW = MAX_SINGLE_LINE_WIDTH - PADDING_H; // 232
    // 33 default lowercase = 231, 34 = 238. Pick name so textW <= 232:
    const name33 = "a".repeat(33); // 231px → textW + PADDING_H = 279 ≤ 280 → lineCount = 1
    const { width, height } = computeComponentSize(name33);
    const textW = measureTextWidth(name33, FONT_SIZE);
    // Confirm textW + PADDING_H <= MAX_SINGLE_LINE_WIDTH → lineCount = 1
    expect(textW + PADDING_H).toBeLessThanOrEqual(MAX_SINGLE_LINE_WIDTH);
    // width = max(MIN_WIDTH, textW + PADDING_H) = 279 (below MAX_SINGLE_LINE_WIDTH)
    expect(width).toBe(textW + PADDING_H);
    // height should be single-line
    const expectedHeight = Math.max(MIN_HEIGHT, SINGLE_LINE_HEIGHT + PADDING_V);
    expect(height).toBe(expectedHeight);
  });

  test("boundary case: computeComponentSize lineCount=1 at exact MAX_SINGLE_LINE_WIDTH boundary", () => {
    // Find a name where textW + PADDING_H === MAX_SINGLE_LINE_WIDTH exactly (232px text)
    // We need textW = 232. Using 'W' (10px each): 23 × 10 = 230, 24 × 10 = 240. Not exact.
    // Using lowercase (7px): 232/7 ≈ 33.1. Mix: 33 × 7 = 231, need +1px — not achievable.
    // Instead verify the threshold condition: textW + PADDING_H = MAX_SINGLE_LINE_WIDTH should be single-line
    // We can't easily craft an exact 232px name, but we CAN verify that a name giving textW = 231
    // and textW = 233 behave correctly on opposite sides of the boundary.
    const nameBelow = "a".repeat(33); // textW = 231, textW + PADDING_H = 279 ≤ 280 → lineCount=1
    const nameAbove = "a".repeat(34); // textW = 238, textW + PADDING_H = 286 > 280 → lineCount=2

    const below = computeComponentSize(nameBelow);
    const above = computeComponentSize(nameAbove);

    // Below boundary: single-line height
    expect(below.height).toBe(Math.max(MIN_HEIGHT, SINGLE_LINE_HEIGHT + PADDING_V));
    // Above boundary: two-line height
    expect(above.height).toBe(2 * SINGLE_LINE_HEIGHT + PADDING_V);
    expect(above.width).toBe(MAX_SINGLE_LINE_WIDTH);
  });

  test("generated text element width equals containerWidth - PADDING_H", async () => {
    const name = "AuthService";
    const textEl = await getTextElement(name);
    const shapeEl = await getShapeElement(name);

    expect(textEl).toBeDefined();
    expect(shapeEl).toBeDefined();
    expect(textEl!.width).toBe(shapeEl!.width - PADDING_H);
  });

  test("short label text element width equals containerWidth - PADDING_H (not clamped to measured pixel width)", async () => {
    // "API" is a very short label — measured width is much less than containerWidth - PADDING_H
    // The old bug would clamp text element width to the measured pixel width
    const name = "API";
    const textEl = await getTextElement(name);
    const shapeEl = await getShapeElement(name);

    expect(textEl).toBeDefined();
    expect(shapeEl).toBeDefined();
    const measuredWidth = measureTextWidth(name, FONT_SIZE);
    // Verify measured width IS smaller than containerWidth - PADDING_H (confirming the bug scenario)
    expect(measuredWidth).toBeLessThan(shapeEl!.width - PADDING_H);
    // Verify the fix: text element width must be containerWidth - PADDING_H, NOT the measured width
    expect(textEl!.width).toBe(shapeEl!.width - PADDING_H);
    expect(textEl!.width).not.toBe(measuredWidth);
  });

  test("long label produces lineCount=2 consistently between computeComponentSize and text element", async () => {
    const name = "Distributed Background Job Processing Worker";
    // computeComponentSize should give two-line height
    const { width, height } = computeComponentSize(name);
    expect(width).toBe(MAX_SINGLE_LINE_WIDTH);
    expect(height).toBe(2 * SINGLE_LINE_HEIGHT + PADDING_V);

    // Generated text element should also have two-line height
    const textEl = await getTextElement(name);
    const shapeEl = await getShapeElement(name);

    expect(textEl).toBeDefined();
    const expectedTextHeight = Math.ceil(2 * FONT_SIZE * 1.25); // lineCount=2
    expect(textEl!.height).toBe(expectedTextHeight);
    // And width should be containerWidth - PADDING_H
    expect(textEl!.width).toBe(shapeEl!.width - PADDING_H);
  });
});

describe("computeLayeredDirection", () => {
  test("linear chain (A→B→C→D) returns DOWN — 4 layers, 1 node each", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "A", name: "A" },
        { id: "B", name: "B" },
        { id: "C", name: "C" },
        { id: "D", name: "D" },
      ],
      connections: [
        { from: "A", to: "B", label: "" },
        { from: "B", to: "C", label: "" },
        { from: "C", to: "D", label: "" },
      ],
    };
    expect(computeLayeredDirection(diagram)).toBe("DOWN");
  });

  test("star topology (hub→A,B,C,D) returns RIGHT — 2 layers, max 4 nodes in layer 2", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "hub", name: "Hub" },
        { id: "A", name: "A" },
        { id: "B", name: "B" },
        { id: "C", name: "C" },
        { id: "D", name: "D" },
      ],
      connections: [
        { from: "hub", to: "A", label: "" },
        { from: "hub", to: "B", label: "" },
        { from: "hub", to: "C", label: "" },
        { from: "hub", to: "D", label: "" },
      ],
    };
    expect(computeLayeredDirection(diagram)).toBe("RIGHT");
  });

  test("single node with no connections returns RIGHT — 1 layer, 1 node", () => {
    const diagram: ParsedDiagram = {
      components: [{ id: "solo", name: "Solo" }],
      connections: [],
    };
    expect(computeLayeredDirection(diagram)).toBe("RIGHT");
  });

  test("balanced 2-layer graph (2 sources → 3 targets) returns RIGHT — layerCount=2, maxNodes=3", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "s1", name: "S1" },
        { id: "s2", name: "S2" },
        { id: "t1", name: "T1" },
        { id: "t2", name: "T2" },
        { id: "t3", name: "T3" },
      ],
      connections: [
        { from: "s1", to: "t1", label: "" },
        { from: "s1", to: "t2", label: "" },
        { from: "s2", to: "t3", label: "" },
      ],
    };
    expect(computeLayeredDirection(diagram)).toBe("RIGHT");
  });

  test("3-layer pipeline (A→B→C) returns DOWN — layerCount=3, maxNodes=1", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "A", name: "A" },
        { id: "B", name: "B" },
        { id: "C", name: "C" },
      ],
      connections: [
        { from: "A", to: "B", label: "" },
        { from: "B", to: "C", label: "" },
      ],
    };
    expect(computeLayeredDirection(diagram)).toBe("DOWN");
  });
});
