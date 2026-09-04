/**
 * Pure state derivation for Control panel items — no db, no React, so both the
 * server service (`./control-panel.ts`) and client rendering can import it and
 * unit tests need no Prisma.
 *
 * The plan predicates deliberately mirror the attention feed's four signals
 * (`src/services/attention/topItems.ts`: halted / awaiting-reply /
 * plan-question / ready-to-review) minus its ownership filter — a control panel
 * item is a thread the user *messaged*, which is a wider net than
 * "created or assigned". Running comes from the same predicate the
 * canvas projector uses (`deriveFeatureRunState`).
 */
import { deriveFeatureRunState, formatRunningLabel } from "@/lib/canvas/feature-live-state";
import { FEATURE_STATUS_LABELS } from "@/types/roadmap";
import type { ControlPanelItem, ControlPanelItemState } from "@/types/control-panel";

const HALTED_WORKFLOW: ReadonlySet<string> = new Set(["HALTED", "FAILED", "ERROR"]);

export interface LastMessageSummary {
  /** Prisma `ChatRole` value (`USER` / `ASSISTANT` / ...). */
  role: string;
  /** True when the message carries a FORM artifact (a clarifying question). */
  hasForm: boolean;
}

export interface PlanStateInput {
  status: string;
  workflowStatus: string | null;
  tasks: ReadonlyArray<{ status: string; workflowStatus: string | null; mode?: string | null }>;
  lastMessage: LastMessageSummary | null;
}

export interface DerivedState {
  state: ControlPanelItemState;
  label: string;
}

function featureStatusLabel(status: string): string {
  return (FEATURE_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

/**
 * Derive a plan's control panel state. Precedence: done → halted →
 * question (only if not running) → awaiting-reply (only if not running) →
 * review → running → status.
 */
export function derivePlanState(input: PlanStateInput): DerivedState {
  const { status, workflowStatus, tasks, lastMessage } = input;
  const run = deriveFeatureRunState(workflowStatus, tasks);
  const isRunning = run.plannerRunning || run.agentsRunningCount > 0;

  if (status === "COMPLETED" || status === "CANCELLED") {
    return { state: "done", label: featureStatusLabel(status) };
  }
  if (status === "ERROR" || (workflowStatus && HALTED_WORKFLOW.has(workflowStatus)) || run.hasErrorTask) {
    return { state: "halted", label: "Halted" };
  }
  if (!isRunning && lastMessage?.role === "ASSISTANT" && lastMessage.hasForm) {
    return { state: "question", label: "Question waiting" };
  }
  if (!isRunning && lastMessage?.role === "ASSISTANT" && tasks.length === 0) {
    return { state: "awaiting-reply", label: "Awaiting your reply" };
  }
  if (workflowStatus === "COMPLETED") {
    return { state: "review", label: "Ready to review" };
  }
  if (isRunning) {
    return { state: "running", label: formatRunningLabel(run) };
  }
  return { state: "none", label: featureStatusLabel(status) };
}

/** States that mean "waiting on the user" — the amber ring on a row's dot. */
export const NEEDS_YOU_STATES: ReadonlySet<ControlPanelItemState> = new Set([
  "halted",
  "question",
  "awaiting-reply",
  "review",
]);

const PREVIEW_MAX_LENGTH = 90;

/** One line of a message for a row's "since you" text: whitespace collapsed, cut with an ellipsis. */
export function previewLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > PREVIEW_MAX_LENGTH ? `${line.slice(0, PREVIEW_MAX_LENGTH - 1)}…` : line;
}

// ─── The chat on stage ──────────────────────────────────────────────────

/** The chat on stage, as the canvas chat store holds it. */
export interface ActiveChatSnapshot {
  /** Local store id — the item id until the server row exists. */
  localId: string;
  /** `SharedConversation.id` once the first turn has been persisted. */
  serverId: string | null;
  /** ISO of the newest message, from anyone; null while the chat is empty. */
  lastMessageAt: string | null;
  /** Jamie's last message, when Jamie spoke last and the turn has settled. */
  lastReply: string | null;
  hasMessages: boolean;
  isStreaming: boolean;
}

function sinceYouOf(chat: ActiveChatSnapshot): string {
  if (chat.isStreaming) return "Jamie is replying";
  if (chat.lastReply) return previewLine(chat.lastReply);
  return chat.hasMessages ? "No reply yet" : "Empty chat";
}

/**
 * The list row for the chat on stage before the server lists it. A fresh
 * chat has no `SharedConversation` row until its first turn is persisted,
 * and the list fetch trails that by a moment; this row stands in until
 * then, saying what the server will say, so the hand-over is invisible.
 */
export function activeChatItem(chat: ActiveChatSnapshot, startedAt: string, title: string): ControlPanelItem {
  const id = chat.serverId ?? chat.localId;
  return {
    key: `chat:${id}`,
    kind: "chat",
    id,
    title,
    workspaceSlug: null,
    workspaceId: null,
    workspaceName: null,
    lastActivityAt: chat.lastMessageAt ?? startedAt,
    sinceYou: sinceYouOf(chat),
    state: chat.isStreaming ? "running" : "none",
    unread: false,
  };
}

/**
 * The server's row for the chat on stage, brought up to what the store
 * already knows: it is read (it is on stage), it is working while Jamie
 * replies, and a message the store holds that the server has not listed
 * yet counts now — so a fetch that raced a send can't move the row back.
 */
export function overlayActiveChat(item: ControlPanelItem, chat: ActiveChatSnapshot): ControlPanelItem {
  const storeAhead = !!chat.lastMessageAt && chat.lastMessageAt > item.lastActivityAt;
  return {
    ...item,
    unread: false,
    lastActivityAt: storeAhead ? chat.lastMessageAt! : item.lastActivityAt,
    state: chat.isStreaming ? "running" : item.state,
    sinceYou: chat.isStreaming || storeAhead ? sinceYouOf(chat) : item.sinceYou,
  };
}

// ─── Search + order ─────────────────────────────────────────────────────

/** Case-insensitive substring match on title, workspace and the since-you line. */
export function matchesControlPanelQuery(item: ControlPanelItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.title, item.workspaceName ?? "", item.sinceYou].some((text) => text.toLowerCase().includes(q));
}

/** Newest activity first. Stable on ties so server order survives. */
export function sortControlPanelItems(items: ControlPanelItem[]): ControlPanelItem[] {
  return [...items].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

// ─── Hierarchy + day groups ─────────────────────────────────────────────

export interface ControlPanelRow {
  item: ControlPanelItem;
  /** 0 = top level, 1 = plan nested under the Jamie chat it came from. */
  depth: number;
  /** Key of the chat this row nests under (depth 1 only). */
  parentKey?: string;
  /** Top-level chats: how many plans nest under it (drives the collapse chevron). */
  childCount?: number;
  /** Newest activity on the row — for a chat, including its nested plans — which is what it is sorted and grouped by. */
  latestAt: string;
}

export interface ControlPanelGroup {
  /** `YYYY-MM-DD` of the group's day, local time. */
  key: string;
  /** "Today", "Yesterday", or a long-form date. */
  label: string;
  rows: ControlPanelRow[];
}

function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dayLabel(date: Date, now: Date): string {
  const key = localDayKey(date);
  if (key === localDayKey(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === localDayKey(yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/**
 * Pull a chat and the plans nested under it out of a flat item list.
 * Used by the optimistic archive/restore move so nested plans follow
 * the parent instead of hanging in the other collection.
 */
export function takeChatFamily(
  items: ControlPanelItem[],
  chatId: string,
): { family: ControlPanelItem[]; rest: ControlPanelItem[] } {
  const family: ControlPanelItem[] = [];
  const rest: ControlPanelItem[] = [];
  for (const item of items) {
    if ((item.kind === "chat" && item.id === chatId) || (item.kind === "plan" && item.parentChatId === chatId)) {
      family.push(item);
    } else {
      rest.push(item);
    }
  }
  return { family, rest };
}

function orderChatFamily(family: ControlPanelItem[]): ControlPanelItem[] {
  const chat = family.find((item) => item.kind === "chat");
  const plans = family.filter((item) => item.kind === "plan");
  return chat ? [chat, ...plans] : family;
}

/**
 * Optimistic archive: drop the chat and its nested plans from Active
 * and insert them at the top of Archive (newest `archivedAt` first).
 */
export function moveChatToArchive(
  items: ControlPanelItem[],
  archivedItems: ControlPanelItem[],
  chatId: string,
  archivedAt: string,
): { items: ControlPanelItem[]; archivedItems: ControlPanelItem[] } {
  const { family, rest } = takeChatFamily(items, chatId);
  if (family.length === 0) return { items, archivedItems };
  const stamped = family.map((item) => (item.kind === "chat" ? { ...item, archivedAt } : item));
  const { rest: archivedRest } = takeChatFamily(archivedItems, chatId);
  return { items: rest, archivedItems: [...orderChatFamily(stamped), ...archivedRest] };
}

/**
 * Optimistic restore: drop the chat and its nested plans from Archive
 * and insert them at the top of Active.
 */
export function moveChatToActive(
  items: ControlPanelItem[],
  archivedItems: ControlPanelItem[],
  chatId: string,
): { items: ControlPanelItem[]; archivedItems: ControlPanelItem[] } {
  const { family, rest } = takeChatFamily(archivedItems, chatId);
  if (family.length === 0) return { items, archivedItems };
  const stamped = family.map((item) => (item.kind === "chat" ? { ...item, archivedAt: null } : item));
  const { rest: itemsRest } = takeChatFamily(items, chatId);
  return { items: [...orderChatFamily(stamped), ...itemsRest], archivedItems: rest };
}

/**
 * Place the on-stage chat into Active or Archive without re-injecting an
 * archived chat into the active list. Overlay live store data onto whichever
 * row already holds it; only a brand-new chat (in neither list) is prepended
 * into Active.
 */
export function resolveControlPanelLists(
  items: ControlPanelItem[],
  archivedItems: ControlPanelItem[],
  activeChat: ActiveChatSnapshot | null,
  opts: { chatOnStage: boolean; startedAt: string; titleForNew: string },
): { displayItems: ControlPanelItem[]; displayArchivedItems: ControlPanelItem[] } {
  if (!activeChat) {
    return { displayItems: items, displayArchivedItems: archivedItems };
  }
  const key = `chat:${activeChat.serverId ?? activeChat.localId}`;
  if (items.some((item) => item.key === key)) {
    return {
      displayItems: items.map((item) => (item.key === key ? overlayActiveChat(item, activeChat) : item)),
      displayArchivedItems: archivedItems,
    };
  }
  if (archivedItems.some((item) => item.key === key)) {
    return {
      displayItems: items,
      displayArchivedItems: archivedItems.map((item) =>
        item.key === key ? overlayActiveChat(item, activeChat) : item,
      ),
    };
  }
  if (!activeChat.hasMessages && !opts.chatOnStage) {
    return { displayItems: items, displayArchivedItems: archivedItems };
  }
  return {
    displayItems: [activeChatItem(activeChat, opts.startedAt, opts.titleForNew), ...items],
    displayArchivedItems: archivedItems,
  };
}

/**
 * Archive is a flat list of chats sorted by `archivedAt` desc, with each
 * chat's plans nested directly beneath it. Do not run this through
 * `buildControlPanelGroups` — that pipeline day-buckets rows and only
 * nests a plan whose parent is in the same array.
 */
export function buildArchivedRows(items: ControlPanelItem[]): ControlPanelRow[] {
  const chats = items.filter((item) => item.kind === "chat");
  const chatIds = new Set(chats.map((item) => item.id));
  const childrenByChat = new Map<string, ControlPanelItem[]>();
  for (const item of items) {
    if (item.kind === "plan" && item.parentChatId && chatIds.has(item.parentChatId)) {
      const list = childrenByChat.get(item.parentChatId) ?? [];
      list.push(item);
      childrenByChat.set(item.parentChatId, list);
    }
  }
  const sortedChats = [...chats].sort((a, b) => {
    const byArchived = (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "");
    return byArchived !== 0 ? byArchived : b.lastActivityAt.localeCompare(a.lastActivityAt);
  });
  const rows: ControlPanelRow[] = [];
  for (const chat of sortedChats) {
    const children = sortControlPanelItems(childrenByChat.get(chat.id) ?? []);
    rows.push({
      item: chat,
      depth: 0,
      childCount: children.length,
      latestAt: chat.archivedAt ?? chat.lastActivityAt,
    });
    for (const child of children) {
      rows.push({ item: child, depth: 1, parentKey: chat.key, latestAt: child.lastActivityAt });
    }
  }
  return rows;
}

/** Rows the keyboard can land on. Collapsed chats hide their plans; a collapsed Archive is skipped entirely. */
export function visibleControlPanelItems(
  groups: ControlPanelGroup[],
  archivedRows: ControlPanelRow[],
  expandedKeys: ReadonlySet<string>,
  archivedExpanded: boolean,
): ControlPanelItem[] {
  const fromGroups = groups.flatMap((g) =>
    g.rows.filter((r) => !(r.parentKey && !expandedKeys.has(r.parentKey))).map((r) => r.item),
  );
  if (!archivedExpanded) return fromGroups;
  const fromArchive = archivedRows
    .filter((r) => !(r.parentKey && !expandedKeys.has(r.parentKey)))
    .map((r) => r.item);
  return [...fromGroups, ...fromArchive];
}

/**
 * Turn the flat item list into the control panel's list: Jamie chats
 * are the rows, and the plans a chat spawned nest under it. A plan
 * whose chat is not listed is left out. Everything is grouped by the
 * day of its newest activity, from anyone — a chat takes the newest
 * among itself and its nested plans, so a planner posting on a plan
 * floats its chat up into Today.
 *
 * `keep` filters items; a chat stays when it or any nested plan is
 * kept, and only the kept plans render under it.
 */
export function buildControlPanelGroups(
  items: ControlPanelItem[],
  keep: (item: ControlPanelItem) => boolean = () => true,
  now: Date = new Date(),
): ControlPanelGroup[] {
  const chatIds = new Set(items.filter((i) => i.kind === "chat").map((i) => i.id));

  const childrenByChat = new Map<string, ControlPanelItem[]>();
  const topLevel: ControlPanelItem[] = [];
  for (const item of items) {
    if (item.kind === "chat") {
      topLevel.push(item);
      continue;
    }
    if (item.parentChatId && chatIds.has(item.parentChatId)) {
      const list = childrenByChat.get(item.parentChatId) ?? [];
      list.push(item);
      childrenByChat.set(item.parentChatId, list);
    }
  }

  interface Entry {
    item: ControlPanelItem;
    children: ControlPanelItem[];
    sortAt: string;
  }
  const entries: Entry[] = [];
  for (const item of topLevel) {
    const children = sortControlPanelItems(childrenByChat.get(item.id) ?? []).filter(keep);
    if (!keep(item) && children.length === 0) continue;
    const sortAt = [item.lastActivityAt, ...children.map((c) => c.lastActivityAt)].sort().at(-1)!;
    entries.push({ item, children, sortAt });
  }
  entries.sort((a, b) => b.sortAt.localeCompare(a.sortAt));

  const groups: ControlPanelGroup[] = [];
  for (const entry of entries) {
    const date = new Date(entry.sortAt);
    const key = localDayKey(date);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: dayLabel(date, now), rows: [] };
      groups.push(group);
    }
    group.rows.push({ item: entry.item, depth: 0, childCount: entry.children.length, latestAt: entry.sortAt });
    for (const child of entry.children) {
      group.rows.push({ item: child, depth: 1, parentKey: entry.item.key, latestAt: child.lastActivityAt });
    }
  }
  return groups;
}
