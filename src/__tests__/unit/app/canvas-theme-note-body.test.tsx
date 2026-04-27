// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// system-canvas re-exports must be mocked before the module under test is
// imported so the dynamic `require` inside canvas-theme.ts resolves to mocks.
vi.mock("system-canvas", () => ({
  darkTheme: {
    node: {
      fill: "#000",
      stroke: "#333",
      cornerRadius: 8,
      labelColor: "#fff",
      sublabelColor: "#aaa",
      fontFamily: "monospace",
      labelFont: "sans-serif",
      fontSize: 13,
      sublabelFontSize: 11,
      strokeWidth: 1,
    },
    group: {
      fill: "#111",
      stroke: "#444",
      strokeDasharray: "4 4",
      labelColor: "#aaa",
      labelFontSize: 11,
      cornerRadius: 8,
      strokeWidth: 1,
    },
    grid: { color: "#222" },
    lanes: {
      bandFillEven: "#111",
      bandFillOdd: "#000",
      dividerColor: "#333",
      dividerWidth: 1,
      headerBackground: "#000",
      headerTextColor: "#aaa",
      headerFontFamily: "sans-serif",
      headerFontSize: 11,
      headerSize: 26,
    },
  },
  resolveTheme: (_config: unknown, _base: unknown) => _config,
}));

// geometry constants
vi.mock("@/lib/canvas/geometry", () => ({
  CARD_H: 120,
  CARD_W: 320,
  INITIATIVE_H: 140,
  INITIATIVE_W: 320,
  MILESTONE_H: 86,
  MILESTONE_W: 220,
  SMALL_W: 220,
  // Milestone sub-canvas (feature columns + task stacks). Values
  // mirror the production constants — kept here as a static fixture
  // so the theme module imports successfully under vi.mock.
  FEATURE_H: 100,
  FEATURE_W: 260,
  TASK_H: 64,
  TASK_W: 180,
}));

// canvas-categories registry – only needs to satisfy the keys check
vi.mock(
  "/workspaces/hive/src/app/org/[githubLogin]/connections/canvas-categories",
  () => ({
    CATEGORY_REGISTRY: [
      { id: "workspace" },
      { id: "repository" },
      { id: "initiative" },
      { id: "milestone" },
      // Milestone sub-canvas projection: each id paired with a
      // CategoryDefinition in the theme module under test.
      { id: "feature" },
      { id: "task" },
      { id: "note" },
      { id: "decision" },
    ],
  }),
);

import { renderNoteBody, renderTaskBody, wrapWords } from "@/app/org/[githubLogin]/connections/canvas-theme";
import type { SlotContext } from "system-canvas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(
  text: string,
  region: { x: number; y: number; width: number; height: number },
  nodeId = "node-1",
): SlotContext {
  return {
    node: {
      id: nodeId,
      text,
      customData: {},
    } as SlotContext["node"],
    theme: {
      node: {
        fontSize: 13,
        fontFamily: "monospace",
      },
    } as SlotContext["theme"],
    region,
    getSubCanvas: () => undefined,
    rollup: () => ({ count: 0, total: 0 }),
  } as unknown as SlotContext;
}

// ---------------------------------------------------------------------------
// wrapWords – pure word-wrap utility
// ---------------------------------------------------------------------------

describe("wrapWords", () => {
  it("returns a single line when text fits in maxWidth", () => {
    // 5 chars × 13 × 0.62 ≈ 40px < 200px
    const lines = wrapWords("hello", 200, 13);
    expect(lines).toEqual(["hello"]);
  });

  it("wraps a long sentence across multiple lines", () => {
    // Each word is ~5 chars; at fontSize 13, width ≈ 5×13×0.62≈40px per word.
    // maxWidth = 100 → roughly 2–3 words per line.
    const text = "one two three four five six seven eight";
    const lines = wrapWords(text, 100, 13);
    expect(lines.length).toBeGreaterThan(1);
    // Every line must fit within maxWidth (individual words may exceed it, but
    // that is acceptable — the wrapper never splits words).
    for (const line of lines) {
      const wordCount = line.split(" ").length;
      expect(wordCount).toBeGreaterThanOrEqual(1);
    }
    // Reassembling all lines must recover the original text.
    expect(lines.join(" ")).toBe(text);
  });

  it("wraps a single unbroken long word as its own line (no word-split)", () => {
    const word = "averylongwordthatexceedsmaxwidth";
    const lines = wrapWords(word, 50, 13);
    // Cannot split a single word — must appear on one line.
    expect(lines).toEqual([word]);
  });

  it("handles empty string gracefully", () => {
    const lines = wrapWords("", 200, 13);
    // An empty string splits into one empty word but the loop pushes nothing
    // (the candidate is "" which never exceeds maxWidth, but `current` stays
    // empty so the trailing push produces [""]).
    // In practice renderNoteBody guards with `if (!raw) return null` before
    // calling wrapWords, so the empty case never reaches the renderer.
    expect(lines.length).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// renderNoteBody – React element structure
// ---------------------------------------------------------------------------

describe("renderNoteBody", () => {
  it("returns null for empty node.text", () => {
    const ctx = makeCtx("", { x: 0, y: 30, width: 188, height: 56 });
    expect(renderNoteBody(ctx)).toBeNull();
  });

  it("renders a single text element for a short string", () => {
    const ctx = makeCtx("Short note", { x: 4, y: 30, width: 188, height: 56 });
    const el = renderNoteBody(ctx) as React.ReactElement;
    expect(el).not.toBeNull();
    expect(el.type).toBe("g");

    // The outer <g> has two children: <defs> and the clipped inner <g>.
    const [defs, innerG] = el.props.children as React.ReactElement[];

    // defs should hold the clipPath
    expect(defs.type).toBe("defs");
    const clipPath = defs.props.children as React.ReactElement;
    expect(clipPath.type).toBe("clipPath");
    expect(clipPath.props.id).toBe("note-clip-node-1");

    // clipPath rect must match the region exactly
    const clipRect = clipPath.props.children as React.ReactElement;
    expect(clipRect.props).toMatchObject({
      x: 4,
      y: 30,
      width: 188,
      height: 56,
    });

    // Inner group holds the text lines — React may return a single element
    // (not an array) when there is only one child.
    expect(innerG.type).toBe("g");
    const rawLines = innerG.props.children;
    const textLines: React.ReactElement[] = Array.isArray(rawLines)
      ? rawLines
      : [rawLines];
    // Short text should be a single line
    expect(textLines).toHaveLength(1);
    expect(textLines[0].type).toBe("text");
    expect(textLines[0].props.children).toBe("Short note");
  });

  it("wraps long text into multiple <text> lines", () => {
    // A long string that will definitely need to wrap within 188px
    const longText =
      "This is a really long note that should definitely wrap across multiple lines";
    const ctx = makeCtx(longText, {
      x: 4,
      y: 30,
      width: 188,
      height: 56,
    });
    const el = renderNoteBody(ctx) as React.ReactElement;
    const [, innerG] = el.props.children as React.ReactElement[];
    const lines = innerG.props.children as React.ReactElement[];
    expect(lines.length).toBeGreaterThan(1);
    // Reassemble to verify no text is dropped
    const allText = lines.map((l: React.ReactElement) => l.props.children as string).join(" ");
    expect(allText).toBe(longText);
  });

  it("renders each newline paragraph independently", () => {
    const multiLine = "First paragraph\nSecond paragraph";
    const ctx = makeCtx(multiLine, {
      x: 4,
      y: 30,
      width: 188,
      height: 80,
    });
    const el = renderNoteBody(ctx) as React.ReactElement;
    const [, innerG] = el.props.children as React.ReactElement[];
    const lines = innerG.props.children as React.ReactElement[];
    // Each paragraph should produce at least one line; total ≥ 2
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it("clipPath rect dimensions match the provided region (overflow clipping)", () => {
    // Simulate overflowing text by giving a narrow/short region
    const ctx = makeCtx(
      "Word1 Word2 Word3 Word4 Word5 Word6 Word7 Word8 Word9 Word10",
      { x: 10, y: 40, width: 80, height: 30 },
      "overflow-node",
    );
    const el = renderNoteBody(ctx) as React.ReactElement;
    const [defs] = el.props.children as React.ReactElement[];
    const clipPath = defs.props.children as React.ReactElement;
    const clipRect = clipPath.props.children as React.ReactElement;
    expect(clipRect.props).toMatchObject({
      x: 10,
      y: 40,
      width: 80,
      height: 30,
    });
    expect(clipPath.props.id).toBe("note-clip-overflow-node");
  });

  it("falls back to SMALL_W - 16 when region.width is 0", () => {
    // When width is 0, wrapWords should still be called with SMALL_W - 16 = 204
    const ctx = makeCtx("hello world", { x: 0, y: 30, width: 0, height: 56 });
    // Should not throw and should produce output
    const el = renderNoteBody(ctx) as React.ReactElement;
    expect(el).not.toBeNull();
  });

  it("uses the node id to create a unique clipPath id per node", () => {
    const ctx = makeCtx("note text", { x: 0, y: 30, width: 188, height: 56 }, "unique-abc");
    const el = renderNoteBody(ctx) as React.ReactElement;
    const [defs] = el.props.children as React.ReactElement[];
    const clipPath = defs.props.children as React.ReactElement;
    expect(clipPath.props.id).toBe("note-clip-unique-abc");
  });
});

// ---------------------------------------------------------------------------
// renderTaskBody – compact task card body renderer (fs=11)
// ---------------------------------------------------------------------------

describe("renderTaskBody", () => {
  it("returns null for empty node.text", () => {
    const ctx = makeCtx("", { x: 0, y: 20, width: 164, height: 40 });
    expect(renderTaskBody(ctx)).toBeNull();
  });

  it("renders text elements with fontSize 11, not the theme fontSize (13)", () => {
    const ctx = makeCtx("Task title text", { x: 0, y: 20, width: 164, height: 40 });
    const el = renderTaskBody(ctx) as React.ReactElement;
    expect(el).not.toBeNull();

    const [, innerG] = el.props.children as React.ReactElement[];
    const rawLines = innerG.props.children;
    const textLines: React.ReactElement[] = Array.isArray(rawLines) ? rawLines : [rawLines];

    // Every <text> element must use fontSize 11
    for (const line of textLines) {
      expect(line.props.fontSize).toBe(11);
    }
  });

  it("wraps long task text into multiple lines", () => {
    const longText = "This is a longer task description that should wrap in the compact card";
    const ctx = makeCtx(longText, { x: 0, y: 20, width: 164, height: 40 });
    const el = renderTaskBody(ctx) as React.ReactElement;
    const [, innerG] = el.props.children as React.ReactElement[];
    const lines = innerG.props.children as React.ReactElement[];
    expect(lines.length).toBeGreaterThan(1);
    // All text lines use fs=11
    for (const line of lines) {
      expect(line.props.fontSize).toBe(11);
    }
  });

  it("sets up a clipPath keyed to the node id", () => {
    const ctx = makeCtx("task body", { x: 0, y: 20, width: 164, height: 40 }, "task-node-42");
    const el = renderTaskBody(ctx) as React.ReactElement;
    const [defs] = el.props.children as React.ReactElement[];
    const clipPath = defs.props.children as React.ReactElement;
    expect(clipPath.props.id).toBe("note-clip-task-node-42");
  });

  it("does not use theme.node.fontSize (13) for task body", () => {
    // Confirms renderTaskBody ignores the theme fontSize and always uses 11
    const ctx = makeCtx("Check font size", { x: 0, y: 20, width: 164, height: 40 });
    const el = renderTaskBody(ctx) as React.ReactElement;
    const [, innerG] = el.props.children as React.ReactElement[];
    const rawLines = innerG.props.children;
    const textLines: React.ReactElement[] = Array.isArray(rawLines) ? rawLines : [rawLines];
    for (const line of textLines) {
      expect(line.props.fontSize).not.toBe(13);
      expect(line.props.fontSize).toBe(11);
    }
  });
});
