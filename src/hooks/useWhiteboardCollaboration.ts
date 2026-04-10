"use client";

import { getPusherClient, getWhiteboardChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { mergeElementsByVersion } from "@/lib/whiteboard/merge-elements";
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
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Extract the userId from a senderId of the form `<userId>-<timestamp>-<random>`.
 * The timestamp and random suffix never contain hyphens (digits and base-36
 * lowercase respectively), so the userId is everything before the last two
 * dash-separated segments. Returns `null` if the senderId is malformed.
 */
function extractUserIdFromSenderId(senderId: string): string | null {
  const lastDash = senderId.lastIndexOf("-");
  if (lastDash <= 0) return null;
  const secondLastDash = senderId.lastIndexOf("-", lastDash - 1);
  if (secondLastDash <= 0) return null;
  return senderId.slice(0, secondLastDash);
}

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
  const [isConnected, setIsConnected] = useState(false);

  // Use a ref for cursor positions to avoid React re-renders on every cursor event
  const cursorPositionsRef = useRef<Map<string, { x: number; y: number; color: string; username?: string; lastUpdated: number }>>(new Map());

  // Stable ref for excalidrawAPI to avoid stale closures in Pusher callbacks
  const excalidrawAPIRef = useRef(excalidrawAPI);
  excalidrawAPIRef.current = excalidrawAPI;

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

  // One-shot warning flag for oversized real-time payloads.
  const hasWarnedOversizedRef = useRef(false);

  // Push current cursor ref contents into Excalidraw's scene imperatively
  const flushCursorsToScene = useCallback(() => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    const map = new Map<string, Collaborator>();
    cursorPositionsRef.current.forEach((cursor, senderId) => {
      map.set(senderId, {
        username: cursor.username || "Collaborator",
        pointer: { x: cursor.x, y: cursor.y, tool: "pointer" },
        color: { background: cursor.color, stroke: cursor.color },
      });
    });
    (api as any).updateScene({ collaborators: map });
  }, []);

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
        })
          .then((res) => {
            // Surface oversized payloads so the user knows the change won't be
            // visible to collaborators until the debounced DB save lands.
            if (res.status === 413) {
              if (!hasWarnedOversizedRef.current) {
                hasWarnedOversizedRef.current = true;
                console.warn(
                  "[whiteboard] Real-time broadcast skipped: payload exceeds Pusher limit. " +
                  "Changes will sync via the next database save.",
                );
              }
              // Reset delta tracking so the next broadcast resends these
              // elements (they were never delivered).
              for (const el of changedElements) {
                lastBroadcastedElementsRef.current.delete(el.id);
              }
            } else if (res.ok) {
              hasWarnedOversizedRef.current = false;
            }
          })
          .catch(console.error);
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

    // Capture ref values once so the cleanup function operates on the same
    // Maps/Sets the effect body uses (and to satisfy react-hooks/exhaustive-deps).
    const cursorPositions = cursorPositionsRef.current;
    const knownUserIds = knownUserIdsRef.current;
    const lastBroadcastedElements = lastBroadcastedElementsRef.current;

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
            const mergedElements = mergeElementsByVersion(currentElements, remoteElements);

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

          cursorPositionsRef.current.set(data.senderId, {
            x: data.cursor.x,
            y: data.cursor.y,
            color: data.color,
            username: data.username,
            lastUpdated: Date.now(),
          });
          flushCursorsToScene();
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
          // Match senderIds whose embedded userId is exactly `data.userId`.
          // Using `startsWith` here would incorrectly remove cursors of users
          // with similar IDs (e.g. "user-12" would also match "user-123").
          for (const key of cursorPositionsRef.current.keys()) {
            if (extractUserIdFromSenderId(key) === data.userId) {
              cursorPositionsRef.current.delete(key);
            }
          }
          flushCursorsToScene();
        }
      );

      // Announce our presence
      sendJoin();

      // Pull the current collaborator list from the server so late joiners
      // see everyone who is already in the room — not just whoever happens
      // to rebroadcast in response to our join event. Best-effort: failures
      // (network, multi-instance gap) fall back to the rebroadcast pattern.
      fetch(collaborationUrl)
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          const initial = body?.collaborators as CollaboratorInfo[] | undefined;
          if (!initial || initial.length === 0) return;
          setCollaborators((prev) => {
            const merged = [...prev];
            const seen = new Set(prev.map((c) => c.odinguserId));
            for (const c of initial) {
              if (c.odinguserId === userId) continue;
              if (seen.has(c.odinguserId)) continue;
              merged.push(c);
              knownUserIdsRef.current.add(c.odinguserId);
              seen.add(c.odinguserId);
            }
            return merged;
          });
        })
        .catch(() => {
          // Silently ignore — rebroadcast handler will fill in.
        });
    } catch {
      // Pusher not configured in this environment
      return;
    }

    // Sweep stale cursors every 30s (safety net for missed leave events)
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
      try {
        channel?.unbind_all();
      } catch (err) {
        console.error("[whiteboard] Failed to unbind Pusher channel:", err);
      }
      try {
        if (pusher && channelName) {
          pusher.unsubscribe(channelName);
        }
      } catch (err) {
        console.error("[whiteboard] Failed to unsubscribe from Pusher channel:", err);
      }
      sendLeaveBeacon();
      hasSentJoinRef.current = false;
      knownUserIds.clear();
      cursorPositions.clear();
      pendingCursorRef.current = null;
      pendingElementsRef.current = null;
      lastBroadcastedElements.clear();
      hasWarnedOversizedRef.current = false;
      setIsConnected(false);
    };
  }, [whiteboardId, excalidrawAPI, userId, flushCursorsToScene]);

  return {
    collaborators,
    isConnected,
    broadcastElements,
    broadcastCursor,
    senderId: senderIdRef.current,
    userColor: userColorRef.current,
  };
}

