"use client";

/**
 * `useLiveNowItems` — merge the attention feed (`AttentionMapContext`)
 * with live agent-activity (`useFeatureLiveState`) into ranked,
 * deduped "Live Now" rows for the org-canvas panel.
 *
 * Zero new data paths: this is a second client-side read of state the
 * canvas already tracks. No fetch, poll, or subscription is added.
 *
 * ## Known coverage boundary (intentional)
 * Running rows are derived from `liveByFeatureId`, which
 * `useFeatureLiveState` seeds from `deriveFeatureSnapshots([root,
 * ...Object.values(subCanvases)])` — i.e. only features on canvases
 * already loaded into `root`/`subCanvases` **this session** produce
 * running rows. This is exactly the reach the amber agent badge and
 * the planner spinner have today; the panel is a lens over the same
 * data and never claims more. The attention half has no such limit
 * because it is FK-derived (see below). An org-wide "currently
 * running" server signal is explicitly out of scope.
 *
 * ## Ref resolution: derived from FKs, not from a node index
 * A node index over `root + subCanvases` cannot work: `subCanvases`
 * starts as `{}` and a sub-canvas is only fetched when the user
 * drills into it, so an index-plus-omit rule yields an empty panel on
 * page load. Instead each row's target is resolved arithmetically
 * from the FKs already on the `AttentionItem` payload
 * (`workspaceId`/`initiativeId`/`milestoneId`/`featureId`):
 *
 *   - **Feature items** → `nodeId = "feature:<entityId>"`, `canvasRef
 *     = mostSpecificRef({ workspaceId, initiativeId })` (pure helper,
 *     `src/lib/canvas/feature-projection.ts`).
 *   - **Task items** → there is no `task:` node category on the org
 *     canvas (tasks appear only as edges off their parent feature
 *     node), so a task resolves to its **parent feature node** via
 *     `item.featureId`, using the task's `initiativeId` — the payload
 *     populates it from the parent feature.
 *
 * **Unresolvable rows are kept, not omitted.** A task with no
 * `featureId`, or any row whose `mostSpecificRef` is a `ws:` ref
 * (workspace canvases project only explicitly pinned features via
 * `CanvasBlob.assignedFeatures`, which cannot be verified up front),
 * still renders — flagged `fallbackOnly: true` with
 * `link: item.link` (the workspace-scoped fallback URL). This panel
 * is the one surface that claims to answer "what needs me"; a halted
 * task the user owns must never silently vanish from it.
 *
 * `fallbackOnly` rows with a `nodeId` (the `ws:`-ref case) may still
 * attempt an in-canvas focus — the feature might be pinned on the
 * workspace sub-canvas — and fall back to `link` only when the node
 * genuinely isn't there. `fallbackOnly` rows with an empty `nodeId`
 * (task with no parent feature) have nothing to focus on and go
 * straight to `link`.
 *
 * ## Grouping, ranking, dedupe
 * Two labeled groups, in this order: **"Needs you"** (attention rows
 * — the feed is ownership-filtered to entities the user created or is
 * assigned) then **"Running"** (live rows — `decorateNodesWithLiveState`
 * applies to every projected feature regardless of owner). The
 * grouping is load-bearing, not cosmetic: without the labels one flat
 * list silently mixes "mine" and "everyone's".
 *
 * Within "Needs you": `ATTENTION_TYPE_ORDER` first, then `ageMs`
 * descending (oldest first) as a stable tiebreak. The server-side
 * `PRIORITY_RANK` ranker is deliberately NOT re-implemented here —
 * the feed arrives pre-ranked and equal `(type, age)` pairs keep that
 * order (stable sort).
 *
 * Within "Running": planner rows before agent rows, then title
 * alphabetically.
 *
 * One row per target node: when a node has both an attention signal
 * and live activity, the attention signal owns the row's
 * label/color/icon and the live state is carried on `running` so the
 * UI can render it as a secondary inline indicator. A feature that is
 * both halted and running agents must not collapse into a row that
 * hides the second signal — and must not split into two rows either.
 *
 * ## Optional metadata for running-only rows
 * `liveByFeatureId` carries only `{ plannerRunning, agentsRunningCount }`
 * keyed by feature id — no title, no canvas ref. Running-only rows
 * therefore take their display title from the optional `featureTitles`
 * map and their `canvasRef` from the optional `featureRefs` map (both
 * derivable in one pass over the same loaded canvases the seeds come
 * from). When omitted, running rows fall back to a placeholder title
 * and an empty `canvasRef` (focus then degrades to the current canvas).
 */
import { useMemo } from "react";
import type { AttentionItem } from "@/services/attention/topItems";
import { ATTENTION_TYPE_META, ATTENTION_TYPE_ORDER } from "@/services/attention/typeMeta";
import { mostSpecificRef } from "@/lib/canvas/feature-projection";
import type { FeatureLiveOverlay } from "./useFeatureLiveState";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Total-row cap, applied after grouping/sorting/deduping. */
export const LIVE_NOW_MAX_ROWS = 12;

/** Group labels, in render order. */
export const LIVE_NOW_GROUP_LABELS = {
  needsYou: "Needs you",
  running: "Running",
} as const;

/** Planner activity is amber, matching the canvas planner pulse. */
const PLANNER_COLOR_HEX = "#f59e0b";
/** Agent-only activity is blue — "in flight", distinct from attention amber. */
const AGENTS_COLOR_HEX = "#3b82f6";

const FEATURE_ID_PREFIX = "feature:";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Live agent-activity state attached to a row (secondary indicator). */
export interface LiveNowRunningState {
  plannerRunning: boolean;
  agentsRunningCount: number;
}

/**
 * One ranked "Live Now" row. Attention-derived rows carry
 * `iconName` (from `ATTENTION_TYPE_META`) and `running: null` unless
 * the same node is also live; running-only rows carry
 * `iconName: null` and `running` set — that pair is the group
 * discriminator (see `liveNowGroupOf`).
 */
export interface LiveNowRow {
  /** Stable React key, unique per row. */
  key: string;
  /**
   * Target canvas node id (`feature:<id>`), or "" when the row has no
   * canvas target (task with no parent feature → link-only).
   */
  nodeId: string;
  /**
   * Canvas ref the target projects on (`initiative:<id>` or `ws:<id>`)
   * per `mostSpecificRef`. Empty for link-only rows, and for
   * running-only rows when no `featureRefs` metadata was supplied.
   */
  canvasRef: string;
  /**
   * True when in-canvas focus cannot be guaranteed: the ref is a
   * `ws:` ref (pinning is unverifiable client-side) or the row has no
   * canvas target at all. The click path may still try to focus
   * (`nodeId` non-empty) and must fall back to `link` on a miss.
   */
  fallbackOnly: boolean;
  /**
   * Workspace-scoped fallback URL. Always present on attention rows;
   * empty on running-only rows (no workspace context is available
   * client-side, and focus-first is always meaningful for them).
   */
  link: string;
  /** Row title — `item.title` for attention rows, feature title for running rows. */
  title: string;
  /** Human-readable activity label ("Halted", "Planner working", …). */
  label: string;
  /** Status color for the row indicator. */
  colorHex: string;
  /**
   * Attention icon name, or null for running-only rows (which render
   * their own spinner). Color alone cannot distinguish `halted` /
   * `awaiting-reply` / `plan-question` — all share `#f59e0b` — so the
   * glyph is required, not decorative.
   */
  iconName: (typeof ATTENTION_TYPE_META)[AttentionItem["type"]]["iconName"] | null;
  /** 0-based rank in the final merged ordering (attention rows first). */
  order: number;
  /** Live agent activity on the same node, or null when none. */
  running: LiveNowRunningState | null;
}

export type LiveNowGroup = "needs-you" | "running";

export interface LiveNowResult {
  /** Ranked rows, capped at `LIVE_NOW_MAX_ROWS`. */
  rows: LiveNowRow[];
  /** How many ranked rows were cut by the cap (drives a "+N more" hint). */
  overflowCount: number;
}

export interface LiveNowInputs {
  /** Full attention feed (ownership-filtered, server-ranked). */
  items: readonly AttentionItem[];
  /** Feature-id → live overlay, from `useFeatureLiveState`. */
  liveByFeatureId: ReadonlyMap<string, FeatureLiveOverlay>;
  /** Optional feature-id → display title (for running-only rows). */
  featureTitles?: ReadonlyMap<string, string>;
  /** Optional feature-id → canvas ref the feature node was seen on. */
  featureRefs?: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------------------
// Small helpers (exported for tests + panel reuse)
// ---------------------------------------------------------------------------

/** True when a live overlay is actually active (not an idle feature). */
export function isRunningOverlayActive(overlay: FeatureLiveOverlay | undefined): boolean {
  return Boolean(overlay && (overlay.plannerRunning || overlay.agentsRunningCount > 0));
}

/**
 * Label for a live overlay: "Planner working", "N agents running"
 * (pluralized), or both joined when a planner runs alongside agents.
 */
export function formatRunningLabel(running: LiveNowRunningState): string {
  const parts: string[] = [];
  if (running.plannerRunning) parts.push("Planner working");
  if (running.agentsRunningCount > 0) {
    parts.push(running.agentsRunningCount === 1 ? "1 agent running" : `${running.agentsRunningCount} agents running`);
  }
  return parts.join(" · ");
}

/** Which labeled group a row belongs to ("Needs you" vs "Running"). */
export function liveNowGroupOf(row: LiveNowRow): LiveNowGroup {
  return row.iconName !== null ? "needs-you" : "running";
}

/** Short placeholder title for a running feature with no known title. */
function fallbackFeatureTitle(featureId: string): string {
  return `Feature ${featureId.slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Pure builder
// ---------------------------------------------------------------------------

/**
 * Merge `items` (attention feed) + `liveByFeatureId` (live agent
 * activity) into ranked `LiveNowRow[]`, capped at `LIVE_NOW_MAX_ROWS`
 * with the overflow counted. Pure — no React, no fetches, no canvas
 * mutation. See the module header for the ranking/dedupe contract.
 */
export function buildLiveNowRows(inputs: LiveNowInputs): LiveNowResult {
  const { items, liveByFeatureId, featureTitles, featureRefs } = inputs;

  // ── 1. Running overlays, filtered to actually-active features ────
  // `useFeatureLiveState` builds `liveByFeatureId` by iterating all of
  // `stateMap` unconditionally, so it holds an entry for every seeded
  // feature including idle ones. Without this filter the panel would
  // render a row per feature.
  const activeRunning = new Map<string, FeatureLiveOverlay>();
  for (const [featureId, overlay] of liveByFeatureId) {
    if (isRunningOverlayActive(overlay)) {
      activeRunning.set(featureId, overlay);
    }
  }

  // ── 2. Resolve every attention item to a target node (FK-derived) ─
  interface ResolvedItem {
    item: AttentionItem;
    nodeId: string;
    canvasRef: string;
    fallbackOnly: boolean;
  }

  const resolved: ResolvedItem[] = [];
  for (const item of items) {
    if (item.entityKind === "feature") {
      const nodeId = `${FEATURE_ID_PREFIX}${item.entityId}`;
      const canvasRef = mostSpecificRef({
        workspaceId: item.workspaceId,
        initiativeId: item.initiativeId,
      });
      resolved.push({
        item,
        nodeId,
        canvasRef,
        fallbackOnly: canvasRef.startsWith("ws:"),
      });
      continue;
    }

    // Task item → parent feature node (there is no `task:` node
    // category on the org canvas; tasks appear only as edges off
    // their parent feature).
    if (!item.featureId) {
      // Nothing to focus — link-only row. Kept, never dropped: the
      // panel must still answer "what needs me" for orphan tasks.
      resolved.push({ item, nodeId: "", canvasRef: "", fallbackOnly: true });
      continue;
    }
    const nodeId = `${FEATURE_ID_PREFIX}${item.featureId}`;
    // `item.initiativeId` mirrors the parent feature's initiativeId —
    // the payload populates it from `task.feature`.
    const canvasRef = mostSpecificRef({
      workspaceId: item.workspaceId,
      initiativeId: item.initiativeId,
    });
    resolved.push({
      item,
      nodeId,
      canvasRef,
      fallbackOnly: canvasRef.startsWith("ws:"),
    });
  }

  // ── 3. Rank attention rows: type order, then oldest first ────────
  // Stable sort: equal (type, age) pairs keep the server's pre-ranked
  // order. PRIORITY_RANK is deliberately not re-implemented here.
  resolved.sort((a, b) => {
    const byType = ATTENTION_TYPE_ORDER[a.item.type] - ATTENTION_TYPE_ORDER[b.item.type];
    if (byType !== 0) return byType;
    return b.item.ageMs - a.item.ageMs;
  });

  // ── 4. Emit attention rows, deduping by target node ──────────────
  // First (highest-ranked) attention item per node wins and owns the
  // row's label/color/icon; concurrent live state is attached below.
  const rowsByNode = new Map<string, LiveNowRow>();
  const rows: LiveNowRow[] = [];

  for (const r of resolved) {
    const key = r.nodeId ? `node:${r.nodeId}` : `item:${r.item.id}`;
    if (rowsByNode.has(key)) continue;

    const running = r.nodeId ? (activeRunning.get(r.nodeId.slice(FEATURE_ID_PREFIX.length)) ?? null) : null;
    const meta = ATTENTION_TYPE_META[r.item.type];

    const row: LiveNowRow = {
      key,
      nodeId: r.nodeId,
      canvasRef: r.canvasRef,
      fallbackOnly: r.fallbackOnly,
      link: r.item.link,
      title: r.item.title,
      label: meta.label,
      colorHex: meta.colorHex,
      iconName: meta.iconName,
      order: rows.length,
      running,
    };
    rowsByNode.set(key, row);
    rows.push(row);
  }

  // ── 5. Running-only rows for features without an attention row ───
  const runningOnly: Array<{ featureId: string; overlay: FeatureLiveOverlay }> = [];
  for (const [featureId, overlay] of activeRunning) {
    if (rowsByNode.has(`node:${FEATURE_ID_PREFIX}${featureId}`)) continue;
    runningOnly.push({ featureId, overlay });
  }

  runningOnly.sort((a, b) => {
    // Planner rows before agent rows.
    const byPlanner = (a.overlay.plannerRunning ? 0 : 1) - (b.overlay.plannerRunning ? 0 : 1);
    if (byPlanner !== 0) return byPlanner;
    // Then title alphabetically (using the same title resolution the
    // rows will carry).
    const ta = featureTitles?.get(a.featureId) ?? fallbackFeatureTitle(a.featureId);
    const tb = featureTitles?.get(b.featureId) ?? fallbackFeatureTitle(b.featureId);
    return ta.localeCompare(tb);
  });

  for (const { featureId, overlay } of runningOnly) {
    const row: LiveNowRow = {
      key: `node:${FEATURE_ID_PREFIX}${featureId}`,
      nodeId: `${FEATURE_ID_PREFIX}${featureId}`,
      // Best-known ref (from the same loaded-canvas scan that seeded
      // the live state); empty when no metadata was supplied.
      canvasRef: featureRefs?.get(featureId) ?? "",
      // Running rows are canvas-derived — the node exists on some
      // loaded canvas this session — so focus-first is always the
      // right primary behavior; there is no link fallback available
      // (no workspace context on the live map).
      fallbackOnly: false,
      link: "",
      title: featureTitles?.get(featureId) ?? fallbackFeatureTitle(featureId),
      label: formatRunningLabel(overlay),
      colorHex: overlay.plannerRunning ? PLANNER_COLOR_HEX : AGENTS_COLOR_HEX,
      iconName: null,
      order: rows.length,
      running: { plannerRunning: overlay.plannerRunning, agentsRunningCount: overlay.agentsRunningCount },
    };
    rowsByNode.set(row.key, row);
    rows.push(row);
  }

  // ── 6. Cap last, after grouping/sorting/deduping ─────────────────
  const capped = rows.slice(0, LIVE_NOW_MAX_ROWS);
  return {
    rows: capped,
    overflowCount: Math.max(0, rows.length - capped.length),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Memoized hook form of `buildLiveNowRows`. Recomputes only when an
 * input identity changes — i.e. on the attention refresh cadence
 * (Pusher-debounced / 30s poll) or when live feature state changes.
 */
export function useLiveNowItems(inputs: LiveNowInputs): LiveNowResult {
  const { items, liveByFeatureId, featureTitles, featureRefs } = inputs;
  return useMemo(
    () => buildLiveNowRows({ items, liveByFeatureId, featureTitles, featureRefs }),
    [items, liveByFeatureId, featureTitles, featureRefs],
  );
}
