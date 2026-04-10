import { db } from "@/lib/db";

/**
 * Result of a whiteboard access check.
 *  - "ok"        — the user has access to the whiteboard
 *  - "not-found" — the whiteboard does not exist
 *  - "forbidden" — the whiteboard exists but the user is not a workspace member/owner
 */
export type WhiteboardAccessResult = "ok" | "not-found" | "forbidden";

/**
 * Performs the database access check for a whiteboard.
 * Use {@link checkWhiteboardAccessCached} on hot paths (e.g. real-time
 * collaboration) to avoid hammering the database on every cursor move.
 */
export async function checkWhiteboardAccess(
  whiteboardId: string,
  userId: string,
): Promise<WhiteboardAccessResult> {
  const whiteboard = await db.whiteboard.findUnique({
    where: { id: whiteboardId },
    select: {
      workspace: {
        select: {
          ownerId: true,
          members: {
            where: { userId },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!whiteboard) return "not-found";

  const isOwner = whiteboard.workspace.ownerId === userId;
  const isMember = whiteboard.workspace.members.length > 0;

  return isOwner || isMember ? "ok" : "forbidden";
}

/**
 * In-memory TTL cache for whiteboard access decisions. The collaboration
 * endpoint is hit on every cursor/element broadcast (potentially many times
 * per second per user), so we don't want to issue a Postgres query every time.
 *
 * The cache is intentionally small and short-lived: we cache only positive
 * ("ok") results so that revoked access takes effect within the TTL. Negative
 * results are not cached so that newly-granted membership becomes effective
 * immediately.
 *
 * Cache key: `${whiteboardId}:${userId}`.
 */
const accessCache = new Map<string, number>();
const ACCESS_CACHE_TTL_MS = 60_000; // 1 minute
const ACCESS_CACHE_MAX_ENTRIES = 5_000;

function pruneCache(now: number) {
  if (accessCache.size <= ACCESS_CACHE_MAX_ENTRIES) return;
  // Drop expired entries first; if still oversized, drop oldest insertions.
  for (const [key, expiresAt] of accessCache) {
    if (expiresAt <= now) accessCache.delete(key);
  }
  while (accessCache.size > ACCESS_CACHE_MAX_ENTRIES) {
    const oldest = accessCache.keys().next().value;
    if (oldest === undefined) break;
    accessCache.delete(oldest);
  }
}

/**
 * Cached version of {@link checkWhiteboardAccess}. Positive ("ok") decisions
 * are cached per (whiteboardId, userId) for {@link ACCESS_CACHE_TTL_MS}.
 */
export async function checkWhiteboardAccessCached(
  whiteboardId: string,
  userId: string,
): Promise<WhiteboardAccessResult> {
  const key = `${whiteboardId}:${userId}`;
  const now = Date.now();
  const cachedExpiresAt = accessCache.get(key);
  if (cachedExpiresAt && cachedExpiresAt > now) {
    return "ok";
  }
  if (cachedExpiresAt) {
    // Expired — drop it before re-checking.
    accessCache.delete(key);
  }

  const result = await checkWhiteboardAccess(whiteboardId, userId);
  if (result === "ok") {
    accessCache.set(key, now + ACCESS_CACHE_TTL_MS);
    pruneCache(now);
  }
  return result;
}

/**
 * Test helper: clears the in-memory access cache. Not exported from index files
 * — only call from tests that need a clean slate between cases.
 */
export function __clearWhiteboardAccessCacheForTests() {
  accessCache.clear();
}
