/**
 * Pure helpers for the "edit last message" tombstone bookkeeping stored at
 * `SharedConversation.settings.removedTurnIds` / `.truncationEpoch`.
 *
 * Kept separate from `turnEdit.ts` (which is also imported by the CLIENT
 * bundle) because these touch the server-only `settings` JSON shape and
 * have no reason to ship to the browser. Server-only; no DB access here
 * though — pure transforms over the already-fetched `settings` blob, so
 * `truncateAndAppendTurn` / `appendTurnMessages` can call them from
 * inside an open `$transaction`.
 */

/** One tombstoned turn: the turn id that was cut, and when. */
export interface TombstoneEntry {
  turnId: string;
  /** ISO timestamp. */
  at: string;
}

/** The subset of `SharedConversation.settings` this module reads/writes. */
export interface TombstoneSettings {
  removedTurnIds?: TombstoneEntry[];
  truncationEpoch?: number;
  titleSource?: unknown;
  [key: string]: unknown;
}

/** Tombstones older than this are evicted — well past `maxDuration = 800`. */
export const TOMBSTONE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

/** Hard cap on retained tombstones, as a safety net against unbounded growth. */
export const TOMBSTONE_MAX_COUNT = 200;

/** Server-only settings keys that a client must never write directly. */
export const SERVER_ONLY_SETTINGS_KEYS = [
  "removedTurnIds",
  "truncationEpoch",
  "titleSource",
] as const;

/**
 * Parse a raw `settings` JSON value into a safe, defensively-typed shape.
 * Tolerates `null`, non-objects, and a malformed `removedTurnIds` (drops
 * any entry that isn't `{ turnId: string, at: string }`).
 */
export function readTombstoneSettings(
  settings: unknown,
): { removedTurnIds: TombstoneEntry[]; truncationEpoch: number } {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { removedTurnIds: [], truncationEpoch: 0 };
  }
  const record = settings as Record<string, unknown>;
  const rawList = Array.isArray(record.removedTurnIds)
    ? record.removedTurnIds
    : [];
  const removedTurnIds: TombstoneEntry[] = rawList.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;
    if (typeof e.turnId !== "string" || typeof e.at !== "string") return [];
    return [{ turnId: e.turnId, at: e.at }];
  });
  const truncationEpoch =
    typeof record.truncationEpoch === "number" && Number.isFinite(record.truncationEpoch)
      ? record.truncationEpoch
      : 0;
  return { removedTurnIds, truncationEpoch };
}

/** Evict entries older than {@link TOMBSTONE_MAX_AGE_MS}, then cap at {@link TOMBSTONE_MAX_COUNT}. */
export function evictStaleTombstones(
  entries: readonly TombstoneEntry[],
  now: number = Date.now(),
): TombstoneEntry[] {
  const fresh = entries.filter((e) => {
    const at = Date.parse(e.at);
    return !Number.isNaN(at) && now - at <= TOMBSTONE_MAX_AGE_MS;
  });
  if (fresh.length <= TOMBSTONE_MAX_COUNT) return fresh;
  // Keep the most recent TOMBSTONE_MAX_COUNT entries.
  return fresh.slice(fresh.length - TOMBSTONE_MAX_COUNT);
}

/** Exact-match tombstone check — never a prefix/LIKE match. */
export function isRemovedTurn(
  settings: unknown,
  turnId: string,
): boolean {
  const { removedTurnIds } = readTombstoneSettings(settings);
  return removedTurnIds.some((e) => e.turnId === turnId);
}

/**
 * Add a tombstone for `turnId` to the parsed settings, evicting stale
 * entries first. Returns the new `removedTurnIds` + incremented
 * `truncationEpoch`, ready to be spread back into a `settings` write.
 * A duplicate add (the turn is already tombstoned) still increments the
 * epoch — callers gate the actual DB write on their own idempotency
 * check before reaching here.
 */
export function addTombstone(
  settings: unknown,
  turnId: string,
  now: number = Date.now(),
): { removedTurnIds: TombstoneEntry[]; truncationEpoch: number } {
  const parsed = readTombstoneSettings(settings);
  const evicted = evictStaleTombstones(parsed.removedTurnIds, now);
  const nextList = evicted.some((e) => e.turnId === turnId)
    ? evicted
    : [...evicted, { turnId, at: new Date(now).toISOString() }];
  return {
    removedTurnIds: nextList,
    truncationEpoch: parsed.truncationEpoch + 1,
  };
}

/**
 * Strip server-only tombstone/title-tracking keys from an incoming
 * client `settings` object before merging it into the stored row. These
 * keys are written ONLY by `truncateAndAppendTurn` / title-generation
 * code — a client that sends them (even accidentally, e.g. by echoing
 * back a GET response) must never be able to clear or forge them.
 */
export function stripServerOnlySettingsKeys<T extends Record<string, unknown>>(
  settings: T,
): Omit<T, (typeof SERVER_ONLY_SETTINGS_KEYS)[number]> {
  const next = { ...settings };
  for (const key of SERVER_ONLY_SETTINGS_KEYS) {
    delete (next as Record<string, unknown>)[key];
  }
  return next;
}
