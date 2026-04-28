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
  type EdgeUpdate,
  type NodeContextMenuConfig,
  type NodeUpdate,
  type SystemCanvasHandle,
} from "system-canvas-react";
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
  type FeatureCreateForm,
} from "../_components/CreateFeatureCanvasDialog";
import type {
  InitiativeResponse,
  MilestoneResponse,
} from "@/types/initiatives";
import { categoryAllowedOnScope } from "./canvas-categories";

/**
 * Live-id detection mirrors `src/lib/canvas/scope.ts`'s `isLiveId`.
 * Duplicated here because that module is server-side (pulls Prisma); we
 * only need the prefix check on the client. Keep the prefix list in sync
 * with `LIVE_ID_PREFIXES` there.
 */
const LIVE_ID_PREFIXES = ["ws:", "feature:", "repo:", "initiative:", "milestone:", "task:"];
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
   * Fires when the user clicks a node (selection) or navigates to a
   * different canvas (clears selection). Lets the parent render a
   * details panel for the currently-selected node.
   *
   * `null` means "no node selected" (clicked an edge, navigated, etc.).
   * Receives the full `CanvasNode` so consumers can read `id`,
   * `category`, `text`, and `customData` without a follow-up lookup.
   */
  onNodeSelect?: (node: CanvasNode | null) => void;
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
}

export function OrgCanvasBackground({
  githubLogin,
  rightInset = 0,
  orgName,
  onHiddenChange,
  onNodeSelect,
  onCanvasBreadcrumbChange,
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
  const handleSystemCanvasNavigate = useCallback(
    (_ref: string) => {
      onNodeSelect?.(null);
    },
    [onNodeSelect],
  );

  /**
   * User clicked a node. Forward it to the parent so a side-panel can
   * render details for it. The library does NOT call `onNodeClick`
   * for clicks on empty canvas — that means there's no built-in way
   * to clear selection by clicking the background. We accept that:
   * navigating away (drill-in, breadcrumb) clears selection, and
   * clicking another node replaces it.
   */
  const handleNodeClick = useCallback(
    (node: CanvasNode) => {
      onNodeSelect?.(node);
    },
    [onNodeSelect],
  );

  /**
   * Library callback: user clicked a breadcrumb. The library does NOT
   * fire `onNavigate` for back-navigation (only for drill-in), so we
   * have to track scope changes here too. The lib has already
   * truncated its internal stack by the time it calls us; we mirror
   * that into our own state via `onBreadcrumbsChange` (see
   * `handleBreadcrumbsChange` below) — that path is the single source
   * of truth for `currentRef` and the URL across both drill-in and
   * back-out.
   *
   * What this handler still owns: dropping the selected node when
   * scope changes. The previously-selected node may not exist on the
   * new scope (selection survives `setCurrentRef`, but the parent
   * right-panel should reset to its default body when the user
   * navigates away).
   */
  const handleBreadcrumbClick = useCallback(
    (_index: number) => {
      onNodeSelect?.(null);
    },
    [onNodeSelect],
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
  type PendingAdd =
    | PendingInitiativeAdd
    | PendingMilestoneAdd
    | PendingFeatureAdd;

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
      applyMutation(canvasRef, (c) => addNode(c, node));
    },
    [applyMutation, startInitiativeCreate, startMilestoneCreate, startFeatureCreate],
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
      //   - milestoneId set       → milestone:<id>
      //   - initiativeId only set → initiative:<id>
      //   - neither set           → ws:<id>
      // Mismatch here would save the position overlay on the wrong
      // canvas, the projected node would render at the projector
      // default, and the user's click position would silently vanish.
      const targetRef: string = form.milestoneId
        ? `milestone:${form.milestoneId}`
        : form.initiativeId
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

  const handleNodeUpdate = useCallback(
    (id: string, patch: NodeUpdate, canvasRef: string | undefined) => {
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
    },
    [applyMutation, persistMilestoneStatus],
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

  const handleEdgeAdd = useCallback(
    (edge: CanvasEdge, canvasRef: string | undefined) => {
      applyMutation(canvasRef, (c) => addEdge(c, edge));
    },
    [applyMutation],
  );
  const handleEdgeUpdate = useCallback(
    (id: string, patch: EdgeUpdate, canvasRef: string | undefined) => {
      applyMutation(canvasRef, (c) => updateEdge(c, id, patch));
    },
    [applyMutation],
  );
  const handleEdgeDelete = useCallback(
    (id: string, canvasRef: string | undefined) => {
      applyMutation(canvasRef, (c) => removeEdge(c, id));
    },
    [applyMutation],
  );

  const canvasForRender = useMemo<CanvasData>(
    () => root ?? { nodes: [], edges: [] },
    [root],
  );

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
  const nodeContextMenu = useMemo<NodeContextMenuConfig>(
    () => ({
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
      ],
      onSelect: (itemId, node, ctx) => {
        if (itemId !== "promote-to-feature") return;
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
      },
    }),
    [startFeatureCreate],
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
          canvases={subCanvases}
          theme={connectionsTheme}
          editable
          onResolveCanvas={onResolveCanvas}
          onNavigate={handleSystemCanvasNavigate}
          onBreadcrumbClick={handleBreadcrumbClick}
          onBreadcrumbsChange={handleBreadcrumbsChange}
          onNodeClick={handleNodeClick}
          onNodeAdd={handleNodeAdd}
          onNodeUpdate={handleNodeUpdate}
          onNodeDelete={handleNodeDelete}
          onEdgeAdd={handleEdgeAdd}
          onEdgeUpdate={handleEdgeUpdate}
          onEdgeDelete={handleEdgeDelete}
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
      />
    </>
  );
}
