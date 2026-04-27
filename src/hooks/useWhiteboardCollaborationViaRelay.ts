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

interface UseWhiteboardCollaborationViaRelayOptions {
  whiteboardId: string;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  onRemoteUpdate?: () => void;
  onBeforeRemoteUpdate?: () => void;
}

interface UseWhiteboardCollaborationViaRelayReturn {
  collaborators: CollaboratorInfo[];
  isConnected: boolean;
  broadcastElements: (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
  ) => void;
  broadcastCursor: (x: number, y: number) => void;
  senderId: string;
  userColor: string;
}

const COLLABORATION_ENABLED =
  process.env.NEXT_PUBLIC_WHITEBOARD_COLLABORATION !== "false";

export function useWhiteboardCollaborationViaRelay({
  whiteboardId,
  excalidrawAPI,
  onRemoteUpdate,
  onBeforeRemoteUpdate,
}: UseWhiteboardCollaborationViaRelayOptions): UseWhiteboardCollaborationViaRelayReturn {
  const { data: session } = useSession();
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [senderId, setSenderId] = useState("");

  const socketRef = useRef<Socket | null>(null);
  const excalidrawAPIRef = useRef(excalidrawAPI);
  excalidrawAPIRef.current = excalidrawAPI;

  const cursorPositionsRef = useRef<
    Map<
      string,
      { x: number; y: number; color: string; username?: string; lastUpdated: number }
    >
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
    (
      api as unknown as {
        updateScene: (p: { collaborators: Map<string, Collaborator> }) => void;
      }
    ).updateScene({ collaborators: map });
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
      const newState = new Map<
        string,
        { version: number; isDeleted?: boolean }
      >();
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
        const deletedIds = changed
          .filter((el) => el.isDeleted)
          .map((el) => el.id);
        if (deletedIds.length > 0) {
          console.info("[whiteboard-relay] broadcasting deletes", {
            ids: deletedIds,
            totalChanged: changed.length,
          });
        }
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

  useEffect(() => {
    if (!COLLABORATION_ENABLED || !whiteboardId || !userId) return;

    const cursorPositions = cursorPositionsRef.current;
    const lastBroadcastedElements = lastBroadcastedElementsRef.current;

    let cancelled = false;
    let socket: Socket | null = null;

    (async () => {
      let tokenResponse: { token: string; url: string };
      try {
        const res = await fetch(
          `/api/whiteboards/${whiteboardId}/relay-token`,
        );
        if (!res.ok) {
          console.warn("[whiteboard-relay] token fetch failed:", res.status);
          return;
        }
        tokenResponse = await res.json();
      } catch (err) {
        console.error("[whiteboard-relay] token fetch error:", err);
        return;
      }
      if (cancelled) return;

      socket = io(tokenResponse.url, {
        auth: { token: tokenResponse.token },
        transports: ["websocket"],
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        if (cancelled) return;
        setIsConnected(true);
        setSenderId(socket?.id ?? "");
        console.info("[whiteboard-relay] connected", {
          url: tokenResponse.url,
          sid: socket?.id,
        });
      });

      socket.on("disconnect", (reason) => {
        setIsConnected(false);
        console.info("[whiteboard-relay] disconnected", reason);
      });

      socket.on("connect_error", (err: Error) => {
        console.warn("[whiteboard-relay] connect_error", err.message);
      });

      socket.on(
        "room:roster",
        (data: { collaborators: RosterEntry[] }) => {
          setCollaborators(
            data.collaborators.map((c) => ({
              odinguserId: c.odinguserId,
              name: c.name,
              image: c.image,
              color: c.color,
              joinedAt: c.joinedAt,
            })),
          );
        },
      );

      socket.on("user:join", (data: { user: RosterEntry }) => {
        setCollaborators((prev) => {
          if (prev.some((c) => c.odinguserId === data.user.odinguserId)) {
            return prev;
          }
          return [
            ...prev,
            {
              odinguserId: data.user.odinguserId,
              name: data.user.name,
              image: data.user.image,
              color: data.user.color,
              joinedAt: data.user.joinedAt,
            },
          ];
        });
      });

      socket.on(
        "user:leave",
        (data: { userId: string; senderId: string }) => {
          setCollaborators((prev) =>
            prev.filter((c) => c.odinguserId !== data.userId),
          );
          cursorPositionsRef.current.delete(data.senderId);
          flushCursorsToScene();
        },
      );

      socket.on(
        "elements:update",
        (data: {
          senderId: string;
          elements: ExcalidrawElement[];
          appState: Partial<AppState>;
        }) => {
          if (data.senderId === socket?.id) return;
          const api = excalidrawAPIRef.current;
          if (!api) return;

          // Use *including-deleted* so the merge sees local tombstones and
          // can refuse to resurrect a just-deleted element.
          const currentElements = api.getSceneElementsIncludingDeleted();
          const remoteElements = data.elements;
          const localById = new Map(
            currentElements.map((el) => [el.id, el]),
          );
          const hasChanges = remoteElements.some((remoteEl) => {
            const localEl = localById.get(remoteEl.id);
            return (
              !localEl ||
              remoteEl.version > localEl.version ||
              remoteEl.isDeleted !== localEl.isDeleted
            );
          });
          if (!hasChanges) return;

          const remoteDeleted = remoteElements.filter((el) => el.isDeleted);
          if (remoteDeleted.length > 0) {
            console.info("[whiteboard-relay] received deletes", {
              ids: remoteDeleted.map((el) => el.id),
              totalRemote: remoteElements.length,
            });
          }

          const merged = mergeElementsByVersion(
            currentElements,
            remoteElements,
          );
          onBeforeRemoteUpdateRef.current?.();
          api.updateScene({
            elements: merged,
            appState: data.appState as AppState,
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
          if (data.senderId === socket?.id) return;
          cursorPositionsRef.current.set(data.senderId, {
            x: data.cursor.x,
            y: data.cursor.y,
            color: data.color,
            username: data.username,
            lastUpdated: Date.now(),
          });
          flushCursorsToScene();
        },
      );
    })();

    const sweepInterval = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [key, cursor] of cursorPositionsRef.current) {
        if (now - cursor.lastUpdated > 60_000) {
          cursorPositionsRef.current.delete(key);
          changed = true;
        }
      }
      if (changed) flushCursorsToScene();
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(sweepInterval);
      socket?.disconnect();
      socketRef.current = null;
      cursorPositions.clear();
      lastBroadcastedElements.clear();
      pendingCursorRef.current = null;
      pendingElementsRef.current = null;
      setIsConnected(false);
    };
  }, [whiteboardId, userId, flushCursorsToScene]);

  return {
    collaborators,
    isConnected,
    broadcastElements,
    broadcastCursor,
    senderId,
    userColor: userColorRef.current,
  };
}
