/**
 * Pure, identity-based persistence helpers for the canvas chat
 * auto-save / live-sync (`useCanvasChatAutoSave`).
 *
 * These exist as standalone functions (not inline in the hook) so the
 * message-loss invariants can be unit-tested without standing up the
 * Zustand store, fetch, and Pusher. The contract:
 *
 *   - A message is persisted iff its id is in the `persisted` set.
 *   - `computeUnsaved` returns local messages whose id isn't persisted,
 *     in order — its lead is therefore always a genuinely-unsaved
 *     message (never an already-saved assistant row), so a creating
 *     POST always carries the real first user message.
 *   - `mergeServerMessages` only ADDS server rows we don't already have
 *     (keyed by id) — it never drops or reorders local rows. This makes
 *     a mid-turn Pusher nudge incapable of losing a local message.
 */

export interface PersistableMessage {
  id: string;
  role: "user" | "assistant";
}

/**
 * Seed the persisted set with the leading `ephemeralSeedCount` message
 * ids. Ephemeral seeds (the AttentionList intro, or the messages a
 * joined/share conversation already has on the server) must never be
 * re-sent, so they count as "already persisted". Seeds are always the
 * leading messages, so we take their ids by position.
 */
export function seedPersistedIds(
  messages: PersistableMessage[],
  ephemeralSeedCount: number,
): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < ephemeralSeedCount && i < messages.length; i++) {
    set.add(messages[i].id);
  }
  return set;
}

/** Local messages not yet on the server, in order. */
export function computeUnsaved<T extends PersistableMessage>(
  messages: T[],
  persisted: Set<string>,
): T[] {
  return messages.filter((m) => !persisted.has(m.id));
}

export interface MergeResult<T> {
  /** The merged list: every local message, plus new server rows appended. */
  messages: T[];
  /** Server rows that weren't already local (appended, in server order). */
  added: T[];
  /** Every server id (callers mark these persisted). */
  serverIds: string[];
}

/**
 * Merge server messages into the local list by id. Keeps ALL local
 * messages (ephemeral seeds + any unsaved local rows survive) and
 * appends server rows we don't already have. Server-appended rows
 * (planner fan-out, auto-turn, planner-form answers) are always the
 * newest, so appending them in server order is chronological — and the
 * `<SubAgentRunCard>`'s `source.kind === "planner"` rows land in the
 * conversation this way.
 *
 * `skipServerIdPrefixes` filters out server rows whose id starts with any
 * of the given prefixes — the backend-driven-turn dedup. The authoring
 * tab passes `${turnId}-` for every turn it sent (see
 * `locallyAuthoredTurnIds`): the SERVER persists those turns' rows under
 * that prefix, but this tab is already showing its own optimistic stream
 * for them, so merging the server copies would double-render. Other tabs
 * / a reopened tab pass no prefixes and merge everything. Local rows are
 * never affected — only incoming server rows are skipped.
 */
export function mergeServerMessages<T extends PersistableMessage>(
  local: T[],
  server: T[],
  skipServerIdPrefixes: readonly string[] = [],
): MergeResult<T> {
  const localIds = new Set(local.map((m) => m.id));
  const isSkipped = (id: string) =>
    skipServerIdPrefixes.length > 0 &&
    skipServerIdPrefixes.some((p) => id.startsWith(p));
  const added = server.filter(
    (m) => !localIds.has(m.id) && !isSkipped(m.id),
  );
  return {
    messages: added.length > 0 ? [...local, ...added] : local,
    added,
    serverIds: server.map((m) => m.id),
  };
}
