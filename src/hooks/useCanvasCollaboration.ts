"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePusherChannel } from "@/hooks/usePusherChannel";
import { PUSHER_EVENTS } from "@/lib/pusher";
import { getCanvasPresenceChannelName } from "@/lib/canvas/presence-channel";

export interface CanvasCollaboratorInfo {
  id: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selectedNodeId?: string;
  image?: string | null;
}

interface CollaboratorState extends Omit<CanvasCollaboratorInfo, "selectedNodeId"> {
  selectedNodeId?: string | null;
  lastSeenAt: number;
}

interface UseCanvasCollaborationOptions {
  githubLogin: string;
  /** Current canvas ref — empty string for root. */
  canvasRef: string;
  userId: string;
  userName: string;
  /** Avatar image URL for the current user. */
  userImage?: string | null;
  /**
   * A ref to the current viewport state so cursor events can be
   * converted from screen to canvas space.
   */
  viewportRef: React.RefObject<{ x: number; y: number; zoom: number }>;
  /** The container DOM element to attach pointermove to. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Currently selected node id, or null. */
  selectedNodeId?: string | null;
  /** Default true. */
  enabled?: boolean;
}

interface UseCanvasCollaborationResult {
  collaborators: CanvasCollaboratorInfo[];
}

/** TTL for stale client-side entries (60s, matching server TTL). */
const CLIENT_TTL_MS = 60_000;
/** Prune interval (15s). */
const PRUNE_INTERVAL_MS = 15_000;
/** Cursor throttle (50ms ≈ 20fps). */
const CURSOR_THROTTLE_MS = 50;

/**
 * Generates a deterministic color from a userId using the canvas team palette.
 * Mirrors `teamAvatarColor` in canvas-theme.ts to avoid a server-component import.
 */
function teamAvatarColor(userId: string): string {
  const palette = [
    "#5EEAD4", // teal-300
    "#38BDF8", // sky-300
    "#A78BFA", // violet-400
    "#FB923C", // orange-400
    "#34D399", // emerald-400
    "#F472B6", // pink-400
    "#FACC15", // yellow-400
    "#60A5FA", // blue-400
    "#F87171", // red-400
    "#C084FC", // purple-400
    "#2DD4BF", // teal-400
    "#4ADE80", // green-400
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return palette[Math.abs(hash) % palette.length];
}

function postCollabEvent(githubLogin: string, body: Record<string, unknown>) {
  fetch(`/api/orgs/${githubLogin}/canvas/collaboration`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    // Fire-and-forget; failures are non-critical for presence
  });
}

/**
 * Hook that manages real-time presence for org canvas collaborators.
 *
 * - Joins on mount, leaves on unmount (with sendBeacon fallback for tab close)
 * - Subscribes to presence Pusher channel
 * - Broadcasts cursor position (throttled) and selection changes
 * - Prunes stale entries client-side every 15s
 * - Filters own userId from returned array
 */
export function useCanvasCollaboration({
  githubLogin,
  canvasRef,
  userId,
  userName,
  userImage,
  viewportRef,
  containerRef,
  selectedNodeId,
  enabled = true,
}: UseCanvasCollaborationOptions): UseCanvasCollaborationResult {
  const [collaboratorMap, setCollaboratorMap] = useState<
    Map<string, CollaboratorState>
  >(new Map());

  const channelName =
    enabled && userId
      ? getCanvasPresenceChannelName(githubLogin, canvasRef)
      : null;

  const channel = usePusherChannel(channelName);

  // Stable refs to avoid stale closures
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const userNameRef = useRef(userName);
  userNameRef.current = userName;
  const userImageRef = useRef(userImage ?? null);
  userImageRef.current = userImage ?? null;
  const githubLoginRef = useRef(githubLogin);
  githubLoginRef.current = githubLogin;
  const canvasRefRef = useRef(canvasRef);
  canvasRefRef.current = canvasRef;

  // Upsert a collaborator in state
  const upsertCollaborator = useCallback(
    (id: string, patch: Partial<CollaboratorState>) => {
      setCollaboratorMap((prev) => {
        const next = new Map(prev);
        const existing = next.get(id) ?? {
          id,
          name: "",
          color: teamAvatarColor(id),
          cursor: null,
          selectedNodeId: null,
          image: null,
          lastSeenAt: Date.now(),
        };
        next.set(id, { ...existing, ...patch, lastSeenAt: Date.now() });
        return next;
      });
    },
    [],
  );

  // Remove a collaborator
  const removeCollaborator = useCallback((id: string) => {
    setCollaboratorMap((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Bind Pusher events
  useEffect(() => {
    if (!channel) return;

    const onJoin = (data: {
      user: { id: string; name: string; color: string; image?: string | null };
    }) => {
      if (data.user.id === userIdRef.current) return;
      upsertCollaborator(data.user.id, {
        name: data.user.name,
        color: data.user.color,
        image: data.user.image ?? null,
        cursor: null,
      });
    };

    const onLeave = (data: { userId: string }) => {
      removeCollaborator(data.userId);
    };

    const onCursor = (data: {
      senderId: string;
      cursor: { x: number; y: number };
      color: string;
    }) => {
      if (data.senderId === userIdRef.current) return;
      upsertCollaborator(data.senderId, {
        cursor: data.cursor,
        color: data.color,
      });
    };

    const onSelection = (data: {
      senderId: string;
      selectedNodeId: string | null;
    }) => {
      if (data.senderId === userIdRef.current) return;
      upsertCollaborator(data.senderId, {
        selectedNodeId: data.selectedNodeId,
      });
    };

    channel.bind(PUSHER_EVENTS.CANVAS_USER_JOIN, onJoin);
    channel.bind(PUSHER_EVENTS.CANVAS_USER_LEAVE, onLeave);
    channel.bind(PUSHER_EVENTS.CANVAS_CURSOR_UPDATE, onCursor);
    channel.bind(PUSHER_EVENTS.CANVAS_SELECTION_UPDATE, onSelection);

    return () => {
      channel.unbind(PUSHER_EVENTS.CANVAS_USER_JOIN, onJoin);
      channel.unbind(PUSHER_EVENTS.CANVAS_USER_LEAVE, onLeave);
      channel.unbind(PUSHER_EVENTS.CANVAS_CURSOR_UPDATE, onCursor);
      channel.unbind(PUSHER_EVENTS.CANVAS_SELECTION_UPDATE, onSelection);
    };
  }, [channel, upsertCollaborator, removeCollaborator]);

  // Join on mount, leave on unmount
  useEffect(() => {
    if (!enabled || !userId) return;

    const login = githubLoginRef.current;
    const ref = canvasRefRef.current;
    const color = teamAvatarColor(userId);
    const name = userNameRef.current;

    postCollabEvent(login, {
      type: "join",
      canvasRef: ref,
      user: { id: userId, name, color, image: userImageRef.current ?? null },
    });

    // Seed pre-existing collaborators — fire-and-forget
    fetch(
      `/api/orgs/${login}/canvas/collaboration?canvasRef=${encodeURIComponent(ref)}`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (body: {
          collaborators: Array<{
            userId: string;
            name: string;
            color: string;
            image: string | null;
          }>;
        } | null) => {
          const initial = body?.collaborators ?? [];
          for (const c of initial) {
            if (c.userId === userIdRef.current) continue;
            upsertCollaborator(c.userId, {
              name: c.name,
              color: c.color,
              image: c.image,
            });
          }
        },
      )
      .catch(() => {
        // Fire-and-forget; failures degrade gracefully (no initial snapshot)
      });

    const leavePayload = JSON.stringify({
      type: "leave",
      canvasRef: ref,
    });
    const leaveUrl = `/api/orgs/${login}/canvas/collaboration`;

    const sendLeave = () => {
      navigator.sendBeacon(
        leaveUrl,
        new Blob([leavePayload], { type: "application/json" }),
      );
    };

    window.addEventListener("beforeunload", sendLeave);

    return () => {
      window.removeEventListener("beforeunload", sendLeave);
      postCollabEvent(login, { type: "leave", canvasRef: ref });
      // Clear collaborators for this canvas on cleanup
      setCollaboratorMap(new Map());
    };
  }, [githubLogin, canvasRef, userId, enabled, upsertCollaborator]);

  // Broadcast cursor via pointermove (throttled ~20fps)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled || !userId) return;

    let lastFired = 0;

    const onMove = (e: PointerEvent) => {
      const now = Date.now();
      if (now - lastFired < CURSOR_THROTTLE_MS) return;
      lastFired = now;

      const vp = viewportRef.current;
      if (!vp) return;

      const rect = el.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      // Convert screen → canvas space: canvas = (screen - offset) / zoom
      const canvasX = (screenX - vp.x) / vp.zoom;
      const canvasY = (screenY - vp.y) / vp.zoom;

      postCollabEvent(githubLoginRef.current, {
        type: "cursor",
        canvasRef: canvasRefRef.current,
        senderId: userId,
        cursor: { x: canvasX, y: canvasY },
        color: teamAvatarColor(userId),
      });
    };

    el.addEventListener("pointermove", onMove);
    return () => el.removeEventListener("pointermove", onMove);
  }, [containerRef, viewportRef, userId, enabled]);

  // Broadcast selection changes
  const prevSelectedNodeId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !userId) return;
    // Skip the initial undefined → null transition (first render with no selection)
    if (
      prevSelectedNodeId.current === undefined &&
      (selectedNodeId === null || selectedNodeId === undefined)
    ) {
      prevSelectedNodeId.current = selectedNodeId ?? null;
      return;
    }
    if (prevSelectedNodeId.current === (selectedNodeId ?? null)) return;
    prevSelectedNodeId.current = selectedNodeId ?? null;

    postCollabEvent(githubLoginRef.current, {
      type: "selection",
      canvasRef: canvasRefRef.current,
      senderId: userId,
      selectedNodeId: selectedNodeId ?? null,
    });
  }, [selectedNodeId, userId, enabled]);

  // Client-side TTL pruning every 15s
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      const cutoff = Date.now() - CLIENT_TTL_MS;
      setCollaboratorMap((prev) => {
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

  // Derive collaborators array (self-filtered)
  const collaborators: CanvasCollaboratorInfo[] = Array.from(
    collaboratorMap.values(),
  )
    .filter((c) => c.id !== userId)
    .map(({ lastSeenAt: _last, selectedNodeId, ...rest }) => ({
      ...rest,
      selectedNodeId: selectedNodeId ?? undefined,
    }));

  return { collaborators };
}
