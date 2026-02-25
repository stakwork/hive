import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { getPusherClient, getFeatureChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { CollaboratorInfo } from "@/types/whiteboard-collaboration";

function generateUserColor(userId: string): string {
  const colors = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
    "#DFE6E9", "#74B9FF", "#A29BFE", "#FD79A8", "#FDCB6E",
  ];

  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

interface UsePlanPresenceParams {
  featureId: string;
}

interface UsePlanPresenceReturn {
  collaborators: CollaboratorInfo[];
}

/**
 * Hook to manage real-time presence for plan collaboration.
 * Tracks who is currently viewing the same plan and broadcasts join/leave events.
 *
 * Initial sync: when we see another user join, we re-broadcast our own join
 * so they learn about us (they may have joined after we did).
 *
 * Leave: uses navigator.sendBeacon so the request survives unmount/tab close.
 */
export function usePlanPresence({
  featureId,
}: UsePlanPresenceParams): UsePlanPresenceReturn {
  const { data: session } = useSession();
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const hasSentJoin = useRef(false);
  const knownUserIds = useRef(new Set<string>());

  // Stable ref for session so the effect doesn't re-run on token refreshes
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Derive a stable primitive for the dependency array
  const userId = session?.user?.id;

  useEffect(() => {
    if (!userId || !sessionRef.current?.user) return;

    const userColor = generateUserColor(userId);

    const buildUserPayload = (): CollaboratorInfo => ({
      odinguserId: userId,
      name: sessionRef.current?.user?.name || "Anonymous",
      image: sessionRef.current?.user?.image || null,
      color: userColor,
      joinedAt: Date.now(),
    });

    const presenceUrl = `/api/features/${featureId}/presence`;

    const sendJoin = () => {
      if (hasSentJoin.current) return;
      fetch(presenceUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "join", user: buildUserPayload() }),
      }).catch((err) => console.error("Error sending join notification:", err));
      hasSentJoin.current = true;
    };

    const pusherClient = getPusherClient();
    const channelName = getFeatureChannelName(featureId);
    const channel = pusherClient.subscribe(channelName);

    const handleUserJoin = (data: { user: CollaboratorInfo; rebroadcast?: boolean }) => {
      if (data.user.odinguserId === userId) return;

      const isNew = !knownUserIds.current.has(data.user.odinguserId);

      setCollaborators((prev) => {
        const exists = prev.some((c) => c.odinguserId === data.user.odinguserId);
        if (exists) return prev;
        return [...prev, data.user];
      });

      if (isNew) {
        knownUserIds.current.add(data.user.odinguserId);
      }

      // Re-broadcast only for genuinely new users whose join is not itself a rebroadcast
      if (hasSentJoin.current && isNew && !data.rebroadcast) {
        fetch(presenceUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "join", user: buildUserPayload(), rebroadcast: true }),
        }).catch((err) => console.error("Error re-broadcasting join:", err));
      }
    };

    const handleUserLeave = (data: { userId: string }) => {
      knownUserIds.current.delete(data.userId);
      setCollaborators((prev) =>
        prev.filter((c) => c.odinguserId !== data.userId)
      );
    };

    channel.bind(PUSHER_EVENTS.PLAN_USER_JOIN, handleUserJoin);
    channel.bind(PUSHER_EVENTS.PLAN_USER_LEAVE, handleUserLeave);

    sendJoin();

    const sendLeaveBeacon = () => {
      navigator.sendBeacon(
        presenceUrl,
        new Blob([JSON.stringify({ type: "leave" })], { type: "application/json" }),
      );
    };

    window.addEventListener("beforeunload", sendLeaveBeacon);

    return () => {
      window.removeEventListener("beforeunload", sendLeaveBeacon);
      channel.unbind_all();
      pusherClient.unsubscribe(channelName);
      sendLeaveBeacon();
      hasSentJoin.current = false;
      knownUserIds.current.clear();
    };
  }, [featureId, userId]);

  return { collaborators };
}
