"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AddNodeButton,
  SystemCanvas,
  addEdge,
  addNode,
  removeEdge,
  removeNode,
  updateEdge,
  updateNode,
  type AddNodeButtonRenderProps,
  type BreadcrumbEntry,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSelection,
  type EdgeUpdate,
  type NodeContextMenuConfig,
  type NodeUpdate,
  type SystemCanvasHandle,
} from "system-canvas-react";
// `getNodeLabel` isn't re-exported from `system-canvas-react`; pull
// it from the core package directly. Used to resolve human-readable
// labels for edge endpoints at click-time.
import { getNodeLabel } from "system-canvas";
import { connectionsTheme } from "./canvas-theme";
import { HiddenLivePill, type HiddenLiveEntry } from "./HiddenLivePill";
import { getOrgChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import {
  InitiativeDialog,
  type InitiativeForm,
} from "@/components/initiatives/InitiativeDialog";
import {
  MilestoneDialog,
  type MilestoneForm,
} from "@/components/initiatives/MilestoneDialog";
import {
  CreateFeatureCanvasDialog,
  type FeatureAssignForm,
  type FeatureCreateForm,
} from "../_components/CreateFeatureCanvasDialog";
import { CreateServiceCanvasDialog } from "../_components/CreateServiceCanvasDialog";
import type {
  InitiativeResponse,
  MilestoneResponse,
} from "@/types/initiatives";
import { categoryAllowedOnScope } from "./canvas-categories";
import { useCanvasChatStore } from "../_state/canvasChatStore";
import { useSendCanvasChatMessage } from "../_state/useSendCanvasChatMessage";

/**
 * Live-id detection mirrors `src/lib/canvas/scope.ts`'s `isLiveId`.
 * Duplicated here because that module is server-side (pulls Prisma); we
 * only need the prefix check on the client. Keep the prefix list in sync
 * with `LIVE_ID_PREFIXES` there.
 */
const LIVE_ID_PREFIXES = ["ws:", "feature:", "repo:", "initiative:", "milestone:", "task:", "research:"];
function isLiveId(id: string): boolean {
  return LIVE_ID_PREFIXES.some((p) => id.startsWith(p));
}

/**
 * Categories that, when picked from the `+` menu, open a creation
 * dialog instead of dropping a node onto the canvas. The dialog hits
 * the appropriate REST API; on success the projector re-emits the new
 * node, and we save the user's click position so the node lands where
 * they clicked.
 *
 * Whether each category is *visible* in the `+` menu on the current
 * scope is decided by `categoryAllowedOnScope` in `canvas-categories.ts`
 * — see `renderAddNodeButton` below. Both filters consult the same
 * helper so a category never shows in the menu but fails the dispatch
 * (or vice versa).
 */
const DB_CREATING_CATEGORIES = new Set(["initiative", "milestone", "feature"]);

/**
 * Authored category ids the user can drop onto a live container card
 * (workspace / initiative / milestone) to move the authored node from
 * the current canvas blob to the target's sub-canvas blob. Stays in
 * lock-step with `canvas-categories.ts` — anything authored (not
 * `agentWritable: false`) and free-floating belongs here. `text` is
 * the library's base type used by the `+ Text` menu pick; including
 * it lets users shuffle plain text cards too.
 *
 * Module-level so the arrays' identity stays stable across renders
 * and `useCallback` deps don't churn.
 */
const AUTHORED_DROPPABLE_CATEGORIES = ["note", "decision", "text"];



/**
 * Live container categories that own a sub-canvas an authored node
 * can be moved into. Mirrors the `ref: liveId` projections in
 * `src/lib/canvas/projectors.ts` — workspaces and initiatives each
 * drill. Milestones are intentionally NOT in this list: they render
 * as cards on the initiative canvas and are not drillable, so there
 * is no sub-canvas to drop authored notes onto. Features also don't
 * drill (no `ref` in v1 per the projector); attempting to move an
 * authored node onto a feature or milestone would have nowhere to land.
 */
const LIVE_CONTAINER_CATEGORIES = ["workspace", "initiative"];

/**
 * Full-screen interactive system-canvas background for the Connections page.
 *
 * Single-owner state model: this component owns both the root canvas and a
 * `Record<ref, CanvasData>` map of nested sub-canvases. Every editing
 * callback from SystemCanvas arrives with a `canvasRef` (undefined for the
 * root, a string for a sub-canvas) — we route mutations through that key
 * and schedule a per-ref debounced save to our REST endpoints.
 */

const ROOT_KEY = "__root__";
const AUTOSAVE_MS = 600;

/**
 * Color applied to edges that have a linked Connection doc, so they
 * stand out from un-linked edges at a glance. Theme default is slate-500
 * (`#64748b`); slate-400 (`#94a3b8`) is the "noticeable but quiet"
 * step. Applied as `edge.color` in a render-only decoration pass (see
 * `decorateEdgesWithLinkVisual`); never persisted.
 */
const LINKED_EDGE_COLOR = "#a4b3cc";

type DirtyMap = Map<string, CanvasData>;

type LastAction =
  | {
      kind: "blob";
      canvasRef: string | undefined; // undefined = root
      prev: CanvasData; // snapshot before the mutation
    }
  | {
      kind: "hide"; // user hid a live node → undo = show
      canvasRef: string | undefined;
      id: string;
    }
  | {
      kind: "show"; // user restored a live node → undo = hide
      canvasRef: string | undefined;
      id: string;
    };

async function fetchRoot(githubLogin: string): Promise<CanvasData> {
  const res = await fetch(`/api/orgs/${githubLogin}/canvas`);
  if (!res.ok) throw new Error(`Failed to load canvas: ${res.status}`);
  const body = await res.json();
  return (body.data ?? { nodes: [], edges: [] }) as CanvasData;
}

async function fetchSub(githubLogin: string, ref: string): Promise<CanvasData> {
  const res = await fetch(
    `/api/orgs/${githubLogin}/canvas/${encodeURIComponent(ref)}`,
  );
  if (!res.ok) throw new Error(`Failed to load sub-canvas: ${res.status}`);
  const body = await res.json();
  return (body.data ?? { nodes: [], edges: [] }) as CanvasData;
}

async function saveCanvas(
  githubLogin: string,
  ref: string | undefined,
  data: CanvasData,
): Promise<void> {
  const url = ref
    ? `/api/orgs/${githubLogin}/canvas/${encodeURIComponent(ref)}`
    : `/api/orgs/${githubLogin}/canvas`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) {
    // Best-effort: surface in console but don't throw — we want autosave
    // to keep trying on the next edit rather than get stuck.
    console.error(`[OrgCanvasBackground] PUT failed (${res.status})`);
  }
}

/**
 * Toggle the visibility of a projected live node. Routed through the
 * dedicated `/canvas/hide` endpoint so it can't be clobbered by the
 * autosave PUT (which only writes nodes + positions).
 */
async function toggleLiveVisibility(
  githubLogin: string,
  ref: string | undefined,
  id: string,
  action: "hide" | "show",
): Promise<void> {
  const res = await fetch(`/api/orgs/${githubLogin}/canvas/hide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: ref ?? "", id, action }),
  });
  if (!res.ok) {
    console.error(
      `[OrgCanvasBackground] ${action} failed for ${id} (${res.status})`,
    );
  }
}

async function fetchHiddenLive(
  githubLogin: string,
  ref: string | undefined,
): Promise<HiddenLiveEntry[]> {
  const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await fetch(`/api/orgs/${githubLogin}/canvas/hide${qs}`);
  if (!res.ok) {
    console.error(
      `[OrgCanvasBackground] fetchHiddenLive failed (${res.status})`,
    );
    return [];
  }
  const body = await res.json();
  return (body.entries ?? []) as HiddenLiveEntry[];
}

/**
 * `CanvasSelection` enriched with the resolved human-readable labels
 * for an edge's endpoints. The lib emits raw `node`/`edge` payloads;
 * we widen the edge case here so consumers (the right panel) don't
 * each have to look up the node map themselves.
 *
 * Node selections pass through unchanged — node entities already
 * carry `text` directly, so consumers that need a label just call
 * `getNodeLabel(selection.node)` themselves.
 */
export type SelectionWithLabels =
  | {
      kind: "node";
      node: CanvasNode;
      canvasRef: string | undefined;
    }
  | {
      kind: "edge";
      edge: CanvasEdge;
      canvasRef: string | undefined;
      fromLabel: string;
      toLabel: string;
    }
  | null;

interface OrgCanvasBackgroundProps {
  githubLogin: string;
  /**
   * Pixels to inset the canvas from the right edge of the viewport. Used
   * to keep the library's bottom-right "+" FAB from hiding behind the
   * Connections sidebar.
   */
  rightInset?: number;
  /**
   * Label for the root breadcrumb. We prefer the org's display name so
   * users see "Acme" rather than the generic "Canvas"; falls back to
   * the `githubLogin` when no name is set.
   */
  orgName?: string | null;
  /**
   * Fires whenever the hidden-live set for the ROOT canvas changes
   * (initial fetch, user hide/restore, Pusher-driven refetch). Lets the
   * parent keep other surfaces in sync — e.g. excluding hidden
   * workspaces from the chat's default context set.
   *
   * The callback is called with a fresh array every time; don't mutate.
   */
  onHiddenChange?: (entries: HiddenLiveEntry[]) => void;
  /**
   * Fires whenever the canvas's selection state changes. Single
   * callback covering all paths: node-click, edge-click,
   * canvas-background-click (deselect), Escape, Delete, navigation,
   * and stale-selection collapse. Mutually exclusive: at most one
   * node or one edge is selected at a time. `null` means nothing.
   *
   * The payload extends the lib's `CanvasSelection` with
   * `fromLabel` / `toLabel` resolved from the canvas data at the
   * moment of selection. Resolving labels here (where the canvas
   * lives) keeps consumers from having to mirror the node map.
   * `getNodeLabel` falls back to the node id when no `text` is set;
   * for live nodes the projector populates `text` with the entity's
   * human name (workspace.name, initiative.name, etc.).
   */
  onSelectionChange?: (selection: SelectionWithLabels) => void;
  /**
   * Imperatively patch an edge's data (today: `customData.connectionId`
   * for the edge\u2194connection link feature). Returns void; the parent
   * doesn't need a result because the canvas state is the source of
   * truth and the next render reflects the change.
   *
   * Wired via a ref so the parent can call it from connection-list
   * affordances (link / unlink) without re-plumbing prop callbacks
   * down to every list row. Set the ref's `.current` to a stable
   * function from this component.
   */
  edgePatchHandleRef?: React.MutableRefObject<
    | ((
        edgeId: string,
        patch: EdgeUpdate,
        canvasRef: string | undefined,
      ) => void)
    | null
  >;
  /**
   * Fires when the user navigates between canvases. Receives a human
   * readable breadcrumb trail joined with ` › ` — e.g. `"Acme"` on
   * root, `"Acme › Auth Refactor"` on a sub-canvas. Used by the chat
   * overlay to tell the agent which scope the user is on by name (the
   * ref id flows separately via `currentCanvasRef`).
   *
   * Today we only nest one level deep, so the trail is always 1 or 2
   * entries. If/when we support multi-level drill-in, we'll need to
   * track the parent stack here — see the TODO in `handleBreadcrumbClick`.
   */
  onCanvasBreadcrumbChange?: (breadcrumb: string) => void;
  /**
   * Fires whenever the set of connection ids referenced by at least
   * one edge (across root + every loaded sub-canvas) changes. The
   * sidebar's connection list uses this to render a small dot on
   * rows whose connection is wired up to the canvas — same idea as
   * the linked-edge color highlight, surfaced from the other side.
   *
   * Emitted as a fresh `Set` each time; consumers can store it
   * directly. Sub-canvases that haven't been loaded yet don't
   * contribute (we only know about edges we've actually fetched),
   * but every sub-canvas the user has visited stays in
   * `subCanvases` for the session, so the set converges as the
   * user explores.
   */
  onLinkedConnectionIdsChange?: (ids: Set<string>) => void;
}

export function OrgCanvasBackground({
  githubLogin,
  rightInset = 0,
  orgName,
  onHiddenChange,
  onSelectionChange,
  edgePatchHandleRef,
  onCanvasBreadcrumbChange,
  onLinkedConnectionIdsChange,
}: OrgCanvasBackgroundProps) {
  const [root, setRoot] = useState<CanvasData | null>(null);
  const [subCanvases, setSubCanvases] = useState<Record<string, CanvasData>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * Current canvas scope as the user has it open. `""` is root; any
   * non-empty value is a sub-canvas ref (e.g. `"ws:abc"` or
   * `"initiative:xyz"`). Driven by the library's `onNavigate` callback;
   * defaults to root.
   *
   * We track this so chrome that's only meaningful at the org level
   * (notably the "N hidden" restore pill, which lists hidden workspaces)
   * stays out of the way when the user has drilled into a sub-canvas
   * and is focused on a smaller scope.
   */
  const [currentRef, setCurrentRef] = useState<string>("");

  // -------------------------------------------------------------------
  // URL <-> canvas-scope sync
  //
  // The active canvas ref is mirrored to the URL as `?canvas=<ref>` so
  // a user can deep-link into a specific initiative timeline or
  // workspace sub-canvas (e.g. share `?canvas=initiative:abc` with a
  // teammate). Three-way sync:
  //
  //   1. URL → canvas: on mount (and when the URL changes externally),
  //      drill into the ref via `SystemCanvas`'s imperative handle.
  //      Done once after `root` loads — `zoomIntoNode` needs the
  //      target node to exist on the rendered canvas.
  //   2. canvas → URL: `onNavigate(ref)` fires on drill-IN; we replace
  //      the URL with the new ref. Uses `router.replace` so browser
  //      back exits the page rather than walking through canvas
  //      scopes (matches the connections-sidebar URL convention on
  //      the same page).
  //   3. canvas → URL on back-out: `onNavigate` does NOT fire on
  //      breadcrumb clicks (library quirk — see `useNavigation.js`).
  //      We wire `onBreadcrumbClick` to update both `currentRef`
  //      state and the URL so going back to root clears `?canvas=`.
  // -------------------------------------------------------------------
  const router = useRouter();
  const searchParams = useSearchParams();
  // Stay on the current route when writing canvas URL params. The
  // canvas only lives at `/org/{login}` today, but reading the
  // pathname keeps the URL writer route-agnostic if we ever mount
  // it elsewhere again.
  const pathname = usePathname();
  /** Imperative handle for `SystemCanvas`; used to drill into a ref from a URL param. */
  const canvasHandleRef = useRef<SystemCanvasHandle | null>(null);
  /**
   * One-shot guard so we only drill into the URL's `?canvas=` once on
   * mount. After that, `onNavigate` / `onBreadcrumbClick` own the URL
   * and the URL would re-feed the same ref back into the handle in a
   * loop. (Future: re-fire when the user pastes a new URL into the
   * same tab — cheaply detected by comparing to `currentRef`.)
   */
  const initialNavAppliedRef = useRef(false);
  /**
   * Truthy from initial render until the deep-link drill-in completes.
   * Captured synchronously from `searchParams` so the spinner overlay
   * shows on the very first paint — the user never sees a flash of the
   * root canvas before the sub-canvas opens.
   *
   * Stored as a ref so the captured value doesn't shift mid-render
   * (and stored separately as state below for the spinner gate, since
   * a ref alone wouldn't trigger re-render on clear).
   */
  const pendingDeepLinkRef = useRef<string | null>(null);
  if (pendingDeepLinkRef.current === null && !initialNavAppliedRef.current) {
    // First render only — capture the URL's `?canvas=` value before any
    // effect runs so the spinner gate below is correct on the initial
    // paint. After this render, `pendingDeepLinkRef` is either the
    // target ref (drill-in pending) or `""` (no deep link, gate stays
    // closed but spinner-state remains false). We use the ref's
    // null/non-null distinction as the "have we captured yet" signal.
    pendingDeepLinkRef.current = searchParams.get("canvas") ?? "";
  }
  const [deepLinkInFlight, setDeepLinkInFlight] = useState<boolean>(
    () => (searchParams.get("canvas") ?? "") !== "",
  );

  /**
   * Update the `?canvas=<ref>` query param without navigating away
   * from the page. Pass `""` to clear the param (root canvas).
   * Other query params on the page (notably `?c=<connection-slug>`
   * from the Connections sidebar) are preserved.
   */
  const writeCanvasUrlParam = useCallback(
    (ref: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (ref === "") {
        params.delete("canvas");
      } else {
        params.set("canvas", ref);
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  /**
   * Library callback: user drilled into a sub-canvas. Scope state
   * (`currentRef`, URL) is now driven by `onBreadcrumbsChange` —
   * which also covers back-navigation and arbitrary-depth breadcrumb
   * clicks — so this handler only owns the side-effect of clearing
   * the selected node. The previously-selected node may not even
   * exist on the new scope; the parent right-panel reverts to its
   * default body.
   */
  /**
   * Single source of truth for selection. The lib's
   * `onSelectionChange` covers every path that mutates selection —
   * node-click, edge-click, canvas-background-click (the new
   * deselect signal), Escape, Delete, navigation, and stale-
   * selection collapse — and emits an atomic update with the final
   * resolved state. We just enrich the edge payload with
   * human-readable endpoint labels (resolved from the canvas's own
   * node list via `getNodeLabel`) and forward to the parent.
   *
   * Replaces the previous patchwork of `onNodeSelect(null)` /
   * `onEdgeSelect(null)` calls scattered across `onNodeClick`,
   * `onEdgeClick`, `onNavigate`, and `onBreadcrumbClick`.
   */
  const handleSelectionChange = useCallback(
    (selection: CanvasSelection) => {
      if (!selection) {
        onSelectionChange?.(null);
        return;
      }
      if (selection.kind === "node") {
        onSelectionChange?.({
          kind: "node",
          node: selection.node,
          canvasRef: selection.canvasRef,
        });
        return;
      }
      // Edge — resolve human labels off the canvas the edge lives on.
      // The refs lag state by one commit, but the edge's endpoints
      // are already in the rendered canvas (it wouldn't have been
      // clickable otherwise) so the lag is harmless here.
      const { edge, canvasRef } = selection;
      const sourceCanvas =
        canvasRef === undefined
          ? rootRef.current
          : subCanvasesRef.current[canvasRef];
      const nodes = sourceCanvas?.nodes ?? [];
      const fromNode = nodes.find((n) => n.id === edge.fromNode);
      const toNode = nodes.find((n) => n.id === edge.toNode);
      const fromLabel = fromNode ? getNodeLabel(fromNode) : edge.fromNode;
      const toLabel = toNode ? getNodeLabel(toNode) : edge.toNode;
      onSelectionChange?.({
        kind: "edge",
        edge,
        canvasRef,
        fromLabel,
        toLabel,
      });
    },
    [onSelectionChange],
  );

  /**
   * Hidden live entries for the CURRENT canvas (whatever `currentRef`
   * points at). Drives the HiddenLivePill, which surfaces "restore"
   * for whatever scope the user is looking at — workspaces on root,
   * repos on a workspace sub-canvas, etc. Refetched whenever
   * `currentRef` changes (see effect below).
   *
   * `null` means "not yet fetched on the current scope." We render
   * the pill as `entries={hiddenLive ?? []}` so the brief gap during
   * a refetch reads as "no entries" rather than flashing a stale list
   * from the previous canvas.
   */
  const [hiddenLive, setHiddenLive] = useState<HiddenLiveEntry[] | null>(null);
  /**
   * Hidden live entries for the ROOT canvas specifically — independent
   * of `currentRef`. The chat workspace seed in `OrgCanvasView` only
   * cares about hidden workspaces (which only live on root); piping the
   * current-scope list through `onHiddenChange` would re-seed the chat
   * with repo/milestone entries when the user drills into a sub-canvas.
   * `null` means "not yet fetched"; the notify effect short-circuits
   * while null so the parent's first non-stub callback is the real list.
   */
  const [rootHiddenLive, setRootHiddenLive] = useState<HiddenLiveEntry[] | null>(null);

  // Keep the latest sub-canvases available to the save flusher without
  // re-creating the debounce timer every render.
  const subCanvasesRef = useRef(subCanvases);
  useEffect(() => {
    subCanvasesRef.current = subCanvases;
  }, [subCanvases]);
  const rootRef = useRef(root);
  useEffect(() => {
    rootRef.current = root;
  }, [root]);
  // Mirror of `currentRef` for callbacks that need to read it without
  // re-binding (Pusher handler, refresh helpers). The Pusher subscription
  // effect intentionally only depends on `githubLogin` so we don't tear
  // down + resubscribe every navigation; reading through this ref keeps
  // the handler pointed at the user's current scope.
  const currentRefRef = useRef(currentRef);
  useEffect(() => {
    currentRefRef.current = currentRef;
  }, [currentRef]);

  // -------------------------------------------------------------------
  // Single source of truth for canvas scope: the library's breadcrumb
  // trail.
  //
  // The lib emits this on every navigation event — drill-in,
  // breadcrumb click, programmatic `zoomIntoNode`, `navigateBack` —
  // for any depth (root → initiative → milestone today, deeper if we
  // nest further). We mirror three things off it:
  //
  //   1. `currentRef`: the deepest entry's ref, or `""` for root.
  //      Drives the HiddenLivePill, scope-aware `+` menu, etc.
  //   2. The `?canvas=` URL param: mirrors `currentRef` so deep links
  //      survive refresh and tab-shares.
  //   3. The breadcrumb string forwarded to the chat overlay so the
  //      AI agent can name the user's scope ("Acme › Auth Refactor ›
  //      M1") rather than echoing an opaque ref id.
  //
  // The library always emits at least the root entry on initial
  // mount, so subscribers don't need to wait for navigation.
  // -------------------------------------------------------------------
  const handleBreadcrumbsChange = useCallback(
    (entries: BreadcrumbEntry[]) => {
      // Last entry's ref is the deepest scope. The root entry has no
      // `ref` field, so an empty trail (or root-only trail) collapses
      // to `""` — which is our convention for "on root."
      const deepest = entries[entries.length - 1]?.ref ?? "";
      // Only touch state / URL when the scope actually changed. The
      // lib emits this on every render of its navigation hook; the
      // breadcrumb-string forward below is cheap enough to run every
      // time, but skipping the URL/state writes here matters for the
      // initial deep-link path: the lib fires the root-only trail
      // before its async drill-in completes, and writing `""` would
      // briefly clobber the user's `?canvas=` param.
      setCurrentRef((prev) => (prev === deepest ? prev : deepest));
      if (currentRefRef.current !== deepest) {
        writeCanvasUrlParam(deepest);
      }
      onCanvasBreadcrumbChange?.(entries.map((e) => e.label).join(" › "));
    },
    [writeCanvasUrlParam, onCanvasBreadcrumbChange],
  );

  // Map keyed by ROOT_KEY or sub-canvas ref -> latest data waiting to flush.
  const dirtyRef = useRef<DirtyMap>(new Map());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActionRef = useRef<LastAction | null>(null);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      const pending = dirtyRef.current;
      dirtyRef.current = new Map();
      flushTimer.current = null;
      for (const [key, data] of pending) {
        const ref = key === ROOT_KEY ? undefined : key;
        void saveCanvas(githubLogin, ref, data);
      }
    }, AUTOSAVE_MS);
  }, [githubLogin]);

  const markDirty = useCallback(
    (canvasRef: string | undefined, next: CanvasData) => {
      dirtyRef.current.set(canvasRef ?? ROOT_KEY, next);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  // Initial root load + hidden-list fetch. Both are root-scoped, both
  // run once per org switch; bundling them here keeps the effect count
  // low and guarantees the pill shows up on first paint (no flash).
  useEffect(() => {
    let cancelled = false;
    fetchRoot(githubLogin)
      .then((data) => {
        if (!cancelled) setRoot(data);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[OrgCanvasBackground] failed to load root", err);
          setLoadError("Failed to load canvas");
        }
      });
    // Root hidden list seeds both `rootHiddenLive` (which drives the
    // chat workspace context via `onHiddenChange`) and `hiddenLive`
    // (the pill's current-scope list — equal to the root list while
    // we're still on root). When the user navigates into a sub-canvas
    // the per-ref effect below replaces `hiddenLive`; `rootHiddenLive`
    // stays put.
    fetchHiddenLive(githubLogin, undefined).then((entries) => {
      if (cancelled) return;
      setRootHiddenLive(entries);
      setHiddenLive(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [githubLogin]);

  // Refetch the current canvas's hidden list whenever the user drills
  // into / out of a sub-canvas. Skips the root case — the initial-load
  // effect above already populates `hiddenLive` for `currentRef === ""`,
  // and re-running on every root visit would just duplicate that work.
  // The pill auto-hides when entries are empty, so a sub-canvas with
  // nothing hidden still costs zero chrome.
  useEffect(() => {
    if (currentRef === "") return;
    let cancelled = false;
    // Optimistic clear so the previous canvas's list never flashes
    // on the new scope.
    setHiddenLive(null);
    fetchHiddenLive(githubLogin, currentRef).then((entries) => {
      if (!cancelled) setHiddenLive(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [githubLogin, currentRef]);

  // Initial drill-in from `?canvas=<ref>`. Runs once after the root
  // canvas has loaded — `zoomIntoNode` requires the projected node
  // (e.g. `initiative:<id>`) to actually exist on the rendered canvas.
  // The guarded `initialNavAppliedRef` keeps this from firing twice on
  // strict-mode / fast-refresh re-renders.
  //
  // The spinner overlay (see JSX) covers the canvas from initial
  // paint until this promise resolves, so the user never sees a
  // flash of the root canvas before the sub-canvas mounts.
  useEffect(() => {
    if (!root || initialNavAppliedRef.current) return;
    const targetRef = pendingDeepLinkRef.current ?? "";
    if (targetRef === "" || targetRef === currentRef) {
      // No deep link, or already there — nothing to do. Clear the
      // spinner gate (which only fires for true deep links anyway).
      initialNavAppliedRef.current = true;
      setDeepLinkInFlight(false);
      return;
    }
    // Today the projector emits a node whose `id` matches the ref it
    // drills into (e.g. the `initiative:<id>` node on root carries
    // `ref: "initiative:<id>"`). So zooming into the id navigates
    // into the matching sub-canvas in one shot.
    //
    // If the ref doesn't resolve to an on-canvas node (e.g. a stale
    // share link to a deleted initiative), the handle's promise just
    // resolves without navigating; the user lands on root, which is
    // the right fallback.
    const handle = canvasHandleRef.current;
    if (!handle) return;
    initialNavAppliedRef.current = true;
    // `durationMs: 0` skips the camera dive-in animation. For a deep
    // link the user just wants to land on the sub-canvas — a 900ms
    // cinematic zoom every time they refresh would feel sluggish.
    // (Drilling in via a click still gets the default animation; that
    // path uses the library's internal navigation flow, not this
    // imperative call.)
    //
    // The promise resolves once the sub-canvas has mounted AND its
    // auto-fit has run (see the library's two-RAF wait inside
    // `zoomIntoNode`). At that point the spinner is safe to drop —
    // the user is already looking at the right canvas.
    void handle
      .zoomIntoNode(targetRef, { durationMs: 0 })
      .catch((err) => {
        console.error(
          "[OrgCanvasBackground] zoomIntoNode failed for URL ref",
          targetRef,
          err,
        );
      })
      .finally(() => {
        setDeepLinkInFlight(false);
      });
    // Intentionally not depending on `searchParams` / `currentRef` —
    // we only want this to fire once on initial mount. Subsequent
    // navigation flows write to the URL, not the other way around.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  // (No runtime-reactive `?canvas=` follower. We previously had one
  // here so the AttentionList card could push `?canvas=&select=` onto
  // the URL and have the canvas drill in to match. That sync path was
  // fragile — `router.replace` lags `useSearchParams` by a render, so
  // breadcrumb-back was racing with our own URL writes and bouncing
  // the user back into the sub-canvas they just exited. AttentionList
  // now opens the workspace-scoped page in a new tab instead, which
  // sidesteps the sync problem entirely. The mount-only deep-link
  // effect above is the only `?canvas=` consumer; the URL is
  // write-only after that, and `handleBreadcrumbsChange` is the
  // single source of truth for `currentRef`.)

  // Refetch the current canvas's hidden list. Used after a hide on a
  // sub-canvas (so the pill picks up the fresh entry) and as the
  // reconcile path when an optimistic restore's follow-up read fails.
  const refreshHiddenLive = useCallback(() => {
    const ref = currentRefRef.current;
    fetchHiddenLive(githubLogin, ref === "" ? undefined : ref).then(
      setHiddenLive,
    );
  }, [githubLogin]);

  // Refetch the ROOT hidden list specifically. Drives `onHiddenChange`,
  // which seeds the chat workspace context — that contract is root-only
  // (workspaces only exist at root), independent of the user's current
  // scope. Used by the Pusher handler when a root-level update arrives.
  const refreshRootHiddenLive = useCallback(() => {
    fetchHiddenLive(githubLogin, undefined).then((entries) => {
      setRootHiddenLive(entries);
      // If the user is still on root, keep the pill in sync too.
      if (currentRefRef.current === "") setHiddenLive(entries);
    });
  }, [githubLogin]);

  // Notify the parent whenever the ROOT hidden-live set changes. Skips
  // until the initial fetch resolves (`rootHiddenLive` starts as `null`),
  // so the parent's first non-stub callback is the real list.
  // Critical for `OrgCanvasView`: it gates the chat mount on
  // `hiddenInitialized`, and the chat reads `defaultExtraWorkspaceSlugs`
  // only on mount — firing this with an empty stub would seed the
  // chat without any hidden filtering, then the real list would land
  // too late to take effect.
  useEffect(() => {
    if (rootHiddenLive === null) return;
    onHiddenChange?.(rootHiddenLive);
  }, [rootHiddenLive, onHiddenChange]);

  // Flush any pending saves on unmount so we don't lose the last edit.
  useEffect(() => {
    return () => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      const pending = dirtyRef.current;
      dirtyRef.current = new Map();
      for (const [key, data] of pending) {
        const ref = key === ROOT_KEY ? undefined : key;
        // Fire-and-forget; the tab is gone by the time this resolves but
        // fetch() still sends the request.
        void saveCanvas(githubLogin, ref, data);
      }
    };
  }, [githubLogin]);

  // Listen for agent-driven canvas updates. When the AI agent (or any
  // other tab / user) rewrites the canvas through `update_canvas` /
  // `patch_canvas`, the server emits `CANVAS_UPDATED` on the org channel
  // so every open viewer refetches and re-renders.
  //
  // Important: we skip the refetch if we have unsaved local edits
  // pending — the user's in-flight changes would be silently clobbered
  // by a read of stale remote state. The autosave flush will propagate
  // our edits shortly, and if a collision happens, last-write-wins.
  //
  // Subscription lifecycle is owned by `usePusherChannel` (refcounted)
  // so this component coexists safely with other consumers of the same
  // org channel — notably `ConnectionsListBody`, which used to call
  // `pusher.unsubscribe` directly and orphan our handler on every
  // parent re-render.
  const channelName = getOrgChannelName(githubLogin);
  const channel = usePusherChannel(channelName);
  useEffect(() => {
    if (!channel) return;

    // Diagnostic: log the subscription lifecycle so we can tell, in the
    // field, whether an agent-driven update arrived before or after the
    // server confirmed our subscription. (Non-presence channels drop any
    // events published during the pre-confirmation window.)
    const handleSubSucceeded = () => {
      console.log(`[OrgCanvasBackground] subscribed to ${channelName}`);
    };
    const handleSubError = (err: unknown) => {
      console.error(`[OrgCanvasBackground] subscription error on ${channelName}`, err);
    };
    channel.bind("pusher:subscription_succeeded", handleSubSucceeded);
    channel.bind("pusher:subscription_error", handleSubError);

    const handleCanvasUpdated = (payload: { ref?: string | null }) => {
      // Don't clobber unsaved local edits — our autosave flush will
      // propagate them shortly. On collision, last-write-wins.
      if (dirtyRef.current.size > 0) return;

      const ref = payload?.ref ?? null;
      if (!ref) {
        fetchRoot(githubLogin)
          .then((data) => setRoot(data))
          .catch((err) => {
            console.error(
              "[OrgCanvasBackground] refetch root after CANVAS_UPDATED failed",
              err,
            );
          });
        // Root hidden list can shift (agent hid/unhid a node, another
        // tab toggled it). Cheap call — one row read + Set lookup.
        // Mirror into `hiddenLive` too when the user is currently on
        // root, so the pill stays in sync with `rootHiddenLive`.
        fetchHiddenLive(githubLogin, undefined).then((entries) => {
          setRootHiddenLive(entries);
          if (currentRefRef.current === "") setHiddenLive(entries);
        });
        return;
      }
      // Only refetch sub-canvases we've actually opened. The cache is
      // keyed by ref; if the user hasn't drilled in, there's nothing to
      // update and the next `onResolveCanvas` will fetch fresh anyway.
      if (!subCanvasesRef.current[ref]) return;
      fetchSub(githubLogin, ref)
        .then((data) => {
          setSubCanvases((prev) => ({ ...prev, [ref]: data }));
        })
        .catch((err) => {
          console.error(
            "[OrgCanvasBackground] refetch sub after CANVAS_UPDATED failed",
            err,
          );
        });
      // If the update is for the canvas the user is currently looking
      // at, refresh its hidden list too — agents can hide live nodes
      // on sub-canvases just like on root.
      if (ref === currentRefRef.current) {
        fetchHiddenLive(githubLogin, ref).then(setHiddenLive);
      }
    };

    channel.bind(PUSHER_EVENTS.CANVAS_UPDATED, handleCanvasUpdated);
    return () => {
      channel.unbind("pusher:subscription_succeeded", handleSubSucceeded);
      channel.unbind("pusher:subscription_error", handleSubError);
      channel.unbind(PUSHER_EVENTS.CANVAS_UPDATED, handleCanvasUpdated);
    };
  }, [channel, channelName, githubLogin]);

  // Resolve a sub-canvas ref: serve from cache if present, otherwise fetch.
  const onResolveCanvas = useCallback(
    async (ref: string): Promise<CanvasData> => {
      const cached = subCanvasesRef.current[ref];
      if (cached) return cached;
      const data = await fetchSub(githubLogin, ref);
      setSubCanvases((prev) => ({ ...prev, [ref]: data }));
      return data;
    },
    [githubLogin],
  );

  // ----- Editing helpers -------------------------------------------------
  //
  // We route every mutation to either root state or the sub-canvas map,
  // keyed by `canvasRef` (undefined = root). The system-canvas core helpers
  // do the immutable merge for us, so each handler is essentially:
  //
  //   newData = helper(currentData, args)
  //   setLocal(newData); markDirty(canvasRef, newData);
  //
  // The two branches (root vs sub-canvas) are structurally identical; we
  // factor them through `applyMutation`.

  const applyMutation = useCallback(
    (
      canvasRef: string | undefined,
      mutate: (data: CanvasData) => CanvasData,
    ) => {
      if (!canvasRef) {
        const current = rootRef.current;
        if (!current) return;
        lastActionRef.current = { kind: "blob", canvasRef, prev: current };
        const next = mutate(current);
        setRoot(next);
        markDirty(undefined, next);
        return;
      }
      const current = subCanvasesRef.current[canvasRef];
      if (!current) return;
      lastActionRef.current = { kind: "blob", canvasRef, prev: current };
      const next = mutate(current);
      setSubCanvases((prev) => ({ ...prev, [canvasRef]: next }));
      markDirty(canvasRef, next);
    },
    [markDirty],
  );

  // -------------------------------------------------------------------
  // DB-creating `+` menu interception
  //
  // When the user picks `Initiative` or `Milestone` from the `+` menu,
  // the library hands us a freshly-synthesized authored node. We do
  // NOT add it to the canvas blob. Instead we open the matching
  // creation dialog with the click position cached, hit the REST API
  // on save, then save the click position into `Canvas.data.positions`
  // for the projected node id so the new card lands where the user
  // clicked. The Pusher `CANVAS_UPDATED` event from the API then
  // re-projects the new entity onto the canvas.
  //
  // Cancel: nothing happens. No node was added.
  // -------------------------------------------------------------------

  /**
   * Pending dialog state for an interception. Carries the click
   * position so we can save it once the API returns the new entity id.
   * `canvasRef` tracks which canvas the click came from — root for
   * initiatives, `initiative:<id>` for milestones.
   */
  type PendingInitiativeAdd = {
    kind: "initiative";
    x: number;
    y: number;
    canvasRef: string | undefined;
  };
  type PendingMilestoneAdd = {
    kind: "milestone";
    x: number;
    y: number;
    /** Always an `initiative:<id>` ref — milestones can only be added inside one. */
    canvasRef: string;
    initiativeId: string;
    /** Count + 1 from the server; undefined if fetch failed (dialog opens with empty field). */
    defaultSequence?: number;
  };
  /**
   * Pending feature-create from either the `+` menu or a "Promote to
   * Feature" right-click on a note. `canvasRef` is the scope the user
   * triggered from — the dialog uses it to lock fields. `prefill` is
   * set on the Promote path; the note's text seeds title + brief.
   */
  type PendingFeatureAdd = {
    kind: "feature";
    x: number;
    y: number;
    /** Empty string ("") means root canvas; otherwise the sub-canvas ref. */
    canvasRef: string | undefined;
    prefill?: { title?: string; brief?: string };
    /**
     * If set, the dialog was opened by promoting a note. After save we
     * delete the source note from its canvas (the user "consumed" it).
     */
    sourceNoteId?: string;
  };
  /**
   * Pending service-create from the `+ Service` menu pick on a workspace
   * sub-canvas. Unlike initiative / milestone / feature, services are
   * NOT DB-projected — the new node lands directly in the canvas blob
   * via `applyMutation` once the dialog returns. We carry only the click
   * position and the source canvas ref through; the dialog supplies
   * the name + platform kind.
   *
   * `node` is the freshly-synthesized authored node the library handed
   * us (carrying the lib-generated id, default size from the category,
   * and the click x/y). We hold onto it so we can drop the dialog's
   * name + kind into it on save without re-synthesizing the id.
   */
  type PendingServiceAdd = {
    kind: "service";
    node: CanvasNode;
    canvasRef: string | undefined;
  };
  type PendingAdd =
    | PendingInitiativeAdd
    | PendingMilestoneAdd
    | PendingFeatureAdd
    | PendingServiceAdd;

  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);

  /**
   * Save a freshly-created live node's click position into the canvas
   * blob so it lands where the user clicked. Fire-and-forget: the API
   * response from POST already returned the new id, so we can write
   * the position before the projector re-emits the node — by the time
   * Pusher fires the refresh, the position overlay is already in place.
   */
  const savePositionForLiveId = useCallback(
    async (
      canvasRef: string | undefined,
      liveId: string,
      x: number,
      y: number,
    ) => {
      try {
        // Read-modify-write the relevant canvas. We read first so we
        // don't clobber other position overlays the user already set.
        const url = canvasRef
          ? `/api/orgs/${githubLogin}/canvas/${encodeURIComponent(canvasRef)}`
          : `/api/orgs/${githubLogin}/canvas`;
        const res = await fetch(url);
        if (!res.ok) return;
        const body = await res.json();
        const data: CanvasData = body.data ?? { nodes: [], edges: [] };
        // Append a stub node carrying the position. The server's
        // splitter will treat its live id as a positions overlay and
        // discard everything else (text/category/customData). It
        // doesn't matter that the projector hasn't emitted the real
        // node yet — the position survives independently.
        const existingNodes = data.nodes ?? [];
        const nextNodes: CanvasNode[] = [
          ...existingNodes.filter((n) => n.id !== liveId),
          {
            id: liveId,
            type: "text",
            category: "",
            text: "",
            x,
            y,
          },
        ];
        await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: { ...data, nodes: nextNodes } }),
        });
      } catch (err) {
        // Non-fatal: the node will appear at the projector's default
        // position and the user can drag it.
        console.error(
          "[OrgCanvasBackground] savePositionForLiveId failed",
          err,
        );
      }
    },
    [githubLogin],
  );

  // ===================================================================
  // Research kickoff
  // ===================================================================
  //
  // The Research feature is the first canvas node type with an
  // **authored\u2192live** lifecycle. The user picks `+ Research` from the
  // menu, types a topic into the dropped node, and on text commit the
  // node fires a synthetic chat message that drives the agent's
  // `save_research` tool (see `src/lib/ai/researchTools.ts`).
  //
  // **The authored\u2192live swap is NOT a client-side concern.** Earlier
  // versions of this feature tried to swap in the client (FIFO
  // queue + processed-id set + `applyMutation(removeNode)` + various
  // race-y refetch sequences). It never converged \u2014 autosave, pusher
  // refetch, and the position-overlay write all fought each other,
  // and any failure left a phantom authored node in the canvas blob.
  //
  // The swap now happens **at the IO boundary** in
  // `src/lib/canvas/io.ts` (`dedupeAuthoredResearch`): on every read
  // and every write, an authored `research` node whose text matches
  // a live `research:<id>` node's text is dropped, with its position
  // carried into the live node's overlay if no overlay exists. That
  // gives us the visible swap on the user's next canvas refresh
  // (which Pusher triggers within ~300ms of `save_research`
  // returning) and self-heals the persisted blob on the next
  // autosave. No client-side queue, no race conditions, no phantom
  // nodes.
  //
  // The only client-side work is firing the kickoff. Tracking which
  // authored node ids we've already kicked off prevents a double-fire
  // if the user hits Enter twice on the same node before the swap
  // happens.

  /**
   * Authored research node ids whose kickoff we've already fired.
   * The library prefills new nodes with placeholder text ("New
   * node") rather than an empty string, so we can't use
   * "empty\u2192non-empty" as the trigger. Instead: fire the kickoff the
   * first time the user-typed text differs from whatever was there
   * before AND we haven't already fired for this id.
   */
  const firedResearchKickoffsRef = useRef<Set<string>>(new Set());

  const sendCanvasChatMessage = useSendCanvasChatMessage();

  /**
   * Fire the synthetic user message that drives the agent.
   *
   * The store's `activeConversationId` may legitimately be null for a
   * brief window during initial mount (before `OrgCanvasView` calls
   * `startConversation`). In that case we drop the kickoff silently
   * \u2014 the user can hit Enter again once the chat is ready, or just
   * type the request directly. We don't want to retry-loop the
   * kickoff because that'd race with the user editing the node.
   */
  const fireResearchKickoff = useCallback(
    (topic: string) => {
      const trimmedTopic = topic.trim();
      if (!trimmedTopic) return;
      const conversationId =
        useCanvasChatStore.getState().activeConversationId;
      if (!conversationId) {
        console.warn(
          "[OrgCanvasBackground] research kickoff fired before chat conversation was ready; user will need to retry or type the request manually",
        );
        return;
      }
      // Format that the prompt suffix instructs the agent to recognize
      // ("if you see a synthetic user message of the form 'Research:
      // <topic>', that's the signal"). The agent extracts the topic
      // and is told to pass it as `topic` verbatim into save_research,
      // which is what makes the IO-layer text-equality dedupe work.
      void sendCanvasChatMessage({
        conversationId,
        content: `Research: ${trimmedTopic}`,
      });
    },
    [sendCanvasChatMessage],
  );

  /**
   * Open the InitiativeDialog with the click position cached. Caller
   * passes the synthetic node from the library so we can pull `x`/`y`
   * off it.
   */
  const startInitiativeCreate = useCallback(
    (node: CanvasNode, canvasRef: string | undefined) => {
      setPendingAdd({
        kind: "initiative",
        x: node.x,
        y: node.y,
        canvasRef,
      });
    },
    [],
  );

  /**
   * Open the MilestoneDialog. Pre-fetch the initiative's existing
   * milestones so we know which sequence numbers are taken (needed
   * for the dialog's client-side validation) and what the next-free
   * sequence is to pre-populate the form.
   *
   * Caller (handleNodeAdd) must already have validated the scope —
   * this function trusts that `canvasRef` is `initiative:<id>`.
   */
  const startMilestoneCreate = useCallback(
    async (node: CanvasNode, canvasRef: string) => {
      const initiativeId = canvasRef.slice("initiative:".length);
      try {
        const res = await fetch(
          `/api/orgs/${githubLogin}/initiatives/${initiativeId}/milestones`,
        );
        const data = res.ok ? await res.json() : null;
        const defaultSequence = data ? data.count + 1 : undefined;
        setPendingAdd({
          kind: "milestone",
          x: node.x,
          y: node.y,
          canvasRef,
          initiativeId,
          defaultSequence,
        });
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] failed to fetch milestones for dialog seed",
          err,
        );
        setPendingAdd({
          kind: "milestone",
          x: node.x,
          y: node.y,
          canvasRef,
          initiativeId,
          defaultSequence: undefined,
        });
      }
    },
    [githubLogin],
  );

  /**
   * Open the CreateFeatureCanvasDialog. Unlike initiative/milestone
   * dialogs, feature creation has no scope-bound pre-fetch: the dialog
   * itself loads workspaces / initiatives / edge hints lazily on open.
   * The caller passes `prefill` only when this is a promote-from-note
   * path (so the dialog seeds its title + description).
   */
  const startFeatureCreate = useCallback(
    (
      node: CanvasNode,
      canvasRef: string | undefined,
      prefill?: { title?: string; brief?: string },
      sourceNoteId?: string,
    ) => {
      setPendingAdd({
        kind: "feature",
        x: node.x,
        y: node.y,
        canvasRef,
        prefill,
        sourceNoteId,
      });
    },
    [],
  );

  /**
   * Open the CreateServiceCanvasDialog. Service is authored-only (no
   * DB row), so this just stashes the lib-synthesized node and waits
   * for the dialog to fill in name + platform `kind` — at which point
   * `handleSaveService` writes the node to the canvas blob via
   * `applyMutation`. Caller (handleNodeAdd) must have validated scope.
   */
  const startServiceCreate = useCallback(
    (node: CanvasNode, canvasRef: string | undefined) => {
      setPendingAdd({ kind: "service", node, canvasRef });
    },
    [],
  );

  const handleNodeAdd = useCallback(
    (node: CanvasNode, canvasRef: string | undefined) => {
      const category = node.category ?? "";
      const ref = canvasRef ?? "";

      // DB-creating categories are routed through their dialog. The
      // scope-aware `+` menu filter shouldn't have offered the option
      // outside its valid scope, but check here too — a stale menu
      // pick (e.g. user navigated mid-click) shouldn't create at the
      // wrong scope. Single rule, two enforcement points.
      if (DB_CREATING_CATEGORIES.has(category)) {
        if (!categoryAllowedOnScope(category, ref)) return;
        if (category === "initiative") {
          startInitiativeCreate(node, canvasRef);
          return;
        }
        if (category === "milestone") {
          // categoryAllowedOnScope guarantees ref starts with "initiative:".
          void startMilestoneCreate(node, ref);
          return;
        }
        if (category === "feature") {
          // Allowed on every scope per `categoryAllowedOnScope`. The
          // dialog handles per-scope field locking; we just hand off
          // the click position.
          startFeatureCreate(node, canvasRef);
          return;
        }
      }

      // Service is authored-only (no DB row, no projector) but still
      // routes through a dialog so the user picks a platform icon up
      // front. We don't add it to DB_CREATING_CATEGORIES — that set's
      // semantic is "needs a REST POST"; service skips the API entirely
      // and lands in the canvas blob via `applyMutation` once the dialog
      // returns. Still scope-guarded against a stale menu pick.
      if (category === "service") {
        if (!categoryAllowedOnScope(category, ref)) return;
        startServiceCreate(node, canvasRef);
        return;
      }

      applyMutation(canvasRef, (c) => addNode(c, node));
    },
    [
      applyMutation,
      startInitiativeCreate,
      startMilestoneCreate,
      startFeatureCreate,
      startServiceCreate,
    ],
  );

  // -------------------------------------------------------------------
  // Dialog save handlers
  // -------------------------------------------------------------------

  const handleSaveInitiative = useCallback(
    async (form: InitiativeForm): Promise<void> => {
      if (pendingAdd?.kind !== "initiative") return;
      const body: Record<string, unknown> = {
        name: form.name,
        description: form.description || undefined,
        status: form.status,
        startDate: form.startDate || undefined,
        targetDate: form.targetDate || undefined,
        completedAt: form.completedAt || undefined,
      };
      const res = await fetch(`/api/orgs/${githubLogin}/initiatives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // Surface enough info to console; the dialog's `onSave` swallows
        // the throw so this is the user-visible signal we have today.
        // A toast belongs here when we add the global toast system.
        console.error(
          "[OrgCanvasBackground] create initiative failed",
          res.status,
        );
        return;
      }
      const created: InitiativeResponse = await res.json();
      // Pin the new initiative to the click position before refetching
      // so the refetched canvas already has the position overlay
      // applied. If the position write fails, the projector falls back
      // to default placement and the user can drag.
      await savePositionForLiveId(
        pendingAdd.canvasRef,
        `initiative:${created.id}`,
        pendingAdd.x,
        pendingAdd.y,
      );
      // Local refetch: don't wait for the Pusher fan-out (300ms delay
      // + WebSocket round-trip + dirtyRef guard). The user just took
      // an explicit action; the new card should appear immediately.
      // Pusher still handles other tabs / users.
      try {
        const data = await fetchRoot(githubLogin);
        setRoot(data);
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] refetch after create initiative failed",
          err,
        );
      }
    },
    [githubLogin, pendingAdd, savePositionForLiveId],
  );

  const handleSaveMilestone = useCallback(
    async (form: MilestoneForm): Promise<{ error?: string }> => {
      if (pendingAdd?.kind !== "milestone") return {};
      const body: Record<string, unknown> = {
        name: form.name,
        description: form.description || undefined,
        status: form.status,
        sequence: parseInt(form.sequence, 10),
        dueDate: form.dueDate || undefined,
        completedAt: form.completedAt || undefined,
      };
      const res = await fetch(
        `/api/orgs/${githubLogin}/initiatives/${pendingAdd.initiativeId}/milestones`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (res.status === 409) {
        return {
          error:
            "A milestone with that sequence already exists in this initiative.",
        };
      }
      if (!res.ok) {
        return { error: "Failed to create milestone." };
      }
      const created: MilestoneResponse = await res.json();
      // Same pattern as initiative create: position-save first so the
      // refetch already reflects it, then refresh the timeline locally
      // for snappy UX. Pusher still notifies other tabs.
      const subRef = pendingAdd.canvasRef;
      await savePositionForLiveId(
        subRef,
        `milestone:${created.id}`,
        pendingAdd.x,
        pendingAdd.y,
      );
      try {
        const data = await fetchSub(githubLogin, subRef);
        setSubCanvases((prev) => ({ ...prev, [subRef]: data }));
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] refetch after create milestone failed",
          err,
        );
      }
      return {};
    },
    [githubLogin, pendingAdd, savePositionForLiveId],
  );

  /**
   * Save handler for the CreateFeatureCanvasDialog. Hits POST
   * /api/features with the resolved `(workspaceId, initiativeId,
   * milestoneId)` triple, then routes the click-position save and
   * canvas refetch to the **target** canvas — which is the most
   * specific scope the new feature lives on, NOT the canvas the user
   * triggered from. Example: user creates from root and picks an
   * initiative → the new feature card appears on the initiative's
   * sub-canvas, so we save the position there and refetch that
   * sub-canvas (not root).
   *
   * If the dialog was opened via "Promote to Feature" on a note,
   * `pendingAdd.sourceNoteId` is set and we remove that note from the
   * originating canvas after the feature is created — the user
   * "consumed" the note when they promoted it.
   */
  const handleSaveFeature = useCallback(
    async (form: FeatureCreateForm): Promise<void> => {
      if (pendingAdd?.kind !== "feature") return;
      const body: Record<string, unknown> = {
        title: form.title,
        workspaceId: form.workspaceId,
        ...(form.brief ? { brief: form.brief } : {}),
        ...(form.initiativeId ? { initiativeId: form.initiativeId } : {}),
        ...(form.milestoneId ? { milestoneId: form.milestoneId } : {}),
      };
      const res = await fetch(`/api/features`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // Surface enough info to console; toast lands here when the
        // global toast system arrives (same gap as initiative/milestone).
        const detail = await res.text().catch(() => "");
        console.error(
          "[OrgCanvasBackground] create feature failed",
          res.status,
          detail,
        );
        return;
      }
      const payload = await res.json();
      const created: { id: string } = payload?.data ?? payload;

      // Resolve the target canvas ref by the "most specific place
      // wins" rule. This must mirror the projector emission rules:
      //   - initiativeId set (with or without milestoneId) → initiative:<id>
      //   - neither set                                    → ws:<id>
      // Milestone-bound features render on their parent initiative's
      // canvas (with a synthetic edge to the milestone card on the
      // same canvas) — there is no separate milestone canvas. Mismatch
      // here would save the position overlay on the wrong canvas, the
      // projected node would render at the projector default, and the
      // user's click position would silently vanish.
      const targetRef: string = form.initiativeId
        ? `initiative:${form.initiativeId}`
        : `ws:${form.workspaceId}`;

      // Save the click position before refetching so the position
      // overlay is already in the blob by the time the canvas reads.
      // Note we pass the **target** ref, not the source canvas ref —
      // the position lives on the canvas the feature renders on.
      await savePositionForLiveId(
        targetRef,
        `feature:${created.id}`,
        pendingAdd.x,
        pendingAdd.y,
      );

      // Promote-from-note path: remove the source note. We do this
      // through the same `applyMutation` flow as a regular delete so
      // the autosave + Pusher broadcast follow the standard path.
      if (pendingAdd.sourceNoteId) {
        applyMutation(pendingAdd.canvasRef, (c) =>
          removeNode(c, pendingAdd.sourceNoteId!),
        );
      }

      // Local refetch of the **target** canvas so the new feature
      // shows up immediately. If the target is the same canvas the
      // user is on, this is the natural refresh; if it's elsewhere
      // (e.g. created on root, lands on initiative), the user will
      // see the card on first drill-in. Pusher fan-out handles other
      // tabs/users.
      try {
        if (targetRef === "") {
          // Defensive: today no feature lands on root (the matrix
          // above always picks a sub-canvas), but keep this branch
          // so the code stays correct if the rules expand.
          const data = await fetchRoot(githubLogin);
          setRoot(data);
        } else {
          const data = await fetchSub(githubLogin, targetRef);
          setSubCanvases((prev) => ({ ...prev, [targetRef]: data }));
        }
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] refetch after create feature failed",
          err,
        );
      }
    },
    [githubLogin, pendingAdd, savePositionForLiveId, applyMutation],
  );

  /**
   * Save handler for `CreateServiceCanvasDialog`. Pure canvas-blob write
   * — no REST POST, no projector. We take the lib-synthesized node we
   * stashed in `pendingAdd.node`, merge in the dialog's `name` (as
   * `text`) and `kind` (as `customData.kind`), and drop the result into
   * the canvas blob via `applyMutation`. The click position the lib
   * gave us is already on `node.x` / `node.y` so the card lands where
   * the user clicked.
   *
   * No projector means no Pusher fan-out — the local `applyMutation`
   * is the only state update needed. Other tabs/users see the new
   * service on their next canvas read (or via autosave's mirror to
   * `Canvas.data`).
   */
  const handleSaveService = useCallback(
    async (form: { name: string; kind: string }): Promise<void> => {
      if (pendingAdd?.kind !== "service") return;
      const { node, canvasRef } = pendingAdd;
      const merged: CanvasNode = {
        ...node,
        text: form.name,
        customData: {
          // Preserve anything the lib synthesized (today there's
          // nothing, but defensive merge so future lib fields survive).
          ...(node.customData ?? {}),
          kind: form.kind,
        },
      };
      applyMutation(canvasRef, (c) => addNode(c, merged));
    },
    [pendingAdd, applyMutation],
  );

  /**
   * Save handler for the CreateFeatureCanvasDialog's **Assign existing**
   * tab. Two flavors driven by the discriminated payload:
   *
   *   - `kind: "workspace-pin"` (workspace canvas) — POST to
   *     `/canvas/assigned-features` with `action: "assign"` to add the
   *     feature id to the canvas's `assignedFeatures` overlay. Feature
   *     row unchanged. Click position lands the card.
   *
   *   - `kind: "initiative-attach"` (initiative canvas) — PATCH
   *     `/api/features/[id]` with `{ initiativeId }` to set the loose
   *     feature's anchor. Service-side `notifyFeatureReassignmentRefresh`
   *     fans out CANVAS_UPDATED to both initiatives (in this case just
   *     the landing one — `before.initiativeId` is null for loose
   *     features). The projector emits the card on this initiative's
   *     canvas alongside its milestones on the next read.
   *
   * Both paths converge on the same `savePositionForLiveId + refetch`
   * tail so the card lands where the user clicked.
   */
  const handleAssignFeature = useCallback(
    async (form: FeatureAssignForm): Promise<void> => {
      if (pendingAdd?.kind !== "feature") return;

      // Resolve `(targetRef, mutationFetch)` per flavor. `targetRef`
      // is always the canvas the user is currently on — exactly the
      // canvas the new card should appear on, since both flavors
      // re-project onto the source scope after the mutation.
      let targetRef: string;
      let mutationFetch: () => Promise<Response>;

      if (form.kind === "workspace-pin") {
        targetRef = `ws:${form.workspaceId}`;
        // Defensive: the dialog only surfaces the workspace-pin
        // payload when the pending scope is the matching workspace
        // canvas. Bail out instead of silently writing to the wrong
        // canvas if it doesn't.
        if (pendingAdd.canvasRef !== targetRef) {
          console.error(
            "[OrgCanvasBackground] handleAssignFeature canvasRef mismatch (workspace)",
            { pendingRef: pendingAdd.canvasRef, targetRef },
          );
          return;
        }
        mutationFetch = () =>
          fetch(`/api/orgs/${githubLogin}/canvas/assigned-features`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ref: targetRef,
              featureId: form.featureId,
              action: "assign",
            }),
          });
      } else {
        targetRef = `initiative:${form.initiativeId}`;
        if (pendingAdd.canvasRef !== targetRef) {
          console.error(
            "[OrgCanvasBackground] handleAssignFeature canvasRef mismatch (initiative)",
            { pendingRef: pendingAdd.canvasRef, targetRef },
          );
          return;
        }
        mutationFetch = () =>
          fetch(`/api/features/${form.featureId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initiativeId: form.initiativeId }),
          });
      }

      const res = await mutationFetch();
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(
          "[OrgCanvasBackground] assign feature failed",
          form.kind,
          res.status,
          detail,
        );
        return;
      }

      await savePositionForLiveId(
        targetRef,
        `feature:${form.featureId}`,
        pendingAdd.x,
        pendingAdd.y,
      );
      try {
        const data = await fetchSub(githubLogin, targetRef);
        setSubCanvases((prev) => ({ ...prev, [targetRef]: data }));
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] refetch after assign feature failed",
          err,
        );
      }
    },
    [githubLogin, pendingAdd, savePositionForLiveId],
  );

  /**
   * Persist a milestone status change to the DB. Fire-and-forget; on
   * success the API route emits CANVAS_UPDATED which round-trips through
   * the projector and reconciles the canonical status. On failure, log
   * and let the next read pull the unchanged status — the optimistic
   * local change will be quietly reverted, which is acceptable for the
   * "I clicked the wrong swatch" scenario.
   */
  const persistMilestoneStatus = useCallback(
    async (
      milestoneId: string,
      initiativeId: string,
      status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED",
    ) => {
      try {
        const res = await fetch(
          `/api/orgs/${githubLogin}/initiatives/${initiativeId}/milestones/${milestoneId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          },
        );
        if (!res.ok) {
          console.error(
            `[OrgCanvasBackground] PATCH milestone status failed (${res.status})`,
          );
        }
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] PATCH milestone status threw",
          err,
        );
      }
    },
    [githubLogin],
  );

  /**
   * Persist a feature title rename to the DB. Same fire-and-forget
   * shape as `persistMilestoneStatus`: optimistic local update lands
   * via `applyMutation`, then the PATCH round-trips through the API
   * route → projector → Pusher CANVAS_UPDATED, which reconciles to
   * the canonical `Feature.title`. On failure, log and let the next
   * read snap the card back to the prior title.
   *
   * Trim happens server-side too (`updateFeature`), but we trim here
   * to skip the network call when the user typed only whitespace.
   */
  const persistFeatureTitle = useCallback(
    async (featureId: string, title: string) => {
      const trimmed = title.trim();
      if (trimmed.length === 0) return;
      try {
        const res = await fetch(`/api/features/${featureId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(
            "[OrgCanvasBackground] PATCH feature title failed",
            res.status,
            detail,
          );
        }
      } catch (err) {
        console.error("[OrgCanvasBackground] PATCH feature title threw", err);
      }
    },
    [],
  );

  const handleNodeUpdate = useCallback(
    (id: string, patch: NodeUpdate, canvasRef: string | undefined) => {
      // Snapshot the pre-update node BEFORE we apply the mutation. The
      // research-kickoff branch below needs to see whether the text
      // just transitioned empty\u2192non-empty, which requires the prior
      // value. `applyMutation` reads from refs that lag React state
      // by a render anyway, so reading them here is consistent with
      // what the mutation will see.
      const sourceCanvas = canvasRef
        ? subCanvasesRef.current[canvasRef]
        : rootRef.current;
      const prevNode = sourceCanvas?.nodes?.find((n) => n.id === id);

      // Optimistic local update first — keeps the swatch reflecting the
      // user's choice immediately, regardless of which path we take
      // below. The autosave will silently drop customData on live ids
      // (the splitter discards it), so this never round-trips through
      // the canvas blob — the PATCH below is the only persistence path
      // for status.
      applyMutation(canvasRef, (c) => updateNode(c, id, patch));

      // For milestone live nodes: a status change is a DB mutation, not
      // a canvas blob change. Intercept it here and PATCH the milestone
      // REST endpoint. Position changes (x/y) still flow through the
      // normal autosave path as `positions[liveId]` overlays.
      if (
        id.startsWith("milestone:") &&
        canvasRef?.startsWith("initiative:")
      ) {
        const newStatus = patch.customData?.status;
        if (
          newStatus === "NOT_STARTED" ||
          newStatus === "IN_PROGRESS" ||
          newStatus === "COMPLETED"
        ) {
          const milestoneId = id.slice("milestone:".length);
          const initiativeId = canvasRef.slice("initiative:".length);
          void persistMilestoneStatus(milestoneId, initiativeId, newStatus);
        }
      }

      // For feature live nodes: a text edit is a DB title rename, not
      // a canvas blob change. The splitter drops `text` on live ids
      // (see `src/lib/canvas/io.ts`), so without this intercept the
      // user's edit reverts on the next read. Skip when the text
      // didn't actually change to avoid spurious PATCHes from
      // re-renders.
      if (id.startsWith("feature:") && patch.text !== undefined) {
        const prevText = (prevNode?.text ?? "").trim();
        const nextText = patch.text.trim();
        if (nextText.length > 0 && nextText !== prevText) {
          const featureId = id.slice("feature:".length);
          void persistFeatureTitle(featureId, nextText);
        }
      }

      // Research kickoff trigger. When an authored research node's
      // text gets edited for the first time, fire the chat-side
      // kickoff that drives `save_research`. Authored = no
      // `research:` id prefix; that prefix only appears once the
      // projector emits the live node post-save. The authored
      // placeholder gets dropped automatically once the live node
      // arrives \u2014 the dedupe runs in `dedupeAuthoredResearch`
      // (`src/lib/canvas/io.ts`) on every read AND every write.
      //
      // The trigger isn't "empty\u2192non-empty" because the library
      // prefills new nodes with placeholder text like "New node"
      // instead of "". Instead, we fire on the FIRST text edit per
      // authored node id (tracked in `firedResearchKickoffsRef`),
      // skipping spurious updates where text didn't actually change.
      if (
        prevNode &&
        prevNode.category === "research" &&
        !id.startsWith("research:") &&
        patch.text !== undefined &&
        !firedResearchKickoffsRef.current.has(id)
      ) {
        const prevText = (prevNode.text ?? "").trim();
        const nextText = patch.text.trim();
        if (nextText.length > 0 && nextText !== prevText) {
          firedResearchKickoffsRef.current.add(id);
          fireResearchKickoff(nextText);
        }
      }
    },
    [
      applyMutation,
      fireResearchKickoff,
      persistMilestoneStatus,
      persistFeatureTitle,
    ],
  );

  /**
   * Batched drag commit. Fires once per drag-end with every moved node
   * — for a single-node drag that's a one-entry array; for a group
   * drag it's the group plus every spatially-contained child.
   *
   * Why this exists: `applyMutation` reads `rootRef.current` /
   * `subCanvasesRef.current`, both mirrored from React state via
   * `useEffect`. The mirror runs *after* React commits, so a synchronous
   * loop of per-node `onNodeUpdate` calls all read the same stale
   * starting state and each `setRoot` overwrites the previous one. The
   * visible bug: dragging a group leaves every child snapping back
   * except the last one in the iteration order. Folding all moves
   * into a single `applyMutation` (which chains every patch through
   * `updateNode` against one starting state) commits the group
   * atomically.
   *
   * The drag path never carries `customData` — only x/y — so we can
   * skip the milestone status special case here. Toolbar status
   * changes still come through `onNodeUpdate` as before.
   */
  const handleNodesUpdate = useCallback(
    (
      updates: { id: string; patch: NodeUpdate }[],
      canvasRef: string | undefined,
    ) => {
      if (updates.length === 0) return;
      applyMutation(canvasRef, (c) =>
        updates.reduce((acc, u) => updateNode(acc, u.id, u.patch), c),
      );
    },
    [applyMutation],
  );
  const handleNodeDelete = useCallback(
    (id: string, canvasRef: string | undefined) => {
      // Live nodes (workspaces, repos, features) aren't deletable — they
      // belong to the DB. "Delete" on the canvas means "hide on this
      // view." Route to the dedicated endpoint, and optimistically drop
      // the node from local state so the UI reacts immediately. The
      // endpoint is idempotent, so a race with a concurrent hide is
      // harmless.
      if (isLiveId(id)) {
        lastActionRef.current = { kind: "hide", canvasRef, id };
        applyMutation(canvasRef, (c) => removeNode(c, id));
        void toggleLiveVisibility(githubLogin, canvasRef, id, "hide").then(
          () => {
            // Refresh whichever hidden list this hide affected so the
            // pill picks up the new entry. Hides on root also feed the
            // chat workspace seed (`rootHiddenLive`).
            if (!canvasRef) {
              refreshRootHiddenLive();
            } else if (canvasRef === currentRefRef.current) {
              refreshHiddenLive();
            }
          },
        );
        return;
      }
      applyMutation(canvasRef, (c) => removeNode(c, id));
    },
    [applyMutation, githubLogin, refreshHiddenLive, refreshRootHiddenLive],
  );

  /**
   * Restore a hidden live node on the canvas the user is currently
   * looking at. Fire-and-forget the server call, then refetch that
   * canvas so the newly-unhidden node gets its full projection (name,
   * ref, rollups) rather than the stub we have in `hiddenLive`.
   * Works for any scope: workspaces on root, repos on a workspace
   * sub-canvas, etc. — `currentRef` decides which canvas the
   * `/canvas/hide` endpoint mutates.
   */
  const handleRestoreLive = useCallback(
    async (id: string) => {
      const ref = currentRefRef.current;
      const isRoot = ref === "";
      lastActionRef.current = {
        kind: "show",
        canvasRef: isRoot ? undefined : ref,
        id,
      };
      // Optimistic: remove from the pill immediately so users don't
      // wait on a round-trip before the popover reflects their click.
      // The pill is only ever shown after the initial fetch resolved
      // (it's mounted by `entries={hiddenLive ?? []}`), so this path
      // can only fire while `prev` is a real array — but guard anyway
      // so a misbehaving caller can't crash here.
      setHiddenLive((prev) =>
        prev === null ? prev : prev.filter((e) => e.id !== id),
      );
      // Mirror the optimistic removal into `rootHiddenLive` too when
      // we're on root so the chat seed stays in sync without a refetch.
      if (isRoot) {
        setRootHiddenLive((prev) =>
          prev === null ? prev : prev.filter((e) => e.id !== id),
        );
      }
      await toggleLiveVisibility(
        githubLogin,
        isRoot ? undefined : ref,
        id,
        "show",
      );
      // Refetch the canvas the restore happened on so the newly-visible
      // projected node renders. Hidden-list refetch is implicit — we
      // already removed it locally.
      try {
        if (isRoot) {
          const data = await fetchRoot(githubLogin);
          setRoot(data);
        } else {
          const data = await fetchSub(githubLogin, ref);
          setSubCanvases((prev) => ({ ...prev, [ref]: data }));
        }
      } catch (err) {
        console.error("[OrgCanvasBackground] refetch after restore failed", err);
        // Reconcile the pill if the refetch dropped out — the server's
        // current state is the source of truth.
        refreshHiddenLive();
        if (isRoot) refreshRootHiddenLive();
      }
    },
    [githubLogin, refreshHiddenLive, refreshRootHiddenLive],
  );

  const handleUndo = useCallback(async () => {
    const action = lastActionRef.current;
    if (!action) return;
    lastActionRef.current = null; // consume — ctrl-z twice is a no-op

    if (action.kind === "blob") {
      if (!action.canvasRef) {
        setRoot(action.prev);
        markDirty(undefined, action.prev);
      } else {
        setSubCanvases((prev) => ({
          ...prev,
          [action.canvasRef!]: action.prev,
        }));
        markDirty(action.canvasRef, action.prev);
      }
      return;
    }

    if (action.kind === "hide") {
      // Undo a hide → reuse the existing handleRestoreLive path exactly
      await handleRestoreLive(action.id);
      return;
    }

    if (action.kind === "show") {
      // Undo a restore → re-hide (mirror of handleNodeDelete live path)
      const ref = action.canvasRef;
      applyMutation(ref, (c) => removeNode(c, action.id));
      await toggleLiveVisibility(githubLogin, ref, action.id, "hide");
      if (!ref) {
        refreshRootHiddenLive();
      } else if (ref === currentRefRef.current) {
        refreshHiddenLive();
      }
    }
  }, [
    markDirty,
    applyMutation,
    githubLogin,
    handleRestoreLive,
    refreshHiddenLive,
    refreshRootHiddenLive,
  ]);

  // Ctrl-Z / Cmd-Z undo listener — scoped to canvas mount lifetime.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key !== "z") return;
      // Don't intercept undo inside text inputs / rich-text editors
      const tag = (e.target as HTMLElement).tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement).isContentEditable
      )
        return;
      e.preventDefault();
      void handleUndo();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleUndo]);

  /**
   * Detect a user-drawn edge whose endpoints are a feature card and a
   * milestone card on the initiative canvas. Either direction is
   * accepted (feature → milestone or milestone → feature). Returns
   * `{ featureId, milestoneId }` for the membership PATCH or `null`
   * when the edge is something else (feature-to-feature dependency,
   * authored note → live container, etc. — those flow through the
   * default blob path).
   */
  const detectFeatureMilestoneEdge = useCallback(
    (
      edge: CanvasEdge,
    ): { featureId: string; milestoneId: string } | null => {
      const a = edge.fromNode;
      const b = edge.toNode;
      if (a.startsWith("feature:") && b.startsWith("milestone:")) {
        return {
          featureId: a.slice("feature:".length),
          milestoneId: b.slice("milestone:".length),
        };
      }
      if (a.startsWith("milestone:") && b.startsWith("feature:")) {
        return {
          featureId: b.slice("feature:".length),
          milestoneId: a.slice("milestone:".length),
        };
      }
      return null;
    },
    [],
  );

  /**
   * Fire-and-forget PATCH that attaches a feature to a milestone via
   * `Feature.milestoneId`. Same shape as the drag-drop reassignment
   * path (`reassignFeatureToMilestone`), used here so user-drawn
   * edges express DB membership instead of authored-blob edges.
   * Pass `null` to detach. The Pusher fan-out from the API route
   * handles the canvas refresh; the synthetic edge appears (or
   * disappears) on the next read.
   */
  const patchFeatureMilestone = useCallback(
    async (featureId: string, milestoneId: string | null) => {
      try {
        const res = await fetch(`/api/features/${featureId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ milestoneId }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(
            "[OrgCanvasBackground] patchFeatureMilestone failed",
            res.status,
            detail,
          );
        }
      } catch (err) {
        console.error("[OrgCanvasBackground] patchFeatureMilestone threw", err);
      }
    },
    [],
  );

  const handleEdgeAdd = useCallback(
    (edge: CanvasEdge, canvasRef: string | undefined) => {
      // Intercept feature↔milestone edges as DB membership writes
      // rather than authored-blob edges. The relationship is owned by
      // `Feature.milestoneId`; the projector emits a synthetic edge
      // on every read to visually represent it. Letting the
      // user-drawn edge sit in the blob alongside the synthetic one
      // would create two parallel representations that can disagree
      // when the DB is mutated through other paths.
      //
      // To avoid the user seeing their edge "disappear and reappear"
      // across the PATCH + Pusher round-trip, we **rename** the
      // edge's id in place to the predicted synthetic id rather than
      // removing it. Two consequences fall out for free:
      //   1. The autosave splitter (`splitCanvas`) filters out
      //      `synthetic:` ids, so this optimistic edge is never
      //      persisted into the blob — DB membership stays the only
      //      source of truth.
      //   2. When the Pusher-driven refetch lands ~hundreds of ms
      //      later carrying the real projector-emitted synthetic
      //      edge, it has the *same* id and endpoints, so React's
      //      diff is a no-op — the user sees a continuous edge
      //      throughout.
      // The id format must match what `milestoneTimelineProjector`
      // emits: `synthetic:feature-milestone:<featureId>`. Drift here
      // would silently double-render edges across the round-trip.
      const link = detectFeatureMilestoneEdge(edge);
      if (link) {
        const syntheticId = `synthetic:feature-milestone:${link.featureId}`;
        // Canonicalize the optimistic edge to match exactly what
        // `milestoneTimelineProjector` will emit on the next refetch
        // — same id, same endpoint order (feature→milestone), and
        // crucially **no `fromSide`/`toSide`** so the library's
        // auto-router routes both versions identically. With matching
        // shape, the Pusher-driven swap is a React diff no-op and
        // the user sees a continuous edge throughout the round-trip.
        // Synthetic edges are DB-derived layout, not user-authored;
        // we intentionally don't preserve which handle the user
        // happened to click — trust the auto-router.
        applyMutation(canvasRef, (c) => {
          const withoutTemp = removeEdge(c, edge.id);
          // Skip if the projector-emitted edge is already in the
          // canvas (e.g. user re-drew an edge that already exists).
          // Adding a duplicate id would crash the library.
          if (withoutTemp.edges?.some((e) => e.id === syntheticId)) {
            return withoutTemp;
          }
          return addEdge(withoutTemp, {
            id: syntheticId,
            fromNode: `feature:${link.featureId}`,
            toNode: `milestone:${link.milestoneId}`,
          } as CanvasEdge);
        });
        void patchFeatureMilestone(link.featureId, link.milestoneId);
        return;
      }
      applyMutation(canvasRef, (c) => addEdge(c, edge));
    },
    [applyMutation, detectFeatureMilestoneEdge, patchFeatureMilestone],
  );
  const handleEdgeUpdate = useCallback(
    (id: string, patch: EdgeUpdate, canvasRef: string | undefined) => {
      // Synthetic edges (DB-projected feature→milestone membership) are
      // not in the blob, so library `updateEdge` calls against them
      // would no-op silently. The most common "update" on a synthetic
      // edge would be repointing one endpoint — that's a membership
      // change, which belongs as a PATCH. Defensive guard: ignore
      // patches addressed at synthetic ids.
      if (id.startsWith("synthetic:")) return;
      applyMutation(canvasRef, (c) => updateEdge(c, id, patch));
    },
    [applyMutation],
  );
  const handleEdgeDelete = useCallback(
    (id: string, canvasRef: string | undefined) => {
      // Deleting a synthetic feature→milestone membership edge means
      // "this feature is no longer in this milestone" — a DB write,
      // not a blob delete. PATCH `milestoneId: null`; the projector
      // re-runs and the synthetic edge disappears.
      //
      // We ALSO optimistically remove it from local state so the
      // user sees the edge disappear immediately rather than
      // lingering until the Pusher refetch lands. `splitCanvas`
      // filters `synthetic:` ids so this removal doesn't produce an
      // extraneous authored-edge delete in the persisted blob.
      if (id.startsWith("synthetic:feature-milestone:")) {
        const featureId = id.slice("synthetic:feature-milestone:".length);
        applyMutation(canvasRef, (c) => removeEdge(c, id));
        void patchFeatureMilestone(featureId, null);
        return;
      }
      applyMutation(canvasRef, (c) => removeEdge(c, id));
    },
    [applyMutation, patchFeatureMilestone],
  );

  // Expose the edge-patch path through the parent-supplied ref so
  // sibling surfaces (the Connections-tab link mode) can write
  // `customData.connectionId` without prop-drilling a callback
  // through every list row. Re-wire on every render so the latest
  // closure is always exposed (the ref's identity is stable, the
  // function it points at is not — that's the desired semantics).
  useEffect(() => {
    if (!edgePatchHandleRef) return;
    edgePatchHandleRef.current = handleEdgeUpdate;
    return () => {
      // Null out on unmount so a stale handler can't fire after the
      // canvas tears down.
      if (edgePatchHandleRef.current === handleEdgeUpdate) {
        edgePatchHandleRef.current = null;
      }
    };
  }, [edgePatchHandleRef, handleEdgeUpdate]);

  // -------------------------------------------------------------------
  // Drop-on-node — three pairings today:
  //
  //   1. **Feature → Milestone (DB reassign).** Drag a `feature:` card
  //      onto a `milestone:` card to PATCH `Feature.milestoneId`. The
  //      server derives `initiativeId` and fans out CANVAS_UPDATED on
  //      every affected canvas; the projector re-emits the feature on
  //      the most-specific scope.
  //
  //   2. **Authored callout → Live container (canvas move).** Drag a
  //      `note` / `decision` / base-`text` node onto a `workspace:` /
  //      `initiative:` / `milestone:` card to MOVE the authored node
  //      from its current canvas blob onto the target's sub-canvas
  //      blob. Lets the user accumulate loose thoughts on the root
  //      canvas, then organize them under the workspace / initiative /
  //      milestone they belong to without retyping. The note's text +
  //      category + customData survive the move (it's a blob-to-blob
  //      hop, not a DB write).
  //
  //   3. **Research → Initiative (DB reassign).** Drag a `research:`
  //      card onto an `initiative:` card to PATCH
  //      `Research.initiativeId`. The row jumps from the root canvas
  //      to the initiative sub-canvas (or between two initiative
  //      sub-canvases) on the next projector run. Drop coords are
  //      intentionally NOT preserved — the source and target live on
  //      different canvases, so the source's `(x, y)` has no meaning
  //      on the destination; the projector's default initiative-canvas
  //      slot is the right landing spot. Symmetric "unscope to root"
  //      isn't supported via drop today (root has no container card
  //      to drop onto); a future right-click menu or "drop on empty
  //      canvas" gesture can cover it.
  //
  // Library-side hooks: `canDropNodeOn` is the per-frame predicate
  // during drag (must be cheap — id-prefix sniff + category check, no
  // fetches, no setState); `onNodeDrop` is the release handler. The
  // library snaps the source back to its pre-drag position before
  // firing `onNodeDrop`, so we never commit a canvas-position update.
  //
  // Self-drop is filtered library-side, but we keep an explicit
  // `source.id !== target.id` line for defensive readability.
  //
  // The lookup arrays (`AUTHORED_DROPPABLE_CATEGORIES`,
  // `LIVE_CONTAINER_CATEGORIES`) live at module scope above so
  // `useCallback` deps stay stable.
  // -------------------------------------------------------------------
  const canDropNodeOn = useCallback(
    (sources: CanvasNode[], target: CanvasNode): boolean => {
      const source = sources[0];
      if (!source || source.id === target.id) return false;

      // Pairing 1: feature → milestone (DB reassign).
      if (
        source.category === "feature" &&
        target.category === "milestone" &&
        source.id.startsWith("feature:") &&
        target.id.startsWith("milestone:")
      ) {
        return true;
      }

      // Pairing 2: authored callout → live container (canvas move).
      // The source must be authored (not a live id) and the target
      // must be a container with a sub-canvas to land in.
      if (
        AUTHORED_DROPPABLE_CATEGORIES.includes(source.category ?? "") &&
        !isLiveId(source.id) &&
        LIVE_CONTAINER_CATEGORIES.includes(target.category ?? "") &&
        isLiveId(target.id)
      ) {
        return true;
      }

      // Pairing 3: research → initiative (DB reassign). Mirrors
      // pairing 1 structurally — the gesture targets a DB column,
      // not the canvas blob, so the synthetic split-bewteen-canvases
      // happens via the projector after the fan-out.
      if (
        source.category === "research" &&
        target.category === "initiative" &&
        source.id.startsWith("research:") &&
        target.id.startsWith("initiative:")
      ) {
        return true;
      }

      return false;
    },
    [],
  );

  /**
   * Fire-and-forget PATCH that reassigns a feature to a different
   * milestone. The server derives the new `initiativeId` from the
   * milestone (via the coherence rule we shipped in `updateFeature`)
   * and fans out `CANVAS_UPDATED` on every affected canvas (root,
   * both initiatives, both milestones, workspace). We don't refetch
   * locally — the Pusher fan-out handler in this component already
   * pulls fresh data for whichever canvas the user is currently
   * looking at, plus root.
   *
   * On error we surface to the console; the user's drop visually
   * snapped back (the library handled that), so there's no stuck
   * "ghost card" to clean up. A toast belongs here when we add the
   * global toast system.
   */
  const reassignFeatureToMilestone = useCallback(
    async (featureId: string, milestoneId: string) => {
      try {
        const res = await fetch(`/api/features/${featureId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ milestoneId }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(
            "[OrgCanvasBackground] reassign feature failed",
            res.status,
            detail,
          );
        }
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] reassign feature threw",
          err,
        );
      }
    },
    [],
  );

  /**
   * Fire-and-forget PATCH that reassigns a research row to a different
   * initiative (or to root, with `initiativeId: null`). Same posture
   * as `reassignFeatureToMilestone`: no local refetch — the server
   * fans out `CANVAS_UPDATED` on both source and target refs via
   * `notifyResearchReassignmentRefresh`, and this component's Pusher
   * handler picks up the relevant canvas.
   *
   * On error we surface to the console; the library snapped the drop
   * back, so there's no stuck "ghost card" to clean up. A toast
   * belongs here when the global toast system lands.
   */
  const reassignResearchToInitiative = useCallback(
    async (researchId: string, initiativeId: string | null) => {
      try {
        const res = await fetch(
          `/api/orgs/${githubLogin}/research/${researchId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initiativeId }),
          },
        );
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          console.error(
            "[OrgCanvasBackground] reassign research failed",
            res.status,
            detail,
          );
        }
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] reassign research threw",
          err,
        );
      }
    },
    [githubLogin],
  );

  /**
   * Move an authored node from the source canvas blob to the target's
   * sub-canvas blob. Two side-effects:
   *
   *   1. **Remove** the node from `currentRef` (the canvas the user is
   *      looking at). Routes through `applyMutation` so it's
   *      optimistic, undoable via Ctrl-Z, and rides the standard
   *      autosave flush that already covers in-flight blob writes.
   *
   *   2. **Add** the node to the target's sub-canvas via a direct
   *      read-modify-write PUT. The target canvas may not be cached
   *      locally (the user might never have drilled into it), so
   *      we use the same pattern as `savePositionForLiveId`: fetch
   *      the latest blob, append the node, PUT it back. The PUT
   *      emits `CANVAS_UPDATED` server-side; both canvases (the one
   *      we removed from + the one we added to) refetch via the
   *      existing Pusher handler, so the user sees the move land on
   *      the target if they drill in.
   *
   * The node's `id` / `text` / `category` / `customData` survive the
   * move verbatim. Position is preserved as-is from the source — the
   * user can drag it once they drill into the target. Resetting `(x,
   * y)` to a projector-default would be marginally nicer but means
   * computing each target's empty-canvas anchor; not worth the
   * complexity for v1.
   *
   * On a server-side write failure, the source-canvas remove already
   * landed locally. The autosave will eventually flush that removal,
   * leaving the user with a "lost note" if the target write also
   * failed. Acceptable for v1 (Ctrl-Z undoes the source removal); a
   * proper rollback would need the consumer-side undo stack to track
   * cross-canvas paired actions, which is overkill here.
   */
  const moveAuthoredNodeToCanvas = useCallback(
    async (
      sourceCanvasRef: string | undefined,
      sourceNode: CanvasNode,
      targetCanvasRef: string,
    ) => {
      // Step 1: optimistic remove from source canvas. `applyMutation`
      // also stamps `lastActionRef` so Ctrl-Z restores the node to
      // its pre-move position on the source canvas.
      applyMutation(sourceCanvasRef, (c) => removeNode(c, sourceNode.id));

      // Step 2: read-modify-write add to target canvas. Direct fetch
      // (not `applyMutation`) because the target canvas may not be
      // in `subCanvases` yet — the user could be on root and dropping
      // onto an initiative they've never drilled into.
      try {
        const url = `/api/orgs/${githubLogin}/canvas/${encodeURIComponent(targetCanvasRef)}`;
        const res = await fetch(url);
        if (!res.ok) {
          console.error(
            "[OrgCanvasBackground] moveAuthoredNodeToCanvas read failed",
            res.status,
          );
          return;
        }
        const body = await res.json();
        const data: CanvasData = body.data ?? { nodes: [], edges: [] };
        const existingNodes = data.nodes ?? [];
        // De-dupe by id in case the user did rapid double-drops or a
        // Pusher refresh interleaved — same id should never appear
        // twice on a single canvas.
        const nextNodes: CanvasNode[] = [
          ...existingNodes.filter((n) => n.id !== sourceNode.id),
          sourceNode,
        ];
        const putRes = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: { ...data, nodes: nextNodes } }),
        });
        if (!putRes.ok) {
          console.error(
            "[OrgCanvasBackground] moveAuthoredNodeToCanvas write failed",
            putRes.status,
          );
        }
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] moveAuthoredNodeToCanvas threw",
          err,
        );
      }
    },
    [applyMutation, githubLogin],
  );

  const handleNodeDrop = useCallback(
    (
      sources: CanvasNode[],
      target: CanvasNode,
      ctx: { canvasRef: string | undefined },
    ) => {
      const source = sources[0];
      if (!source) return;

      // Pairing 1: feature → milestone (DB reassign). The predicate
      // ran during drag, but a mid-drag agent edit could have changed
      // the categories — re-check defensively, then derive the DB
      // ids from the canvas-id strings.
      if (
        source.category === "feature" &&
        target.category === "milestone" &&
        source.id.startsWith("feature:") &&
        target.id.startsWith("milestone:")
      ) {
        const featureId = source.id.slice("feature:".length);
        const milestoneId = target.id.slice("milestone:".length);
        void reassignFeatureToMilestone(featureId, milestoneId);
        return;
      }

      // Pairing 2: authored callout → live container (canvas move).
      // The target's `ref` is the sub-canvas to move the authored
      // node into. Defensive: if the projector ever stops emitting a
      // `ref` on a container we'd silently no-op, which is the right
      // failure mode (better than writing to an unknown scope).
      if (
        AUTHORED_DROPPABLE_CATEGORIES.includes(source.category ?? "") &&
        !isLiveId(source.id) &&
        LIVE_CONTAINER_CATEGORIES.includes(target.category ?? "") &&
        target.ref
      ) {
        void moveAuthoredNodeToCanvas(ctx.canvasRef, source, target.ref);
        return;
      }

      // Pairing 3: research → initiative (DB reassign). Defensive
      // re-check of the predicate since a mid-drag agent edit could
      // have flipped categories between drag-start and release.
      if (
        source.category === "research" &&
        target.category === "initiative" &&
        source.id.startsWith("research:") &&
        target.id.startsWith("initiative:")
      ) {
        const researchId = source.id.slice("research:".length);
        const initiativeId = target.id.slice("initiative:".length);
        void reassignResearchToInitiative(researchId, initiativeId);
        return;
      }
    },
    [
      reassignFeatureToMilestone,
      moveAuthoredNodeToCanvas,
      reassignResearchToInitiative,
    ],
  );

  /**
   * Visually highlight edges that have a linked Connection doc. The
   * lib renders edges using `theme.edge.stroke` by default; setting
   * `edge.color` overrides that with a per-edge value. We map linked
   * edges to a brighter slate so they stand out at a glance — small
   * affordance, big discoverability win (the user can see at a
   * glance which edges have docs behind them).
   *
   * Decoration is render-only: it lands on the data passed to
   * `<SystemCanvas>` but NOT on the persisted blob. `applyMutation`
   * reads from `rootRef.current` / `subCanvasesRef.current` (the
   * undecorated state mirrors), so writes never leak the visual
   * `color` back into the canvas. Memoized on the source canvas so
   * the lib's edge-render pass stays pure.
   */
  const decorateEdgesWithLinkVisual = useCallback(
    (data: CanvasData): CanvasData => {
      const edges = data.edges ?? [];
      let changed = false;
      const next = edges.map((e) => {
        const cd = (e as { customData?: { connectionId?: unknown } })
          .customData;
        const linked =
          typeof cd?.connectionId === "string" && cd.connectionId.length > 0;
        // Don't override an explicit user-set color — if the edge
        // already has one, the user (or agent) made a deliberate
        // visual choice we shouldn't clobber.
        if (linked && !e.color) {
          changed = true;
          return { ...e, color: LINKED_EDGE_COLOR };
        }
        return e;
      });
      return changed ? { ...data, edges: next } : data;
    },
    [],
  );

  const canvasForRender = useMemo<CanvasData>(
    () => decorateEdgesWithLinkVisual(root ?? { nodes: [], edges: [] }),
    [root, decorateEdgesWithLinkVisual],
  );

  // Sub-canvases also need decoration so links are highlighted on
  // every scope (root, workspace sub-canvas, initiative sub-canvas).
  // Memoized as a fresh object only when an underlying ref changes.
  const subCanvasesForRender = useMemo<Record<string, CanvasData>>(() => {
    const out: Record<string, CanvasData> = {};
    for (const [ref, data] of Object.entries(subCanvases)) {
      out[ref] = decorateEdgesWithLinkVisual(data);
    }
    return out;
  }, [subCanvases, decorateEdgesWithLinkVisual]);

  // Set of connection ids referenced by at least one edge across all
  // canvases we've loaded this session. Walked off the same `root` +
  // `subCanvases` state the renderer already uses, so it stays in
  // sync automatically (link/unlink → state update → fresh set).
  // The sidebar uses this to mark connections that are wired up.
  const linkedConnectionIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    const collect = (data: CanvasData | null | undefined) => {
      for (const e of data?.edges ?? []) {
        const cd = (e as { customData?: { connectionId?: unknown } })
          .customData;
        if (typeof cd?.connectionId === "string" && cd.connectionId.length > 0) {
          ids.add(cd.connectionId);
        }
      }
    };
    collect(root);
    for (const data of Object.values(subCanvases)) collect(data);
    return ids;
  }, [root, subCanvases]);

  useEffect(() => {
    onLinkedConnectionIdsChange?.(linkedConnectionIds);
  }, [linkedConnectionIds, onLinkedConnectionIdsChange]);

  // Anchor the canvas container to the viewport but leave `rightInset`
  // pixels of empty space on the right so the library-owned FAB + future
  // toolbar affordances sit to the LEFT of the sidebar. The background
  // color still paints the full inset area (via a separate div) so the
  // sidebar doesn't reveal the page background underneath.
  const canvasContainerStyle: React.CSSProperties = {
    right: rightInset,
  };

  /**
   * Right-click menu on canvas nodes. Currently surfaces one item:
   * **"Promote to Feature…"** on note nodes. Selecting it opens the
   * `CreateFeatureCanvasDialog` with the note's `text` pre-filled
   * (truncated for the title, full text as the description) and the
   * source note id stashed on `pendingAdd` so we delete the note
   * after the feature is created — the user "consumed" the note
   * when they promoted it. Allowed on every scope; the dialog handles
   * per-scope field locking.
   *
   * `useMemo` keeps the config object reference stable across renders;
   * `<SystemCanvas>` reads it on every render to filter items per node,
   * but a fresh config every render would force the library's internal
   * effects to re-bind unnecessarily.
   */
  /**
   * Unpin a feature card from a workspace sub-canvas. Right-click
   * affordance on `feature:` nodes when the user is on a `ws:<id>`
   * scope. The mutation only touches the canvas overlay
   * (`Canvas.data.assignedFeatures`) — the Feature row itself is
   * unchanged. Optimistic local refetch is sufficient; the API
   * route's Pusher fan-out covers other tabs.
   *
   * No confirm dialog by design: pinning is a layout decision
   * symmetric to dragging a card off-screen, and reversing it via
   * the Assign-existing tab is one click away. Matches the
   * "layout-only, not destructive" framing of the feature.
   */
  const handleUnpinFeatureFromWorkspace = useCallback(
    async (featureLiveId: string, workspaceRef: string) => {
      const featureId = featureLiveId.startsWith("feature:")
        ? featureLiveId.slice("feature:".length)
        : featureLiveId;
      try {
        const res = await fetch(
          `/api/orgs/${githubLogin}/canvas/assigned-features`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ref: workspaceRef,
              featureId,
              action: "unassign",
            }),
          },
        );
        if (!res.ok) {
          console.error(
            "[OrgCanvasBackground] unassign feature failed",
            res.status,
          );
          return;
        }
        const data = await fetchSub(githubLogin, workspaceRef);
        setSubCanvases((prev) => ({ ...prev, [workspaceRef]: data }));
      } catch (err) {
        console.error(
          "[OrgCanvasBackground] unassign feature error",
          err,
        );
      }
    },
    [githubLogin],
  );

  const nodeContextMenu = useMemo<NodeContextMenuConfig>(
    () => ({
      // Item set is composed conditionally per scope. The library
      // does NOT support `match.scope` today, so we filter the items
      // array up-front based on `currentRef` and let `match.categories`
      // do the rest. Memo dep includes `currentRef` so the menu
      // rebuilds on navigation. Showing a labelled menu item that
      // does nothing on click is a discoverability bug — filter it
      // out instead of relying on an onSelect guard.
      items: [
        {
          id: "promote-to-feature",
          label: "Promote to Feature…",
          // Only notes are promotable. Other categories (decisions,
          // projected live nodes, base text/file/link/group) get no
          // menu — the library treats "zero matched items" as "don't
          // open", so right-clicking them is a silent no-op.
          match: { categories: ["note"] },
        },
        // "Remove from canvas" only makes sense on a `ws:<id>` scope
        // (where pinning is honored). Drop the item entirely on root /
        // initiative / opaque scopes so right-clicking a feature card
        // on those canvases shows no menu (which the library handles
        // by not opening it, same as a non-matching category).
        ...(currentRef.startsWith("ws:")
          ? ([
              {
                id: "unpin-feature-from-workspace" as const,
                label: "Remove from canvas",
                match: { categories: ["feature"] as const },
              },
            ] as NodeContextMenuConfig["items"])
          : []),
      ],
      onSelect: (itemId, node, ctx) => {
        if (itemId === "promote-to-feature") {
          const text = (node.text ?? "").trim();
          // Title pre-fill: first non-empty line, capped to fit the
          // dialog's input. Full text always seeds the description so
          // the user doesn't lose context when the title gets truncated.
          const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
          const titleSeed = firstLine.slice(0, 80);
          const briefSeed = text;
          // The library types `ctx.canvasRef` as `string | null` (null
          // for the root canvas); the rest of OrgCanvasBackground uses
          // `string | undefined`. Coerce so `startFeatureCreate`'s
          // signature matches the `+` menu path.
          startFeatureCreate(
            node,
            ctx.canvasRef ?? undefined,
            { title: titleSeed, brief: briefSeed },
            node.id,
          );
          return;
        }
        if (itemId === "unpin-feature-from-workspace") {
          const canvasRef = ctx.canvasRef ?? "";
          // Defensive — the menu items array drops this entry on
          // non-`ws:` scopes, so the only way we'd get here on a
          // non-ws ref is a stale library callback firing during
          // navigation. Bail silently rather than write to the
          // wrong canvas.
          if (!canvasRef.startsWith("ws:")) return;
          void handleUnpinFeatureFromWorkspace(node.id, canvasRef);
          return;
        }
      },
    }),
    [currentRef, startFeatureCreate, handleUnpinFeatureFromWorkspace],
  );

  /**
   * Replace the library's default FAB container so we can hoist the
   * button above the chat-input bar. The library would otherwise place it
   * at `bottom:16` of the canvas, which sits underneath the chat input's
   * `pointer-events-auto` wrapper and can't receive clicks.
   *
   * Menu filtering is **scope-aware**: each option is run through
   * `categoryAllowedOnScope` against `currentRef`, so the user only
   * sees categories that make sense at the canvas they're currently
   * looking at:
   *   - Root → initiative, note, decision, text/file/link/group
   *   - Workspace sub-canvas → note, decision, text/file/link/group
   *   - Initiative timeline → milestone, note, decision, text/...
   *
   * `kind: "type"` options (the library's built-in JSON-canvas types)
   * are always shown — they're free authoring primitives and have no
   * scope semantics.
   *
   * `currentRef` is captured lexically; React re-renders the component
   * whenever the user navigates (we set it in onNavigate), and the
   * library calls this render-prop on every render, so the menu
   * tracks scope changes automatically.
   */
  const renderAddNodeButton = (props: AddNodeButtonRenderProps) => {
    const filtered = {
      ...props,
      options: props.options.filter((o) => {
        if (o.kind !== "category") return true;
        return categoryAllowedOnScope(o.value, currentRef);
      }),
    };
    return (
      <div
        style={{
          position: "absolute",
          bottom: 16,
          right: 16,
          zIndex: 30,
          pointerEvents: "auto",
        }}
      >
        {/*
         * `AddNodeButton` itself is `position:absolute; bottom:16; right:16`,
         * so wrapping it in a `position:relative` shim neutralizes the
         * library's absolute coords and lets our outer wrapper control the
         * final on-screen position.
         */}
        <div style={{ position: "relative" }}>
          <AddNodeButton {...filtered} />
        </div>
      </div>
    );
  };

  if (loadError) {
    // Fail quiet: the canvas is a background; if it can't load, fall back
    // to a plain dark surface rather than blocking the page.
    return <div className="absolute inset-0 bg-[#15171c]" aria-hidden />;
  }

  if (!root) {
    return <div className="absolute inset-0 bg-[#15171c]" aria-hidden />;
  }

  return (
    <>
      <div className="absolute inset-0 bg-[#15171c]" aria-hidden />
      <div className="absolute inset-y-0 left-0" style={canvasContainerStyle}>
        <SystemCanvas
          ref={canvasHandleRef}
          canvas={canvasForRender}
          canvases={subCanvasesForRender}
          theme={connectionsTheme}
          editable
          zoomNavigation
          onResolveCanvas={onResolveCanvas}
          onBreadcrumbsChange={handleBreadcrumbsChange}
          onSelectionChange={handleSelectionChange}
          onNodeAdd={handleNodeAdd}
          onNodeUpdate={handleNodeUpdate}
          onNodesUpdate={handleNodesUpdate}
          onNodeDelete={handleNodeDelete}
          onEdgeAdd={handleEdgeAdd}
          onEdgeUpdate={handleEdgeUpdate}
          onEdgeDelete={handleEdgeDelete}
          canDropNodeOn={canDropNodeOn}
          onNodeDrop={handleNodeDrop}
          nodeContextMenu={nodeContextMenu}
          renderAddNodeButton={renderAddNodeButton}
          rootLabel={orgName || githubLogin}
        />
        {/*
         * Restore pill — top-right of the canvas area. Shown on any
         * canvas with at least one hidden live node: workspaces on
         * root, repos on a workspace sub-canvas, milestones on an
         * initiative sub-canvas. The pill auto-hides when entries are
         * empty, so the 99% steady-state is zero chrome regardless of
         * scope. Hidden lists are per-canvas (`Canvas.data.hidden` is
         * a per-ref overlay), so `hiddenLive` is refetched on every
         * `currentRef` change. Sits inside the canvas container so it
         * tracks `rightInset` alongside the canvas itself.
         */}
        <HiddenLivePill
          // Pre-fetch (`hiddenLive === null`) the pill is given an
          // empty list — it auto-hides when there's nothing to show,
          // so this just keeps it dormant until the fetch lands.
          entries={hiddenLive ?? []}
          onRestore={handleRestoreLive}
        />


        {/*
         * Deep-link load overlay. When the page loads with a `?canvas=`
         * query param, we mount the root canvas first (the library
         * needs it to find the target node before `zoomIntoNode` can
         * navigate). That brief moment of "root visible" before the
         * sub-canvas opens reads as a flash. This overlay covers the
         * canvas with the same background + a spinner so the user
         * sees only "loading → already on the right canvas." Cleared
         * when `zoomIntoNode`'s promise resolves (sub-canvas mounted
         * and auto-fit complete).
         *
         * Only shown when `deepLinkInFlight` started true (URL had
         * `?canvas=`). Subsequent in-app drill-ins don't go through
         * this overlay; they animate naturally.
         */}
        {deepLinkInFlight && (
          <div
            className="absolute inset-0 z-40 flex items-center justify-center bg-[#15171c]"
            aria-busy="true"
            aria-label="Loading canvas"
          >
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        )}
      </div>

      {/*
       * Creation dialogs for DB-backed categories. Mounted at the
       * component's top level (not inside the canvas container) so they
       * render as full-page modals rather than getting clipped by the
       * canvas's positioning shim. Closing without saving (cancel,
       * Esc, click-outside) just clears `pendingAdd` — no node was
       * ever added to the canvas.
       */}
      <InitiativeDialog
        open={pendingAdd?.kind === "initiative"}
        onClose={() => setPendingAdd(null)}
        onSave={handleSaveInitiative}
      />
      <MilestoneDialog
        open={pendingAdd?.kind === "milestone"}
        onClose={() => setPendingAdd(null)}
        defaultSequence={
          pendingAdd?.kind === "milestone" ? pendingAdd.defaultSequence : undefined
        }
        onSave={handleSaveMilestone}
      />
      <CreateFeatureCanvasDialog
        open={pendingAdd?.kind === "feature"}
        onClose={() => setPendingAdd(null)}
        githubLogin={githubLogin}
        scope={
          pendingAdd?.kind === "feature" ? pendingAdd.canvasRef ?? "" : ""
        }
        prefill={pendingAdd?.kind === "feature" ? pendingAdd.prefill : undefined}
        // The Promote-to-Feature path sets `sourceNoteId` on `pendingAdd`
        // to the originating note's id. Threaded through so the dialog
        // can pre-select fields based on edges incident to that note
        // (e.g. note → initiative on root pre-selects the initiative).
        sourceNodeId={
          pendingAdd?.kind === "feature" ? pendingAdd.sourceNoteId : undefined
        }
        onSave={handleSaveFeature}
        onAssign={handleAssignFeature}
      />
      <CreateServiceCanvasDialog
        open={pendingAdd?.kind === "service"}
        onClose={() => setPendingAdd(null)}
        onSave={handleSaveService}
      />
    </>
  );
}
