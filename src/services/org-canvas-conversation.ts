/**
 * Org-canvas conversation-row lifecycle + prompt-cache helpers.
 *
 * Extracted from `src/app/api/ask/quick/route.ts` so BOTH the streaming
 * chat turn AND a non-streaming (mobile / agent-as-tool) turn can share
 * one copy of this IDOR-sensitive DB logic. These are pure functions
 * over `db` + args — no request coupling — so the two routes stay in
 * lockstep instead of drifting.
 *
 * Org-canvas conversations are NOT workspace-scoped: their
 * `SharedConversation` row has `workspaceId: null` and `sourceControlOrgId`
 * set. That's why the workspace-keyed `resolveTokenAttributionRowId`
 * (still in `route.ts`) never matches them and a dedicated org-aware
 * path is needed here.
 */

import { ModelMessage } from "ai";
import { db } from "@/lib/db";
import type { CachedConcepts } from "@/lib/ai/runCanvasAgent";
import { generateTitle } from "@/lib/ai/conversationHelpers";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";
import {
  appendTurnMessages,
  type StoredMessage,
  type StoredAttachment,
} from "@/services/canvas-turn-persistence";
import {
  addTombstone,
  isRemovedTurn,
  readTombstoneSettings,
} from "@/lib/canvas/tombstones";
import {
  findEditableLastUserRow,
  computeTruncation,
} from "@/lib/canvas/turnEdit";

/**
 * Org-canvas sibling of `resolveTokenAttributionRowId`. Org-canvas
 * conversations are NOT workspace-scoped (`workspaceId: null`,
 * `sourceControlOrgId` set), so the workspace-keyed validator never
 * matches them and would silently drop the id. The approval flow
 * needs a validated id to stamp `Feature.parentCanvasConversationId`,
 * which is what lets `fanOutPlannerMessageToCanvas` post the planner's
 * `source.kind === "planner"` message back into this conversation (and
 * render the `<SubAgentRunCard>`).
 *
 * Validates the row belongs to this org and either to this caller or
 * is an explicitly shared room (mirrors the GET/PUT ownership rule in
 * the org-canvas conversations route). Returns the id when safe, else
 * null. IDOR-safe: a mismatched id is indistinguishable from missing.
 */
export async function resolveOrgConversationRowId(args: {
  conversationId: unknown;
  userId: string;
  orgId: string;
}): Promise<string | null> {
  const { conversationId, userId, orgId } = args;
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return null;
  }

  const row = await db.sharedConversation.findFirst({
    where: {
      id: conversationId,
      sourceControlOrgId: orgId,
      OR: [{ userId }, { isShared: true }],
    },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Persist the user's message for a backend-driven org-canvas turn,
 * creating the conversation row on the first turn. Returns the row id
 * the rest of the request (fan-out, the `after()` assistant-turn write,
 * the `X-Conversation-Id` header) keys off.
 *
 * - **Existing row** (validated org-canvas id from the prompt cache):
 *   append the user row under the shared row lock, idempotent on
 *   `${turnId}-u` so a retry / double-send doesn't duplicate it.
 * - **No / mismatched id:** create a fresh `SharedConversation` owned by
 *   this caller (workspace-null, org-scoped), titled from the message,
 *   seeded with the user row, and carrying the full workspace-slug set
 *   in `settings.extraWorkspaceSlugs` (what the auto-turn reconstruction
 *   and later turns read — org rows have no `workspaceId` to recover the
 *   slugs from). Creating a new row on an IDOR-mismatched id is safe:
 *   the caller can only ever write to their own conversation.
 *
 * `isShared` controls the visibility of a NEWLY-created row. It defaults
 * to `true`: every org-canvas conversation is a joinable room, so any org
 * member who opens its `?chat=<id>` URL reads + appends to the SAME row
 * (no private-until-shared gate, no fork-on-join). The URL is the share
 * mechanism — there's no separate "Share" step. Existing rows keep
 * whatever `isShared` they already had — this only seeds it on create.
 */
export async function persistCanvasUserMessage(args: {
  orgId: string;
  userId: string;
  existingRowId: string | null;
  turnId: string;
  content: string;
  attachments?: StoredAttachment[];
  workspaceSlugs: string[];
  isShared?: boolean;
}): Promise<string | null> {
  const {
    orgId,
    userId,
    existingRowId,
    turnId,
    content,
    attachments,
    workspaceSlugs,
    isShared = true,
  } = args;

  const userRow: StoredMessage = {
    id: `${turnId}-u`,
    role: "user",
    // Always stamp the author so "edit last message"
    // (`findEditableLastUserRow`) can recognize this row later. There is
    // no fallback to row ownership — a row without `authorId` is never
    // editable.
    authorId: userId,
    content,
    timestamp: new Date().toISOString(),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };

  if (existingRowId) {
    const result = await appendTurnMessages({
      conversationId: existingRowId,
      rows: [userRow],
      idPrefix: `${turnId}-u`,
      reason: "user-message",
      turnId,
    });
    // `truncateAndAppendTurn` may have already cut this exact turn id
    // out from under us (the first-turn / mid-conversation edit race:
    // the edit ran its lookup-or-create and tombstoned `turnId` before
    // this original request's append reached the lock). Appending
    // nothing here is correct — the edit's own `newUserRow` already
    // landed under a DIFFERENT (fresh) turn id, so there's no data to
    // recover, and the caller must not attribute the rest of this
    // request (the assistant turn, title generation) to a row that no
    // longer reflects it.
    if (result === "tombstoned") return null;
    return existingRowId;
  }

  // First-turn race guard: the edit flow's lookup-or-create AND this
  // create both take the same advisory lock keyed on `userId:turnId`
  // before creating a row, so the two can never interleave — either
  // this create wins (and the edit later tombstones it in a
  // `truncateAndAppendTurn` retry), or the edit's create-with-tombstone
  // wins first (in which case this create must become a no-op; see
  // below).
  const lockKey = `${userId}:${turnId}`;
  let created: { id: string } | null = null;
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;

    // Before creating, check whether a recent owner row already exists
    // that has THIS turn tombstoned — that can only mean the edit flow
    // already ran its lookup-or-create (under the same lock, so it must
    // have gone first) and created the row itself with the tombstone
    // pre-set. If so, skip the create entirely: the route's
    // `canvasConversationRowId` comes back null and nothing further is
    // written for this turn.
    const recent = await tx.sharedConversation.findFirst({
      where: {
        sourceControlOrgId: orgId,
        userId,
        source: "org-canvas",
        createdAt: { gt: new Date(Date.now() - 15 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, settings: true },
    });
    if (recent && isRemovedTurn(recent.settings, turnId)) {
      console.log("[canvas-turn] tombstoned-write-skipped", {
        conversationId: recent.id,
        turnId,
        writer: "create",
      });
      return;
    }

    created = await tx.sharedConversation.create({
      data: {
        sourceControlOrgId: orgId,
        userId,
        workspaceId: null,
        messages: [userRow] as unknown as never,
        title: generateTitle([userRow]),
        lastMessageAt: new Date(),
        source: "org-canvas",
        settings: { extraWorkspaceSlugs: workspaceSlugs } as unknown as never,
        followUpQuestions: [],
        isShared,
      },
      select: { id: true },
    });
  });
  return created ? created.id : null;
}

/** Discriminated result of {@link truncateAndAppendTurn}. */
export type TruncateAndAppendResult =
  | { kind: "not-found" }
  | {
      kind: "rejected";
      reason: "not-last" | "approval-row" | "not-author" | "no-author";
    }
  | {
      kind: "ok";
      rowId: string;
      truncationEpoch: number;
      removedCount: number;
      /** True when `replacesTurnId` was already tombstoned (idempotent retry). */
      alreadyTombstoned: boolean;
    };

/**
 * Cut the turn `replacesTurnId` out of an org-canvas conversation and
 * append `newUserRow` in its place, as ONE locked transaction — "edit
 * last message". See the feature architecture (section 2) for the full
 * design; this is the single entry point both resolution paths in
 * `/api/ask/quick/route.ts` (known row id, or a turn-id lookup) funnel
 * into.
 *
 * Steps, all under one `SELECT … FOR UPDATE`:
 *   1. Lock the row, scoped by org + (owner OR shared). No match →
 *      `{ kind: "not-found" }`.
 *   2. If `replacesTurnId` is already tombstoned, this is an idempotent
 *      retry: skip the cut and just append `newUserRow`.
 *   3. If the turn isn't present in `messages` yet (the early-Stop race
 *      — the user's Stop/edit beat the original request's own user-row
 *      persist to the lock), tombstone it anyway and append. The
 *      original request's later persist / assistant append then both
 *      no-op against the now-tombstoned id.
 *   4. Otherwise, `findEditableLastUserRow` must return exactly the
 *      `${replacesTurnId}-u` row — any other outcome is a 409 and NO
 *      write happens.
 *   5. Apply `computeTruncation`, push the tombstone, bump
 *      `truncationEpoch`, append `newUserRow`. On an index-0 cut, reset
 *      the title to a placeholder generated from the new row and clear
 *      `settings.titleSource` so the LLM title regenerates for the new
 *      turn.
 *
 * Exactly one `notifyCanvasConversationUpdated` fires, after the
 * transaction commits, with reason `"truncate"`.
 */
export async function truncateAndAppendTurn(args: {
  orgId: string;
  conversationId: string;
  userId: string;
  replacesTurnId: string;
  newUserRow: StoredMessage;
  newTurnId: string;
}): Promise<TruncateAndAppendResult> {
  const { orgId, conversationId, userId, replacesTurnId, newUserRow } = args;

  let outcome: TruncateAndAppendResult = { kind: "not-found" };

  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      {
        messages: unknown;
        settings: unknown;
        title: string | null;
        userId: string | null;
        isShared: boolean;
      }[]
    >`
      SELECT messages, settings, title, "userId", "isShared"
      FROM shared_conversations
      WHERE id = ${conversationId}
        AND "sourceControlOrgId" = ${orgId}
        AND source = 'org-canvas'
        AND ("userId" = ${userId} OR "isShared" = true)
      FOR UPDATE
    `;
    if (locked.length === 0) {
      outcome = { kind: "not-found" };
      return;
    }

    const row = locked[0];
    const messages = Array.isArray(row.messages)
      ? (row.messages as StoredMessage[])
      : [];

    // 2. Idempotent retry: already tombstoned → just append.
    if (isRemovedTurn(row.settings, replacesTurnId)) {
      const { truncationEpoch } = readTombstoneSettings(row.settings);
      await tx.sharedConversation.update({
        where: { id: conversationId },
        data: {
          messages: [...messages, newUserRow] as unknown as never,
          lastMessageAt: new Date(),
        },
      });
      outcome = {
        kind: "ok",
        rowId: conversationId,
        truncationEpoch,
        removedCount: 0,
        alreadyTombstoned: true,
      };
      return;
    }

    const turnPresent = messages.some(
      (m) => typeof m.id === "string" && m.id === `${replacesTurnId}-u`,
    );

    if (turnPresent) {
      // 4. Validate this is genuinely the latest editable message.
      const editable = findEditableLastUserRow(messages, userId);
      if (!editable || editable.id !== `${replacesTurnId}-u`) {
        const lastUserRow = [...messages].reverse().find((m) => m.role === "user");
        const reason: "not-last" | "approval-row" | "not-author" | "no-author" =
          !lastUserRow || lastUserRow.id !== `${replacesTurnId}-u`
            ? "not-last"
            : lastUserRow.approval != null || lastUserRow.rejection != null
              ? "approval-row"
              : !lastUserRow.authorId
                ? "no-author"
                : "not-author";
        outcome = { kind: "rejected", reason };
        return;
      }
    }

    // 3/5. Apply the cut (a no-op split when the turn wasn't present
    // yet — `computeTruncation` just returns everything as `kept`).
    const { kept, removed } = computeTruncation(messages, replacesTurnId);
    const tombstones = addTombstone(row.settings, replacesTurnId);

    const existingSettings =
      row.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
        ? (row.settings as Record<string, unknown>)
        : {};

    const isIndexZeroCut = messages.length > 0 && messages[0]?.id === `${replacesTurnId}-u`;
    const nextSettings: Record<string, unknown> = {
      ...existingSettings,
      removedTurnIds: tombstones.removedTurnIds,
      truncationEpoch: tombstones.truncationEpoch,
    };
    if (isIndexZeroCut) {
      delete nextSettings.titleSource;
    }

    await tx.sharedConversation.update({
      where: { id: conversationId },
      data: {
        messages: [...kept, newUserRow] as unknown as never,
        lastMessageAt: new Date(),
        settings: nextSettings as unknown as never,
        ...(isIndexZeroCut ? { title: generateTitle([newUserRow]) } : {}),
      },
    });

    outcome = {
      kind: "ok",
      rowId: conversationId,
      truncationEpoch: tombstones.truncationEpoch,
      removedCount: removed.length,
      alreadyTombstoned: false,
    };
  });

  if (outcome.kind === "ok") {
    notifyCanvasConversationUpdated(conversationId, "truncate");
  }
  return outcome;
}

/**
 * Look up the org-canvas row that holds a given turn's user row, for the
 * edit flow's fallback when the client doesn't know (or no longer
 * trusts) the conversation row id. Owner-only (deliberately excludes
 * shared rooms — the edit's write path is already owner-gated by
 * `findEditableLastUserRow`'s `authorId` check, but this lookup itself
 * must not let one shared-room member discover another's row by turn
 * id), scoped to recent rows (15 minutes — well past any plausible
 * edit-after-send gap), and matches the row id EXACTLY via a jsonb
 * containment query — never `LIKE` / a prefix, which could match an
 * unrelated row whose turn id happens to share a prefix.
 */
export async function findOrgCanvasRowByTurnId(args: {
  orgId: string;
  userId: string;
  turnId: string;
}): Promise<string | null> {
  const { orgId, userId, turnId } = args;
  const containment = JSON.stringify([{ id: `${turnId}-u`, authorId: userId }]);
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM shared_conversations
    WHERE "sourceControlOrgId" = ${orgId}
      AND "userId" = ${userId}
      AND source = 'org-canvas'
      AND "createdAt" > now() - interval '15 minutes'
      AND messages @> ${containment}::jsonb
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

/**
 * Fetch the stored messages for an org-canvas conversation, validating
 * that the row belongs to this org and either to this caller or is an
 * explicitly shared room (same ownership rule as
 * `resolveOrgConversationRowId` / `loadOrgCanvasPromptCache`). Returns
 * the rows for server-history reconstruction, or `null` when the id is
 * missing / mismatched / not an org row.
 *
 * Org-canvas sibling of `fetchStoredConversationMessages` (which is
 * workspace-keyed and so never matches a workspace-null org row). The
 * `/api/ask/sync` server-history turn rebuilds prior turns from this.
 * IDOR-safe: a mismatched id is indistinguishable from missing.
 */
export async function fetchOrgCanvasConversationMessages(args: {
  conversationId: unknown;
  userId: string;
  orgId: string;
}): Promise<StoredMessage[] | null> {
  const { conversationId, userId, orgId } = args;
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return null;
  }
  const row = await db.sharedConversation.findFirst({
    where: {
      id: conversationId,
      sourceControlOrgId: orgId,
      OR: [{ userId }, { isShared: true }],
    },
    select: { messages: true },
  });
  if (!row) return null;
  return Array.isArray(row.messages)
    ? (row.messages as unknown as StoredMessage[])
    : [];
}

/**
 * Load the cached concepts for an org-canvas conversation, while
 * validating that the row belongs to this org and either to this caller
 * or is an explicitly shared room (same ownership rule as
 * `resolveOrgConversationRowId`). Returns the validated row id plus the
 * cached concepts (or null when there's no usable cache yet). IDOR-safe:
 * a mismatched/missing id yields `null` indistinguishably.
 *
 * The concepts live at `settings.promptConcepts` (`CachedConcepts`).
 * They're the expensive swarm `listConcepts` result; reusing them lets
 * later turns skip that round-trip. The rendered prefix is rebuilt fresh
 * each turn (for an accurate scope hint), so it is NOT what we cache for
 * reuse — `settings.promptPrefix` is only a display snapshot.
 */
export async function loadOrgCanvasPromptCache(args: {
  conversationId: unknown;
  userId: string;
  orgId: string;
}): Promise<{ rowId: string; cachedConcepts: CachedConcepts | null } | null> {
  const { conversationId, userId, orgId } = args;
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return null;
  }
  const row = await db.sharedConversation.findFirst({
    where: {
      id: conversationId,
      sourceControlOrgId: orgId,
      OR: [{ userId }, { isShared: true }],
    },
    select: { id: true, settings: true },
  });
  if (!row) return null;
  const settings = (row.settings ?? {}) as Record<string, unknown>;
  const pc = settings.promptConcepts;
  const cachedConcepts =
    pc && typeof pc === "object" ? (pc as CachedConcepts) : null;
  return { rowId: row.id, cachedConcepts };
}

/** True when a cache holds at least one concept (defensive: never cache
 *  an empty result from a swarm outage). */
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
 * Atomically merge the rendered prefix snapshot (for the Agent Logs
 * detail view) and — when present — the reusable concept cache into
 * `SharedConversation.settings` via a jsonb `||` merge. Using a single
 * UPDATE (rather than read-modify-write) keeps it race-free against the
 * client autosave's concurrent `settings` writes — both sides merge into
 * the same blob instead of overwriting it. Caller has validated `rowId`.
 *
 * The two payloads are DECOUPLED on purpose: the prefix snapshot is a
 * display-only debugging artifact and must always be written so the
 * Agent Logs panel renders, even for orgs whose swarm returns no
 * concepts. The concept cache is a reuse optimization and is written
 * only when `concepts` is non-null — caching an empty list would poison
 * the next turn into permanently skipping the swarm fetch. Pass `null`
 * to snapshot the prefix without touching `promptConcepts`.
 */
export async function persistOrgCanvasPromptCache(
  rowId: string,
  concepts: CachedConcepts | null,
  prefixSnapshot: ModelMessage[],
): Promise<void> {
  const patch = JSON.stringify(
    concepts
      ? { promptConcepts: concepts, promptPrefix: prefixSnapshot }
      : { promptPrefix: prefixSnapshot },
  );
  await db.$executeRaw`
    UPDATE shared_conversations
    SET settings = COALESCE(settings, '{}'::jsonb) || ${patch}::jsonb
    WHERE id = ${rowId}
  `;
}

/**
 * Record which Prompt-Manager prompt versions produced this
 * conversation's turns, at `settings.prompts` keyed by prompt name:
 * `{ prompts: { CANVAS_AGENT_SYSTEM_PROMPT: { prompt_id, prompt_version_id } } }`.
 *
 * Conversation-level + latest-wins: the jsonb `||` merge replaces the
 * whole `prompts` key each turn, so it reflects the versions used by the
 * most recent turn (good enough — prompt versions change rarely and the
 * canvas chat is single-owner). Race-free against the client autosave's
 * concurrent `settings` writes for the same reason `persistOrgCanvasPromptCache`
 * is: both sides merge into the blob rather than overwriting it. No-op
 * when `resolutions` is empty (every prompt fell back to its in-repo
 * default, so there's nothing to attribute). Caller has validated `rowId`.
 */
export async function persistOrgCanvasPromptResolutions(
  rowId: string,
  resolutions: Record<string, { prompt_id: string; prompt_version_id: string | null }>,
): Promise<void> {
  if (Object.keys(resolutions).length === 0) return;
  const patch = JSON.stringify({ prompts: resolutions });
  await db.$executeRaw`
    UPDATE shared_conversations
    SET settings = COALESCE(settings, '{}'::jsonb) || ${patch}::jsonb
    WHERE id = ${rowId}
  `;
}
