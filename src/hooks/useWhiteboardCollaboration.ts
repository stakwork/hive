"use client";

import { getPusherClient, getWhiteboardChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type {
  CollaboratorInfo,
  WhiteboardCursorUpdateEvent,
  WhiteboardElementsUpdateEvent,
  WhiteboardUserJoinEvent,
  WhiteboardUserLeaveEvent,
} from "@/types/whiteboard-collaboration";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, Collaborator, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Generate a consistent color based on user ID
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

interface UseWhiteboardCollaborationOptions {
  whiteboardId: string;
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  onRemoteUpdate?: () => void;
}

interface UseWhiteboardCollaborationReturn {
  collaborators: CollaboratorInfo[];
  /** Collaborators in Excalidraw's expected format for cursor rendering */
  excalidrawCollaborators: Map<string, Collaborator>;
  isConnected: boolean;
  /** Broadcast elements to other users immediately (no DB save) */
  broadcastElements: (
    elements: readonly ExcalidrawElement[],
    appState: AppState
  ) => void;
  /** Broadcast cursor position to other users */
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
}: UseWhiteboardCollaborationOptions): UseWhiteboardCollaborationReturn {
  const { data: session } = useSession();
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const [cursorPositions, setCursorPositions] = useState<Map<string, { x: number; y: number; color: string; username?: string; lastUpdated: number }>>(new Map());
  const [isConnected, setIsConnected] = useState(false);

  // Generate a unique sender ID for this session
  const senderIdRef = useRef<string>(
    `${session?.user?.id || "anon"}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  );

  const userColorRef = useRef<string>(
    generateUserColor(session?.user?.id || senderIdRef.current)
  );

  // Throttle refs for broadcasting
  const lastElementsBroadcastRef = useRef<number>(0);
  const lastCursorBroadcastRef = useRef<number>(0);
  const pendingElementsRef = useRef<{
    elements: readonly ExcalidrawElement[];
    appState: AppState;
  } | null>(null);
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);

  // Track last broadcast state for delta computation
  const lastBroadcastedElementsRef = useRef<Map<string, { version: number; isDeleted?: boolean }>>(new Map());

  // Convert cursor positions to Excalidraw's collaborator format
  const excalidrawCollaborators = useMemo(() => {
    const map = new Map<string, Collaborator>();
    cursorPositions.forEach((cursor, odinguserId) => {
      map.set(odinguserId, {
        username: cursor.username || "Collaborator",
        pointer: {
          x: cursor.x,
          y: cursor.y,
          tool: "pointer",
        },
        color: {
          background: cursor.color,
          stroke: cursor.color,
        },
      });
    });
    return map;
  }, [cursorPositions]);

  // Compute delta between current elements and last broadcasted state
  const computeElementsDelta = useCallback(
    (elements: readonly ExcalidrawElement[]): ExcalidrawElement[] => {
      const lastState = lastBroadcastedElementsRef.current;
      const changedElements: ExcalidrawElement[] = [];

      for (const el of elements) {
        const lastEl = lastState.get(el.id);
        // Include if: new element, version changed, or deleted status changed
        if (
          !lastEl ||
          lastEl.version !== el.version ||
          lastEl.isDeleted !== el.isDeleted
        ) {
          changedElements.push(el);
        }
      }

      // Update the last broadcasted state
      const newState = new Map<string, { version: number; isDeleted?: boolean }>();
      for (const el of elements) {
        newState.set(el.id, { version: el.version, isDeleted: el.isDeleted });
      }
      lastBroadcastedElementsRef.current = newState;

      return changedElements;
    },
    []
  );

  // Broadcast elements with 100ms throttle (no DB save, just Pusher)
  // Uses delta sync to only send changed elements, keeping payload under Pusher's 10KB limit
  const broadcastElements = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      if (!COLLABORATION_ENABLED || !whiteboardId) return;

      const now = Date.now();
      const timeSinceLastBroadcast = now - lastElementsBroadcastRef.current;

      const doBroadcast = (els: readonly ExcalidrawElement[], state: AppState) => {
        // Compute delta - only send changed elements
        const changedElements = computeElementsDelta(els);

        // Skip broadcast if nothing changed
        if (changedElements.length === 0) return;

        fetch(`/api/whiteboards/${whiteboardId}/collaboration`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "elements",
            elements: changedElements, // Only changed elements
            appState: {
              viewBackgroundColor: state.viewBackgroundColor,
              gridSize: state.gridSize,
            },
            senderId: senderIdRef.current,
          }),
        }).catch(console.error);
      };

      if (timeSinceLastBroadcast >= 100) {
        lastElementsBroadcastRef.current = now;
        doBroadcast(elements, appState);
      } else {
        pendingElementsRef.current = { elements, appState };
        setTimeout(() => {
          if (pendingElementsRef.current) {
            const pending = pendingElementsRef.current;
            pendingElementsRef.current = null;
            lastElementsBroadcastRef.current = Date.now();
            doBroadcast(pending.elements, pending.appState);
          }
        }, 100 - timeSinceLastBroadcast);
      }
    },
    [whiteboardId, computeElementsDelta]
  );

  // Broadcast cursor with 50ms throttle
  const broadcastCursor = useCallback(
    (x: number, y: number) => {
      if (!COLLABORATION_ENABLED || !whiteboardId) return;

      const now = Date.now();
      const timeSinceLastBroadcast = now - lastCursorBroadcastRef.current;

      const doBroadcast = (cursorX: number, cursorY: number) => {
        fetch(`/api/whiteboards/${whiteboardId}/collaboration`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "cursor",
            senderId: senderIdRef.current,
            cursor: { x: cursorX, y: cursorY },
            color: userColorRef.current,
          }),
        }).catch(console.error);
      };

      if (timeSinceLastBroadcast >= 50) {
        lastCursorBroadcastRef.current = now;
        doBroadcast(x, y);
      } else {
        pendingCursorRef.current = { x, y };
        setTimeout(() => {
          if (pendingCursorRef.current) {
            const pending = pendingCursorRef.current;
            pendingCursorRef.current = null;
            lastCursorBroadcastRef.current = Date.now();
            doBroadcast(pending.x, pending.y);
          }
        }, 50 - timeSinceLastBroadcast);
      }
    },
    [whiteboardId]
  );

  // Refs for presence rebroadcast (following usePlanPresence pattern)
  const hasSentJoinRef = useRef(false);
  const knownUserIdsRef = useRef(new Set<string>());

  // Stable ref for session so the effect doesn't re-run on token refreshes
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const onRemoteUpdateRef = useRef(onRemoteUpdate);
  onRemoteUpdateRef.current = onRemoteUpdate;

  // Derive a stable primitive for the dependency array
  const userId = session?.user?.id;

  // Subscribe to Pusher channel
  useEffect(() => {
    if (!COLLABORATION_ENABLED || !whiteboardId || !userId) return;

    const collaborationUrl = `/api/whiteboards/${whiteboardId}/collaboration`;

    const buildUserPayload = () => ({
      odinguserId: userId,
      name: sessionRef.current?.user?.name || "Anonymous",
      image: sessionRef.current?.user?.image || null,
      color: userColorRef.current,
      joinedAt: Date.now(),
    });

    const sendJoin = () => {
      if (hasSentJoinRef.current) return;
      fetch(collaborationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "join", user: buildUserPayload() }),
      }).catch(console.error);
      hasSentJoinRef.current = true;
    };

    let pusher: ReturnType<typeof getPusherClient> | null = null;
    let channel: ReturnType<ReturnType<typeof getPusherClient>["subscribe"]> | null = null;
    let channelName: string | null = null;

    try {
      pusher = getPusherClient();
      channelName = getWhiteboardChannelName(whiteboardId);
      channel = pusher.subscribe(channelName);

      channel.bind("pusher:subscription_succeeded", () => {
        setIsConnected(true);
      });

      // Handle remote element updates
      channel.bind(
        PUSHER_EVENTS.WHITEBOARD_ELEMENTS_UPDATE,
        (data: WhiteboardElementsUpdateEvent) => {
          if (data.senderId === senderIdRef.current) return;

          if (excalidrawAPI) {
            const currentElements = excalidrawAPI.getSceneElements();
            const remoteElements = data.elements as ExcalidrawElement[];
            const mergedElements = mergeElements(currentElements, remoteElements);

            excalidrawAPI.updateScene({
              elements: mergedElements,
              appState: data.appState as any,
            });

            onRemoteUpdateRef.current?.();
          }
        }
      );

      // Handle cursor updates — persist until explicit leave, sweep stale after 60s
      channel.bind(
        PUSHER_EVENTS.WHITEBOARD_CURSOR_UPDATE,
        (data: WhiteboardCursorUpdateEvent) => {
          if (data.senderId === senderIdRef.current) return;

          setCursorPositions((prev) => {
            const next = new Map(prev);
            next.set(data.senderId, {
              x: data.cursor.x,
              y: data.cursor.y,
              color: data.color,
              username: data.username,
              lastUpdated: Date.now(),
            });
            return next;
          });
        }
      );

      // Handle user join with rebroadcast for late joiners
      channel.bind(
        PUSHER_EVENTS.WHITEBOARD_USER_JOIN,
        (data: WhiteboardUserJoinEvent) => {
          if (data.user.odinguserId === userId) return;

          const isNew = !knownUserIdsRef.current.has(data.user.odinguserId);

          setCollaborators((prev) => {
            if (prev.some((c) => c.odinguserId === data.user.odinguserId)) return prev;
            return [...prev, data.user];
          });

          if (isNew) {
            knownUserIdsRef.current.add(data.user.odinguserId);
          }

          // Re-broadcast our presence so the new joiner sees us
          if (hasSentJoinRef.current && isNew && !data.rebroadcast) {
            fetch(collaborationUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "join", user: buildUserPayload(), rebroadcast: true }),
            }).catch(console.error);
          }
        }
      );

      // Handle user leave
      channel.bind(
        PUSHER_EVENTS.WHITEBOARD_USER_LEAVE,
        (data: WhiteboardUserLeaveEvent) => {
          knownUserIdsRef.current.delete(data.userId);
          setCollaborators((prev) =>
            prev.filter((c) => c.odinguserId !== data.userId)
          );
          setCursorPositions((prev) => {
            const next = new Map(prev);
            for (const key of next.keys()) {
              if (key.startsWith(data.userId)) {
                next.delete(key);
              }
            }
            return next;
          });
        }
      );

      // Announce our presence
      sendJoin();
    } catch {
      // Pusher not configured in this environment
      return;
    }

    // Sweep stale cursors every 30s (safety net for missed leave events)
    const sweepInterval = setInterval(() => {
      setCursorPositions((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [key, cursor] of next) {
          if (now - cursor.lastUpdated > 60_000) {
            next.delete(key);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 30_000);

    // Reliable leave via sendBeacon (survives tab close)
    const sendLeaveBeacon = () => {
      navigator.sendBeacon(
        collaborationUrl,
        new Blob([JSON.stringify({ type: "leave" })], { type: "application/json" }),
      );
    };

    window.addEventListener("beforeunload", sendLeaveBeacon);

    // Cleanup on unmount
    return () => {
      window.removeEventListener("beforeunload", sendLeaveBeacon);
      clearInterval(sweepInterval);
      channel?.unbind_all();
      if (pusher && channelName) {
        pusher.unsubscribe(channelName);
      }
      sendLeaveBeacon();
      hasSentJoinRef.current = false;
      knownUserIdsRef.current.clear();
      setIsConnected(false);
    };
  }, [whiteboardId, excalidrawAPI, userId]);

  return {
    collaborators,
    excalidrawCollaborators,
    isConnected,
    broadcastElements,
    broadcastCursor,
    senderId: senderIdRef.current,
    userColor: userColorRef.current,
  };
}

/**
 * Merge local and remote elements using element-level versioning
 * Remote elements take precedence when there's a conflict
 */
function mergeElements(
  localElements: readonly ExcalidrawElement[],
  remoteElements: ExcalidrawElement[]
): ExcalidrawElement[] {
  const localMap = new Map(localElements.map((el) => [el.id, el]));
  const remoteMap = new Map(remoteElements.map((el) => [el.id, el]));
  const mergedMap = new Map<string, ExcalidrawElement>();

  // Add all local elements first
  for (const [id, el] of localMap) {
    mergedMap.set(id, el);
  }

  // Override with remote elements (they have newer data from the server)
  for (const [id, remoteEl] of remoteMap) {
    const localEl = localMap.get(id);
    if (!localEl) {
      // New element from remote
      mergedMap.set(id, remoteEl);
    } else {
      // Use the element with the higher version
      if (remoteEl.version >= localEl.version) {
        mergedMap.set(id, remoteEl);
      }
    }
  }

  // Remove elements that were deleted remotely (not in remote but were in local)
  // Only if they haven't been locally modified since
  for (const [id, localEl] of localMap) {
    if (!remoteMap.has(id) && localEl.isDeleted) {
      mergedMap.delete(id);
    }
  }

  return Array.from(mergedMap.values());
}
