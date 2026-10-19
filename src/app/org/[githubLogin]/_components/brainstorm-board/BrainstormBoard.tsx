"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronDown, Maximize, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildChoiceTree } from "../artifacts/viewers/ChoiceTree";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import { clickDraft, compose, expandDraft } from "./actions";
import { edgeTypes, RED, type BoardEdgeData } from "./edges";
import { hand, mono } from "./fonts";
import { HEADING_H, layoutBoard, ZONE_PAD } from "./layout";
import { Linen, LINEN, ZoomVar } from "./linen";
import { nodeTypes, type CardData, type NoteData, type ZoneData } from "./nodes";
import { loadNotes, loadPositions, saveNotes, savePositions, type BoardNote } from "./storage";
import { couldOnMyPath, dimmedIds, ghostIds, isPerson, matchMember, myPath, ZONES, type BoardMember, type Zone } from "./zones";

const REFETCH_MS = 15_000;
const MAX_SLUGS = 12;
const ZONE_COPY: Record<Zone, { title: string; subtitle: string; key: string; button: string }> = {
  built: { title: "what we built", subtitle: "decided and shipped", key: "1", button: "Built" },
  now: { title: "where we stand", subtitle: "open now — pick one", key: "2", button: "Now" },
  could: { title: "what could be", subtitle: "simulated — nothing here is built", key: "3", button: "Could be" },
};

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
}

/** Keys typed into the chat composer (or any field) must not drive the board. */
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

/** Same key and read as the chat card's tree, so the two share one cache entry. */
function useBoardTree(ws: string, root: string) {
  return useQuery({
    queryKey: ["choice-tree", ws, root, ""],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(ws)}/graph/choice-tree?focus=${encodeURIComponent(root)}`);
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

function Surface({ ws, root, rootJob, tree, members }: { ws: string; root: string; rootJob: string | null; tree: ReturnType<typeof buildChoiceTree>; members: BoardMember[] }) {
  const rf = useReactFlow();
  const rootItem = tree.items[0];
  const layout = useMemo(() => layoutBoard(tree), [tree]);
  const path = useMemo(() => myPath(tree), [tree]);
  const pathSet = useMemo(() => new Set(path), [path]);
  const ghosts = useMemo(() => ghostIds(tree), [tree]);
  const dimmed = useMemo(() => dimmedIds(tree), [tree]);
  const itemById = useMemo(() => new Map(tree.items.map((i) => [i.id, i])), [tree]);
  const [futures, setFutures] = useState<"all" | "mine">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const positions = useRef(loadPositions(root));
  const [notes, setNotes] = useState<BoardNote[]>(() => loadNotes(root));
  const [focusNote, setFocusNote] = useState<string | null>(null);

  useEffect(() => saveNotes(root, notes), [root, notes]);

  const onNoteText = useCallback((id: string, text: string) => setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, text } : n))), []);
  const onNoteDelete = useCallback((id: string) => setNotes((ns) => ns.filter((n) => n.id !== id)), []);

  const derived = useMemo<Node[]>(() => {
    const out: Node[] = ZONES.map((zone) => {
      const box = layout.zones[zone];
      const data: ZoneData = { zone, ...ZONE_COPY[zone], width: box.width + ZONE_PAD * 2, height: box.height + HEADING_H + ZONE_PAD, grid: zone === "could", empty: box.empty };
      return {
        id: `zone:${zone}`,
        type: "zone",
        position: { x: box.x - ZONE_PAD, y: box.y - HEADING_H },
        data,
        width: data.width,
        height: data.height,
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: -1,
        style: { pointerEvents: "none" as const },
      };
    });
    for (const item of tree.items) {
      const zone = layout.zoneOf.get(item.id) ?? "now";
      const ghost = ghosts.has(item.id);
      const isDim = dimmed.has(item.id);
      const data: CardData = {
        item,
        zone,
        height: layout.heights[item.id],
        built: zone === "built" && !ghost && !isDim && (item.state === "chosen" || item.state === "decided"),
        ghost,
        dim: isDim,
        selected: item.id === selectedId,
        member: matchMember(members, item),
      };
      out.push({
        id: item.id,
        type: "card",
        position: positions.current[item.id] ?? layout.positions[item.id],
        data,
        style: { width: 260 },
        hidden: futures === "mine" && zone === "could" && !couldOnMyPath(item.id, tree, pathSet),
      });
    }
    for (const n of notes) {
      const data: NoteData = { text: n.text, autoFocus: focusNote === n.id, onText: onNoteText, onDelete: onNoteDelete, noteId: n.id };
      out.push({ id: `note:${n.id}`, type: "note", position: { x: n.x, y: n.y }, data, zIndex: 5 });
    }
    return out;
  }, [tree, layout, ghosts, dimmed, selectedId, members, futures, pathSet, notes, focusNote, onNoteText, onNoteDelete]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(derived);
  useEffect(() => setNodes(derived), [derived, setNodes]);

  const edges = useMemo<Edge[]>(() => {
    const hidden = new Set(derived.filter((n) => n.hidden).map((n) => n.id));
    return tree.links.map((l) => {
      const source = itemById.get(l.source);
      const zs = layout.zoneOf.get(l.source);
      const zt = layout.zoneOf.get(l.target);
      const kind: BoardEdgeData["kind"] = ghosts.has(l.target)
        ? "ghost"
        : pathSet.has(l.source) && pathSet.has(l.target)
          ? "chosen"
          : zs === "built" && zt === "built"
            ? "built"
            : "normal";
      const data: BoardEdgeData = { kind, fromPerson: isPerson(source?.madeBy), dim: dimmed.has(l.target) };
      return { id: `${l.source}>${l.target}`, source: l.source, target: l.target, type: data.fromPerson ? "ink" : "agent", data, hidden: hidden.has(l.source) || hidden.has(l.target) };
    });
  }, [tree, itemById, layout, ghosts, dimmed, pathSet, derived]);

  const jumpTo = useCallback(
    (zone: Zone) => {
      const b = layout.zones[zone];
      if (b.empty) return;
      void rf.fitBounds({ x: b.x - ZONE_PAD, y: -HEADING_H, width: b.width + ZONE_PAD * 2, height: b.height + HEADING_H + ZONE_PAD }, { padding: 0.08, duration: 400 });
    },
    [layout, rf],
  );
  const fit = useCallback(() => void rf.fitView({ padding: 0.1, duration: 400 }), [rf]);

  const selected = selectedId ? itemById.get(selectedId) : undefined;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const zone = ZONES.find((z) => ZONE_COPY[z].key === k);
      if (zone) jumpTo(zone);
      else if (k === "f") fit();
      else if (k === "e" && selected) compose(expandDraft(selected), "replace");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jumpTo, fit, selected]);

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

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      const item = itemById.get(node.id);
      if (!item) return;
      if (selectedId === item.id) return setSelectedId(null);
      setSelectedId(item.id);
      const draft = clickDraft(item);
      if (draft) compose(draft, "append");
    },
    [itemById, selectedId],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === "card") {
        positions.current = { ...positions.current, [node.id]: node.position };
        savePositions(root, positions.current);
      } else if (node.type === "note") {
        const id = node.id.slice("note:".length);
        setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...node.position } : n)));
      }
    },
    [root],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".react-flow__pane") || t.closest(".react-flow__node")) return;
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = Math.random().toString(36).slice(2, 10);
      setNotes((ns) => [...ns, { id, x: p.x - 100, y: p.y - 30, text: "" }]);
      setFocusNote(id);
    },
    [rf],
  );

  const chip = "rounded-full border border-[#cdbf9c] bg-[#fbf6e6]/95 px-3 py-1 text-[17px] shadow-sm hover:bg-white";
  return (
    <div className="relative isolate h-full w-full" style={{ backgroundColor: LINEN }} onDoubleClick={onDoubleClick} data-brainstorm-board data-root={root}>
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
        minZoom={0.18}
        maxZoom={2.2}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
      >
        <Linen />
        <ZoomVar />
      </ReactFlow>

      {/* Your path */}
      <div className={cn("pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-4 pl-72", hand.className)}>
        <div className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-full border border-[#cdbf9c] bg-[#fbf6e6]/95 px-4 py-1 text-[18px] shadow-sm" data-trail>
          <span className="shrink-0 text-[#8a6a43]">Your path</span>
          {path.map((id, i) => {
            const it = itemById.get(id)!;
            const last = i === path.length - 1;
            return (
              <span key={id} className="flex shrink-0 items-center gap-2">
                <span className="text-[#8a6a43]">→</span>
                <button type="button" className={cn("hover:underline", last && "font-bold text-[#c8452c]")} title={it.name} onClick={() => void rf.fitView({ nodes: [{ id }], duration: 400, maxZoom: 1, padding: 0.6 })}>
                  {it.letter ?? short(it.name)}
                </button>
              </span>
            );
          })}
        </div>
      </div>

      {/* Zone jumps and the futures toggle */}
      <div className={cn("absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2", hand.className)}>
        {ZONES.map((z) => (
          <button key={z} type="button" className={chip} onClick={() => jumpTo(z)} disabled={layout.zones[z].empty} title={`Jump to ${ZONE_COPY[z].title} (${ZONE_COPY[z].key})`}>
            {ZONE_COPY[z].button} <kbd className="ml-1 text-[13px] text-[#8a6a43]">{ZONE_COPY[z].key}</kbd>
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-[#cdbf9c]" />
        <button type="button" className={chip} aria-pressed={futures === "mine"} onClick={() => setFutures((f) => (f === "all" ? "mine" : "all"))} title="Futures: all, or only those under your chosen path">
          Futures: {futures === "all" ? "all" : "my path"}
        </button>
      </div>

      {/* Zoom */}
      <div className={cn("absolute bottom-3 right-3 z-10 flex items-center gap-1", hand.className)}>
        <button type="button" aria-label="Zoom out" className={chip} onClick={() => void rf.zoomOut({ duration: 200 })}>
          <Minus className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Zoom in" className={chip} onClick={() => void rf.zoomIn({ duration: 200 })}>
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" className={chip} onClick={fit} title="Fit (F)">
          <Maximize className="mr-1 inline h-4 w-4" />Fit <kbd className="ml-1 text-[13px] text-[#8a6a43]">F</kbd>
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1 rounded-md border border-[#cdbf9c] bg-[#fbf6e6]/95 px-3 py-2 text-[#3d3626] shadow-sm" data-legend>
        <span className={cn("flex items-center gap-2 text-[17px]", hand.className)}>
          <i className="inline-block h-3 w-4 -rotate-3 bg-[#f5ebc4] shadow ring-1 ring-black/10" />a person wrote it
        </span>
        <span className={cn("flex items-center gap-2 text-[16px]", mono.className)}>
          <i className="inline-block h-3 w-4 border border-[#9ca3af] bg-white" />the agent wrote it
        </span>
        <span className={cn("flex items-center gap-2 text-[14px]", hand.className)} style={{ color: RED }}>
          <i className="inline-block h-3 w-4 rounded-full border-2" style={{ borderColor: RED }} />chosen
        </span>
      </div>
    </div>
  );
}

function Board({ ws, root, members, onFail }: { ws: string; root: string; members: BoardMember[]; onFail: () => void }) {
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
  if (isLoading || failed) return <p className={cn("p-6 text-[20px] text-[#6b6248]", hand.className)}>{failed ? "Couldn’t open that brainstorm…" : "Loading the board…"}</p>;
  return (
    <ReactFlowProvider>
      <Surface ws={ws} root={root} rootJob={rootJob} tree={tree} members={members} />
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
  const [sel, setSel] = useState<Selection | null>(initial.current.ws && initial.current.root ? { ws: initial.current.ws, root: initial.current.root } : null);
  const [failedRoot, setFailedRoot] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const members = useMembers(githubLogin);

  const slugs = useMemo(() => [...new Set([initial.current.ws, ...workspaceSlugs].filter((s): s is string => !!s))].slice(0, MAX_SLUGS), [workspaceSlugs]);
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
  const all = useMemo(() => lists.flatMap((q, i) => (q.data ?? []).map((r) => ({ ...r, ws: slugs[i] }))), [lists, slugs]);

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

  // A root that fails to load falls back to the picker.
  const onFail = useCallback(() => {
    setFailedRoot(sel?.root ?? "?");
    setSel(null);
    setPickerOpen(true);
  }, [sel?.root]);

  const current = sel ? all.find((r) => r.ws === sel.ws && r.ref_id === sel.root) : undefined;
  return (
    <div className="relative h-full w-full" style={{ backgroundColor: LINEN }}>
      {sel && <Board key={`${sel.ws}/${sel.root}`} ws={sel.ws} root={sel.root} members={members} onFail={onFail} />}
      {!sel && settled && all.length === 0 && (
        <p className={cn("absolute inset-0 flex items-center justify-center text-[24px] text-[#6b6248]", hand.className)} data-empty>
          No brainstorms yet — ask Jamie to brainstorm something.
        </p>
      )}
      {!sel && !settled && <p className={cn("p-6 text-[20px] text-[#6b6248]", hand.className)}>Looking for brainstorms…</p>}

      {/* Picker */}
      {all.length > 0 && (
        <div className={cn("absolute left-3 top-3 z-20 w-64", hand.className)} data-picker>
          <button type="button" className="flex w-full items-center justify-between gap-2 rounded-full border border-[#cdbf9c] bg-[#fbf6e6]/95 px-3 py-1 text-left text-[18px] shadow-sm hover:bg-white" onClick={() => setPickerOpen((o) => !o)} aria-expanded={pickerOpen}>
            <span className="truncate">{current ? current.text : failedRoot ? "Pick a brainstorm" : "Brainstorms"}</span>
            <ChevronDown className="h-4 w-4 shrink-0" />
          </button>
          {failedRoot && !sel && <p className="mt-1 rounded bg-[#fbf6e6]/95 px-3 py-1 text-[16px] text-[#c8452c]">Couldn’t open that brainstorm.</p>}
          {pickerOpen && (
            <ul className="mt-1 max-h-72 overflow-y-auto rounded-md border border-[#cdbf9c] bg-[#fbf6e6] py-1 shadow-md" role="listbox">
              {all.map((r) => (
                <li key={`${r.ws}/${r.ref_id}`}>
                  <button type="button" role="option" aria-selected={sel?.root === r.ref_id && sel.ws === r.ws} className="block w-full px-3 py-1 text-left text-[17px] hover:bg-white" onClick={() => open({ ws: r.ws, root: r.ref_id })}>
                    <span className="block truncate">{r.text}</span>
                    {slugs.length > 1 && <span className="block text-[13px] text-[#8a6a43]">{r.ws}</span>}
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
