import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { getPusherClient, getFeatureChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import type { CollaboratorInfo } from "@/types/whiteboard-collaboration";
import type { Channel } from "pusher-js";

// Generate a consistent color for a user based on their ID
function generateUserColor(userId: string): string {
  const colors = [
    "#FF6B6B", // Red
    "#4ECDC4", // Teal
    "#45B7D1", // Blue
    "#96CEB4", // Green
    "#FFEAA7", // Yellow
    "#DFE6E9", // Gray
    "#74B9FF", // Light Blue
    "#A29BFE", // Purple
    "#FD79A8", // Pink
    "#FDCB6E", // Orange
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
 */
export function usePlanPresence({
  featureId,
}: UsePlanPresenceParams): UsePlanPresenceReturn {
  const { data: session } = useSession();
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);
  const channelRef = useRef<Channel | null>(null);
  const hasSentJoin = useRef(false);

  // Generate stable senderId and color from session
  const senderId = session?.user?.id || "";
  const senderColor = generateUserColor(senderId);

  // Send join notification
  const sendJoinNotification = useCallback(async () => {
    if (!session?.user || hasSentJoin.current) return;

    try {
      const user: CollaboratorInfo = {
        odinguserId: session.user.id,
        name: session.user.name || "Anonymous",
        image: session.user.image || null,
        color: senderColor,
        joinedAt: Date.now(),
      };

      await fetch(`/api/features/${featureId}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "join", user }),
      });

      hasSentJoin.current = true;
    } catch (error) {
      console.error("Error sending join notification:", error);
    }
  }, [featureId, session, senderColor]);

  // Send leave notification
  const sendLeaveNotification = useCallback(async () => {
    if (!session?.user) return;

    try {
      await fetch(`/api/features/${featureId}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "leave" }),
      });
    } catch (error) {
      console.error("Error sending leave notification:", error);
    }
  }, [featureId, session]);

  useEffect(() => {
    if (!session?.user) return;

    const pusherClient = getPusherClient();
    const channelName = getFeatureChannelName(featureId);
    const channel = pusherClient.subscribe(channelName);
    channelRef.current = channel;

    // Handle user join
    const handleUserJoin = (data: { user: CollaboratorInfo }) => {
      setCollaborators((prev) => {
        // Deduplicate by odinguserId
        const exists = prev.some((c) => c.odinguserId === data.user.odinguserId);
        if (exists) return prev;
        return [...prev, data.user];
      });
    };

    // Handle user leave
    const handleUserLeave = (data: { userId: string }) => {
      setCollaborators((prev) =>
        prev.filter((c) => c.odinguserId !== data.userId)
      );
    };

    // Bind events
    channel.bind(PUSHER_EVENTS.PLAN_USER_JOIN, handleUserJoin);
    channel.bind(PUSHER_EVENTS.PLAN_USER_LEAVE, handleUserLeave);

    // Send join notification
    sendJoinNotification();

    // Cleanup on unmount
    return () => {
      if (channelRef.current) {
        channelRef.current.unbind_all();
        pusherClient.unsubscribe(channelName);
        channelRef.current = null;
      }
      sendLeaveNotification();
      hasSentJoin.current = false;
    };
  }, [featureId, session, sendJoinNotification, sendLeaveNotification]);

  // Filter out current user from collaborators
  const otherCollaborators = collaborators.filter(
    (c) => c.odinguserId !== senderId
  );

  return {
    collaborators: otherCollaborators,
  };
}
