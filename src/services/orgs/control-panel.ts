/**
 * The org page's chat list — the user's Jamie chats in this org.
 *
 *   - **chat** — the user's org-canvas `SharedConversation`s, newest
 *     activity first, `limit` of them at a time (the client asks for
 *     more);
 *   - **jobs** — the strut jobs each chat started, from their job-turn
 *     `StrutRun`s (`conversationId` is the chat they deliver to);
 *   - **pull requests** — the PR cards the chat's messages carry, each at
 *     its newest version.
 *
 * Shaping is the pure helpers in `./control-panel-state.ts`.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { JOB_TURN_KIND, jobTitleOf } from "@/lib/strut-jobs";
import { countLiveRuns } from "@/services/canvas-active-runs";
import type { ControlPanelItem, ControlPanelResponse } from "@/types/control-panel";
import { chatJobs, chatPullRequests, sortByActivity, type JobTurnRow } from "./control-panel-state";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;

const CHAT_SELECT = {
  id: true,
  title: true,
  createdAt: true,
  lastMessageAt: true,
  archivedAt: true,
  messages: true,
  activeRuns: true,
} as const;

type ConversationRow = {
  id: string;
  title: string | null;
  createdAt: Date;
  lastMessageAt: Date | null;
  archivedAt: Date | null;
  messages: unknown;
  activeRuns: unknown;
};

function laterOf(a: string, b: string | undefined): string {
  return b && b > a ? b : a;
}

/**
 * Every job turn delivering to these chats, grouped by chat, and each job's
 * title — read from its first turn only, since a later turn's `input` is
 * that turn's prompt and the title never changes.
 */
async function loadJobTurns(
  conversationIds: string[],
): Promise<{ byChat: Map<string, JobTurnRow[]>; titles: Map<string, string> }> {
  const byChat = new Map<string, JobTurnRow[]>();
  const titles = new Map<string, string>();
  if (conversationIds.length === 0) return { byChat, titles };
  const where = { conversationId: { in: conversationIds }, kind: JOB_TURN_KIND, jobId: { not: null } };
  const [runs, firstTurns] = await Promise.all([
    db.strutRun.findMany({
      where,
      select: { conversationId: true, jobId: true, status: true, createdAt: true, settledAt: true },
    }),
    // Each job's first turn only — in SQL: Prisma's `distinct` would fetch every turn's `input` and drop the rest in memory.
    db.$queryRaw<{ jobId: string; input: unknown }[]>(Prisma.sql`
      SELECT DISTINCT ON (job_id) job_id AS "jobId", input
      FROM strut_runs
      WHERE conversation_id IN (${Prisma.join(conversationIds)})
        AND kind = ${JOB_TURN_KIND}
        AND job_id IS NOT NULL
      ORDER BY job_id, created_at ASC
    `),
  ]);
  for (const run of runs) {
    if (!run.conversationId || !run.jobId) continue;
    const list = byChat.get(run.conversationId) ?? [];
    list.push({ ...run, jobId: run.jobId });
    byChat.set(run.conversationId, list);
  }
  for (const turn of firstTurns) titles.set(turn.jobId, jobTitleOf(turn));
  return { byChat, titles };
}

function shapeChat(c: ConversationRow, jobTurns: JobTurnRow[], titles: ReadonlyMap<string, string>): ControlPanelItem {
  const messages = Array.isArray(c.messages) ? c.messages : [];
  const jobs = chatJobs(jobTurns, titles);
  const chatAt = (c.lastMessageAt ?? c.createdAt).toISOString();
  return {
    id: c.id,
    title: c.title ?? "Untitled chat",
    lastActivityAt: laterOf(chatAt, jobs[0]?.lastActivityAt),
    working: countLiveRuns(c.activeRuns) > 0 || jobs.some((job) => job.working),
    archivedAt: c.archivedAt?.toISOString() ?? null,
    jobs,
    pullRequests: chatPullRequests(messages),
  };
}

export async function getControlPanelItems(params: {
  orgId: string;
  userId: string;
  /** How many chats to return (newest activity first). */
  limit?: number;
}): Promise<ControlPanelResponse> {
  const { orgId, userId } = params;
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const chatWhere = { sourceControlOrgId: orgId, userId, source: "org-canvas", archivedAt: null };

  const [conversations, chatTotal, archivedConversations] = await Promise.all([
    db.sharedConversation.findMany({
      where: chatWhere,
      orderBy: { lastMessageAt: "desc" },
      take: limit,
      select: CHAT_SELECT,
    }),
    db.sharedConversation.count({ where: chatWhere }),
    db.sharedConversation.findMany({
      where: { sourceControlOrgId: orgId, userId, source: "org-canvas", archivedAt: { not: null } },
      orderBy: { archivedAt: "desc" },
      take: MAX_LIMIT,
      select: CHAT_SELECT,
    }),
  ]);

  const jobTurns = await loadJobTurns([...conversations, ...archivedConversations].map((c) => c.id));
  const shape = (c: ConversationRow) => shapeChat(c, jobTurns.byChat.get(c.id) ?? [], jobTurns.titles);

  return {
    items: sortByActivity(conversations.map(shape)),
    // Archive keeps the query's archivedAt-desc order.
    archivedItems: archivedConversations.map(shape),
    chats: { shown: conversations.length, total: chatTotal },
  };
}
