/**
 * In-memory presence store for canvas collaborators.
 *
 * IMPORTANT: this store is per-Node-process. In a multi-instance deployment
 * (e.g. Vercel autoscale, multiple containers behind a load balancer) each
 * instance will only see the subset of presence events that landed on it.
 * Worst case we degrade to the prior behaviour rather than break.
 *
 * Entries are kept fresh by `recordHeartbeat` (called from join/cursor events)
 * and pruned with a TTL of 60 seconds. Explicit `recordLeave` removes entries
 * immediately when the user closes the tab.
 *
 * Room key format: `${githubLogin}:${canvasRef || 'root'}`
 */

export interface CanvasPresenceEntry {
  userId: string;
  name: string | null;
  color?: string;
  image: string | null;
  joinedAt: number;
  lastSeenAt: number;
}

const PRESENCE_TTL_MS = 60_000;

const presenceByCanvas = new Map<string, Map<string, CanvasPresenceEntry>>();

function getRoom(roomKey: string): Map<string, CanvasPresenceEntry> {
  let room = presenceByCanvas.get(roomKey);
  if (!room) {
    room = new Map();
    presenceByCanvas.set(roomKey, room);
  }
  return room;
}

function pruneRoom(room: Map<string, CanvasPresenceEntry>, now: number) {
  for (const [userId, entry] of room) {
    if (now - entry.lastSeenAt > PRESENCE_TTL_MS) {
      room.delete(userId);
    }
  }
}

/** Record or refresh a user's presence in a canvas room. */
export function recordHeartbeat(
  roomKey: string,
  entry: Omit<CanvasPresenceEntry, "lastSeenAt" | "joinedAt" | "image"> & {
    joinedAt?: number;
    image?: string | null;
  },
): void {
  const room = getRoom(roomKey);
  const now = Date.now();
  const existing = room.get(entry.userId);
  room.set(entry.userId, {
    userId: entry.userId,
    name: entry.name ?? existing?.name ?? null,
    color: entry.color ?? existing?.color,
    image: entry.image ?? existing?.image ?? null,
    joinedAt: existing?.joinedAt ?? entry.joinedAt ?? now,
    lastSeenAt: now,
  });
}

/** Remove a user from a canvas room (e.g. on explicit leave / beforeunload). */
export function recordLeave(roomKey: string, userId: string): void {
  const room = presenceByCanvas.get(roomKey);
  if (!room) return;
  room.delete(userId);
  if (room.size === 0) presenceByCanvas.delete(roomKey);
}

/**
 * Get the currently-active collaborators for a canvas room, excluding the
 * caller. Stale entries (older than {@link PRESENCE_TTL_MS}) are pruned.
 */
export function getActivePresence(
  roomKey: string,
  excludeUserId?: string,
): CanvasPresenceEntry[] {
  const room = presenceByCanvas.get(roomKey);
  if (!room) return [];
  pruneRoom(room, Date.now());
  const entries: CanvasPresenceEntry[] = [];
  for (const entry of room.values()) {
    if (entry.userId === excludeUserId) continue;
    entries.push(entry);
  }
  return entries;
}

/** Test helper: clears all presence state. */
export function __clearCanvasPresenceForTests() {
  presenceByCanvas.clear();
}
