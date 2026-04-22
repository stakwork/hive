import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  typingUsers: string[];
  sendTyping: (isTyping: boolean) => void;
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
  const [typingUsers, setTypingUsers] = useState<{ userId: string; name: string }[]>([]);
  const hasSentJoin = useRef(false);
  const knownUserIds = useRef(new Set<string>());
  // Stable ref so sendTyping never changes identity
  const typingStateRef = useRef<{ featureId: string; userId: string | undefined; name: string | undefined }>({
    featureId,
    userId: undefined,
    name: undefined,
  });

  // Derive a stable primitive for the dependency array
  const userId = session?.user?.id;

  // Stable ref for session so the effect doesn't re-run on token refreshes
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Keep typingStateRef in sync
  typingStateRef.current = {
    featureId,
    userId,
    name: session?.user?.name ?? undefined,
  };

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

    let channel: ReturnType<ReturnType<typeof getPusherClient>["subscribe"]> | null = null;
    let pusherClient: ReturnType<typeof getPusherClient> | null = null;

    try {
      pusherClient = getPusherClient();
      const channelName = getFeatureChannelName(featureId);
      channel = pusherClient.subscribe(channelName);

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

      const handleTypingStart = (data: { userId: string; name: string }) => {
        if (data.userId === userId) return; // self-exclusion
        setTypingUsers((prev) => {
          if (prev.some((u) => u.userId === data.userId)) return prev;
          return [...prev, { userId: data.userId, name: data.name }];
        });
      };

      const handleTypingStop = (data: { userId: string }) => {
        setTypingUsers((prev) => prev.filter((u) => u.userId !== data.userId));
      };

      channel.bind(PUSHER_EVENTS.PLAN_USER_JOIN, handleUserJoin);
      channel.bind(PUSHER_EVENTS.PLAN_USER_LEAVE, handleUserLeave);
      channel.bind(PUSHER_EVENTS.PLAN_TYPING_START, handleTypingStart);
      channel.bind(PUSHER_EVENTS.PLAN_TYPING_STOP, handleTypingStop);

      sendJoin();
    } catch {
      // Pusher not configured in this environment
      return;
    }

    const sendLeaveBeacon = () => {
      navigator.sendBeacon(
        presenceUrl,
        new Blob([JSON.stringify({ type: "leave" })], { type: "application/json" }),
      );
      // Clear typing state on leave
      setTypingUsers([]);
    };

    window.addEventListener("beforeunload", sendLeaveBeacon);

    return () => {
      window.removeEventListener("beforeunload", sendLeaveBeacon);
      channel?.unbind_all();
      if (pusherClient && channel) {
        const channelName = getFeatureChannelName(featureId);
        pusherClient.unsubscribe(channelName);
      }
      sendLeaveBeacon();
      hasSentJoin.current = false;
      knownUserIds.current.clear();
    };
  }, [featureId, userId]);

  // Stable sendTyping function backed by a ref so it never triggers re-renders
  const sendTyping = useCallback(
    (isTyping: boolean) => {
      const { featureId: fId, userId: uId, name } = typingStateRef.current;
      if (!uId) return;
      const firstName = (name ?? "").split(" ")[0] || name || "Someone";
      fetch(`/api/features/${fId}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isTyping
            ? { type: "typing-start", name: firstName }
            : { type: "typing-stop" }
        ),
      }).catch(() => {});
    },
    [] // intentionally empty — reads via ref
  );

  const typingUserNames = useMemo(
    () => typingUsers.map((u) => u.name),
    [typingUsers]
  );

  return { collaborators, typingUsers: typingUserNames, sendTyping };
}
