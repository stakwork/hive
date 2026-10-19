"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  getViewportForBounds,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronDown, Maximize, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildChoiceTree, type ChoiceItem } from "../artifacts/viewers/ChoiceTree";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import { composeFor, type BoardAction } from "./actions";
import { edgeTypes, RED, type BoardEdgeData } from "./edges";
import { hand, mono } from "./fonts";
import { CARD_W, layoutBoard } from "./layout";
import { Linen, LINEN } from "./linen";
import { dimmedIds, ghostIds, isPerson, matchMember, myPath, type BoardMember } from "./model";
import { nodeTypes, type CardData } from "./nodes";

const REFETCH_MS = 15_000;
/** Opening view: a tree that fits at this zoom or more is fitted; a bigger one opens at OPEN_ZOOM, root OPEN_LEFT px from the left. */
const OPEN_FIT_MIN = 0.7;
const OPEN_ZOOM = 0.85;
const OPEN_LEFT = 40;
const MAX_SLUGS = 12;

interface RawTree {
  nodes?: Array<{ ref_id: string; type?: string; properties?: Record<string, unknown> }>;
  edges?: Array<{ source: string; target: string }>;
}
interface RootEntry {
  ref_id: string;
  text: string;
  job: string | null;
  made_by: string | null;
}
interface Selection {
  ws: string;
  root: string;
  /** Text of a root that is not a brainstorm of its own (a re-rooted node). */
  label?: string;
}

/** Keys typed into the chat composer (or any field) must not drive the board. */
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

/** Same key and read as the chat card's tree, so the two share one cache entry. */
function useBoardTree(ws: string, root: string) {
  return useQuery({
    queryKey: ["choice-tree", ws, root, ""],
    queryFn: async () => {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(ws)}/graph/choice-tree?focus=${encodeURIComponent(root)}`,
      );
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return (await res.json()) as RawTree;
    },
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

function useMembers(githubLogin: string): BoardMember[] {
  const { data } = useQuery({
    queryKey: ["org-members-board", githubLogin],
    queryFn: async () => {
      const res = await fetch(`/api/orgs/${githubLogin}/members`);
      const body: unknown = res.ok ? await res.json() : [];
      return Array.isArray(body) ? (body as BoardMember[]) : [];
    },
    staleTime: 60_000,
  });
  return data ?? EMPTY_MEMBERS;
}
const EMPTY_MEMBERS: BoardMember[] = [];

const short = (t: string, n = 26) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Dark text on white, thin grey border: readable on the linen. */
const CTL =
  "border border-[#d2d2d7] bg-white text-[#1d1d1f] shadow-[0_1px_3px_rgba(0,0,0,.12)] hover:bg-[#f5f5f7] font-sans";

type ReRoot = (item: ChoiceItem) => void;

function Surface({
  ws,
  root,
  rootJob,
  tree,
  members,
  onReroot,
}: {
  ws: string;
  root: string;
  rootJob: string | null;
  tree: ReturnType<typeof buildChoiceTree>;
  members: BoardMember[];
  onReroot: ReRoot;
}) {
  const rf = useReactFlow();
  const rootItem = tree.items[0];
  const path = useMemo(() => myPath(tree), [tree]);
  const pathSet = useMemo(() => new Set(path), [path]);
  const ghosts = useMemo(() => ghostIds(tree), [tree]);
  const dimmed = useMemo(() => dimmedIds(tree), [tree]);
  const itemById = useMemo(() => new Map(tree.items.map((i) => [i.id, i])), [tree]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);

  // Real card heights, reported by the cards; the layout uses them over its estimates.
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const pending = useRef<Record<string, number>>({});
  const frame = useRef(0);
  const onSize = useCallback((id: string, height: number) => {
    pending.current[id] = height;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const batch = pending.current;
      pending.current = {};
      setMeasured((m) => {
        const next = { ...m };
        let changed = false;
        for (const [k, h] of Object.entries(batch)) {
          if (Math.abs((m[k] ?? -1) - h) >= 1) {
            next[k] = h;
            changed = true;
          }
        }
        return changed ? next : m;
      });
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const layout = useMemo(() => layoutBoard(tree, selectedId, measured), [tree, selectedId, measured]);
  const allMeasured = tree.items.every((i) => measured[i.id] !== undefined);

  // Cards may be dragged within this session; a drag is forgotten when the set of nodes changes.
  const sig = useMemo(() => tree.items.map((i) => i.id).join("|"), [tree]);
  const dragged = useRef<{ sig: string; pos: Record<string, { x: number; y: number }> }>({ sig, pos: {} });

  const onAct = useCallback(
    (action: BoardAction | "start-here", item: ChoiceItem) => {
      if (action === "start-here") onReroot(item);
      else composeFor(action, item);
    },
    [onReroot],
  );

  const derived = useMemo<Node[]>(() => {
    const drag = dragged.current.sig === sig ? dragged.current.pos : {};
    return tree.items.map((item) => {
      const data: CardData = {
        item,
        height: layout.heights[item.id],
        ghost: ghosts.has(item.id),
        dim: dimmed.has(item.id),
        selected: item.id === selectedId,
        member: matchMember(members, item),
        isRoot: item.id === rootItem?.id,
        onSize,
        onAct,
      };
      return {
        id: item.id,
        type: "card",
        position: drag[item.id] ?? layout.positions[item.id],
        data,
        style: { width: CARD_W },
        zIndex: item.id === selectedId ? 10 : 0,
      };
    });
  }, [tree, sig, layout, ghosts, dimmed, selectedId, members, rootItem?.id, onSize, onAct]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(derived);
  useEffect(() => {
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return derived.map((n) => ({ ...n, measured: old.get(n.id)?.measured }));
    });
  }, [derived, setNodes]);

  const edges = useMemo<Edge[]>(
    () =>
      tree.links.map((l) => {
        const source = itemById.get(l.source);
        const kind: BoardEdgeData["kind"] = ghosts.has(l.target)
          ? "ghost"
          : pathSet.has(l.source) && pathSet.has(l.target)
            ? "chosen"
            : "normal";
        const data: BoardEdgeData = { kind, fromPerson: isPerson(source?.madeBy), dim: dimmed.has(l.target) };
        return {
          id: `${l.source}>${l.target}`,
          source: l.source,
          target: l.target,
          type: data.fromPerson ? "ink" : "agent",
          data,
        };
      }),
    [tree, itemById, ghosts, dimmed, pathSet],
  );

  const fit = useCallback(() => void rf.fitView({ padding: 0.1, duration: 400 }), [rf]);

  // Opening view, once every card has reported its size: fit a small tree; a big one would fit
  // too small to read, so open at a readable zoom with the root at the left, on the "Your path" chain.
  const box = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    if (!allMeasured || opened.current) return;
    opened.current = true;
    const t = setTimeout(() => {
      const el = box.current;
      const l = layoutRef.current;
      const ids = tree.items.map((i) => i.id);
      if (!el || !ids.length) return void rf.fitView({ padding: 0.1, maxZoom: 1 });
      const minX = Math.min(...ids.map((id) => l.positions[id].x));
      const minY = Math.min(...ids.map((id) => l.positions[id].y));
      const bounds = {
        x: minX,
        y: minY,
        width: Math.max(...ids.map((id) => l.positions[id].x + CARD_W)) - minX,
        height: Math.max(...ids.map((id) => l.positions[id].y + l.heights[id])) - minY,
      };
      const fit = getViewportForBounds(bounds, el.clientWidth, el.clientHeight, 0.12, 1, 0.1);
      if (fit.zoom >= OPEN_FIT_MIN) return void rf.setViewport(fit);
      const focus = path[path.length - 1] ?? ids[0];
      const rootPos = l.positions[ids[0]];
      const mid = l.positions[focus].y + l.heights[focus] / 2;
      void rf.setViewport({
        x: OPEN_LEFT - rootPos.x * OPEN_ZOOM,
        y: el.clientHeight / 2 - mid * OPEN_ZOOM,
        zoom: OPEN_ZOOM,
      });
    }, 80);
    return () => {
      clearTimeout(t);
      opened.current = false;
    };
  }, [allMeasured, rf, tree, path]);

  // A selected card is panned into view (current zoom, at least 0.8) so its buttons are visible.
  useEffect(() => {
    if (!selectedId) return;
    const t = setTimeout(() => {
      const n = rf.getNode(selectedId);
      if (!n) return;
      const h = n.measured?.height ?? layoutRef.current.heights[selectedId];
      void rf.setCenter(n.position.x + CARD_W / 2, n.position.y + h / 2, {
        zoom: Math.max(rf.getZoom(), 0.8),
        duration: 300,
      });
    }, 150);
    return () => clearTimeout(t);
  }, [selectedId, rf]);

  const selected = selectedId ? itemById.get(selectedId) : undefined;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "f") fit();
      else if (k === "e" && selected) composeFor("expand", selected);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit, selected]);

  // Hidden context: the board in view, and the node selected on it.
  const setBrainstormFocus = useCanvasChatStore((s) => s.setBrainstormFocus);
  useEffect(() => {
    setBrainstormFocus({
      workspaceSlug: ws,
      rootRefId: root,
      rootText: rootItem?.name ?? root,
      jobId: rootJob,
      selectedRefId: selected?.id ?? null,
      selectedLabel: selected?.letter ?? null,
    });
  }, [setBrainstormFocus, ws, root, rootItem?.name, rootJob, selected?.id, selected?.letter]);
  useEffect(() => () => setBrainstormFocus(null), [setBrainstormFocus]);

  // Tapping a card only selects it (again, or the pane, deselects); the buttons on it write to the chat.
  const onNodeClick = useCallback(
    (_: unknown, node: Node) => setSelectedId((cur) => (cur === node.id ? null : node.id)),
    [],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      if (dragged.current.sig !== sig) dragged.current = { sig, pos: {} };
      dragged.current.pos[node.id] = node.position;
    },
    [sig],
  );

  return (
    <div
      ref={box}
      className="relative isolate h-full w-full"
      style={{ backgroundColor: LINEN }}
      data-brainstorm-board
      data-root={root}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={() => setSelectedId(null)}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        minZoom={0.12}
        maxZoom={2.2}
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
      >
        <Linen />
      </ReactFlow>

      {/* Your path */}
      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center pl-72 pr-4">
        <div
          className={cn(
            "pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-full px-4 py-1 text-[14px]",
            CTL,
          )}
          data-trail
        >
          <span className="shrink-0 text-[#6e6e73]">Your path</span>
          {path.map((id, i) => {
            const it = itemById.get(id)!;
            const last = i === path.length - 1;
            return (
              <span key={id} className="flex min-w-0 shrink-0 items-center gap-2">
                <span className="text-[#6e6e73]">→</span>
                <button
                  type="button"
                  className={cn("max-w-[160px] truncate hover:underline", last && "font-semibold text-[#c8452c]")}
                  title={it.name}
                  onClick={() => void rf.fitView({ nodes: [{ id }], duration: 400, maxZoom: 1, padding: 0.6 })}
                >
                  {it.letter ?? short(it.name)}
                </button>
              </span>
            );
          })}
        </div>
      </div>

      {/* Zoom */}
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 text-[14px]">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          className={cn("rounded-md px-2 py-1.5", CTL)}
          onClick={() => void rf.zoomOut({ duration: 200 })}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          className={cn("rounded-md px-2 py-1.5", CTL)}
          onClick={() => void rf.zoomIn({ duration: 200 })}
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Fit the tree (F)"
          className={cn("flex items-center gap-1 rounded-md px-2.5 py-1.5", CTL)}
          onClick={fit}
        >
          <Maximize className="h-4 w-4" />
          Fit <kbd className="ml-0.5 text-[12px] text-[#6e6e73]">F</kbd>
        </button>
      </div>

      {/* Legend: a "?" that opens it, so it never covers cards */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col items-start gap-1">
        <button
          type="button"
          aria-label="Legend"
          aria-expanded={legendOpen}
          title="Legend"
          className={cn("h-8 w-8 rounded-full text-[15px] font-semibold", CTL)}
          onClick={() => setLegendOpen((o) => !o)}
        >
          ?
        </button>
        {legendOpen && (
          <div
            className="flex flex-col gap-1 rounded-md border border-[#cdbf9c] bg-[#fbf6e6] px-3 py-2 text-[#3d3626] shadow-md"
            data-legend
          >
            <span className={cn("flex items-center gap-2 text-[17px]", hand.className)}>
              <i className="inline-block h-3 w-4 -rotate-3 bg-[#f5ebc4] shadow ring-1 ring-black/10" />a person wrote it
            </span>
            <span className={cn("flex items-center gap-2 text-[16px]", mono.className)}>
              <i className="inline-block h-3 w-4 border border-[#9ca3af] bg-white" />
              the agent wrote it
            </span>
            <span className={cn("flex items-center gap-2 text-[17px]", hand.className)} style={{ color: RED }}>
              <i className="inline-block h-3 w-4 rounded-full border-2" style={{ borderColor: RED }} />
              chosen
            </span>
            <span className={cn("flex items-center gap-2 text-[16px] text-sky-800", mono.className)}>
              <i className="inline-block h-3 w-4 border-2 border-dashed border-sky-500 bg-white" />
              simulated
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Board({
  ws,
  root,
  members,
  onFail,
  onReroot,
}: {
  ws: string;
  root: string;
  members: BoardMember[];
  onFail: () => void;
  onReroot: ReRoot;
}) {
  const { data, isLoading, error } = useBoardTree(ws, root);
  const tree = useMemo(() => buildChoiceTree(data?.nodes ?? [], data?.edges ?? [], root), [data, root]);
  const rootJob = useMemo(() => {
    const job = data?.nodes?.find((n) => n.ref_id === root)?.properties?.job;
    return typeof job === "string" && job ? job : null;
  }, [data, root]);
  const failed = !!error || (!!data && tree.items.length === 0);
  useEffect(() => {
    if (failed) onFail();
  }, [failed, onFail]);
  if (isLoading || failed)
    return (
      <p className={cn("p-6 text-[20px] text-[#6b6248]", hand.className)}>
        {failed ? "Couldn’t open that brainstorm…" : "Loading the board…"}
      </p>
    );
  return (
    <ReactFlowProvider>
      <Surface ws={ws} root={root} rootJob={rootJob} tree={tree} members={members} onReroot={onReroot} />
    </ReactFlowProvider>
  );
}

function writeUrl(sel: Selection | null) {
  const params = new URLSearchParams(window.location.search);
  if (sel) {
    params.set("root", sel.root);
    params.set("ws", sel.ws);
  } else {
    params.delete("root");
    params.delete("ws");
  }
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

/**
 * The Brainstorm tab: a brainstorm tree (Question / Option nodes) on a linen
 * board. `?root=` / `?ws=` name the board; without them it lists the
 * brainstorms of the org's workspaces and opens the newest.
 */
export function BrainstormBoard({ githubLogin, workspaceSlugs }: { githubLogin: string; workspaceSlugs: string[] }) {
  const params = useSearchParams();
  const initial = useRef({ ws: params.get("ws"), root: params.get("root") });
  const [sel, setSel] = useState<Selection | null>(
    initial.current.ws && initial.current.root ? { ws: initial.current.ws, root: initial.current.root } : null,
  );
  const [failedRoot, setFailedRoot] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const members = useMembers(githubLogin);

  const slugs = useMemo(
    () => [...new Set([initial.current.ws, ...workspaceSlugs].filter((s): s is string => !!s))].slice(0, MAX_SLUGS),
    [workspaceSlugs],
  );
  const lists = useQueries({
    queries: slugs.map((slug) => ({
      queryKey: ["brainstorms", slug],
      queryFn: async () => {
        const res = await fetch(`/api/workspaces/${encodeURIComponent(slug)}/graph/brainstorms`);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return ((await res.json()) as { brainstorms?: RootEntry[] }).brainstorms ?? [];
      },
      refetchInterval: 30_000,
      retry: false,
    })),
  });
  const settled = slugs.length > 0 && lists.every((q) => !q.isLoading);
  const all = useMemo(
    () => lists.flatMap((q, i) => (q.data ?? []).map((r) => ({ ...r, ws: slugs[i] }))),
    [lists, slugs],
  );

  const open = useCallback((next: Selection | null) => {
    setSel(next);
    setPickerOpen(false);
    setFailedRoot(null);
    writeUrl(next);
  }, []);

  // No root asked for: open the newest brainstorm.
  useEffect(() => {
    if (!sel && !failedRoot && all.length) open({ ws: all[0].ws, root: all[0].ref_id });
  }, [sel, failedRoot, all, open]);

  // "Start here": the board re-rooted at any node, in the same workspace.
  const reroot = useCallback<ReRoot>(
    (item) => sel && open({ ws: sel.ws, root: item.id, label: item.name }),
    [sel, open],
  );

  // A root that fails to load falls back to the picker.
  const onFail = useCallback(() => {
    setFailedRoot(sel?.root ?? "?");
    setSel(null);
    setPickerOpen(true);
  }, [sel?.root]);

  const current = sel ? all.find((r) => r.ws === sel.ws && r.ref_id === sel.root) : undefined;
  return (
    <div className="relative h-full w-full" style={{ backgroundColor: LINEN }}>
      {sel && (
        <Board
          key={`${sel.ws}/${sel.root}`}
          ws={sel.ws}
          root={sel.root}
          members={members}
          onFail={onFail}
          onReroot={reroot}
        />
      )}
      {!sel && settled && all.length === 0 && (
        <p
          className={cn("absolute inset-0 flex items-center justify-center text-[24px] text-[#6b6248]", hand.className)}
          data-empty
        >
          No brainstorms yet — ask Jamie to brainstorm something.
        </p>
      )}
      {!sel && !settled && (
        <p className={cn("p-6 text-[20px] text-[#6b6248]", hand.className)}>Looking for brainstorms…</p>
      )}

      {/* Picker */}
      {all.length > 0 && (
        <div className="absolute left-3 top-3 z-20 w-64 font-sans" data-picker>
          <button
            type="button"
            title="Choose a brainstorm"
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-[14px]",
              CTL,
            )}
            onClick={() => setPickerOpen((o) => !o)}
            aria-expanded={pickerOpen}
          >
            <span className="truncate">
              {current ? current.text : sel?.label ? sel.label : failedRoot ? "Pick a brainstorm" : "Brainstorms"}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0" />
          </button>
          {failedRoot && !sel && (
            <p className="mt-1 rounded border border-[#d2d2d7] bg-white px-3 py-1 text-[14px] text-[#c8452c]">
              Couldn’t open that brainstorm.
            </p>
          )}
          {pickerOpen && (
            <ul
              className="mt-1 max-h-72 overflow-y-auto rounded-md border border-[#d2d2d7] bg-white py-1 text-[#1d1d1f] shadow-md"
              role="listbox"
            >
              {all.map((r) => (
                <li key={`${r.ws}/${r.ref_id}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={sel?.root === r.ref_id && sel.ws === r.ws}
                    className="block w-full px-3 py-1.5 text-left text-[14px] hover:bg-[#f5f5f7]"
                    onClick={() => open({ ws: r.ws, root: r.ref_id })}
                  >
                    <span className="block truncate">{r.text}</span>
                    {slugs.length > 1 && <span className="block text-[12px] text-[#6e6e73]">{r.ws}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
