/**
 * Control panel items — the user's Jamie agents in this org, and the
 * plans each of them manages.
 *
 * The control panel is a panel over Jamie chats: Jamie is the
 * orchestrator, plans hang off a chat. So the list is
 *   - **chat** — the user's org-canvas `SharedConversation`s, newest
 *     activity first, `limit` of them at a time (the client asks for
 *     more);
 *   - **plan**  — every `Feature` spawned from one of those chats
 *     (`Feature.parentCanvasConversationId`), nested under it on the
 *     client. Tasks are reached from the plan on the stage and are not
 *     items here.
 *
 * "Your last touch" (the user's latest message in a chat; their latest
 * plan-chat message, else the plan's creation) only decides what is
 * unread and what the "since you" line says; ordering is by newest
 * activity from anyone. State per item comes from the pure helpers in
 * `./control-panel-state.ts`, so the control panel, the attention feed
 * and the canvas projector agree on what "working" / "waiting" mean.
 */
import { db } from "@/lib/db";
import { ChatRole, Prisma } from "@prisma/client";
import { getAccessibleWorkspaces } from "@/services/attention/topItems";
import { countLiveRuns } from "@/services/canvas-active-runs";
import type { ControlPanelItem, ControlPanelResponse } from "@/types/control-panel";
import { derivePlanState, previewLine, sortControlPanelItems, type LastMessageSummary } from "./control-panel-state";

/** `limit` counts chats; their plans ride along. */
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;

interface ThreadTouchRow {
  id: string;
  lastMessageAt: Date;
}

/** Loose shape of one stored org-canvas message (`SharedConversation.messages`). */
interface StoredCanvasMessage {
  role?: string;
  content?: unknown;
  timestamp?: string;
  createdAt?: string;
  source?: { kind?: string; hasForm?: boolean; plannerMessageId?: string } | null;
}

function messageTime(m: StoredCanvasMessage): number | null {
  const raw = m.timestamp ?? m.createdAt;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function messageText(m: StoredCanvasMessage): string {
  if (typeof m.content === "string") return m.content.trim();
  if (Array.isArray(m.content)) {
    const part = m.content.find(
      (p): p is { type: string; text: string } =>
        !!p && typeof p === "object" && (p as { type?: unknown }).type === "text",
    );
    return (part?.text ?? "").trim();
  }
  return "";
}

/** Timestamp of the user's most recent message in a stored transcript, or null. */
function lastUserMessageAt(messages: StoredCanvasMessage[]): Date | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const ms = messageTime(m);
    if (ms !== null) return new Date(ms);
  }
  return null;
}

/** One-line "since you" for a chat: what the last non-user message said. */
function chatSinceYou(messages: StoredCanvasMessage[], yourLastAt: Date, planCount: number): string {
  const last = messages[messages.length - 1];
  if (last && last.role !== "user") {
    const ms = messageTime(last);
    if (ms === null || ms > yourLastAt.getTime()) {
      const text = previewLine(messageText(last));
      if (text) return text;
      return last.source?.kind === "planner" ? "Planner posted an update" : "Jamie replied";
    }
  }
  if (planCount > 0) return planCount === 1 ? "1 plan from this chat" : `${planCount} plans from this chat`;
  if (last && last.role === "user") return "No reply yet";
  return "Empty chat";
}

/**
 * A planner asked a clarifying question in this chat and nobody has
 * answered it through the chat's form yet — the chat is waiting on the
 * user. Mirrors the pending-form rule `SubAgentRunCard` renders.
 */
function hasPendingPlannerForm(messages: StoredCanvasMessage[]): boolean {
  const answered = new Set<string>();
  for (const m of messages) {
    if (m.source?.kind === "user-answered-planner-form" && m.source.plannerMessageId) {
      answered.add(m.source.plannerMessageId);
    }
  }
  return messages.some(
    (m) =>
      m.source?.kind === "planner" &&
      m.source.hasForm === true &&
      !!m.source.plannerMessageId &&
      !answered.has(m.source.plannerMessageId),
  );
}

function laterOf(a: Date, b: Date | null | undefined): Date {
  return b && b > a ? b : a;
}

function summarizeLast(last: { role: ChatRole; artifacts: { type: string }[] } | undefined): LastMessageSummary | null {
  if (!last) return null;
  return { role: last.role, hasForm: last.artifacts.some((a) => a.type === "FORM") };
}

export async function getControlPanelItems(params: {
  githubLogin: string;
  orgId: string;
  userId: string;
  /** How many chats to return (newest activity first). */
  limit?: number;
}): Promise<ControlPanelResponse> {
  const { githubLogin, orgId, userId } = params;
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const chatWhere = { sourceControlOrgId: orgId, userId, source: "org-canvas" };

  const [workspaces, conversations, chatTotal] = await Promise.all([
    getAccessibleWorkspaces(githubLogin, userId),
    db.sharedConversation.findMany({
      where: chatWhere,
      orderBy: { lastMessageAt: "desc" },
      take: limit,
      select: {
        id: true,
        title: true,
        createdAt: true,
        lastMessageAt: true,
        ownerSeenAt: true,
        messages: true,
        activeRuns: true,
      },
    }),
    db.sharedConversation.count({ where: chatWhere }),
  ]);
  const wsIds = workspaces.map((w) => w.id);
  const wsById = new Map(workspaces.map((w) => [w.id, w]));
  const conversationIds = conversations.map((c) => c.id);
  const hasPlans = conversationIds.length > 0 && wsIds.length > 0;

  // Plans these chats spawned, in workspaces the user can see — and the
  // user's latest plan-chat message per plan (same GROUP BY shape as the
  // My Activity feed in `services/roadmap/user-activity.ts`), selected by
  // the same criteria so the two run side by side.
  const [features, planTouches] = await Promise.all([
    hasPlans
      ? db.feature.findMany({
          where: {
            parentCanvasConversationId: { in: conversationIds },
            workspaceId: { in: wsIds },
            deleted: false,
          },
          select: {
            id: true,
            title: true,
            status: true,
            workflowStatus: true,
            createdAt: true,
            workspaceId: true,
            parentCanvasConversationId: true,
            tasks: {
              where: { deleted: false, archived: false },
              select: { status: true, workflowStatus: true, mode: true },
            },
            // Latest message; id tiebreaker because timestamp has ms precision.
            chatMessages: {
              orderBy: [{ timestamp: "desc" }, { id: "desc" }],
              take: 1,
              select: {
                role: true,
                timestamp: true,
                artifacts: { select: { type: true } },
              },
            },
          },
        })
      : [],
    hasPlans
      ? db.$queryRaw<ThreadTouchRow[]>(Prisma.sql`
          SELECT cm.feature_id AS "id", MAX(cm.timestamp) AS "lastMessageAt"
          FROM chat_messages cm
          WHERE cm.user_id = ${userId}
            AND cm.role = ${ChatRole.USER}::"ChatRole"
            AND cm.feature_id IN (
              SELECT f.id FROM features f
              WHERE f.parent_canvas_conversation_id IN (${Prisma.join(conversationIds)})
                AND f.workspace_id IN (${Prisma.join(wsIds)})
                AND f.deleted = false
            )
          GROUP BY cm.feature_id
        `)
      : [],
  ]);
  const planTouch = new Map<string, Date>();
  for (const row of planTouches) planTouch.set(row.id, new Date(row.lastMessageAt));

  const planCountByConversation = new Map<string, number>();
  for (const f of features) {
    const parent = f.parentCanvasConversationId;
    if (parent) planCountByConversation.set(parent, (planCountByConversation.get(parent) ?? 0) + 1);
  }

  const items: ControlPanelItem[] = [];

  for (const c of conversations) {
    const messages = Array.isArray(c.messages) ? (c.messages as StoredCanvasMessage[]) : [];
    const yourLastAt = lastUserMessageAt(messages) ?? c.lastMessageAt ?? c.createdAt;
    items.push({
      key: `chat:${c.id}`,
      kind: "chat",
      id: c.id,
      title: c.title ?? "Untitled chat",
      workspaceSlug: null,
      workspaceId: null,
      workspaceName: null,
      lastActivityAt: laterOf(c.createdAt, c.lastMessageAt).toISOString(),
      sinceYou: chatSinceYou(messages, yourLastAt, planCountByConversation.get(c.id) ?? 0),
      // A chat is never "done": it's working, waiting on the user, or idle.
      state: countLiveRuns(c.activeRuns) > 0 ? "running" : hasPendingPlannerForm(messages) ? "question" : "none",
      // Same rule as the history list: content arrived since the owner last opened it.
      unread: c.lastMessageAt ? !c.ownerSeenAt || c.lastMessageAt > c.ownerSeenAt : false,
    });
  }

  for (const f of features) {
    const ws = wsById.get(f.workspaceId);
    if (!ws) continue;
    // Touch = the user's latest plan-chat message, else creation (they
    // kicked it off from the chat, which always precedes any message).
    const yourLastAt = laterOf(f.createdAt, planTouch.get(f.id));
    const last = f.chatMessages[0];
    const derived = derivePlanState({
      status: f.status,
      workflowStatus: f.workflowStatus,
      tasks: f.tasks,
      lastMessage: summarizeLast(last),
    });
    items.push({
      key: `plan:${f.id}`,
      kind: "plan",
      id: f.id,
      title: f.title,
      workspaceSlug: ws.slug,
      workspaceId: ws.id,
      workspaceName: ws.name,
      // Activity is what was said on the plan, not the feature row's
      // `updatedAt` — any write bumps that (opening the plan page persists
      // a default model, for one) and would float the chat up as "just now".
      lastActivityAt: laterOf(f.createdAt, last?.timestamp).toISOString(),
      sinceYou: derived.label,
      state: derived.state,
      unread: !!last && last.role !== ChatRole.USER && last.timestamp > yourLastAt,
      parentChatId: f.parentCanvasConversationId,
    });
  }

  return {
    items: sortControlPanelItems(items),
    chats: { shown: conversations.length, total: chatTotal },
  };
}
