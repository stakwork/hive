/**
 * Shared pure helpers for the org-canvas "edit last message" feature.
 *
 * Imported by BOTH the server (`truncateAndAppendTurn`,
 * `canvas-turn-persistence.ts`, `/api/ask/quick`, the autosave PUT) and
 * the client (`useSendCanvasChatMessage.ts`, `useCanvasChatAutoSave.ts`,
 * `SidebarChat.tsx`) so both sides agree on exactly what "the latest
 * editable message" means and exactly which rows a cut removes. Pure
 * functions only — no DB, no fetch, no React — so they stay trivially
 * unit-testable and safe to import from a client bundle.
 *
 * Turn-id shape: every row the server writes for a turn is
 * `${turnId}-u` (the user row) or `${turnId}-a*` / `${turnId}-n*`
 * (assistant rows — see `messagesFromSteps` / `canvas-turn-persistence.ts`).
 * `turnId` itself is either a UUID (`crypto.randomUUID()`) or the
 * `turn-<a>-<b>` fallback shape `useSendCanvasChatMessage.ts` produces
 * when `crypto.randomUUID` isn't available. Because a UUID contains
 * hyphens, row ids can't be parsed by splitting on `-` — every helper
 * here matches against `TURN_ID_RE` instead.
 */

/**
 * Matches a bare turn id: a UUID (v4-shaped, but we don't enforce the
 * version/variant nibbles — any 8-4-4-4-12 hex id is accepted) or the
 * `turn-<a>-<b>` fallback shape. Max 64 chars total (the leading
 * lookahead bounds the whole match, including the `turn-` prefix).
 */
export const TURN_ID_RE =
  /^(?=.{1,64}$)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|turn-[a-z0-9]+-[a-z0-9]+)$/;

/** Row-id shape: `${turnId}-u` (exact) or `${turnId}-a<rest>` / `${turnId}-n<rest>`. */
const ROW_ID_RE = new RegExp(
  "^(?=.{1,66}$)(" +
    "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" +
    "|" +
    "turn-[a-z0-9]+-[a-z0-9]+" +
    ")-(u|a[a-z0-9]*|n[a-z0-9]*)$",
);

/** True when `id` is a well-formed, length-bounded turn id. */
export function isValidTurnId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && TURN_ID_RE.test(id);
}

/**
 * Extract the turn id from a stored/rendered row id, or `undefined` when
 * the id isn't one of this feature's server-owned shapes.
 *
 * Returns `undefined` for `autoturn-*`, `automation-*`, `research-*`,
 * `answered-*`, `graph-walk-*`, planner-form rows, `synced-N`, and old
 * numeric (`Date.now()`) ids — none of those are turn-prefixed rows this
 * feature understands, and treating them as such would let an edit
 * truncate content it doesn't own.
 */
export function turnIdFromRowId(id: unknown): string | undefined {
  if (typeof id !== "string") return undefined;
  const match = ROW_ID_RE.exec(id);
  if (!match) return undefined;
  return match[1];
}

/**
 * Minimal shape `findEditableLastUserRow` / `computeTruncation` need.
 * Intentionally loose (mirrors `StoredMessage` / `CanvasChatMessage`
 * structurally) so this module has no dependency on either's concrete
 * type and can be imported from a client bundle.
 */
export interface TurnEditableMessage {
  id: string;
  role: "user" | "assistant";
  authorId?: string | null;
  approval?: unknown;
  rejection?: unknown;
  source?: unknown;
  originTurnId?: string | null;
}

/**
 * Find the latest editable user message, or `undefined` when there is
 * none. The target is always the **last row with `role: "user"` of any
 * kind** — a planner-form answer or an automation prompt as the most
 * recent user row means nothing is editable, even if an earlier row
 * would otherwise qualify. This keeps the client and the server
 * (`truncateAndAppendTurn`) in lockstep on what "the latest message" is.
 *
 * Editable requires ALL of:
 *   - the row id is exactly `${turnId}-u` (not `-u0`, `-ua`, …) — only
 *     `persistCanvasUserMessage` / the client's optimistic append
 *     produce that shape;
 *   - no `approval` / `rejection` (an approve/reject click can't be
 *     edited);
 *   - no `source` (planner-form answers and automation prompts carry
 *     `source` and are excluded, even though they're `role: "user"`);
 *   - `authorId === userId` — rows without `authorId` (everything
 *     written before this feature shipped, plus system-written rows)
 *     are never editable. There is no owner fallback.
 */
export function findEditableLastUserRow<T extends TurnEditableMessage>(
  messages: readonly T[],
  userId: string,
): T | undefined {
  let lastUserRow: T | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserRow = messages[i];
      break;
    }
  }
  if (!lastUserRow) return undefined;

  const turnId = turnIdFromRowId(lastUserRow.id);
  if (!turnId || lastUserRow.id !== `${turnId}-u`) return undefined;
  if (lastUserRow.approval != null) return undefined;
  if (lastUserRow.rejection != null) return undefined;
  if (lastUserRow.source != null) return undefined;
  if (!lastUserRow.authorId || lastUserRow.authorId !== userId) return undefined;

  return lastUserRow;
}

/**
 * Split `messages` into what a cut of `turnId` keeps vs. removes.
 *
 * Removed: every row whose id has the `${turnId}-` prefix (covers the
 * `${turnId}-u` row and every `${turnId}-a*` / `${turnId}-n*` assistant
 * row from the SAME turn), plus any row stamped `originTurnId === turnId`
 * (late fan-out from a dispatched sub-agent — research / graph-walk —
 * that the now-removed turn kicked off).
 *
 * Kept: rows from a different turn (protects other members' content in
 * shared rooms) and untagged status cards that can't be tied to any
 * turn (planner, agent-run, automation fan-outs — these report on
 * actions already taken and are intentionally NOT undone, per the
 * feature's Gaps).
 */
export function computeTruncation<T extends TurnEditableMessage>(
  messages: readonly T[],
  turnId: string,
): { kept: T[]; removed: T[] } {
  const prefix = `${turnId}-`;
  const kept: T[] = [];
  const removed: T[] = [];
  for (const m of messages) {
    const isTurnRow = typeof m.id === "string" && m.id.startsWith(prefix);
    const isOriginTagged = m.originTurnId === turnId;
    if (isTurnRow || isOriginTagged) {
      removed.push(m);
    } else {
      kept.push(m);
    }
  }
  return { kept, removed };
}

/**
 * Apply a batch of tombstoned turn ids to a local (client-side) message
 * list, e.g. from `settings.removedTurnIds` on a live-sync refetch.
 *
 * Never drops `activeTurnId` — the tab's OWN in-flight turn must survive
 * a truncation nudge for an unrelated (earlier) turn; dropping it would
 * yank the optimistic stream the tab is actively rendering out from
 * under itself.
 */
export function applyTruncations<T extends TurnEditableMessage>(
  local: readonly T[],
  removedTurnIds: readonly string[],
  opts: { activeTurnId?: string | null } = {},
): { messages: T[]; changed: boolean } {
  const { activeTurnId } = opts;
  let changed = false;
  let messages: T[] = local as T[];
  for (const turnId of removedTurnIds) {
    if (activeTurnId && turnId === activeTurnId) continue;
    const { kept, removed } = computeTruncation(messages, turnId);
    if (removed.length > 0) {
      changed = true;
      messages = kept;
    }
  }
  return { messages, changed };
}
