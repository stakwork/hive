import { db } from "@/lib/db";

/**
 * Writes a pull request's live state back onto the inline `pull_request`
 * artifact refs stored in a chat's `SharedConversation.messages`, so the
 * org chats sidebar (which reads the stored state) stops showing "Open" for
 * a merged PR. Only `content.state` is written; `lastMessageAt`,
 * `ownerSeenAt`, the title and Pusher are left alone — a reconcile is not
 * new activity.
 */

export interface ReconcileChatPullRequestInput {
  conversationId: string;
  orgId: string;
  userId: string;
  repo: string;
  number: number;
  state: string;
}

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Whether `artifact` is an inline PR ref for this repo/number whose stored state differs. */
function isStale(artifact: unknown, repo: string, number: number, state: string): artifact is Json {
  if (!isObj(artifact) || artifact.kind !== "pull_request") return false;
  const source = artifact.source;
  if (!isObj(source) || source.type !== "inline" || !isObj(source.content)) return false;
  const c = source.content;
  return (
    typeof c.repo === "string" && c.repo.toLowerCase() === repo.toLowerCase() && c.number === number && c.state !== state
  );
}

/** New messages with matching refs flipped, and how many refs changed. Input is not mutated. */
function applyState(messages: unknown, repo: string, number: number, state: string): { messages: unknown[]; changed: number } {
  const list = Array.isArray(messages) ? messages : [];
  let changed = 0;
  const next = list.map((message) => {
    if (!isObj(message) || !Array.isArray(message.artifacts)) return message;
    let touched = false;
    const artifacts = message.artifacts.map((artifact) => {
      if (!isStale(artifact, repo, number, state)) return artifact;
      touched = true;
      changed++;
      const source = artifact.source as Json;
      return { ...artifact, source: { ...source, content: { ...(source.content as Json), state } } };
    });
    return touched ? { ...message, artifacts } : message;
  });
  return { messages: next, changed };
}

export async function reconcileChatPullRequestState(
  input: ReconcileChatPullRequestInput,
): Promise<{ updated: number }> {
  const { conversationId, orgId, userId, repo, number, state } = input;

  // Same access rule as PUT on the conversation: the owner, or anyone for a shared room.
  const row = await db.sharedConversation.findFirst({
    where: { id: conversationId, sourceControlOrgId: orgId, OR: [{ userId }, { isShared: true }] },
    select: { messages: true },
  });
  if (!row) return { updated: 0 };

  // Fast path: nothing stale, no lock.
  if (applyState(row.messages, repo, number, state).changed === 0) return { updated: 0 };

  const updated = await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ messages: unknown }[]>`
      SELECT messages FROM shared_conversations WHERE id = ${conversationId} FOR UPDATE
    `;
    if (locked.length === 0) return 0;
    const { messages, changed } = applyState(locked[0].messages, repo, number, state);
    if (changed === 0) return 0;
    await tx.sharedConversation.update({ where: { id: conversationId }, data: { messages: messages as never } });
    return changed;
  });

  if (updated > 0) {
    console.info("[strut-pull-request] reconciled", { conversationId, repo, number, to: state, refs: updated });
  }
  return { updated };
}
