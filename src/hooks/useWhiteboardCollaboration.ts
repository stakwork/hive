"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import type { ExcalidrawImperativeAPI, Collaborator } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { getPusherClient, getWhiteboardChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type {
  CollaboratorInfo,
  WhiteboardElementsUpdateEvent,
  WhiteboardCursorUpdateEvent,
  WhiteboardUserJoinEvent,
  WhiteboardUserLeaveEvent,
} from "@/types/whiteboard-collaboration";

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

export function useWhiteboardCollaboration({
  whiteboardId,
  excalidrawAPI,
  onRemoteUpdate,
}: UseWhiteboardCollaborationOptions): UseWhiteboardCollaborationReturn {
  const { data: session } = useSession();
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const [cursorPositions, setCursorPositions] = useState<Map<string, { x: number; y: number; color: string; username?: string }>>(new Map());
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
          tool: "laser",
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
      if (!whiteboardId) return;

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
      if (!whiteboardId) return;

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

  // Subscribe to Pusher channel
  useEffect(() => {
    if (!whiteboardId) return;

    const pusher = getPusherClient();
    const channelName = getWhiteboardChannelName(whiteboardId);
    const channel = pusher.subscribe(channelName);

    channel.bind("pusher:subscription_succeeded", () => {
      setIsConnected(true);

      // Announce join
      if (session?.user) {
        fetch(`/api/whiteboards/${whiteboardId}/collaboration`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "join",
            user: {
              odinguserId: session.user.id,
              name: session.user.name || "Anonymous",
              image: session.user.image || null,
              color: userColorRef.current,
              joinedAt: Date.now(),
            },
          }),
        }).catch(console.error);
      }
    });

    // Handle remote element updates
    channel.bind(
      PUSHER_EVENTS.WHITEBOARD_ELEMENTS_UPDATE,
      (data: WhiteboardElementsUpdateEvent) => {
        // Ignore our own updates
        if (data.senderId === senderIdRef.current) return;

        if (excalidrawAPI) {
          const currentElements = excalidrawAPI.getSceneElements();
          const remoteElements = data.elements as ExcalidrawElement[];

          // Merge elements: remote elements take precedence for conflicts
          const mergedElements = mergeElements(currentElements, remoteElements);

          excalidrawAPI.updateScene({
            elements: mergedElements,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            appState: data.appState as any,
          });

          onRemoteUpdate?.();
        }
      }
    );

    // Handle cursor updates
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
          });
          return next;
        });

        // Remove stale cursor after 3 seconds of inactivity
        setTimeout(() => {
          setCursorPositions((prev) => {
            const next = new Map(prev);
            const cursor = next.get(data.senderId);
            if (cursor && cursor.x === data.cursor.x && cursor.y === data.cursor.y) {
              next.delete(data.senderId);
            }
            return next;
          });
        }, 3000);
      }
    );

    // Handle user join
    channel.bind(
      PUSHER_EVENTS.WHITEBOARD_USER_JOIN,
      (data: WhiteboardUserJoinEvent) => {
        setCollaborators((prev) => {
          // Don't add ourselves or duplicates
          if (
            data.user.odinguserId === session?.user?.id ||
            prev.some((c) => c.odinguserId === data.user.odinguserId)
          ) {
            return prev;
          }
          return [...prev, data.user];
        });
      }
    );

    // Handle user leave
    channel.bind(
      PUSHER_EVENTS.WHITEBOARD_USER_LEAVE,
      (data: WhiteboardUserLeaveEvent) => {
        setCollaborators((prev) =>
          prev.filter((c) => c.odinguserId !== data.userId)
        );
        setCursorPositions((prev) => {
          const next = new Map(prev);
          // Remove cursor for any sender ID starting with the leaving user's ID
          for (const key of next.keys()) {
            if (key.startsWith(data.userId)) {
              next.delete(key);
            }
          }
          return next;
        });
      }
    );

    // Cleanup on unmount
    return () => {
      // Announce leave
      if (session?.user) {
        fetch(`/api/whiteboards/${whiteboardId}/collaboration`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "leave",
            user: { odinguserId: session.user.id },
          }),
        }).catch(console.error);
      }

      channel.unbind_all();
      pusher.unsubscribe(channelName);
      setIsConnected(false);
    };
  }, [whiteboardId, excalidrawAPI, session, onRemoteUpdate]);

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
