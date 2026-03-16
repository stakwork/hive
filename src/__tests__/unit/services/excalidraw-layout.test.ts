import { describe, test, expect } from "vitest";
import {
  sanitiseDiagram,
  measureTextWidth,
  computeComponentSize,
  computeWordWrapLineCount,
  computeLayeredDirection,
  relayoutDiagram,
  extractParsedDiagram,
  FONT_SIZE,
  LINE_HEIGHT,
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
    const lines = computeWordWrapLineCount(
      "Async Distributed Background Job Worker Queue Processing Service Node Manager Controller Orchestrator",
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
    const name = "Async Distributed Background Job Worker Queue Processing Service Node Manager Controller Orchestrator";
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

// Helper: build a minimal diagram with a single component and run relayoutDiagram.
// Returns the bound text element (type === 'text' with containerId set).
async function getBoundTextElement(name: string) {
  const diagram: ParsedDiagram = {
    components: [{ id: "c1", name }],
    connections: [],
  };
  const result = await relayoutDiagram(diagram);
  const textEl = result.elements.find(
    (el) => el.type === "text" && (el as Record<string, unknown>).containerId != null
  ) as Record<string, unknown> | undefined;
  return textEl;
}

describe("AI element tagging (customData.source === 'ai')", () => {
  test("all elements from a single component carry customData.source === 'ai'", async () => {
    const diagram: ParsedDiagram = {
      components: [{ id: "c1", name: "Service A", type: "service" }],
      connections: [],
    };
    const result = await relayoutDiagram(diagram);
    expect(result.elements.length).toBeGreaterThan(0);
    for (const el of result.elements) {
      expect((el as Record<string, unknown>).customData).toEqual({ source: "ai" });
    }
  });

  test("arrow and label elements from connections carry customData.source === 'ai'", async () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "c1", name: "Client", type: "client" },
        { id: "c2", name: "Service", type: "service" },
      ],
      connections: [{ from: "c1", to: "c2", label: "REST" }],
    };
    const result = await relayoutDiagram(diagram);
    expect(result.elements.length).toBeGreaterThan(0);
    for (const el of result.elements) {
      expect((el as Record<string, unknown>).customData).toEqual({ source: "ai" });
    }
  });

  test("diamond shape component elements carry customData.source === 'ai'", async () => {
    const diagram: ParsedDiagram = {
      components: [{ id: "d1", name: "Decision", type: "gateway", shape: "diamond" }],
      connections: [],
    };
    const result = await relayoutDiagram(diagram);
    expect(result.elements.length).toBeGreaterThan(0);
    for (const el of result.elements) {
      expect((el as Record<string, unknown>).customData).toEqual({ source: "ai" });
    }
  });
});

describe("createComponentElement text height", () => {
  test("short label (API) produces text element with height === SINGLE_LINE_HEIGHT", async () => {
    const textEl = await getBoundTextElement("API");
    expect(textEl).toBeDefined();
    expect(textEl!.height).toBe(SINGLE_LINE_HEIGHT);
    expect(SINGLE_LINE_HEIGHT).toBe(Math.ceil(FONT_SIZE * LINE_HEIGHT));
  });

  test("multi-word label that fits as single-line container stays single-line in text element", async () => {
    // 'User Auth Service' fits within MAX_SINGLE_LINE_WIDTH (container is narrow).
    // textAreaWidth = containerWidth - 10 >= full textWidth, so no wrapping occurs.
    const name = "User Auth Service";
    const textW = measureTextWidth(name, FONT_SIZE);
    // Confirm it's a narrow container (would have triggered the old lineCount=1 short-circuit)
    expect(textW + PADDING_H).toBeLessThan(MAX_SINGLE_LINE_WIDTH);

    const textEl = await getBoundTextElement(name);
    expect(textEl).toBeDefined();
    // lineCount must be 1 — textAreaWidth is always wider than the label in this branch
    const expectedLineCount = computeWordWrapLineCount(name, Math.max(MIN_WIDTH, textW + PADDING_H) - 10);
    expect(expectedLineCount).toBe(1);
    expect(textEl!.height).toBe(SINGLE_LINE_HEIGHT);
  });

  test("long label (wide container) produces text element taller than SINGLE_LINE_HEIGHT", async () => {
    // This label exceeds MAX_SINGLE_LINE_WIDTH when padded, so containerWidth = MAX_SINGLE_LINE_WIDTH.
    // The old code also handled this correctly; verify the fix preserves that behaviour.
    const name = "Async Distributed Background Job Worker Queue Processing Service";
    const textW = measureTextWidth(name, FONT_SIZE);
    expect(textW + PADDING_H).toBeGreaterThan(MAX_SINGLE_LINE_WIDTH);

    const textAreaWidth = MAX_SINGLE_LINE_WIDTH - 10; // containerWidth - BOUND_TEXT_PADDING*2
    const lineCount = computeWordWrapLineCount(name, textAreaWidth);
    expect(lineCount).toBeGreaterThanOrEqual(2);

    const textEl = await getBoundTextElement(name);
    expect(textEl).toBeDefined();
    expect(textEl!.height).toBeGreaterThan(SINGLE_LINE_HEIGHT);
    expect(textEl!.height).toBeGreaterThanOrEqual(Math.ceil(2 * FONT_SIZE * LINE_HEIGHT));
  });
});

// ---------------------------------------------------------------------------
// Layer support tests
// ---------------------------------------------------------------------------

describe("sanitiseDiagram — layer support", () => {
  test("passes layers through unchanged when all layerNames are declared", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "c1", name: "React App", type: "client", layerName: "Frontend" },
        { id: "c2", name: "API Server", type: "service", layerName: "Backend" },
      ],
      connections: [{ from: "c1", to: "c2", label: "REST" }],
      layers: [
        { id: "l1", name: "Frontend", order: 0 },
        { id: "l2", name: "Backend", order: 1 },
      ],
    };

    const result = sanitiseDiagram(diagram);

    expect(result.layers).toHaveLength(2);
    expect(result.layers![0].name).toBe("Frontend");
    expect(result.layers![1].name).toBe("Backend");
  });

  test("auto-registers an undeclared layerName into layers[]", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "c1", name: "React App", type: "client", layerName: "Frontend" },
        { id: "c2", name: "Postgres", type: "database", layerName: "Data" }, // not in layers
      ],
      connections: [],
      layers: [
        { id: "l1", name: "Frontend", order: 0 },
      ],
    };

    const result = sanitiseDiagram(diagram);

    expect(result.layers).toBeDefined();
    const names = result.layers!.map((l) => l.name);
    expect(names).toContain("Frontend");
    expect(names).toContain("Data");
  });

  test("builds layers[] from first-appearance order when diagram.layers is absent", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "c1", name: "React App", type: "client", layerName: "Frontend" },
        { id: "c2", name: "API Server", type: "service", layerName: "Backend" },
        { id: "c3", name: "Postgres", type: "database", layerName: "Frontend" }, // duplicate layer
      ],
      connections: [],
    };

    const result = sanitiseDiagram(diagram);

    expect(result.layers).toBeDefined();
    // Only 2 distinct names, in first-appearance order
    expect(result.layers!.map((l) => l.name)).toEqual(["Frontend", "Backend"]);
  });

  test("returns no layers when no component carries a layerName", () => {
    const diagram: ParsedDiagram = {
      components: [
        { id: "c1", name: "Service A", type: "service" },
        { id: "c2", name: "Service B", type: "service" },
      ],
      connections: [],
    };

    const result = sanitiseDiagram(diagram);

    expect(result.layers).toBeUndefined();
  });
});

describe("relayoutDiagram — layered (frame) mode", () => {
  const twoLayerDiagram: ParsedDiagram = {
    components: [
      { id: "c1", name: "React App", type: "client", layerName: "Frontend" },
      { id: "c2", name: "API Server", type: "service", layerName: "Backend" },
      { id: "c3", name: "Worker", type: "worker", layerName: "Backend" },
    ],
    connections: [
      { from: "c1", to: "c2", label: "REST" },
      { from: "c2", to: "c3", label: "job" },
    ],
    layers: [
      { id: "l1", name: "Frontend", order: 0 },
      { id: "l2", name: "Backend", order: 1 },
    ],
  };

  test("produces exactly 2 frame elements with correct names", async () => {
    const result = await relayoutDiagram(twoLayerDiagram);
    const frames = result.elements.filter((el) => (el as Record<string, unknown>).type === "frame");
    expect(frames).toHaveLength(2);

    const frameNames = frames.map((f) => (f as Record<string, unknown>).name as string);
    expect(frameNames).toContain("Frontend");
    expect(frameNames).toContain("Backend");
  });

  test("frame children (shape + text) appear before their frame element in the array", async () => {
    const result = await relayoutDiagram(twoLayerDiagram);

    for (const frame of result.elements.filter((el) => (el as Record<string, unknown>).type === "frame")) {
      const frameId = (frame as Record<string, unknown>).id as string;
      const frameIndex = result.elements.indexOf(frame);

      // Every element that references this frameId must appear before it
      const children = result.elements.filter(
        (el) => (el as Record<string, unknown>).frameId === frameId
      );
      expect(children.length).toBeGreaterThan(0);
      for (const child of children) {
        const childIndex = result.elements.indexOf(child);
        expect(childIndex).toBeLessThan(frameIndex);
      }
    }
  });

  test("shape and text elements within a layer carry the correct frameId", async () => {
    const result = await relayoutDiagram(twoLayerDiagram);

    const frames = result.elements.filter((el) => (el as Record<string, unknown>).type === "frame");
    const frontendFrame = frames.find((f) => (f as Record<string, unknown>).name === "Frontend")!;
    const backendFrame = frames.find((f) => (f as Record<string, unknown>).name === "Backend")!;

    const frontendChildren = result.elements.filter(
      (el) => (el as Record<string, unknown>).frameId === (frontendFrame as Record<string, unknown>).id
    );
    const backendChildren = result.elements.filter(
      (el) => (el as Record<string, unknown>).frameId === (backendFrame as Record<string, unknown>).id
    );

    // Frontend has 1 component → 2 elements (shape + text)
    expect(frontendChildren).toHaveLength(2);
    // Backend has 2 components → 4 elements (2× shape + text)
    expect(backendChildren).toHaveLength(4);
  });

  test("connection arrows are emitted last (after all frame/component elements)", async () => {
    const result = await relayoutDiagram(twoLayerDiagram);

    const lastFrameIndex = result.elements.reduce((max, el, i) =>
      (el as Record<string, unknown>).type === "frame" ? i : max, -1
    );
    const firstArrowIndex = result.elements.findIndex(
      (el) => (el as Record<string, unknown>).type === "arrow"
    );

    expect(firstArrowIndex).toBeGreaterThan(lastFrameIndex);
  });

  test("no-layer diagram → flat layout with no frame elements (regression)", async () => {
    const flatDiagram: ParsedDiagram = {
      components: [
        { id: "c1", name: "Service A", type: "service" },
        { id: "c2", name: "Service B", type: "service" },
      ],
      connections: [{ from: "c1", to: "c2", label: "HTTP" }],
    };

    const result = await relayoutDiagram(flatDiagram);

    const frames = result.elements.filter((el) => (el as Record<string, unknown>).type === "frame");
    expect(frames).toHaveLength(0);

    // Should still have rectangle/text/arrow elements
    const shapes = result.elements.filter((el) => (el as Record<string, unknown>).type === "rectangle");
    expect(shapes).toHaveLength(2);
  });
});

describe("extractParsedDiagram — layer round-trip", () => {
  test("layerName round-trips correctly through relayoutDiagram → extractParsedDiagram", async () => {
    const original: ParsedDiagram = {
      components: [
        { id: "c1", name: "React App", type: "client", layerName: "Frontend" },
        { id: "c2", name: "API Server", type: "service", layerName: "Backend" },
      ],
      connections: [{ from: "c1", to: "c2", label: "REST" }],
      layers: [
        { id: "l1", name: "Frontend", order: 0 },
        { id: "l2", name: "Backend", order: 1 },
      ],
    };

    const layoutResult = await relayoutDiagram(original);
    const extracted = extractParsedDiagram(
      layoutResult.elements as unknown as Record<string, unknown>[]
    );

    expect(extracted).not.toBeNull();
    expect(extracted!.components).toHaveLength(2);

    const reactApp = extracted!.components.find((c) => c.name === "React App");
    const apiServer = extracted!.components.find((c) => c.name === "API Server");

    expect(reactApp?.layerName).toBe("Frontend");
    expect(apiServer?.layerName).toBe("Backend");
  });

  test("layers[] is populated from first-appearance order in extracted diagram", async () => {
    const original: ParsedDiagram = {
      components: [
        { id: "c1", name: "React App", type: "client", layerName: "Frontend" },
        { id: "c2", name: "API Server", type: "service", layerName: "Backend" },
      ],
      connections: [],
      layers: [
        { id: "l1", name: "Frontend", order: 0 },
        { id: "l2", name: "Backend", order: 1 },
      ],
    };

    const layoutResult = await relayoutDiagram(original);
    const extracted = extractParsedDiagram(
      layoutResult.elements as unknown as Record<string, unknown>[]
    );

    expect(extracted!.layers).toBeDefined();
    expect(extracted!.layers!.length).toBe(2);
    const names = extracted!.layers!.map((l) => l.name);
    expect(names).toContain("Frontend");
    expect(names).toContain("Backend");
  });

  test("no layers[] on extracted diagram when no frame elements present", async () => {
    const flatDiagram: ParsedDiagram = {
      components: [
        { id: "c1", name: "Service A", type: "service" },
      ],
      connections: [],
    };

    const layoutResult = await relayoutDiagram(flatDiagram);
    const extracted = extractParsedDiagram(
      layoutResult.elements as unknown as Record<string, unknown>[]
    );

    expect(extracted).not.toBeNull();
    expect(extracted!.layers).toBeUndefined();
    expect(extracted!.components[0].layerName).toBeUndefined();
  });
});
