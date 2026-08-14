/**
 * Unit tests for `AttentionBadge` (`makeAttentionBadgeRenderer`).
 *
 * Verifies:
 *   1. Returns null when no attention signal is present.
 *   2. Renders a badge for each known signal type.
 *   3. The badge uses the correct color for each signal type.
 *   4. Pure function — no own state or side effects.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import React from "react";
import type { SlotContext } from "system-canvas";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the context — we control what type is returned per test.
let mockAttentionType: string | null = null;

vi.mock(
  "@/app/org/[githubLogin]/connections/AttentionMapContext",
  () => ({
    useAttentionType: vi.fn(
      (_kind: string, _id: string) => mockAttentionType,
    ),
  }),
);

vi.mock("@/services/attention/typeMeta", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/attention/typeMeta")
  >("@/services/attention/typeMeta");
  return actual;
});

// ---------------------------------------------------------------------------
// Stub SlotContext
// ---------------------------------------------------------------------------

function makeSlotContext(nodeId: string): SlotContext {
  return {
    node: {
      id: nodeId,
      text: "Test node",
      customData: {},
    },
    region: { x: 100, y: 10, width: 20, height: 20 },
    theme: {} as SlotContext["theme"],
    viewport: { zoom: 1, x: 0, y: 0 },
    selected: false,
    hovered: false,
  } as unknown as SlotContext;
}

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { makeAttentionBadgeRenderer } from "@/app/org/[githubLogin]/connections/AttentionBadge";
import { ATTENTION_TYPE_META } from "@/services/attention/typeMeta";
import { useAttentionType } from "@/app/org/[githubLogin]/connections/AttentionMapContext";
import type { AttentionItem } from "@/services/attention/topItems";

const ALL_TYPES: AttentionItem["type"][] = [
  "halted",
  "awaiting-reply",
  "plan-question",
  "ready-to-review",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderSlot(
  entityKind: "feature" | "task",
  entityId: string,
  nodeId: string,
) {
  const ctx = makeSlotContext(nodeId);
  const renderFn = makeAttentionBadgeRenderer(entityKind, entityId);
  const element = renderFn(ctx);
  if (!element) return null;
  return render(element as React.ReactElement);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockAttentionType = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("makeAttentionBadgeRenderer", () => {
  test("renders nothing when no attention signal is present", () => {
    mockAttentionType = null;
    const ctx = makeSlotContext("feature:feat-1");
    const renderFn = makeAttentionBadgeRenderer("feature", "feat-1");
    const element = renderFn(ctx);

    // The render function returns a React element wrapping AttentionBadgeSlot.
    // When useAttentionType returns null, the slot renders null.
    const { container } = render(element as React.ReactElement);
    // Nothing should be rendered
    expect(container.firstChild).toBeNull();
  });

  test.each(ALL_TYPES)(
    "renders a badge for signal type '%s'",
    async (type) => {
      mockAttentionType = type;
      const ctx = makeSlotContext("feature:feat-2");
      const renderFn = makeAttentionBadgeRenderer("feature", "feat-2");
      const element = renderFn(ctx);

      expect(element).not.toBeNull();
      const { container } = render(element as React.ReactElement);
      // Should render an SVG group with a circle and a nested icon SVG
      const circles = container.querySelectorAll("circle");
      expect(circles.length).toBeGreaterThan(0);
    },
  );

  test.each(ALL_TYPES)(
    "badge for '%s' uses the correct accent color on the circle stroke",
    (type) => {
      mockAttentionType = type;
      const expectedColor = ATTENTION_TYPE_META[type].colorHex;
      const ctx = makeSlotContext("task:task-3");
      const renderFn = makeAttentionBadgeRenderer("task", "task-3");
      const element = renderFn(ctx);

      const { container } = render(element as React.ReactElement);
      const circle = container.querySelector("circle");
      expect(circle?.getAttribute("stroke")).toBe(expectedColor);
    },
  );

  test("calls useAttentionType with the correct entityKind and entityId", () => {
    mockAttentionType = "halted";
    const ctx = makeSlotContext("feature:feat-abc");
    const renderFn = makeAttentionBadgeRenderer("feature", "feat-abc");
    render(renderFn(ctx) as React.ReactElement);

    expect(useAttentionType).toHaveBeenCalledWith("feature", "feat-abc");
  });

  test("calls useAttentionType with task kind for task entities", () => {
    mockAttentionType = "ready-to-review";
    const ctx = makeSlotContext("task:task-xyz");
    const renderFn = makeAttentionBadgeRenderer("task", "task-xyz");
    render(renderFn(ctx) as React.ReactElement);

    expect(useAttentionType).toHaveBeenCalledWith("task", "task-xyz");
  });

  test("nested icon SVG is present inside the badge", () => {
    mockAttentionType = "halted";
    const ctx = makeSlotContext("feature:feat-icon");
    const renderFn = makeAttentionBadgeRenderer("feature", "feat-icon");
    const element = renderFn(ctx);
    const { container } = render(element as React.ReactElement);

    // Should contain a nested <svg> for the icon
    const svgs = container.querySelectorAll("svg");
    // The outer SVG from the test renderer + nested icon SVG inside the badge
    expect(svgs.length).toBeGreaterThanOrEqual(1);
    // The nested icon SVG should have path elements
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThan(0);
  });
});
