/**
 * Unit tests for `useLiveNowItems` (`buildLiveNowRows` pure builder +
 * memoized hook) — the merge/rank/dedupe layer behind the org-canvas
 * "Live Now" panel.
 *
 * Covered:
 *   - Type ordering (ATTENTION_TYPE_ORDER) + age-descending tiebreak.
 *   - Group split: "Needs you" (attention rows) before "Running".
 *   - Running filter: idle features in `liveByFeatureId` produce no row.
 *   - Running label pluralization + planner label.
 *   - Dedupe by target node preserving the concurrent running indicator.
 *   - 12-row cap + "+N more" overflow count.
 *   - Empty input → empty output.
 *   - FK ref resolution: feature → `initiative:<id>`; initiative-anchored
 *     task → parent `feature:<id>` node; loose feature/task →
 *     `fallbackOnly` with link populated; task with no featureId →
 *     `fallbackOnly`. No attention item is ever silently dropped.
 *   - Hook memoization identity (recompute only when inputs change).
 */
import { describe, test, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AttentionItem } from "@/services/attention/topItems";
import type { FeatureLiveOverlay } from "@/app/org/[githubLogin]/connections/useFeatureLiveState";
import {
  buildLiveNowRows,
  useLiveNowItems,
  formatRunningLabel,
  isRunningOverlayActive,
  liveNowGroupOf,
  LIVE_NOW_MAX_ROWS,
} from "@/app/org/[githubLogin]/connections/useLiveNowItems";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

let idCounter = 0;

function makeItem(overrides: Partial<AttentionItem> & { type: AttentionItem["type"] }): AttentionItem {
  idCounter += 1;
  const entityId = overrides.entityId ?? `e${idCounter}`;
  const entityKind = overrides.entityKind ?? "task";
  return {
    id: `${overrides.type}:${entityKind}:${entityId}`,
    type: overrides.type,
    title: overrides.title ?? `Item ${idCounter}`,
    workspaceSlug: overrides.workspaceSlug ?? "ws-alpha",
    workspaceName: overrides.workspaceName ?? "Alpha WS",
    entityKind,
    entityId,
    link: overrides.link ?? `/w/ws-alpha/${entityKind}/${entityId}`,
    ageMs: overrides.ageMs ?? 5000,
    workspaceId: overrides.workspaceId ?? "ws-1",
    initiativeId: overrides.initiativeId,
    milestoneId: overrides.milestoneId,
    featureId: overrides.featureId,
    priority: overrides.priority,
    workflowStatus: overrides.workflowStatus,
  };
}

const overlay = (plannerRunning: boolean, agentsRunningCount: number): FeatureLiveOverlay => ({
  plannerRunning,
  agentsRunningCount,
});

// ---------------------------------------------------------------------------
// buildLiveNowRows — ordering within "Needs you"
// ---------------------------------------------------------------------------

describe("buildLiveNowRows — Needs-you ordering", () => {
  test("sorts by ATTENTION_TYPE_ORDER: halted before awaiting-reply before plan-question before ready-to-review", () => {
    const rows = buildLiveNowRows({
      items: [
        makeItem({ type: "ready-to-review" }),
        makeItem({ type: "plan-question" }),
        makeItem({ type: "awaiting-reply", entityKind: "feature" }),
        makeItem({ type: "halted" }),
      ],
      liveByFeatureId: new Map(),
    }).rows;

    expect(rows.map((r) => r.label)).toEqual(["Halted", "Awaiting your reply", "Question waiting", "Ready to review"]);
  });

  test("ageMs descending is the tiebreak within a type bucket (oldest first)", () => {
    const rows = buildLiveNowRows({
      items: [
        makeItem({ type: "halted", title: "young", ageMs: 1_000 }),
        makeItem({ type: "halted", title: "oldest", ageMs: 90_000 }),
        makeItem({ type: "halted", title: "middle", ageMs: 30_000 }),
      ],
      liveByFeatureId: new Map(),
    }).rows;

    expect(rows.map((r) => r.title)).toEqual(["oldest", "middle", "young"]);
  });

  test("rows carry order as a 0-based rank and the ATTENTION_TYPE_META label/color/icon", () => {
    const rows = buildLiveNowRows({
      items: [makeItem({ type: "halted" }), makeItem({ type: "ready-to-review" })],
      liveByFeatureId: new Map(),
    }).rows;

    expect(rows.map((r) => r.order)).toEqual([0, 1]);
    expect(rows[0].colorHex).toBe("#f59e0b");
    expect(rows[0].iconName).toBe("alert-triangle");
    expect(rows[1].colorHex).toBe("#10b981");
    expect(rows[1].iconName).toBe("check-circle-2");
  });
});

// ---------------------------------------------------------------------------
// Group split
// ---------------------------------------------------------------------------

describe("buildLiveNowRows — group split", () => {
  test("attention rows come before running rows", () => {
    const rows = buildLiveNowRows({
      items: [makeItem({ type: "halted" })],
      liveByFeatureId: new Map([
        ["f-planner", overlay(true, 0)],
        ["f-agents", overlay(false, 2)],
      ]),
      featureTitles: new Map([
        ["f-planner", "Planner Feature"],
        ["f-agents", "Agents Feature"],
      ]),
    }).rows;

    expect(rows).toHaveLength(3);
    expect(rows.map(liveNowGroupOf)).toEqual(["needs-you", "running", "running"]);
    // All attention rows precede all running rows.
    const firstRunning = rows.findIndex((r) => liveNowGroupOf(r) === "running");
    expect(rows.slice(0, firstRunning).every((r) => liveNowGroupOf(r) === "needs-you")).toBe(true);
  });

  test("liveNowGroupOf discriminates via iconName (attention rows have glyphs, running rows do not)", () => {
    const rows = buildLiveNowRows({
      items: [],
      liveByFeatureId: new Map([["f1", overlay(true, 0)]]),
      featureTitles: new Map([["f1", "F1"]]),
    }).rows;

    expect(rows[0].iconName).toBeNull();
    expect(liveNowGroupOf(rows[0])).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// Running rows
// ---------------------------------------------------------------------------

describe("buildLiveNowRows — running rows", () => {
  test("an idle feature in liveByFeatureId produces NO row (required filter)", () => {
    const result = buildLiveNowRows({
      items: [],
      liveByFeatureId: new Map([
        ["f-idle", overlay(false, 0)],
        ["f-also-idle", overlay(false, 0)],
      ]),
      featureTitles: new Map([
        ["f-idle", "Idle"],
        ["f-also-idle", "Also Idle"],
      ]),
    });

    expect(result.rows).toEqual([]);
    expect(result.overflowCount).toBe(0);
  });

  test("planner-running and agent-running features both produce rows; planner sorts first", () => {
    const rows = buildLiveNowRows({
      items: [],
      liveByFeatureId: new Map([
        ["f-agents", overlay(false, 3)],
        ["f-planner", overlay(true, 0)],
      ]),
      featureTitles: new Map([
        ["f-agents", "Agents"],
        ["f-planner", "Planner"],
      ]),
    }).rows;

    expect(rows).toHaveLength(2);
    expect(rows[0].nodeId).toBe("feature:f-planner");
    expect(rows[0].label).toBe("Planner working");
    expect(rows[1].nodeId).toBe("feature:f-agents");
    expect(rows[1].label).toBe("3 agents running");
  });

  test("running rows sort alphabetically by title within the same planner/agent class", () => {
    const rows = buildLiveNowRows({
      items: [],
      liveByFeatureId: new Map([
        ["f-b", overlay(false, 1)],
        ["f-a", overlay(false, 1)],
        ["f-c", overlay(false, 1)],
      ]),
      featureTitles: new Map([
        ["f-b", "Banana"],
        ["f-a", "Apple"],
        ["f-c", "Cherry"],
      ]),
    }).rows;

    expect(rows.map((r) => r.title)).toEqual(["Apple", "Banana", "Cherry"]);
  });

  test("isRunningOverlayActive gates the plannerRunning || agentsRunningCount > 0 rule", () => {
    expect(isRunningOverlayActive(overlay(true, 0))).toBe(true);
    expect(isRunningOverlayActive(overlay(false, 1))).toBe(true);
    expect(isRunningOverlayActive(overlay(true, 2))).toBe(true);
    expect(isRunningOverlayActive(overlay(false, 0))).toBe(false);
    expect(isRunningOverlayActive(undefined)).toBe(false);
  });
});

describe("formatRunningLabel", () => {
  test("planner only", () => {
    expect(formatRunningLabel(overlay(true, 0))).toBe("Planner working");
  });

  test("singular agent", () => {
    expect(formatRunningLabel(overlay(false, 1))).toBe("1 agent running");
  });

  test("plural agents", () => {
    expect(formatRunningLabel(overlay(false, 4))).toBe("4 agents running");
  });

  test("planner + agents joins both signals", () => {
    expect(formatRunningLabel(overlay(true, 2))).toBe("Planner working · 2 agents running");
  });
});

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------

describe("buildLiveNowRows — dedupe by target node", () => {
  test("a halted feature that is also running agents yields ONE row: attention owns label/color/icon, running preserved as secondary indicator", () => {
    const haltedFeature = makeItem({
      type: "halted",
      entityKind: "feature",
      entityId: "f-halted",
      initiativeId: "init-1",
    });

    const result = buildLiveNowRows({
      items: [haltedFeature],
      liveByFeatureId: new Map([["f-halted", overlay(false, 2)]]),
    });

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.nodeId).toBe("feature:f-halted");
    expect(row.label).toBe("Halted");
    expect(row.iconName).toBe("alert-triangle");
    expect(row.colorHex).toBe("#f59e0b");
    expect(row.running).toEqual({ plannerRunning: false, agentsRunningCount: 2 });
  });

  test("two attention items resolving to the same feature node (halted feature + plan-question task) collapse to one row, highest-ranked item wins", () => {
    const haltedFeature = makeItem({
      type: "halted",
      entityKind: "feature",
      entityId: "f-shared",
      initiativeId: "init-1",
      title: "Halted feature title",
    });
    const taskOnSameFeature = makeItem({
      type: "plan-question",
      entityKind: "task",
      entityId: "task-1",
      featureId: "f-shared",
      initiativeId: "init-1",
      title: "Task title",
    });

    const result = buildLiveNowRows({
      items: [taskOnSameFeature, haltedFeature],
      liveByFeatureId: new Map(),
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].nodeId).toBe("feature:f-shared");
    // halted (order 0) outranks plan-question (order 2).
    expect(result.rows[0].label).toBe("Halted");
    expect(result.rows[0].title).toBe("Halted feature title");
  });

  test("a running-only feature does not get a second row when an attention row already covers the node — but stays when the node differs", () => {
    const rows = buildLiveNowRows({
      items: [makeItem({ type: "halted", entityKind: "feature", entityId: "f-covered", initiativeId: "init-1" })],
      liveByFeatureId: new Map([
        ["f-covered", overlay(true, 0)],
        ["f-other", overlay(false, 1)],
      ]),
      featureTitles: new Map([["f-other", "Other"]]),
    }).rows;

    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.nodeId === "feature:f-covered")).toHaveLength(1);
    expect(rows.find((r) => r.nodeId === "feature:f-other")?.running).toEqual({
      plannerRunning: false,
      agentsRunningCount: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Cap + overflow
// ---------------------------------------------------------------------------

describe("buildLiveNowRows — cap and overflow", () => {
  test("caps at 12 rows and reports the overflow count", () => {
    const items: AttentionItem[] = [];
    for (let i = 0; i < 15; i += 1) {
      items.push(
        makeItem({
          type: "halted",
          entityKind: "feature",
          entityId: `f-${i}`,
          initiativeId: `init-${i}`,
          ageMs: i, // distinct ages for deterministic order
        }),
      );
    }

    const result = buildLiveNowRows({ items, liveByFeatureId: new Map() });

    expect(result.rows).toHaveLength(LIVE_NOW_MAX_ROWS);
    expect(result.overflowCount).toBe(3);
    // Oldest first within the bucket.
    expect(result.rows[0].title).toBe(items[14].title);
    expect(result.rows.map((r) => r.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  test("cap applies after grouping/sorting — running rows are cut first when attention rows fill the cap", () => {
    const items: AttentionItem[] = [];
    for (let i = 0; i < LIVE_NOW_MAX_ROWS; i += 1) {
      items.push(
        makeItem({
          type: "halted",
          entityKind: "feature",
          entityId: `f-${i}`,
          initiativeId: `init-${i}`,
          ageMs: i,
        }),
      );
    }

    const result = buildLiveNowRows({
      items,
      liveByFeatureId: new Map([["f-runner", overlay(true, 0)]]),
      featureTitles: new Map([["f-runner", "Runner"]]),
    });

    expect(result.rows).toHaveLength(LIVE_NOW_MAX_ROWS);
    expect(result.overflowCount).toBe(1);
    expect(result.rows.every((r) => liveNowGroupOf(r) === "needs-you")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

describe("buildLiveNowRows — empty input", () => {
  test("no items and no live features → empty rows, zero overflow", () => {
    expect(buildLiveNowRows({ items: [], liveByFeatureId: new Map() })).toEqual({
      rows: [],
      overflowCount: 0,
    });
  });

  test("only idle live features → empty rows, zero overflow", () => {
    expect(
      buildLiveNowRows({
        items: [],
        liveByFeatureId: new Map([["f", overlay(false, 0)]]),
      }),
    ).toEqual({ rows: [], overflowCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// FK ref resolution
// ---------------------------------------------------------------------------

describe("buildLiveNowRows — FK ref resolution (no node index)", () => {
  test("feature item anchored to an initiative → feature:<id> node on initiative:<id>, focusable", () => {
    const rows = buildLiveNowRows({
      items: [
        makeItem({
          type: "halted",
          entityKind: "feature",
          entityId: "feat-1",
          workspaceId: "ws-1",
          initiativeId: "init-9",
        }),
      ],
      liveByFeatureId: new Map(),
    }).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0].nodeId).toBe("feature:feat-1");
    expect(rows[0].canvasRef).toBe("initiative:init-9");
    expect(rows[0].fallbackOnly).toBe(false);
    expect(rows[0].link).toBe("/w/ws-alpha/feature/feat-1");
  });

  test("initiative-anchored task → parent feature:<featureId> node on initiative:<initiativeId>", () => {
    const rows = buildLiveNowRows({
      items: [
        makeItem({
          type: "plan-question",
          entityKind: "task",
          entityId: "task-7",
          workspaceId: "ws-1",
          featureId: "feat-7",
          initiativeId: "init-7",
        }),
      ],
      liveByFeatureId: new Map(),
    }).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0].nodeId).toBe("feature:feat-7");
    expect(rows[0].canvasRef).toBe("initiative:init-7");
    expect(rows[0].fallbackOnly).toBe(false);
  });

  test("loose feature (no initiative) → ws: ref, fallbackOnly with link populated — row is KEPT", () => {
    const rows = buildLiveNowRows({
      items: [
        makeItem({
          type: "ready-to-review",
          entityKind: "feature",
          entityId: "feat-loose",
          workspaceId: "ws-1",
          initiativeId: null,
          link: "/w/ws-alpha/plan/feat-loose",
        }),
      ],
      liveByFeatureId: new Map(),
    }).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0].nodeId).toBe("feature:feat-loose");
    expect(rows[0].canvasRef).toBe("ws:ws-1");
    expect(rows[0].fallbackOnly).toBe(true);
    expect(rows[0].link).toBe("/w/ws-alpha/plan/feat-loose");
  });

  test("task on a loose feature (featureId set, no initiative) → parent feature node, ws: ref, fallbackOnly, link kept", () => {
    const rows = buildLiveNowRows({
      items: [
        makeItem({
          type: "halted",
          entityKind: "task",
          entityId: "task-loose",
          workspaceId: "ws-1",
          featureId: "feat-loose-parent",
          initiativeId: null,
          link: "/w/ws-alpha/task/task-loose",
        }),
      ],
      liveByFeatureId: new Map(),
    }).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0].nodeId).toBe("feature:feat-loose-parent");
    expect(rows[0].canvasRef).toBe("ws:ws-1");
    expect(rows[0].fallbackOnly).toBe(true);
    expect(rows[0].link).toBe("/w/ws-alpha/task/task-loose");
  });

  test("task with no featureId → fallbackOnly link-only row (nodeId and canvasRef empty), never dropped", () => {
    const orphan = makeItem({
      type: "halted",
      entityKind: "task",
      entityId: "orphan-task",
      workspaceId: "ws-1",
      featureId: null,
      initiativeId: null,
      link: "/w/ws-alpha/task/orphan-task",
    });
    const rows = buildLiveNowRows({
      items: [orphan],
      liveByFeatureId: new Map(),
    }).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0].nodeId).toBe("");
    expect(rows[0].canvasRef).toBe("");
    expect(rows[0].fallbackOnly).toBe(true);
    expect(rows[0].link).toBe("/w/ws-alpha/task/orphan-task");
    expect(rows[0].title).toBe(orphan.title);
  });

  test("NO attention item is ever silently dropped — every item yields a row (distinct targets)", () => {
    const items: AttentionItem[] = [
      // feature → initiative canvas
      makeItem({ type: "halted", entityKind: "feature", entityId: "fa", initiativeId: "i1" }),
      // task → its own parent feature on another initiative
      makeItem({ type: "plan-question", entityKind: "task", entityId: "ta", featureId: "fa2", initiativeId: "i2" }),
      // loose feature → ws ref fallback
      makeItem({ type: "ready-to-review", entityKind: "feature", entityId: "fb", initiativeId: null }),
      // loose-feature task → ws ref fallback
      makeItem({ type: "awaiting-reply", entityKind: "task", entityId: "tb", featureId: "fb2", initiativeId: null }),
      // orphan task → link-only fallback
      makeItem({ type: "halted", entityKind: "task", entityId: "tc", featureId: null, initiativeId: null }),
    ];

    const result = buildLiveNowRows({ items, liveByFeatureId: new Map() });

    // 5 items in, 5 rows out — every resolution path keeps its item.
    expect(result.rows).toHaveLength(items.length);
    expect(result.overflowCount).toBe(0);
    // Every item title survives into some row.
    const titles = new Set(result.rows.map((r) => r.title));
    for (const item of items) expect(titles.has(item.title)).toBe(true);
  });

  test("items sharing one target node merge into one row (dedupe is by node, not by item) — the representative row count reflects nodes, not drops", () => {
    const items: AttentionItem[] = [
      makeItem({ type: "halted", entityKind: "feature", entityId: "fa", initiativeId: "i1", title: "Halted feature" }),
      makeItem({
        type: "plan-question",
        entityKind: "task",
        entityId: "ta",
        featureId: "fa",
        initiativeId: "i1",
        title: "Task on same feature",
      }),
    ];

    const result = buildLiveNowRows({ items, liveByFeatureId: new Map() });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].nodeId).toBe("feature:fa");
    expect(result.rows[0].title).toBe("Halted feature");
  });
});

// ---------------------------------------------------------------------------
// Running-only row metadata (titles / refs)
// ---------------------------------------------------------------------------

describe("buildLiveNowRows — running-only row metadata", () => {
  test("uses featureTitles/featureRefs when supplied; placeholder + empty ref otherwise", () => {
    const withMeta = buildLiveNowRows({
      items: [],
      liveByFeatureId: new Map([["f1", overlay(true, 1)]]),
      featureTitles: new Map([["f1", "Real Title"]]),
      featureRefs: new Map([["f1", "initiative:init-1"]]),
    }).rows[0];

    expect(withMeta.title).toBe("Real Title");
    expect(withMeta.canvasRef).toBe("initiative:init-1");
    expect(withMeta.fallbackOnly).toBe(false);
    expect(withMeta.link).toBe("");
    expect(withMeta.running).toEqual({ plannerRunning: true, agentsRunningCount: 1 });

    const withoutMeta = buildLiveNowRows({
      items: [],
      liveByFeatureId: new Map([["f1", overlay(false, 2)]]),
    }).rows[0];

    expect(withoutMeta.title).toBe("Feature f1");
    expect(withoutMeta.canvasRef).toBe("");
    expect(withoutMeta.link).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

describe("useLiveNowItems (hook)", () => {
  test("returns the built rows and keeps identity stable across re-renders with identical inputs", () => {
    const items = [makeItem({ type: "halted" })];
    const liveByFeatureId = new Map([["f1", overlay(true, 0)]]);

    const { result, rerender } = renderHook(() => useLiveNowItems({ items, liveByFeatureId }));

    const first = result.current;
    expect(first.rows).toHaveLength(2); // 1 attention + 1 running

    rerender();
    expect(result.current).toBe(first);
  });

  test("recomputes when the attention items change", () => {
    const liveByFeatureId = new Map<string, FeatureLiveOverlay>();
    const initial = [makeItem({ type: "halted" })];

    const { result, rerender } = renderHook(
      ({ items }: { items: AttentionItem[] }) => useLiveNowItems({ items, liveByFeatureId }),
      { initialProps: { items: initial } },
    );

    const first = result.current;
    rerender({ items: [makeItem({ type: "ready-to-review" })] });

    expect(result.current).not.toBe(first);
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].label).toBe("Ready to review");
  });
});
