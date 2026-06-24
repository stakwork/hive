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

import { randomUUID } from "crypto";
import { ModelMessage } from "ai";
import { db } from "@/lib/db";
import type { CachedConcepts } from "@/lib/ai/runCanvasAgent";
import { generateTitle } from "@/lib/ai/conversationHelpers";
import {
  appendTurnMessages,
  type StoredMessage,
  type StoredAttachment,
} from "@/services/canvas-turn-persistence";

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
 */
export async function persistCanvasUserMessage(args: {
  orgId: string;
  userId: string;
  existingRowId: string | null;
  turnId: string;
  content: string;
  attachments?: StoredAttachment[];
  workspaceSlugs: string[];
}): Promise<string> {
  const {
    orgId,
    userId,
    existingRowId,
    turnId,
    content,
    attachments,
    workspaceSlugs,
  } = args;

  const userRow: StoredMessage = {
    id: `${turnId}-u`,
    role: "user",
    content,
    timestamp: new Date().toISOString(),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };

  if (existingRowId) {
    await appendTurnMessages({
      conversationId: existingRowId,
      rows: [userRow],
      idPrefix: `${turnId}-u`,
      reason: "user-message",
    });
    return existingRowId;
  }

  const created = await db.sharedConversation.create({
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
      isShared: false,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Persist a single-shot org-agent exchange (one user prompt + one
 * assistant answer) as a fresh, shareable org-canvas conversation, and
 * return its id.
 *
 * Used by the `org_agent` MCP tool when invoked from a call/voice
 * context: the agent asks one question, and we want a durable, org-
 * member-viewable record the caller can hand back as a link
 * (`/org/<login>?chat=<id>`, which auto-loads the conversation). Unlike
 * the interactive chat path, there is no prior conversation to
 * continue — each call mints its own row.
 *
 * The row mirrors `persistCanvasUserMessage`'s org-canvas shape
 * (`workspaceId: null`, `sourceControlOrgId` set, `extraWorkspaceSlugs`
 * in `settings` so later org tooling can recover the slug set) but is
 * created `isShared: true` so any org member can open it, and carries
 * both turns in one atomic create.
 */
export async function createSharedOrgAgentConversation(args: {
  orgId: string;
  userId: string;
  prompt: string;
  answer: string;
  workspaceSlugs: string[];
}): Promise<string> {
  const { orgId, userId, prompt, answer, workspaceSlugs } = args;

  const turnId = randomUUID();
  const now = new Date();

  const userRow: StoredMessage = {
    id: `${turnId}-u`,
    role: "user",
    content: prompt,
    timestamp: now.toISOString(),
  };
  const assistantRow: StoredMessage = {
    id: `${turnId}-a0`,
    role: "assistant",
    content: answer,
    timestamp: now.toISOString(),
  };

  const created = await db.sharedConversation.create({
    data: {
      sourceControlOrgId: orgId,
      userId,
      workspaceId: null,
      messages: [userRow, assistantRow] as unknown as never,
      title: generateTitle([userRow]),
      lastMessageAt: now,
      source: "org-agent",
      settings: { extraWorkspaceSlugs: workspaceSlugs } as unknown as never,
      followUpQuestions: [],
      isShared: true,
    },
    select: { id: true },
  });

  return created.id;
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
  if (Array.isArray(c.features)) return c.features.length > 0;
  if (c.conceptsByWorkspace) {
    return Object.values(c.conceptsByWorkspace).some(
      (list) => Array.isArray(list) && list.length > 0,
    );
  }
  return false;
}

/**
 * Atomically merge the cached concepts (for reuse) + the rendered prefix
 * snapshot (for the Agent Logs detail view) into
 * `SharedConversation.settings` via a jsonb `||` merge. Using a single
 * UPDATE (rather than read-modify-write) keeps it race-free against the
 * client autosave's concurrent `settings` writes — both sides merge into
 * the same blob instead of overwriting it. Caller has validated `rowId`.
 */
export async function persistOrgCanvasPromptCache(
  rowId: string,
  concepts: CachedConcepts,
  prefixSnapshot: ModelMessage[],
): Promise<void> {
  const patch = JSON.stringify({
    promptConcepts: concepts,
    promptPrefix: prefixSnapshot,
  });
  await db.$executeRaw`
    UPDATE shared_conversations
    SET settings = COALESCE(settings, '{}'::jsonb) || ${patch}::jsonb
    WHERE id = ${rowId}
  `;
}
