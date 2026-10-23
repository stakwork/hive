"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getOrgChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { getJson } from "@/components/graph-workbench/queries";
import type { InitiativeOp } from "@/services/graph/initiative-write";
import type { ChoiceTreeData, InitiativeSummary, InitiativeTreeData } from "@/services/graph/workbench";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import { type Board, type InitiativeEntry, type PlanNode, toBoard } from "./board";

/** Initiatives listed per workspace (the desk shows the latest few; the stack and its list, the rest). */
export const LISTED_INITIATIVES = 50;
const REFETCH_MS = 60_000;
/** A plan read in the last half minute isn't read again when ⌘K or the list asks for every plan. */
const STALE_MS = 30_000;
/** While strut is writing a plan, read it this often so cards appear as they land. */
const BUILDING_MS = 1_600;

type ListResponse = { initiatives: InitiativeSummary[]; building: boolean };

/** A saved change to one initiative's plan, as the edit endpoint takes it. */
export type PlanOp = InitiativeOp;

const treeKey = (ws: string, ref: string) => ["initiative-tree", ws, ref];
/** Same key and read as the chat card's tree and the desk, so they share one cache entry. */
const choiceKey = (ws: string, root: string) => ["choice-tree", ws, root, ""];

async function post(url: string, body: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, body: { error: "Couldn't reach the server. Nothing was saved." } };
  }
}

/** The edge a new card hangs from its parent by, for the cards that show at once (stories and requirements). */
const ADD_EDGE: Partial<Record<string, string>> = { UserStory: "HAS_STORY", Requirement: "HAS_REQUIREMENT" };
let tempSeq = 0;

/**
 * Edits, deletes and added stories/requirements as the graph will have them, so the canvas shows them before the
 * save returns. An added card has a client temp ref_id; the re-read after the save replaces the whole tree, so the
 * real card takes its place and it can't show twice.
 */
export function applyLocally(tree: InitiativeTreeData, ops: PlanOp[]): InitiativeTreeData {
  const added = ops.flatMap((o) => (o.op === "add" && o.parent && ADD_EDGE[o.type] ? [o] : []));
  if (added.length) {
    const next: InitiativeTreeData = {
      ...tree,
      nodes: [
        ...tree.nodes,
        ...added.map((o, i) => ({
          ref_id: `pending:${o.temp}:${++tempSeq}:${i}`,
          type: o.type as InitiativeTreeData["nodes"][number]["type"],
          properties: { ...o.fields },
        })),
      ],
      edges: [...tree.edges],
    };
    added.forEach((o, i) =>
      next.edges.push({ source: o.parent!, target: next.nodes[tree.nodes.length + i].ref_id, type: ADD_EDGE[o.type]! }),
    );
    return applyLocally(next, ops.filter((o) => o.op !== "add"));
  }
  const edits = new Map(ops.flatMap((o) => (o.op === "edit" ? [[o.ref, o.fields] as const] : [])));
  // A deleted card hides everything under it, as the read does.
  const gone = new Set(ops.flatMap((o) => (o.op === "remove" ? [o.ref] : [])));
  for (let grew = gone.size > 0; grew; ) {
    grew = false;
    for (const e of tree.edges) if (gone.has(e.source) && !gone.has(e.target)) grew = !!gone.add(e.target);
  }
  if (!edits.size && !gone.size) return tree;
  return {
    ...tree,
    nodes: tree.nodes
      .filter((n) => !gone.has(n.ref_id))
      .map((n) => (edits.has(n.ref_id) ? { ...n, properties: { ...n.properties, ...edits.get(n.ref_id) } } : n)),
    edges: tree.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
  };
}

// Module-level combines keep the results referentially stable between renders (an inline one re-renders forever).
const combineLists = (results: Array<{ data?: ListResponse; isLoading: boolean; isError: boolean }>) => ({
  data: results.map((r) => r.data),
  loading: results.some((r) => r.isLoading),
  failed: results.length > 0 && results.every((r) => r.isError),
});
const combineTrees = (results: Array<{ data?: InitiativeTreeData; isPending: boolean }>) => ({
  data: results.map((r) => r.data),
  pending: results.some((r) => r.isPending),
});
const combineChoices = (results: Array<{ data?: ChoiceTreeData }>) => results.map((r) => r.data);

/**
 * The canvas's board, read from the graph: every initiative across the org's
 * workspaces, the plans of the ones in `read` (the desk; every one when the
 * palette or the full list is open), and the brainstorm trees of the
 * initiative you're in. Saves go straight to the graph and the board reads
 * them back.
 */
export function useCanvasBoard(
  githubLogin: string,
  slugs: string[],
  { read, openInitiative }: { read: (ids: string[]) => string[]; openInitiative: string | null },
) {
  const qc = useQueryClient();
  const lists = useQueries({
    queries: slugs.map((slug) => ({
      queryKey: ["initiatives", slug],
      queryFn: () =>
        getJson<ListResponse>(
          `/api/workspaces/${encodeURIComponent(slug)}/graph/initiatives?limit=${LISTED_INITIATIVES}`,
        ),
      refetchInterval: (q: { state: { data?: ListResponse } }) => (q.state.data?.building ? BUILDING_MS : REFETCH_MS),
      retry: false,
    })),
    combine: combineLists,
  });
  const listed = useMemo(() => {
    const seen = new Set<string>();
    return lists.data
      .flatMap((d, i) => (d?.initiatives ?? []).map((summary) => ({ summary, ws: slugs[i] })))
      .filter((x) => !seen.has(x.summary.ref_id) && !!seen.add(x.summary.ref_id))
      .sort((a, b) => (b.summary.updated_at ?? 0) - (a.summary.updated_at ?? 0));
  }, [lists.data, slugs]);

  const wanted = read(listed.map((l) => l.summary.ref_id));
  const wantedKey = wanted.join(",");
  const toRead = useMemo(
    () => listed.filter((l) => wanted.includes(l.summary.ref_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `wantedKey` is `wanted` by value
    [listed, wantedKey],
  );
  const trees = useQueries({
    queries: toRead.map(({ summary, ws }) => ({
      queryKey: treeKey(ws, summary.ref_id),
      queryFn: () =>
        getJson<InitiativeTreeData>(
          `/api/workspaces/${encodeURIComponent(ws)}/graph/initiative-tree?focus=${encodeURIComponent(summary.ref_id)}`,
        ),
      refetchInterval: (q: { state: { data?: InitiativeTreeData } }) =>
        q.state.data?.building ? BUILDING_MS : REFETCH_MS,
      staleTime: STALE_MS,
      retry: 1,
    })),
    combine: combineTrees,
  });
  const entries = useMemo<InitiativeEntry[]>(() => {
    const byRef = new Map(toRead.map((l, i) => [l.summary.ref_id, trees.data[i]]));
    return listed.map((l) => ({ ...l, tree: byRef.get(l.summary.ref_id) }));
  }, [listed, toRead, trees.data]);

  // Brainstorms show only inside an initiative, so only the open one's trees are read.
  const roots = useMemo(() => {
    const e = entries.find((x) => x.summary.ref_id === openInitiative);
    return (e?.tree?.nodes ?? []).flatMap((n) => (n.brainstorms ?? []).map((root) => ({ ws: e!.ws, root })));
  }, [entries, openInitiative]);
  const choices = useQueries({
    queries: roots.map(({ ws, root }) => ({
      queryKey: choiceKey(ws, root),
      queryFn: () =>
        getJson<ChoiceTreeData>(
          `/api/workspaces/${encodeURIComponent(ws)}/graph/choice-tree?focus=${encodeURIComponent(root)}`,
        ),
      refetchInterval: REFETCH_MS,
      retry: 1,
    })),
    combine: combineChoices,
  });
  const brainstorms = useMemo(
    () => Object.fromEntries(roots.map((r, i) => [r.root, choices[i]] as const)),
    [roots, choices],
  );

  const board: Board = useMemo(() => toBoard(entries, brainstorms), [entries, brainstorms]);

  // A save anywhere (the desk, a teammate's canvas) re-reads that brainstorm, or that plan and the list.
  const channel = usePusherChannel(getOrgChannelName(githubLogin));
  useEffect(() => {
    if (!channel) return;
    const onBrainstorm = (p: { workspaceSlug?: string; root?: string }) => {
      if (p?.workspaceSlug && p.root) void qc.invalidateQueries({ queryKey: ["choice-tree", p.workspaceSlug, p.root] });
    };
    const onPlan = (p: { workspaceSlug?: string; root?: string }) => {
      if (!p?.workspaceSlug) return;
      // No root: strut wrote somewhere in that workspace's graph (a decided proposal), so read its plans again.
      void qc.invalidateQueries({
        queryKey: p.root ? treeKey(p.workspaceSlug, p.root) : ["initiative-tree", p.workspaceSlug],
      });
      void qc.invalidateQueries({ queryKey: ["initiatives", p.workspaceSlug] });
    };
    channel.bind(PUSHER_EVENTS.BRAINSTORM_UPDATED, onBrainstorm);
    channel.bind(PUSHER_EVENTS.INITIATIVE_UPDATED, onPlan);
    return () => {
      channel.unbind(PUSHER_EVENTS.BRAINSTORM_UPDATED, onBrainstorm);
      channel.unbind(PUSHER_EVENTS.INITIATIVE_UPDATED, onPlan);
    };
  }, [channel, qc]);

  // A Jamie turn may have had strut write: read the plans and brainstorms again once it ends.
  const streaming = useCanvasChatStore((s) => {
    const c = s.activeConversationId ? s.conversations[s.activeConversationId] : undefined;
    return !!(c?.isStreaming || c?.isLoading);
  });
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    const ended = wasStreaming.current && !streaming;
    wasStreaming.current = streaming;
    if (!ended) return;
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ["initiatives"] });
      void qc.invalidateQueries({ queryKey: ["initiative-tree"] });
      void qc.invalidateQueries({ queryKey: ["choice-tree"] });
    };
    refresh();
    // Again a moment later: a job the turn started writes its first cards after the reply.
    const t = setTimeout(refresh, 1500);
    return () => clearTimeout(t);
  }, [streaming, qc]);

  /**
   * Saves edits to one initiative's plan; edits and deletes show
   * at once and roll back if the save fails. Resolves to the ref_id of each
   * card it created (by the op's `temp`), or null when it failed.
   */
  const savePlan = useCallback(
    async (node: PlanNode, ops: PlanOp[]): Promise<Record<string, string> | null> => {
      // A brainstorm question isn't in the plan's tree: it belongs to whichever plan holds the card it's about.
      const ref = node.type === "question" ? node.about : node.id;
      const owner = entries.find((e) => e.summary.ref_id === ref || e.tree?.nodes.some((n) => n.ref_id === ref));
      if (!owner) return null;
      const key = treeKey(owner.ws, owner.summary.ref_id);
      const before = qc.getQueryData<InitiativeTreeData>(key);
      if (before) qc.setQueryData<InitiativeTreeData>(key, applyLocally(before, ops));
      const res = await post(`/api/workspaces/${encodeURIComponent(owner.ws)}/graph/initiative-tree/changes`, {
        root: owner.summary.ref_id,
        ops,
      });
      if (!res.ok) {
        if (before) qc.setQueryData(key, before);
        toast.error(typeof res.body.error === "string" ? res.body.error : "Couldn't save that change.");
        return null;
      }
      await qc.invalidateQueries({ queryKey: key });
      return (res.body.created as Record<string, string> | undefined) ?? {};
    },
    [entries, qc],
  );

  /**
   * Chooses an answer (replacing any earlier choice on its question), or
   * un-chooses the chosen one. Hive writes it: the answer's state, and what
   * it makes one level down.
   */
  const choose = useCallback(
    async (q: PlanNode, optionId: string) => {
      const o = q.options?.find((x) => x.id === optionId);
      if (!q.root || !o) return false;
      // Says what the person wants (choose, or take back the chosen one), so a retry after a failed write completes it.
      const saved = await savePlan(q, [{ op: "choose", root: q.root, option: optionId, chosen: !o.chosen }]);
      if (saved) await qc.invalidateQueries({ queryKey: ["choice-tree", q.ws, q.root] });
      return !!saved;
    },
    [qc, savePlan],
  );

  return {
    board,
    entries,
    loading: slugs.length === 0 || lists.loading,
    /** Some of the plans asked for haven't been read yet. */
    reading: trees.pending,
    failed: lists.failed,
    savePlan,
    choose,
  };
}
