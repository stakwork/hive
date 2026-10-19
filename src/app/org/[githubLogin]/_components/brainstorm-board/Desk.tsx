"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Maximize, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getOrgChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { useContextMenu } from "@/components/graph-workbench/ContextMenu";
import { buildChoiceTree, type ChoiceItem } from "../artifacts/viewers/ChoiceTree";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import { cardActions, composeFor, isBoardAction, type DeskAction } from "./actions";
import { HEADING_ABOVE, latestAdded, placeDesk, type DeskBlock } from "./desk-layout";
import { edgeTypes, type BoardEdgeData } from "./edges";
import { hand } from "./fonts";
import { CARD_W, layoutBoard } from "./layout";
import { Linen, LINEN } from "./linen";
import { dimmedIds, ghostIds, isPerson, matchMember, myPath, type BoardMember } from "./model";
import { nodeTypes, PaperDefs, type CardData, type DraftData, type HeadingData, type SlotData } from "./nodes";
import {
  addCard,
  clearSaved,
  discard,
  isPencilId,
  newTempId,
  setText,
  withPencil,
  type Pencil,
  type RawTree,
} from "./pencil";
import { DeskSearch } from "./DeskSearch";
import type { SearchEntry } from "./search";

const MAX_SLUGS = 12;
/** Pusher refetches a changed tree at once; this is the fallback. */
const REFETCH_MS = 60_000;
const SLOT_H = 46;
const DRAFT_H = 110;
const ROOT_DRAFT = { w: 420, h: 150 };
/** Other brainstorms, while one is in focus. */
const FADED = 0.18;

interface RootEntry {
  ref_id: string;
  text: string;
  job: string | null;
  made_by: string | null;
}
interface XY {
  x: number;
  y: number;
}
interface Draft {
  /** The brainstorm it belongs to: a root ref_id, or a new brainstorm's temp id. */
  key: string;
  ws: string;
  root: string | null;
  kind: "question" | "option";
  /** The card it goes under; null for a new brainstorm. */
  parent: string | null;
  /** Rewriting this card rather than adding one. */
  editId?: string;
  initial: string;
  /** Where a new brainstorm was opened. */
  at?: XY;
}
interface Block {
  key: string;
  ws: string;
  root: string;
  job: string | null;
  tree: ReturnType<typeof buildChoiceTree>;
  /** Card and slot positions inside the block, and the block's size. */
  positions: Record<string, XY>;
  width: number;
  height: number;
  /** Latest time a card was added, ms; now when unsaved pencil. */
  at: number | undefined;
  slots: Array<{ id: string; question: string }>;
  draftId: string | null;
}

/** The opening view never zooms out past this; a tall day shows its top instead. */
const MIN_OPEN_ZOOM = 0.45;

/** Keys typed into the chat composer (or any field) must not drive the desk. */
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

const CHIP =
  "rounded-full border border-[#cdbf9c] bg-[#fbf6e6]/95 px-3.5 py-1 text-[17px] text-[#2f2b26] shadow-[0_1px_2px_rgba(80,60,20,.08),0_2px_6px_rgba(80,60,20,.06)] transition-colors hover:bg-white active:scale-[.97]";

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

/** A placeholder item for a slot or a draft, so dagre leaves room for it in the tree. */
const placeholder = (id: string): ChoiceItem => ({ id, name: "", state: "open", isQuestion: false });

/**
 * The brainstorm desk (`?view=desk`): every brainstorm of the org's
 * workspaces on one linen desk, a column per workspace. People write cards
 * by hand in pencil and save them to the graph; everything else they ask of
 * a card is drafted into Jamie's chat, as before. `?ws=&root=` focuses one
 * brainstorm.
 */
export function Desk({ githubLogin, workspaceSlugs }: { githubLogin: string; workspaceSlugs: string[] }) {
  return (
    <ReactFlowProvider>
      <DeskSurface githubLogin={githubLogin} workspaceSlugs={workspaceSlugs} />
    </ReactFlowProvider>
  );
}

function DeskSurface({ githubLogin, workspaceSlugs }: { githubLogin: string; workspaceSlugs: string[] }) {
  const rf = useReactFlow();
  // The pane's own size (the desk is narrower than the window: the chat panel sits beside it).
  const paneW = useStore((s) => s.width);
  const paneH = useStore((s) => s.height);
  const qc = useQueryClient();
  const params = useSearchParams();
  const initial = useRef({ ws: params.get("ws"), root: params.get("root") });
  const me = useSession().data?.user?.name ?? null;
  const members = useMembers(githubLogin);
  const { open: openMenu, menu } = useContextMenu();

  // ── Data: the brainstorms of every workspace, and each one's tree ────────
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
      refetchInterval: REFETCH_MS,
      retry: false,
    })),
    combine: combineLists,
  });
  const listsSettled = slugs.length > 0 && lists.settled;
  const roots = useMemo(
    () => {
      // Workspaces don't split the desk, so a brainstorm listed by several shows once (first workspace wins).
      const seen = new Set<string>();
      return lists.data
        .flatMap((d, i) => (d ?? []).map((r) => ({ ...r, ws: slugs[i] })))
        .filter((r) => !seen.has(r.ref_id) && !!seen.add(r.ref_id));
    },
    [lists, slugs],
  );
  // Same key and read as the chat card's tree, so the two share one cache entry.
  const trees = useQueries({
    queries: roots.map((r) => ({
      queryKey: ["choice-tree", r.ws, r.ref_id, ""],
      queryFn: async () => {
        const res = await fetch(
          `/api/workspaces/${encodeURIComponent(r.ws)}/graph/choice-tree?focus=${encodeURIComponent(r.ref_id)}`,
        );
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return (await res.json()) as RawTree;
      },
      refetchInterval: REFETCH_MS,
      refetchOnWindowFocus: true,
      retry: 1,
    })),
    combine: combineTrees,
  });

  // A save anywhere (this desk, a teammate's) refetches that one tree.
  const channel = usePusherChannel(getOrgChannelName(githubLogin));
  useEffect(() => {
    if (!channel) return;
    const onUpdate = (p: { workspaceSlug?: string; root?: string }) => {
      if (!p?.workspaceSlug) return;
      void qc.invalidateQueries({ queryKey: ["brainstorms", p.workspaceSlug] });
      if (p.root) void qc.invalidateQueries({ queryKey: ["choice-tree", p.workspaceSlug, p.root] });
    };
    channel.bind(PUSHER_EVENTS.BRAINSTORM_UPDATED, onUpdate);
    return () => {
      channel.unbind(PUSHER_EVENTS.BRAINSTORM_UPDATED, onUpdate);
    };
  }, [channel, qc]);

  // ── Desk state ────────────────────────────────────────────────────────────
  const [pencil, setPencil] = useState<Pencil>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(initial.current.root);
  const [searching, setSearching] = useState(false);
  /** Where brainstorms opened on the desk sit this session; nothing is stored. */
  const [anchors, setAnchors] = useState<Record<string, XY>>({});
  const saving = useRef(false);

  // Real heights, reported by the nodes; the layout uses them over its estimates.
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const pendingSizes = useRef<Record<string, number>>({});
  const frame = useRef(0);
  const onSize = useCallback((id: string, height: number) => {
    pendingSizes.current[id] = height;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const batch = pendingSizes.current;
      pendingSizes.current = {};
      setMeasured((m) => {
        let changed = false;
        const next = { ...m };
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

  // ── Blocks: one per brainstorm, with pencil written in, slots and the draft ─
  const blocks = useMemo<Block[]>(() => {
    const entries: Array<{ key: string; ws: string; root: string; job: string | null; raw: RawTree | undefined }> =
      roots.map((r, i) => ({
        key: r.ref_id,
        ws: r.ws,
        root: r.ref_id,
        job: r.job,
        raw: trees[i],
      }));
    // Brainstorms started on the desk and not saved yet.
    for (const [key, b] of Object.entries(pencil)) {
      if (b.root === null && b.ops[0]?.op === "add_question")
        entries.push({ key, ws: b.ws, root: b.ops[0].temp, job: null, raw: undefined });
    }
    return entries.flatMap(({ key, ws, root, job, raw }) => {
      const shown = withPencil(raw, pencil[key], me);
      const tree = buildChoiceTree(shown.nodes ?? [], shown.edges ?? [], root);
      if (!tree.items.length) return [];
      const ghosts = ghostIds(tree);
      const slots = tree.items
        .filter((i) => i.isQuestion && i.state === "open" && !ghosts.has(i.id))
        .map((i) => ({ id: `slot:${i.id}`, question: i.id }));
      const adding = draft && !draft.editId && draft.key === key && draft.parent ? draft : null;
      const draftId = adding ? "draft" : null;
      const extra = [...slots.map((s) => ({ item: placeholder(s.id), parent: s.question, h: SLOT_H }))];
      if (adding) extra.push({ item: placeholder("draft"), parent: adding.parent!, h: DRAFT_H });
      const laid = layoutBoard(
        {
          items: [...tree.items, ...extra.map((e) => e.item)],
          links: [...tree.links, ...extra.map((e) => ({ source: e.parent, target: e.item.id }))],
        },
        selected,
        {
          ...Object.fromEntries(extra.map((e) => [e.item.id, measured[e.item.id] ?? e.h])),
          ...pick(
            measured,
            tree.items.map((i) => i.id),
          ),
        },
      );
      const now = Date.now();
      const at = pencil[key]?.ops.length ? now : latestAdded(raw?.nodes);
      const ids = Object.keys(laid.positions);
      const minX = Math.min(...ids.map((id) => laid.positions[id].x));
      const minY = Math.min(...ids.map((id) => laid.positions[id].y));
      const positions = Object.fromEntries(
        ids.map((id) => [id, { x: laid.positions[id].x - minX, y: laid.positions[id].y - minY }]),
      );
      const width = Math.max(...ids.map((id) => positions[id].x + CARD_W));
      const height = Math.max(...ids.map((id) => positions[id].y + laid.heights[id]));
      return [{ key, ws, root, job, tree, positions, width, height, at, slots, draftId }];
    });
  }, [roots, trees, pencil, draft, selected, measured, me]);

  const placement = useMemo(() => {
    const deskBlocks: DeskBlock[] = blocks.map((b) => ({
      key: b.key,
      ws: b.ws,
      width: b.width,
      height: b.height,
      at: b.at,
      anchor: anchors[b.key],
    }));
    if (draft && draft.root === null && draft.at) {
      deskBlocks.push({ key: "draft-root", ws: draft.ws, at: Date.now(), width: ROOT_DRAFT.w, height: ROOT_DRAFT.h, anchor: draft.at });
    }
    return placeDesk(deskBlocks, Date.now());
  }, [blocks, anchors, draft]);

  /** Which brainstorm each card belongs to. */
  const keyOf = useMemo(() => new Map(blocks.flatMap((b) => b.tree.items.map((i) => [i.id, b] as const))), [blocks]);

  // ── Actions ───────────────────────────────────────────────────────────────
  /** Saves one brainstorm's pencil; returns the new ids by temp id, or null when it failed. */
  const saveBatch = useCallback(
    async (key: string, current: Pencil): Promise<Record<string, string> | null> => {
      const batch = current[key];
      if (!batch) return {};
      try {
        const res = await fetch(`/api/workspaces/${encodeURIComponent(batch.ws)}/graph/brainstorms/changes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ root: batch.root, ops: batch.ops }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          root?: string;
          created?: Record<string, string>;
          error?: string;
        };
        if (!res.ok || !body.root) {
          toast.error(body.error ?? "Couldn't save your cards. They're still on the desk in pencil.");
          return null;
        }
        const created = body.created ?? {};
        setPencil((p) => clearSaved(p, key));
        if (batch.root === null) {
          // The new brainstorm keeps its place on the desk under its real id.
          setAnchors((a) => (a[key] ? { ...a, [body.root!]: a[key] } : a));
          setFocus((f) => (f === key ? body.root! : f));
        }
        setSelected((s) => (s && created[s] ? created[s] : s));
        void qc.invalidateQueries({ queryKey: ["brainstorms", batch.ws] });
        await qc.invalidateQueries({ queryKey: ["choice-tree", batch.ws, body.root] });
        return created;
      } catch {
        toast.error("Couldn't reach the server. Your cards are still on the desk in pencil.");
        return null;
      }
    },
    [qc],
  );

  const pencilRef = useRef(pencil);
  pencilRef.current = pencil;
  const saveAll = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      for (const key of Object.keys(pencilRef.current)) await saveBatch(key, pencilRef.current);
    } finally {
      saving.current = false;
    }
  }, [saveBatch]);

  const startNewBox = useCallback(
    (at: XY) => {
      setSelected(null);
      setDraft({
        key: newTempId(),
        ws: slugs[0] ?? "",
        root: null,
        kind: "question",
        parent: null,
        initial: "",
        at: { x: at.x - 210, y: at.y - 50 },
      });
      // Write it at a readable size, wherever the desk was zoomed to.
      void rf.setCenter(at.x, at.y, { zoom: Math.max(rf.getZoom(), 0.9), duration: 320 });
    },
    [slugs, rf],
  );

  const onAct = useCallback(
    async (action: DeskAction, item: ChoiceItem) => {
      const block = keyOf.get(item.id);
      if (!block) return;
      const root = pencil[block.key]?.root === null ? null : block.root;
      if (action === "add-option" || action === "follow-up") {
        setDraft({
          key: block.key,
          ws: block.ws,
          root,
          kind: action === "add-option" ? "option" : "question",
          parent: item.id,
          initial: "",
        });
        setSelected(null);
        return;
      }
      if (action === "edit") {
        setDraft({
          key: block.key,
          ws: block.ws,
          root,
          kind: item.isQuestion ? "question" : "option",
          parent: null,
          editId: item.id,
          initial: item.name,
        });
        return;
      }
      if (action === "discard") {
        setPencil((p) => discard(p, block.key, item.id));
        setSelected(null);
        return;
      }
      if (!isBoardAction(action)) return;
      // The job only sees what's in the graph: save this brainstorm's pencil first.
      let id = item.id;
      if (pencil[block.key]) {
        const created = await saveBatch(block.key, pencil);
        if (!created) return;
        id = created[item.id] ?? item.id;
      }
      composeFor(action, { ...item, id });
    },
    [keyOf, pencil, saveBatch],
  );

  const commitDraft = useCallback(
    (text: string) => {
      if (!draft) return;
      if (draft.editId) {
        setPencil((p) => setText(p, draft.key, draft.ws, draft.root ?? draft.key, draft.editId!, text));
      } else if (draft.parent === null) {
        setPencil((p) =>
          addCard(p, draft.key, draft.ws, null, { op: "add_question", temp: draft.key, parent: null, text }),
        );
        setAnchors((a) => ({ ...a, [draft.key]: draft.at! }));
        setSelected(draft.key);
        setFocus(draft.key);
      } else {
        const temp = newTempId();
        setPencil((p) =>
          addCard(p, draft.key, draft.ws, draft.root, {
            op: draft.kind === "option" ? "add_option" : "add_question",
            temp,
            parent: draft.parent!,
            text,
          }),
        );
      }
      setDraft(null);
    },
    [draft],
  );
  const cancelDraft = useCallback(() => setDraft(null), []);
  const setDraftWs = useCallback((ws: string) => setDraft((d) => (d ? { ...d, ws } : d)), []);
  const onAddSlot = useCallback(
    (question: string) => {
      const block = keyOf.get(question);
      if (!block) return;
      setSelected(null);
      setDraft({
        key: block.key,
        ws: block.ws,
        root: pencil[block.key]?.root === null ? null : block.root,
        kind: "option",
        parent: question,
        initial: "",
      });
    },
    [keyOf, pencil],
  );

  // ── Flow nodes and edges ──────────────────────────────────────────────────
  const { flowNodes, flowEdges } = useMemo(() => {
    const flowNodes: Node[] = [];
    const flowEdges: Edge[] = [];
    for (const h of placement.headings) {
      const data: HeadingData = { title: h.title, subtitle: `${h.count} brainstorm${h.count === 1 ? "" : "s"}` };
      flowNodes.push({
        id: `heading:${h.day}`,
        type: "heading",
        position: { x: h.x, y: h.y },
        data,
        draggable: false,
        selectable: false,
        focusable: false,
      });
    }
    for (const b of blocks) {
      const at = placement.offsets[b.key] ?? { x: 0, y: 0 };
      const faded = focus !== null && focus !== b.key ? { opacity: FADED } : undefined;
      const pos = (id: string) => ({ x: at.x + b.positions[id].x, y: at.y + b.positions[id].y });
      const ghosts = ghostIds(b.tree);
      const dimmed = dimmedIds(b.tree);
      const path = myPath(b.tree);
      const pathSet = new Set(path);
      const frontier = path[path.length - 1];
      const batch = pencil[b.key];
      for (const item of b.tree.items) {
        if (draft?.editId === item.id) {
          const data: DraftData = {
            kind: draft.kind,
            root: false,
            initial: draft.initial,
            workspaces: slugs,
            ws: draft.ws,
            onWorkspace: setDraftWs,
            onCommit: commitDraft,
            onCancel: cancelDraft,
            onSize,
          };
          flowNodes.push({ id: item.id, type: "draft", position: pos(item.id), data, draggable: false, zIndex: 20 });
          continue;
        }
        const data: CardData = {
          item,
          ghost: ghosts.has(item.id),
          dim: dimmed.has(item.id),
          selected: item.id === selected,
          frontier: item.id === frontier && item.isQuestion && item.state === "open",
          pencil:
            isPencilId(batch, item.id) || (batch?.ops.some((o) => o.op === "edit_text" && o.ref === item.id) ?? false),
          member: matchMember(members, item),
          onSize,
          onAct,
        };
        flowNodes.push({
          id: item.id,
          type: "card",
          position: pos(item.id),
          data,
          style: { width: CARD_W, ...faded },
          zIndex: item.id === selected ? 10 : 0,
        });
      }
      for (const s of b.slots) {
        const data: SlotData = { question: s.question, onAdd: onAddSlot, onSize };
        flowNodes.push({ id: s.id, type: "slot", position: pos(s.id), data, draggable: false, style: faded });
        flowEdges.push({
          id: `${s.question}>${s.id}`,
          source: s.question,
          target: s.id,
          type: "ink",
          data: { kind: "ghost", fromPerson: true } satisfies BoardEdgeData,
        });
      }
      if (b.draftId && draft) {
        const data: DraftData = {
          kind: draft.kind,
          root: false,
          initial: "",
          workspaces: slugs,
          ws: draft.ws,
          onWorkspace: setDraftWs,
          onCommit: commitDraft,
          onCancel: cancelDraft,
          onSize,
        };
        flowNodes.push({ id: b.draftId, type: "draft", position: pos(b.draftId), data, draggable: false, zIndex: 20 });
        flowEdges.push({
          id: `${draft.parent}>draft`,
          source: draft.parent!,
          target: b.draftId,
          type: "ink",
          data: { kind: "normal", fromPerson: true } satisfies BoardEdgeData,
        });
      }
      const byId = new Map(b.tree.items.map((i) => [i.id, i]));
      for (const l of b.tree.links) {
        const person = isPerson(byId.get(l.source)?.madeBy);
        const kind: BoardEdgeData["kind"] = ghosts.has(l.target)
          ? "ghost"
          : pathSet.has(l.source) && pathSet.has(l.target)
            ? "chosen"
            : "normal";
        const data: BoardEdgeData = { kind, fromPerson: person, dim: dimmed.has(l.target) };
        flowEdges.push({
          id: `${l.source}>${l.target}`,
          source: l.source,
          target: l.target,
          type: person ? "ink" : "agent",
          data,
          style: faded,
        });
      }
    }
    if (draft && draft.root === null && draft.at) {
      const data: DraftData = {
        kind: "question",
        root: true,
        initial: "",
        workspaces: slugs,
        ws: draft.ws,
        onWorkspace: setDraftWs,
        onCommit: commitDraft,
        onCancel: cancelDraft,
        onSize,
      };
      flowNodes.push({ id: "draft-root", type: "draft", position: draft.at, data, draggable: false, zIndex: 20 });
    }
    return { flowNodes, flowEdges };
  }, [
    placement,
    blocks,
    focus,
    pencil,
    draft,
    selected,
    members,
    slugs,
    onSize,
    onAct,
    onAddSlot,
    commitDraft,
    cancelDraft,
    setDraftWs,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(flowNodes);
  useEffect(() => {
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return flowNodes.map((n) => ({ ...n, measured: old.get(n.id)?.measured }));
    });
  }, [flowNodes, setNodes]);

  // ── View ──────────────────────────────────────────────────────────────────
  // Off-screen cards aren't rendered (so not measured): fit to the layout's own bounds, not xyflow's.
  const deskBounds = useMemo(() => {
    const boxes = [
      ...blocks.map((b) => ({ ...(placement.offsets[b.key] ?? { x: 0, y: 0 }), w: b.width, h: b.height })),
      ...placement.headings.map((h) => ({ x: h.x, y: h.y, w: 700, h: 200 })),
    ];
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map((b) => b.x));
    // Room above the headings for the chips along the top.
    const y = Math.min(...boxes.map((b) => b.y)) - 500;
    return {
      x,
      y,
      width: Math.max(...boxes.map((b) => b.x + b.w)) - x,
      height: Math.max(...boxes.map((b) => b.y + b.h)) - y,
    };
  }, [blocks, placement]);
  const fit = useCallback(
    (duration = 380) => {
      if (deskBounds) void rf.fitBounds(deskBounds, { padding: 0.06, duration });
    },
    [rf, deskBounds],
  );
  /** Today: the newest (rightmost) day's brainstorms, at a readable zoom. */
  const showNewest = useCallback(() => {
    const last = placement.columns[placement.columns.length - 1];
    if (!last) return fit(0);
    const top = -HEADING_ABOVE - 20;
    const bottom = Math.max(
      ...blocks
        .map((b) => ({ ...(placement.offsets[b.key] ?? { x: 0, y: 0 }), h: b.height }))
        .filter((b) => b.x >= last.x0 && b.x <= last.x1)
        .map((b) => b.y + b.h),
      0,
    );
    const w = last.x1 - last.x0;
    const h = bottom - top;
    const pad = 0.06;
    const fitZoom = Math.min((paneW * (1 - 2 * pad)) / w, (paneH * (1 - 2 * pad)) / h);
    if (fitZoom >= MIN_OPEN_ZOOM) {
      const zoom = Math.min(1, fitZoom);
      void rf.setViewport({ x: (paneW - w * zoom) / 2 - last.x0 * zoom, y: (paneH - h * zoom) / 2 - top * zoom, zoom });
    } else {
      // A tall day: keep it readable; its label and newest tree up top, clear of the toolbar.
      void rf.setViewport({ x: 80 - last.x0 * MIN_OPEN_ZOOM, y: 120 - top * MIN_OPEN_ZOOM, zoom: MIN_OPEN_ZOOM });
    }
  }, [placement, blocks, rf, fit, paneW, paneH]);
  const focusOn = useCallback(
    (key: string | null) => {
      setFocus(key);
      if (!key) return void setTimeout(() => fit(), 0);
      const at = placement.offsets[key];
      const b = blocks.find((x) => x.key === key);
      if (at && b)
        void rf.fitBounds(
          { x: at.x - 60, y: at.y - 60, width: b.width + 120, height: b.height + 120 },
          { padding: 0.06, duration: 420 },
        );
    },
    [placement, blocks, rf, fit],
  );

  // Opening view, once the brainstorms are on the desk: the one the link names, else everything.
  // Runs once; a change before it fires (cards reporting their sizes) just restarts the wait.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !listsSettled || !blocks.length || !paneW || !paneH) return;
    const t = setTimeout(() => {
      opened.current = true;
      const named = initial.current.root && blocks.some((b) => b.key === initial.current.root);
      if (named) focusOn(initial.current.root);
      else showNewest();
    }, 150);
    return () => clearTimeout(t);
  }, [listsSettled, blocks, focusOn, showNewest, paneW, paneH]);

  // A brainstorm being written or opened from search is brought into view.
  const flyTo = useCallback(
    (id: string) => {
      const n = flowNodes.find((f) => f.id === id);
      if (n)
        void rf.setCenter(n.position.x + CARD_W / 2, n.position.y + 60, {
          zoom: Math.max(rf.getZoom(), 0.9),
          duration: 420,
        });
    },
    [flowNodes, rf],
  );

  // ── Jamie: the brainstorm in view and the card selected on it ─────────────
  const setBrainstormFocus = useCanvasChatStore((s) => s.setBrainstormFocus);
  const inView = (selected && keyOf.get(selected)) || (focus ? blocks.find((b) => b.key === focus) : undefined);
  const selectedItem = selected ? keyOf.get(selected)?.tree.items.find((i) => i.id === selected) : undefined;
  useEffect(() => {
    // An unsaved brainstorm isn't in the graph yet: nothing for Jamie to look at.
    if (!inView || pencil[inView.key]?.root === null) return void setBrainstormFocus(null);
    setBrainstormFocus({
      workspaceSlug: inView.ws,
      rootRefId: inView.root,
      rootText: inView.tree.items[0]?.name ?? inView.root,
      jobId: inView.job,
      selectedRefId: selectedItem && !isPencilId(pencil[inView.key], selectedItem.id) ? selectedItem.id : null,
      selectedLabel: selectedItem?.letter ?? null,
    });
  }, [setBrainstormFocus, inView, selectedItem, pencil]);
  useEffect(() => () => setBrainstormFocus(null), [setBrainstormFocus]);

  // ── Keys, and leaving with unsaved pencil ─────────────────────────────────
  const unsaved = Object.values(pencil).reduce((n, b) => n + b.ops.length, 0);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "s") {
        e.preventDefault();
        void saveAll();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && k === "k") {
        e.preventDefault();
        setSearching((s) => !s);
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (k === "escape") {
        if (selected) setSelected(null);
        else if (focus) focusOn(null);
      } else if (k === "f") fit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveAll, selected, focus, focusOn, fit]);

  // ── Search ────────────────────────────────────────────────────────────────
  const entries = useMemo<SearchEntry[]>(
    () =>
      blocks.flatMap((b) =>
        b.tree.items.map((item) => ({ item, key: b.key, ws: b.ws, board: b.tree.items[0]?.name ?? "" })),
      ),
    [blocks],
  );
  const onPick = useCallback(
    (id: string, key: string) => {
      setSearching(false);
      setFocus(key);
      setSelected(id === key ? null : id);
      flyTo(id);
    },
    [flyTo],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  const empty = listsSettled && !blocks.length && !draft;
  return (
    <div
      className="relative isolate h-full w-full"
      style={{ backgroundColor: LINEN }}
      data-brainstorm-desk
      onDoubleClick={(e) => {
        const t = e.target as HTMLElement;
        if (!t.closest(".react-flow__pane") || t.closest(".react-flow__node")) return;
        startNewBox(rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }}
    >
      <PaperDefs />
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => {
          if (n.type !== "card") return;
          setSelected((s) => (s === n.id ? null : n.id));
          const key = keyOf.get(n.id)?.key;
          if (key && focus && focus !== key) setFocus(key);
        }}
        onPaneClick={() => setSelected(null)}
        onPaneContextMenu={(e) => {
          const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          openMenu(e, [
            { label: "New question here", onSelect: () => startNewBox(at) },
            { label: "Search the desk", hint: "⌘K", onSelect: () => setSearching(true) },
            ...(unsaved
              ? [
                  {
                    label: `Save ${unsaved} change${unsaved === 1 ? "" : "s"}`,
                    hint: "⌘S",
                    onSelect: () => void saveAll(),
                  },
                ]
              : []),
            { label: "Fit everything", hint: "F", separatorBefore: true, onSelect: () => fit() },
            ...(focus ? [{ label: "Back to the whole desk", hint: "Esc", onSelect: () => focusOn(null) }] : []),
          ]);
        }}
        onNodeContextMenu={(e, n) => {
          if (n.type !== "card") return e.preventDefault();
          const { item, pencil: inPencil } = n.data as CardData;
          const block = keyOf.get(item.id);
          openMenu(
            e,
            [
              ...cardActions(item, { pencil: inPencil, person: isPerson(item.madeBy) }).map((a) => ({
                label: a.label,
                onSelect: () => void onAct(a.action, item),
              })),
              ...(block && block.key !== focus
                ? [{ label: "Focus this brainstorm", separatorBefore: true, onSelect: () => focusOn(block.key) }]
                : []),
            ],
            item.name,
          );
        }}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        minZoom={0.08}
        maxZoom={2.2}
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
      >
        <Linen />
        <MiniMap
          pannable
          zoomable
          position="bottom-left"
          nodeColor={minimapColor}
          nodeStrokeWidth={0}
          nodeBorderRadius={2}
          maskColor="rgba(236,227,207,.6)"
          className="!rounded-[10px] !border !border-[#cdbf9c] !bg-[#f4ecd9] shadow-[0_1px_2px_rgba(80,60,20,.08),0_4px_14px_rgba(80,60,20,.1)]"
          style={{ width: 200, height: 130 }}
        />
      </ReactFlow>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(ellipse_at_50%_45%,transparent_55%,rgba(90,60,20,.13)_100%)]"
      />
      {menu}

      {/* Top left: new, search, focus, save */}
      <div className={cn("absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2", hand.className)}>
        <button
          type="button"
          className={CHIP}
          onClick={() => startNewBox(rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }))}
        >
          + New brainstorm
        </button>
        <button type="button" className={CHIP} onClick={() => setSearching((s) => !s)} aria-expanded={searching}>
          Search <kbd className="ml-1 text-[13px] text-[#8a6a43]">⌘K</kbd>
        </button>
        {focus && blocks.some((b) => b.key === focus) && (
          <button
            type="button"
            className={cn(CHIP, "max-w-[320px] truncate")}
            onClick={() => focusOn(null)}
            title="Back to the whole desk (Esc)"
          >
            ◎ {blocks.find((b) => b.key === focus)?.tree.items[0]?.name}{" "}
            <kbd className="ml-1 text-[13px] text-[#8a6a43]">Esc</kbd>
          </button>
        )}
        {unsaved > 0 && (
          <button
            type="button"
            className={cn(CHIP, "border-[#2f2b26] bg-[#2f2b26] text-[#fbf6e6] hover:bg-black")}
            onClick={() => void saveAll()}
            data-save
          >
            Save {unsaved} change{unsaved === 1 ? "" : "s"} <kbd className="ml-1 text-[13px] opacity-60">⌘S</kbd>
          </button>
        )}
        {!unsaved && !focus && (
          <span className="text-[16px] text-[#8a6a43]">double-click or right-click the desk to add</span>
        )}
      </div>
      {searching && <DeskSearch entries={entries} onPick={onPick} onClose={() => setSearching(false)} />}

      {/* Zoom */}
      <div className={cn("absolute bottom-3 right-3 z-10 flex items-center gap-1.5", hand.className)}>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          className={CHIP}
          onClick={() => void rf.zoomOut({ duration: 160 })}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          className={CHIP}
          onClick={() => void rf.zoomIn({ duration: 160 })}
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Fit everything (F)"
          className={cn(CHIP, "flex items-center gap-1")}
          onClick={() => fit()}
        >
          <Maximize className="h-4 w-4" />
          Fit <kbd className="text-[13px] text-[#8a6a43]">F</kbd>
        </button>
      </div>

      {!listsSettled && slugs.length > 0 && (
        <p className={cn("absolute left-4 top-16 text-[20px] text-[#6b6248]", hand.className)}>
          Looking for brainstorms…
        </p>
      )}
      {empty && (
        <p
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center justify-center text-[24px] text-[#6b6248]",
            hand.className,
          )}
          data-empty
        >
          No brainstorms yet. Double-click anywhere to start one.
        </p>
      )}
    </div>
  );
}

// Module-level, so `useQueries` keeps returning the same object until a query's data changes.
const combineLists = (results: Array<{ data?: RootEntry[]; isLoading: boolean }>) => ({
  data: results.map((r) => r.data),
  settled: results.every((r) => !r.isLoading),
});
const combineTrees = (results: Array<{ data?: RawTree }>) => results.map((r) => r.data);

function pick(m: Record<string, number>, ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) if (m[id] !== undefined) out[id] = m[id];
  return out;
}

const minimapColor = (n: Node) => {
  if (n.type === "card") return isPerson((n.data as CardData).item.madeBy) ? "#e2cd85" : "#fffdf6";
  if (n.type === "heading") return "rgba(61,54,38,.35)";
  return "#d8ccb0";
};
