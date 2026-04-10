/**
 * In-memory presence store for whiteboard collaborators.
 *
 * IMPORTANT: this store is per-Node-process. In a multi-instance deployment
 * (e.g. Vercel autoscale, multiple containers behind a load balancer) each
 * instance will only see the subset of presence events that landed on it.
 * The client falls back to the existing "rebroadcast on join" pattern when
 * the synced list is incomplete, so worst case we degrade to the prior
 * behaviour rather than break.
 *
 * Entries are kept fresh by `recordHeartbeat` (called from join/cursor/element
 * events) and pruned with a TTL of 60 seconds — twice the cursor sweep
 * interval used by the client. Explicit `recordLeave` removes entries
 * immediately when the user closes the tab.
 */

export interface PresenceEntry {
  userId: string;
  name: string | null;
  image: string | null;
  color?: string;
  joinedAt: number;
  lastSeenAt: number;
}

const PRESENCE_TTL_MS = 60_000;

const presenceByWhiteboard = new Map<string, Map<string, PresenceEntry>>();

function getRoom(whiteboardId: string): Map<string, PresenceEntry> {
  let room = presenceByWhiteboard.get(whiteboardId);
  if (!room) {
    room = new Map();
    presenceByWhiteboard.set(whiteboardId, room);
  }
  return room;
}

function pruneRoom(room: Map<string, PresenceEntry>, now: number) {
  for (const [userId, entry] of room) {
    if (now - entry.lastSeenAt > PRESENCE_TTL_MS) {
      room.delete(userId);
    }
  }
}

/** Record or refresh a user's presence in a whiteboard room. */
export function recordHeartbeat(
  whiteboardId: string,
  entry: Omit<PresenceEntry, "lastSeenAt" | "joinedAt"> & {
    joinedAt?: number;
  },
): void {
  const room = getRoom(whiteboardId);
  const now = Date.now();
  const existing = room.get(entry.userId);
  room.set(entry.userId, {
    userId: entry.userId,
    name: entry.name ?? existing?.name ?? null,
    image: entry.image ?? existing?.image ?? null,
    color: entry.color ?? existing?.color,
    joinedAt: existing?.joinedAt ?? entry.joinedAt ?? now,
    lastSeenAt: now,
  });
}

/** Remove a user from a whiteboard room (e.g. on explicit leave / beforeunload). */
export function recordLeave(whiteboardId: string, userId: string): void {
  const room = presenceByWhiteboard.get(whiteboardId);
  if (!room) return;
  room.delete(userId);
  if (room.size === 0) presenceByWhiteboard.delete(whiteboardId);
}

/**
 * Get the currently-active collaborators for a whiteboard, excluding the
 * caller. Stale entries (older than {@link PRESENCE_TTL_MS}) are pruned.
 */
export function getActivePresence(
  whiteboardId: string,
  excludeUserId?: string,
): PresenceEntry[] {
  const room = presenceByWhiteboard.get(whiteboardId);
  if (!room) return [];
  pruneRoom(room, Date.now());
  const entries: PresenceEntry[] = [];
  for (const entry of room.values()) {
    if (entry.userId === excludeUserId) continue;
    entries.push(entry);
  }
  return entries;
}

/** Test helper: clears all presence state. */
export function __clearWhiteboardPresenceForTests() {
  presenceByWhiteboard.clear();
}
