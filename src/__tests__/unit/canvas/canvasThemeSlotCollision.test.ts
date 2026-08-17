/**
 * Unit tests for canvas-theme slot placement — specifically asserting
 * that the attention badge and agent-count badge occupy distinct slots
 * on `featureCategory` and `taskCategory` so the two features
 * (PR #4982 and PR #4981) never collide.
 *
 * We import `connectionsTheme` directly (after mocking its heavy deps)
 * and inspect the `slots` record of each category — no rendering required.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import type { CategoryDefinition } from "system-canvas";

// ---------------------------------------------------------------------------
// Mock dependencies of canvas-theme.ts that would fail in a unit context
// ---------------------------------------------------------------------------

// AttentionBadge uses AttentionMapContext (React context) — mock the renderer
// factory so canvas-theme can import it without a provider.
vi.mock(
  "@/app/org/[githubLogin]/connections/AttentionBadge",
  () => ({
    makeAttentionBadgeRenderer:
      vi.fn(() => vi.fn(() => null)),
  }),
);

// AttentionMapContext provides useAttentionType — not needed for slot inspection.
vi.mock(
  "@/app/org/[githubLogin]/connections/AttentionMapContext",
  () => ({
    useAttentionType: vi.fn(() => null),
  }),
);

// canvas-categories imports nothing problematic, but mock to be safe.
vi.mock(
  "@/app/org/[githubLogin]/connections/canvas-categories",
  async () => {
    // Return a minimal registry with just the categories under test.
    const CATEGORY_REGISTRY = [
      { id: "workspace",  label: "Workspace",  agentWritable: false },
      { id: "repository", label: "Repository", agentWritable: false },
      { id: "service",    label: "Service",    agentWritable: false },
      { id: "initiative", label: "Initiative", agentWritable: false },
      { id: "milestone",  label: "Milestone",  agentWritable: false },
      { id: "feature",    label: "Feature",    agentWritable: false },
      { id: "task",       label: "Task",       agentWritable: false },
      { id: "note",       label: "Note",       agentWritable: true  },
      { id: "decision",   label: "Decision",   agentWritable: true  },
      { id: "research",   label: "Research",   agentWritable: false },
    ];
    return { CATEGORY_REGISTRY };
  },
);

// @/lib/platforms — provides brand icon data. Return empty maps.
vi.mock("@/lib/platforms", () => ({
  PLATFORM_BY_ID: {},
  PLATFORM_ICONS:  {},
  PLATFORMS:       [],
}));

// ---------------------------------------------------------------------------
// Load theme under test (after mocks are registered)
// ---------------------------------------------------------------------------

let featureDef: CategoryDefinition;
let taskDef: CategoryDefinition;

beforeAll(async () => {
  const { connectionsTheme } = await import(
    "@/app/org/[githubLogin]/connections/canvas-theme"
  );
  featureDef = connectionsTheme.categories["feature"] as CategoryDefinition;
  taskDef    = connectionsTheme.categories["task"]    as CategoryDefinition;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("canvas-theme slot placement — attention badge vs agent-count badge", () => {
  describe("featureCategory", () => {
    it("has a topLeft slot (attention badge position)", () => {
      expect(featureDef.slots).toBeDefined();
      expect(featureDef.slots!.topLeft).toBeDefined();
    });

    it("defines a topRightOuter slot (agent-count badge position)", () => {
      expect(featureDef.slots?.topRightOuter).toBeDefined();
    });

    it("topLeft slot is a custom renderer (attention badge)", () => {
      expect(featureDef.slots!.topLeft).toMatchObject({ kind: "custom" });
    });

    it("topLeft and topRightOuter are distinct slots — no collision", () => {
      const slots = featureDef.slots ?? {};
      const attentionSlot = slots.topLeft;
      const agentSlot     = slots.topRightOuter;
      expect(attentionSlot).not.toBe(agentSlot);
    });
  });

  describe("taskCategory", () => {
    it("has a topLeft slot (attention badge position)", () => {
      expect(taskDef.slots).toBeDefined();
      expect(taskDef.slots!.topLeft).toBeDefined();
    });

    it("does NOT define a topRightOuter slot (kept free for future parity with feature)", () => {
      expect(taskDef.slots?.topRightOuter).toBeUndefined();
    });

    it("topLeft slot is a custom renderer (attention badge)", () => {
      expect(taskDef.slots!.topLeft).toMatchObject({ kind: "custom" });
    });

    it("topLeft and topRightOuter are distinct slots — no collision", () => {
      const slots = taskDef.slots ?? {};
      const attentionSlot = slots.topLeft;
      const agentSlot     = slots.topRightOuter;
      expect(attentionSlot).not.toBe(agentSlot);
    });
  });
});
