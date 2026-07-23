"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  CanvasCollaboratorInfo,
  UseCanvasCollaborationOptions,
} from "./useCanvasCollaboration";

/**
 * Relay (Socket.IO) drop-in replacement for `useCanvasCollaboration`.
 *
 * Same options + return shape, but presence rides the per-swarm hive-relay
 * over a persistent WebSocket instead of Pusher + a POST-per-cursor-move.
 * The room is per-org (`canvas:<githubLogin>`); each cursor carries its
 * `canvasRef` so peers only render cursors/selection for the sub-canvas
 * they're currently viewing.
 */

interface UseCanvasCollaborationResult {
  collaborators: CanvasCollaboratorInfo[];
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

  // Connect + handle presence events.
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
    })();

    return () => {
      cancelled = true;
      socket?.disconnect();
      socketRef.current = null;
      setPeers(new Map());
    };
  }, [githubLogin, userId, enabled, upsertPeer, removePeer]);

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

  return { collaborators };
}
