"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import * as Y from "yjs";
import {
  LOCAL_ORIGIN,
  seedYDoc,
  yDocToCanvasData,
  addNode as docAddNode,
  updateNode as docUpdateNode,
  removeNode as docRemoveNode,
  addEdge as docAddEdge,
  updateEdge as docUpdateEdge,
  removeEdge as docRemoveEdge,
} from "system-canvas-collab";
import type { CanvasData, CanvasNode, CanvasEdge } from "system-canvas";
import type {
  CanvasCollaboratorInfo,
  UseCanvasCollaborationOptions,
} from "./useCanvasCollaboration";

/** Origins that must NOT re-broadcast (only user edits, tagged LOCAL_ORIGIN, do). */
const REMOTE_ORIGIN = Symbol("remote");
const SEED_ORIGIN = Symbol("seed");

/**
 * Conflict-free document layer for the org canvas, keyed by sub-canvas ref.
 * Each ref gets its own Y.Doc (system-canvas-collab's binding); the ref that
 * is first in the room seeds from the Postgres projection, late-joiners sync
 * the live doc from peers (no re-seed). Edits + the binary deltas ride the
 * SAME relay socket as presence.
 */
export interface CanvasCrdt {
  /** Reconstruct a ref's live CanvasData, or null until seeded/synced. */
  reconstruct: (ref: string) => CanvasData | null;
  /** Seed a ref's doc from the projection (takes effect only if first in room). */
  seed: (ref: string, data: CanvasData) => void;
  addNode: (ref: string, node: CanvasNode) => void;
  updateNode: (ref: string, id: string, patch: Partial<CanvasNode>) => void;
  removeNode: (ref: string, id: string) => void;
  addEdge: (ref: string, edge: CanvasEdge) => void;
  updateEdge: (ref: string, id: string, patch: Partial<CanvasEdge>) => void;
  removeEdge: (ref: string, id: string) => void;
  /** Bumps on any doc change (local or remote) — use as a render memo dep. */
  version: number;
}

interface UseCanvasCollaborationResult {
  collaborators: CanvasCollaboratorInfo[];
  crdt: CanvasCrdt;
}

const CLIENT_TTL_MS = 60_000;
const PRUNE_INTERVAL_MS = 15_000;
const CURSOR_THROTTLE_MS = 50;

function teamAvatarColor(userId: string): string {
  const palette = [
    "#5EEAD4", "#38BDF8", "#A78BFA", "#FB923C", "#34D399", "#F472B6",
    "#FACC15", "#60A5FA", "#F87171", "#C084FC", "#2DD4BF", "#4ADE80",
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

/** One connected peer socket. Keyed by senderId (socket.id). */
interface PeerState {
  userId: string;
  name: string;
  color: string;
  image: string | null;
  cursor: { x: number; y: number } | null;
  selectedNodeId: string | null;
  /** Sub-canvas the cursor/selection is on; only rendered when it matches ours. */
  cursorRef: string;
  lastSeenAt: number;
}

interface RosterEntry {
  odinguserId: string;
  name: string;
  image: string | null;
  color: string;
  joinedAt: number;
  senderId: string;
}

export function useCanvasCollaborationViaRelay({
  githubLogin,
  canvasRef,
  userId,
  userName,
  userImage,
  getViewport,
  getSvgElement,
  containerRef,
  selectedNodeId,
  enabled = true,
}: UseCanvasCollaborationOptions): UseCanvasCollaborationResult {
  const [peers, setPeers] = useState<Map<string, PeerState>>(new Map());
  const socketRef = useRef<Socket | null>(null);

  // Stable refs for use inside socket/pointer callbacks.
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const canvasRefRef = useRef(canvasRef);
  canvasRefRef.current = canvasRef;
  const selectedNodeIdRef = useRef<string | null | undefined>(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;
  const lastCursorRef = useRef<{ x: number; y: number } | null>(null);

  // ---- Document CRDT (full nodes+edges, one Y.Doc per ref) --------------
  const docsRef = useRef<Map<string, Y.Doc>>(new Map());
  const readyRef = useRef<Set<string>>(new Set());
  const seededRef = useRef<Set<string>>(new Set());
  const pendingSeedsRef = useRef<Map<string, CanvasData>>(new Map());
  // "pending" until room:roster tells us if we're first (seed) or not (sync).
  const roomStateRef = useRef<"pending" | "first" | "existing">("pending");
  const [docVersion, setDocVersion] = useState(0);
  const bumpVersion = useCallback(() => setDocVersion((v) => v + 1), []);

  // Get-or-create a ref's doc, wiring its broadcast/render handler once.
  const getDoc = useCallback(
    (ref: string): Y.Doc => {
      const existing = docsRef.current.get(ref);
      if (existing) return existing;
      const doc = new Y.Doc();
      doc.on("update", (update: Uint8Array, origin: unknown) => {
        if (origin === LOCAL_ORIGIN) {
          socketRef.current?.emit("yupdate", { ref, update });
        }
        bumpVersion();
      });
      docsRef.current.set(ref, doc);
      return doc;
    },
    [bumpVersion],
  );

  const applyRemote = useCallback(
    (ref: string, update: Uint8Array) => {
      try {
        Y.applyUpdate(getDoc(ref), update, REMOTE_ORIGIN);
        readyRef.current.add(ref);
      } catch (err) {
        console.warn("[canvas-relay] bad yupdate:", err);
      }
    },
    [getDoc],
  );

  const seedRef = useCallback(
    (ref: string, data: CanvasData) => {
      if (seededRef.current.has(ref) || readyRef.current.has(ref)) return;
      if (roomStateRef.current === "pending") {
        pendingSeedsRef.current.set(ref, data);
        return;
      }
      if (roomStateRef.current !== "first") return; // existing → sync from peers
      seededRef.current.add(ref);
      readyRef.current.add(ref);
      seedYDoc(getDoc(ref), data, SEED_ORIGIN);
    },
    [getDoc],
  );

  const reconstruct = useCallback((ref: string): CanvasData | null => {
    if (!readyRef.current.has(ref)) return null;
    const doc = docsRef.current.get(ref);
    return doc ? yDocToCanvasData(doc) : null;
  }, []);

  const crdtAddNode = useCallback(
    (ref: string, node: CanvasNode) => docAddNode(getDoc(ref), node, LOCAL_ORIGIN),
    [getDoc],
  );
  const crdtUpdateNode = useCallback(
    (ref: string, id: string, patch: Partial<CanvasNode>) =>
      docUpdateNode(getDoc(ref), id, patch, LOCAL_ORIGIN),
    [getDoc],
  );
  const crdtRemoveNode = useCallback(
    (ref: string, id: string) => docRemoveNode(getDoc(ref), id, LOCAL_ORIGIN),
    [getDoc],
  );
  const crdtAddEdge = useCallback(
    (ref: string, edge: CanvasEdge) => docAddEdge(getDoc(ref), edge, LOCAL_ORIGIN),
    [getDoc],
  );
  const crdtUpdateEdge = useCallback(
    (ref: string, id: string, patch: Partial<CanvasEdge>) =>
      docUpdateEdge(getDoc(ref), id, patch, LOCAL_ORIGIN),
    [getDoc],
  );
  const crdtRemoveEdge = useCallback(
    (ref: string, id: string) => docRemoveEdge(getDoc(ref), id, LOCAL_ORIGIN),
    [getDoc],
  );

  const crdt = useMemo<CanvasCrdt>(
    () => ({
      reconstruct,
      seed: seedRef,
      addNode: crdtAddNode,
      updateNode: crdtUpdateNode,
      removeNode: crdtRemoveNode,
      addEdge: crdtAddEdge,
      updateEdge: crdtUpdateEdge,
      removeEdge: crdtRemoveEdge,
      version: docVersion,
    }),
    [
      reconstruct,
      seedRef,
      crdtAddNode,
      crdtUpdateNode,
      crdtRemoveNode,
      crdtAddEdge,
      crdtUpdateEdge,
      crdtRemoveEdge,
      docVersion,
    ],
  );

  const upsertPeer = useCallback(
    (senderId: string, patch: Partial<PeerState>) => {
      setPeers((prev) => {
        const next = new Map(prev);
        const existing: PeerState = next.get(senderId) ?? {
          userId: "",
          name: "",
          color: "#888",
          image: null,
          cursor: null,
          selectedNodeId: null,
          cursorRef: "",
          lastSeenAt: Date.now(),
        };
        next.set(senderId, { ...existing, ...patch, lastSeenAt: Date.now() });
        return next;
      });
    },
    [],
  );

  const removePeer = useCallback((senderId: string) => {
    setPeers((prev) => {
      if (!prev.has(senderId)) return prev;
      const next = new Map(prev);
      next.delete(senderId);
      return next;
    });
  }, []);

  // Broadcast this client's current doc state (all refs) to the room, so a
  // late-joiner converges without independently seeding.
  const broadcastDocState = useCallback(() => {
    const sock = socketRef.current;
    if (!sock) return;
    for (const [ref, doc] of docsRef.current) {
      sock.emit("yupdate", { ref, update: Y.encodeStateAsUpdate(doc) });
    }
  }, []);

  // Connect + handle presence + doc sync.
  useEffect(() => {
    if (!enabled || !userId) return;
    let cancelled = false;
    let socket: Socket | null = null;

    (async () => {
      let token: string;
      let url: string;
      try {
        const res = await fetch(`/api/orgs/${githubLogin}/canvas/relay-token`);
        if (!res.ok) {
          console.warn("[canvas-relay] token fetch failed:", res.status);
          return;
        }
        ({ token, url } = await res.json());
      } catch (err) {
        console.error("[canvas-relay] token fetch error:", err);
        return;
      }
      if (cancelled) return;

      socket = io(url, { auth: { token }, transports: ["websocket"] });
      socketRef.current = socket;

      socket.on("room:roster", (data: { collaborators: RosterEntry[] }) => {
        // Decide seed-vs-sync: an empty room means we own the initial state.
        roomStateRef.current =
          data.collaborators.length > 0 ? "existing" : "first";
        if (roomStateRef.current === "first") {
          for (const [ref, seedData] of pendingSeedsRef.current) {
            if (seededRef.current.has(ref) || readyRef.current.has(ref)) continue;
            seededRef.current.add(ref);
            readyRef.current.add(ref);
            seedYDoc(getDoc(ref), seedData, SEED_ORIGIN);
          }
        }
        pendingSeedsRef.current.clear();

        for (const c of data.collaborators) {
          upsertPeer(c.senderId, {
            userId: c.odinguserId,
            name: c.name,
            color: c.color,
            image: c.image,
          });
        }
      });

      socket.on("user:join", (data: { user: RosterEntry }) => {
        upsertPeer(data.user.senderId, {
          userId: data.user.odinguserId,
          name: data.user.name,
          color: data.user.color,
          image: data.user.image,
        });
        // A newcomer arrived; hand them our live doc so they don't re-seed.
        broadcastDocState();
      });

      socket.on("user:leave", (data: { senderId: string }) => {
        removePeer(data.senderId);
      });

      socket.on(
        "cursor:update",
        (data: {
          senderId: string;
          userId?: string;
          cursor: { x: number; y: number } | null;
          color: string;
          selectedNodeId: string | null;
          canvasRef: string;
          username?: string;
        }) => {
          upsertPeer(data.senderId, {
            cursor: data.cursor,
            color: data.color,
            selectedNodeId: data.selectedNodeId,
            cursorRef: data.canvasRef ?? "",
            // Carry identity so the self-filter works even if we never saw a
            // roster/join for this socket (e.g. a reconnect ghost or another
            // tab of the same user).
            ...(data.userId ? { userId: data.userId } : {}),
            ...(data.username ? { name: data.username } : {}),
          });
        },
      );

      // Binary Yjs deltas from collaborators, routed to the ref's doc.
      socket.on(
        "yupdate",
        (data: { ref?: string; update: ArrayBuffer | Uint8Array }) => {
          const u =
            data.update instanceof Uint8Array
              ? data.update
              : new Uint8Array(data.update);
          applyRemote(data.ref ?? "", u);
        },
      );
    })();

    return () => {
      cancelled = true;
      socket?.disconnect();
      socketRef.current = null;
      setPeers(new Map());
    };
  }, [
    githubLogin,
    userId,
    enabled,
    upsertPeer,
    removePeer,
    getDoc,
    applyRemote,
    broadcastDocState,
  ]);

  // Broadcast cursor via pointermove (throttled), in canvas space.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled || !userId) return;
    let lastFired = 0;

    const onMove = (e: PointerEvent) => {
      const now = Date.now();
      if (now - lastFired < CURSOR_THROTTLE_MS) return;
      lastFired = now;

      const vp = getViewport();
      const svgEl = getSvgElement();
      const rect = (svgEl ?? el).getBoundingClientRect();
      const canvasX = (e.clientX - rect.left - vp.x) / vp.zoom;
      const canvasY = (e.clientY - rect.top - vp.y) / vp.zoom;
      lastCursorRef.current = { x: canvasX, y: canvasY };

      socketRef.current?.emit("cursor:update", {
        cursor: { x: canvasX, y: canvasY },
        color: teamAvatarColor(userId),
        selectedNodeId: selectedNodeIdRef.current,
        canvasRef: canvasRefRef.current,
      });
    };

    el.addEventListener("pointermove", onMove);
    return () => el.removeEventListener("pointermove", onMove);
  }, [containerRef, getViewport, getSvgElement, userId, enabled]);

  // Broadcast selection changes (piggybacks on cursor:update with last cursor).
  const prevSelected = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !userId) return;
    if (
      prevSelected.current === undefined &&
      (selectedNodeId === null || selectedNodeId === undefined)
    ) {
      prevSelected.current = selectedNodeId ?? null;
      return;
    }
    if (prevSelected.current === (selectedNodeId ?? null)) return;
    prevSelected.current = selectedNodeId ?? null;

    socketRef.current?.emit("cursor:update", {
      cursor: lastCursorRef.current,
      color: teamAvatarColor(userId),
      selectedNodeId: selectedNodeId ?? null,
      canvasRef: canvasRefRef.current,
    });
  }, [selectedNodeId, userId, enabled]);

  // Client-side TTL prune.
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      const cutoff = Date.now() - CLIENT_TTL_MS;
      setPeers((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [id, entry] of prev) {
          if (entry.lastSeenAt < cutoff) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, PRUNE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled]);

  // Destroy all docs on unmount (frees observers + memory).
  useEffect(() => {
    const docs = docsRef.current;
    return () => {
      for (const doc of docs.values()) doc.destroy();
      docs.clear();
    };
  }, []);

  // Derive collaborators (self-filtered; cursor/selection only for THIS ref).
  const collaborators: CanvasCollaboratorInfo[] = Array.from(peers.values())
    .filter((p) => p.userId !== userId)
    .map((p) => ({
      id: p.userId || "unknown",
      name: p.name,
      color: p.color,
      image: p.image,
      cursor: p.cursorRef === canvasRef ? p.cursor : null,
      selectedNodeId:
        p.cursorRef === canvasRef ? p.selectedNodeId ?? undefined : undefined,
    }));

  return { collaborators, crdt };
}
