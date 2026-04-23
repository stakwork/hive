"use client";

import { mergeElementsByVersion } from "@/lib/whiteboard/merge-elements";
import type { CollaboratorInfo } from "@/types/whiteboard-collaboration";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  Collaborator,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

function generateUserColor(userId: string): string {
  const colors = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
    "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
    "#BB8FCE", "#85C1E9", "#F8B500", "#00CED1",
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

interface RosterEntry {
  odinguserId: string;
  name: string;
  image: string | null;
  color: string;
  joinedAt: number;
  senderId: string;
}

interface UseWhiteboardCollaborationOptions {
  whiteboardId: string;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  onRemoteUpdate?: () => void;
  /**
   * Called immediately before the hook applies a remote scene update via
   * `excalidrawAPI.updateScene`. The page uses this to mark the upcoming
   * `onChange` callback as programmatic so it is not re-broadcast or saved
   * as if it were a local edit. Only fires when the remote payload actually
   * changes the scene — bumping on a no-op would swallow a subsequent real
   * user edit.
   */
  onBeforeRemoteUpdate?: () => void;
}

interface UseWhiteboardCollaborationReturn {
  collaborators: CollaboratorInfo[];
  isConnected: boolean;
  /** Broadcast element delta to other users (no DB save). 100 ms throttle. */
  broadcastElements: (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
  ) => void;
  /** Broadcast cursor position to other users. 50 ms throttle. */
  broadcastCursor: (x: number, y: number) => void;
  senderId: string;
  userColor: string;
}

const COLLABORATION_ENABLED =
  process.env.NEXT_PUBLIC_WHITEBOARD_COLLABORATION !== "false";

export function useWhiteboardCollaboration({
  whiteboardId,
  excalidrawAPI,
  onRemoteUpdate,
  onBeforeRemoteUpdate,
}: UseWhiteboardCollaborationOptions): UseWhiteboardCollaborationReturn {
  const { data: session } = useSession();
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [senderId, setSenderId] = useState("");

  const socketRef = useRef<Socket | null>(null);
  const excalidrawAPIRef = useRef(excalidrawAPI);
  excalidrawAPIRef.current = excalidrawAPI;

  const cursorPositionsRef = useRef<
    Map<string, { x: number; y: number; color: string; username?: string }>
  >(new Map());

  const userId = session?.user?.id;
  const userColorRef = useRef<string>(generateUserColor(userId || "anon"));

  const lastElementsBroadcastRef = useRef<number>(0);
  const lastCursorBroadcastRef = useRef<number>(0);
  const pendingElementsRef = useRef<{
    elements: readonly ExcalidrawElement[];
    appState: AppState;
  } | null>(null);
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);

  const lastBroadcastedElementsRef = useRef<
    Map<string, { version: number; isDeleted?: boolean }>
  >(new Map());

  const onRemoteUpdateRef = useRef(onRemoteUpdate);
  onRemoteUpdateRef.current = onRemoteUpdate;
  const onBeforeRemoteUpdateRef = useRef(onBeforeRemoteUpdate);
  onBeforeRemoteUpdateRef.current = onBeforeRemoteUpdate;

  const flushCursorsToScene = useCallback(() => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    const map = new Map<string, Collaborator>();
    cursorPositionsRef.current.forEach((cursor, sid) => {
      map.set(sid, {
        username: cursor.username || "Collaborator",
        pointer: { x: cursor.x, y: cursor.y, tool: "pointer" },
        color: { background: cursor.color, stroke: cursor.color },
      });
    });
    (api as unknown as { updateScene: (p: { collaborators: Map<string, Collaborator> }) => void }).updateScene({
      collaborators: map,
    });
  }, []);

  const computeElementsDelta = useCallback(
    (elements: readonly ExcalidrawElement[]): ExcalidrawElement[] => {
      const lastState = lastBroadcastedElementsRef.current;
      const changed: ExcalidrawElement[] = [];

      for (const el of elements) {
        const lastEl = lastState.get(el.id);
        if (
          !lastEl ||
          lastEl.version !== el.version ||
          lastEl.isDeleted !== el.isDeleted
        ) {
          changed.push(el);
        }
      }

      const newState = new Map<string, { version: number; isDeleted?: boolean }>();
      for (const el of elements) {
        newState.set(el.id, { version: el.version, isDeleted: el.isDeleted });
      }
      lastBroadcastedElementsRef.current = newState;

      return changed;
    },
    [],
  );

  const broadcastElements = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      if (!COLLABORATION_ENABLED || !whiteboardId) return;
      const socket = socketRef.current;
      if (!socket?.connected) return;

      const now = Date.now();
      const timeSince = now - lastElementsBroadcastRef.current;

      const doBroadcast = (
        els: readonly ExcalidrawElement[],
        state: AppState,
      ) => {
        const changed = computeElementsDelta(els);
        if (changed.length === 0) return;
        socket.emit("elements:update", {
          elements: changed,
          appState: {
            viewBackgroundColor: state.viewBackgroundColor,
            gridSize: state.gridSize,
          },
        });
      };

      if (timeSince >= 100) {
        lastElementsBroadcastRef.current = now;
        doBroadcast(elements, appState);
      } else {
        pendingElementsRef.current = { elements, appState };
        setTimeout(() => {
          if (pendingElementsRef.current) {
            const p = pendingElementsRef.current;
            pendingElementsRef.current = null;
            lastElementsBroadcastRef.current = Date.now();
            doBroadcast(p.elements, p.appState);
          }
        }, 100 - timeSince);
      }
    },
    [whiteboardId, computeElementsDelta],
  );

  const broadcastCursor = useCallback(
    (x: number, y: number) => {
      if (!COLLABORATION_ENABLED || !whiteboardId) return;
      const socket = socketRef.current;
      if (!socket?.connected) return;

      const now = Date.now();
      const timeSince = now - lastCursorBroadcastRef.current;

      const doBroadcast = (cx: number, cy: number) => {
        socket.emit("cursor:update", {
          cursor: { x: cx, y: cy },
          color: userColorRef.current,
        });
      };

      if (timeSince >= 50) {
        lastCursorBroadcastRef.current = now;
        doBroadcast(x, y);
      } else {
        pendingCursorRef.current = { x, y };
        setTimeout(() => {
          if (pendingCursorRef.current) {
            const p = pendingCursorRef.current;
            pendingCursorRef.current = null;
            lastCursorBroadcastRef.current = Date.now();
            doBroadcast(p.x, p.y);
          }
        }, 50 - timeSince);
      }
    },
    [whiteboardId],
  );

  // Pull the latest scene from the DB and merge it in. Used after a socket
  // reconnect — events broadcast during the outage are not replayed by the
  // relay, so the DB is our only source of truth for catching up.
  const refetchAndMerge = useCallback(async () => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    try {
      const res = await fetch(`/api/whiteboards/${whiteboardId}`);
      if (!res.ok) return;
      const body = await res.json();
      const remoteElements = body?.data?.elements as
        | ExcalidrawElement[]
        | undefined;
      if (!remoteElements) return;

      const currentElements = api.getSceneElements();
      const localById = new Map(currentElements.map((el) => [el.id, el]));
      const hasChanges = remoteElements.some((remoteEl) => {
        const localEl = localById.get(remoteEl.id);
        return !localEl || remoteEl.version > localEl.version;
      });
      if (!hasChanges) return;

      const merged = mergeElementsByVersion(currentElements, remoteElements);
      onBeforeRemoteUpdateRef.current?.();
      api.updateScene({ elements: merged });
      onRemoteUpdateRef.current?.();
    } catch (err) {
      console.error("[whiteboard] refetch-after-reconnect failed:", err);
    }
  }, [whiteboardId]);

  useEffect(() => {
    if (!COLLABORATION_ENABLED || !whiteboardId || !userId) return;

    // Capture ref instances once so the cleanup function operates on the same
    // Maps the effect body uses (react-hooks/exhaustive-deps — refs can be
    // re-assigned between render and cleanup in theory, even though ours
    // never are).
    const cursorPositions = cursorPositionsRef.current;
    const lastBroadcastedElements = lastBroadcastedElementsRef.current;

    let cancelled = false;
    let socket: Socket | null = null;

    const fetchToken = async (): Promise<{ token: string; url: string } | null> => {
      try {
        const res = await fetch(`/api/whiteboards/${whiteboardId}/relay-token`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            reason?: string;
            error?: string;
          };
          console.info(
            `[whiteboard] relay unavailable (HTTP ${res.status}, reason=${body.reason ?? body.error ?? "unknown"}) — live collaboration off for this session.`,
          );
          return null;
        }
        return (await res.json()) as { token: string; url: string };
      } catch (err) {
        console.info("[whiteboard] relay token fetch failed:", err);
        return null;
      }
    };

    void (async () => {
      const initial = await fetchToken();
      if (!initial || cancelled) return;

      // Pass the initial token directly; for reconnects, the auth callback
      // fetches a fresh one. Tokens are short-lived (5 min) so we refresh
      // per-handshake to avoid a stale-token reconnect failure.
      let cachedInitialToken: string | null = initial.token;

      socket = io(initial.url, {
        auth: (cb) => {
          if (cachedInitialToken) {
            cb({ token: cachedInitialToken });
            cachedInitialToken = null;
            return;
          }
          void fetchToken().then((t) => cb({ token: t?.token ?? "" }));
        },
        transports: ["websocket"],
        reconnection: true,
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        if (!socket) return;
        setIsConnected(true);
        setSenderId(socket.id ?? "");
        console.info(`[whiteboard] relay connected sid=${socket.id}`);
      });

      socket.on("disconnect", () => {
        setIsConnected(false);
      });

      socket.io.on("reconnect", () => {
        void refetchAndMerge();
      });

      socket.on("connect_error", (err) => {
        console.warn("[whiteboard] relay connect_error:", err.message);
        setIsConnected(false);
      });

      socket.on("room:roster", (data: { collaborators: RosterEntry[] }) => {
        setCollaborators(
          data.collaborators.map((c) => ({
            odinguserId: c.odinguserId,
            name: c.name,
            image: c.image,
            color: c.color,
            joinedAt: c.joinedAt,
          })),
        );
      });

      socket.on("user:join", (data: { user: RosterEntry }) => {
        const u = data.user;
        setCollaborators((prev) => {
          if (prev.some((c) => c.odinguserId === u.odinguserId)) return prev;
          return [
            ...prev,
            {
              odinguserId: u.odinguserId,
              name: u.name,
              image: u.image,
              color: u.color,
              joinedAt: u.joinedAt,
            },
          ];
        });
      });

      socket.on("user:leave", (data: { userId: string; senderId: string }) => {
        setCollaborators((prev) =>
          prev.filter((c) => c.odinguserId !== data.userId),
        );
        cursorPositionsRef.current.delete(data.senderId);
        flushCursorsToScene();
      });

      socket.on(
        "elements:update",
        (data: {
          senderId: string;
          elements: ExcalidrawElement[];
          appState: Partial<AppState>;
        }) => {
          const api = excalidrawAPIRef.current;
          if (!api) return;
          const currentElements = api.getSceneElements();
          const localById = new Map(currentElements.map((el) => [el.id, el]));
          const hasChanges = data.elements.some((remoteEl) => {
            const localEl = localById.get(remoteEl.id);
            return !localEl || remoteEl.version > localEl.version;
          });
          if (!hasChanges) return;

          const merged = mergeElementsByVersion(currentElements, data.elements);
          onBeforeRemoteUpdateRef.current?.();
          api.updateScene({
            elements: merged,
            appState: data.appState as unknown as AppState,
          });
          onRemoteUpdateRef.current?.();
        },
      );

      socket.on(
        "cursor:update",
        (data: {
          senderId: string;
          cursor: { x: number; y: number };
          color: string;
          username?: string;
        }) => {
          cursorPositionsRef.current.set(data.senderId, {
            x: data.cursor.x,
            y: data.cursor.y,
            color: data.color,
            username: data.username,
          });
          flushCursorsToScene();
        },
      );
    })();

    return () => {
      cancelled = true;
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
      socketRef.current = null;
      setIsConnected(false);
      setSenderId("");
      setCollaborators([]);
      cursorPositions.clear();
      lastBroadcastedElements.clear();
      pendingCursorRef.current = null;
      pendingElementsRef.current = null;
    };
  }, [whiteboardId, userId, flushCursorsToScene, refetchAndMerge]);

  return {
    collaborators,
    isConnected,
    broadcastElements,
    broadcastCursor,
    senderId,
    userColor: userColorRef.current,
  };
}
