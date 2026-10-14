/**
 * Shared auto-turn helpers used by the strut job wake path
 * (`src/services/canvas-strut-autoturn.ts`): the `stay_silent` tool
 * name, the per-wake claim (idempotency across redeliveries), and the
 * prompt-concept cache helpers.
 */

import { db } from "@/lib/db";
import type { CachedConcepts } from "@/lib/ai/runCanvasAgent";
import type { StoredMessage } from "@/services/canvas-turn-persistence";

/** Tool name for the terminal no-op. Not namespaced. */
export const STAY_SILENT_TOOL = "stay_silent";


/**
 * A claim that has sat unreleased longer than this is treated as stale
 * (the owning run crashed before its `finally` released it) and may be
 * re-claimed, so a dead turn never wedges a wake forever. Sized
 * comfortably above the worst-case turn wall-clock (LLM + tool round-trips)
 * so it never expires a genuinely in-flight turn.
 */
const AUTOTURN_CLAIM_STALE_MS = 5 * 60 * 1000;

/** Shape of the per-message claim bag stored under `settings.autoTurnClaims`. */
type AutoTurnClaims = Record<string, { claimedAt: number }>;

/**
 * Atomically claim a wake for an auto-turn. Returns `true` iff
 * THIS caller won the claim and should run the turn.
 *
 * Serialized by the conversation row lock (`SELECT … FOR UPDATE`), the same
 * mechanism `appendTurnMessages` and the fan-out use — so it's correct
 * under Prisma's connection pool (the whole check-and-set runs in one
 * interactive transaction on one connection, and the lock auto-releases at
 * COMMIT; nothing is held across the LLM call). Bails when:
 *   - the conversation row is gone,
 *   - the turn already COMPLETED (a real `autoturn-<id>-*` output row
 *     exists in `messages`), or
 *   - a non-stale claim for this message already exists (a live concurrent
 *     run owns it).
 * Otherwise it records `{ claimedAt: now }` and returns `true`.
 *
 * The claim lives in `settings.autoTurnClaims` (not a `messages` row) so it
 * never pollutes the rendered transcript. The read-modify-write is safe
 * against concurrent `settings` writers because they all serialize on this
 * same row lock; we re-read the latest committed `settings` under the lock
 * and write the full object back, preserving sibling keys (`promptConcepts`,
 * `extraWorkspaceSlugs`). One benign edge: the client autosave PUT replaces
 * `settings` wholesale with the client's copy (which has no `autoTurnClaims`),
 * so an autosave landing mid-turn can erase a live claim. The fallout is
 * minor and self-correcting — at worst a redelivered SAME message re-runs
 * once; `appendTurnMessages`'
 * `idPrefix` dedup still blocks duplicate output rows. The leak/drop bug this
 * replaces was the real hazard; this claim is the narrow belt-and-suspenders.
 */
export async function claimAutoTurn(
  conversationId: string,
  wakeId: string,
): Promise<boolean> {
  const idPrefix = `autoturn-${wakeId}-`;
  let won = false;
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ messages: unknown; settings: unknown }[]>`
      SELECT messages, settings FROM shared_conversations
      WHERE id = ${conversationId} FOR UPDATE
    `;
    if (locked.length === 0) return; // conversation deleted

    // Already completed? A committed output row is the permanent dedup.
    const messages = Array.isArray(locked[0].messages)
      ? (locked[0].messages as StoredMessage[])
      : [];
    if (messages.some((m) => typeof m.id === "string" && m.id.startsWith(idPrefix))) {
      return;
    }

    const settings = (locked[0].settings ?? {}) as {
      autoTurnClaims?: AutoTurnClaims;
    };
    const claims: AutoTurnClaims = { ...(settings.autoTurnClaims ?? {}) };
    const existing = claims[wakeId];
    if (existing && Date.now() - existing.claimedAt < AUTOTURN_CLAIM_STALE_MS) {
      return; // a live run already owns this message
    }

    claims[wakeId] = { claimedAt: Date.now() };
    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: { settings: { ...settings, autoTurnClaims: claims } as never },
    });
    won = true;
  });
  return won;
}

/**
 * Release a claim recorded by {@link claimAutoTurn}. Best-effort and
 * idempotent — the stale-timeout in `claimAutoTurn` is the backstop if this
 * never runs (e.g. the process died). Serialized by the same row lock so it
 * doesn't clobber a concurrent `settings` writer.
 */
export async function releaseAutoTurnClaim(
  conversationId: string,
  wakeId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ settings: unknown }[]>`
      SELECT settings FROM shared_conversations
      WHERE id = ${conversationId} FOR UPDATE
    `;
    if (locked.length === 0) return;
    const settings = (locked[0].settings ?? {}) as {
      autoTurnClaims?: AutoTurnClaims;
    };
    if (!settings.autoTurnClaims?.[wakeId]) return;
    const claims: AutoTurnClaims = { ...settings.autoTurnClaims };
    delete claims[wakeId];
    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: { settings: { ...settings, autoTurnClaims: claims } as never },
    });
  });
}

/**
 * True when a cache holds at least one concept. Defensive: never cache an
 * empty result (a swarm outage yields an empty list, and caching that
 * would poison the cache into permanently serving nothing). Mirrors the
 * `hasConcepts` guard in `/api/ask/quick/route.ts`.
 */
export function hasConcepts(c: CachedConcepts): boolean {
  if (Array.isArray(c.concepts)) return c.concepts.length > 0;
  if (c.conceptsByWorkspace) {
    return Object.values(c.conceptsByWorkspace).some(
      (list) => Array.isArray(list) && list.length > 0,
    );
  }
  return false;
}

/**
 * Persist freshly-fetched concepts to `settings.promptConcepts` so the
 * next turn (auto or user-driven) reuses them and skips the per-swarm
 * `list_concepts` fetch. Uses a single jsonb `||` merge (not
 * read-modify-write) so it's race-free against the client autosave's
 * concurrent `settings` writes — both sides merge into the same blob
 * instead of overwriting it. Sibling of `persistOrgCanvasPromptCache` in
 * `/api/ask/quick/route.ts`.
 */
export async function persistPromptConcepts(
  conversationId: string,
  concepts: CachedConcepts,
): Promise<void> {
  const patch = JSON.stringify({ promptConcepts: concepts });
  await db.$executeRaw`
    UPDATE shared_conversations
    SET settings = COALESCE(settings, '{}'::jsonb) || ${patch}::jsonb
    WHERE id = ${conversationId}
  `;
}
