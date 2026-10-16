/**
 * Pure derivation for the org page's chat list — no db, no React, so both
 * the server service (`./control-panel.ts`) and the client list can import
 * it and unit tests need no Prisma.
 */
import { generateTitle } from "@/lib/ai/conversationHelpers";
import {
  artifactIdentity,
  jobIdOfArtifact,
  latestArtifacts,
  parseArtifactContent,
  parseArtifactRefs,
} from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import type { ControlPanelItem, ControlPanelJob, ControlPanelPullRequest } from "@/types/control-panel";

// ─── Jobs and pull requests ─────────────────────────────────────────────

/** One job turn's `StrutRun`, as the service selects it. */
export interface JobTurnRow {
  jobId: string;
  status: string;
  createdAt: Date;
  settledAt: Date | null;
}

/**
 * A chat's jobs from its job-turn runs: working while any turn is PENDING,
 * newest activity first. `titles` holds each job's title, from its launch.
 */
export function chatJobs(runs: readonly JobTurnRow[], titles: ReadonlyMap<string, string>): ControlPanelJob[] {
  const jobs = new Map<string, ControlPanelJob>();
  for (const run of runs) {
    const at = (run.settledAt ?? run.createdAt).toISOString();
    const job = jobs.get(run.jobId);
    if (!job) {
      jobs.set(run.jobId, {
        id: run.jobId,
        title: titles.get(run.jobId) ?? "Job",
        working: run.status === "PENDING",
        lastActivityAt: at,
      });
      continue;
    }
    if (run.status === "PENDING") job.working = true;
    if (at > job.lastActivityAt) job.lastActivityAt = at;
  }
  return sortByActivity([...jobs.values()]);
}

/** Loose shape of one stored org-canvas message — only what the PRs are read from. */
interface StoredMessage {
  artifacts?: unknown;
  source?: { kind?: string; jobId?: string } | null;
}

/**
 * The pull requests a chat's messages carry, each as its newest card has
 * it (`latestArtifacts`: a later turn's ref is a newer version of the same
 * PR), newest report first, credited to the job whose row carried it
 * (`jobIdOfArtifact`). Only inline PR refs are read: that is how a job's
 * row stores one.
 */
export function chatPullRequests(messages: readonly StoredMessage[]): ControlPanelPullRequest[] {
  const parsed = messages.map((message) => ({
    artifacts: parseArtifactRefs(message.artifacts),
    source: message.source?.kind ? { kind: message.source.kind, jobId: message.source.jobId } : undefined,
  }));
  const all = parsed.flatMap((message) => message.artifacts ?? []);
  const reportedAt = new Map(all.map((ref, i) => [ref, i]));
  return latestArtifacts(all)
    .sort((a, b) => reportedAt.get(b)! - reportedAt.get(a)!)
    .flatMap((ref) => {
      if (ref.kind !== "pull_request" || ref.source.type !== "inline") return [];
      const content = parseArtifactContent("pull_request", ref.source.content);
      if (!content) return [];
      const jobId = jobIdOfArtifact(parsed, ref);
      return [
        {
          identity: artifactIdentity(ref),
          title: ref.title,
          url: content.url,
          repo: content.repo,
          number: content.number,
          state: content.state,
          ...(jobId ? { jobId } : {}),
        },
      ];
    });
}

// ─── The active chat ────────────────────────────────────────────────────

/** The active chat, as the canvas chat store holds it. */
export interface ActiveChatSnapshot {
  /** Local store id — the item id until the server row exists. */
  localId: string;
  /** `SharedConversation.id` once the first turn has been persisted. */
  serverId: string | null;
  /** ISO of the newest message, from anyone; null while the chat is empty. */
  lastMessageAt: string | null;
  hasMessages: boolean;
  isStreaming: boolean;
  /** Store title when set (LLM / seeded); null while still generating. */
  title: string | null;
}

/**
 * Label for the active chat's row while the server has not listed it. Prefer the store title (LLM /
 * seeded) so the live list does not stay stuck on a truncated first
 * message until the next list refetch.
 */
export function activeChatTitle(chat: ActiveChatSnapshot, messages: unknown[] | undefined): string {
  if (chat.title) return chat.title;
  if (chat.hasMessages && messages) return generateTitle(messages);
  return "New chat";
}

/**
 * The list row for the active chat before the server lists it. A fresh
 * chat has no `SharedConversation` row until its first turn is persisted,
 * and the list fetch trails that by a moment; this row stands in until
 * then, so the hand-over is invisible.
 */
export function activeChatItem(chat: ActiveChatSnapshot, startedAt: string, title: string): ControlPanelItem {
  return {
    id: chat.serverId ?? chat.localId,
    title,
    lastActivityAt: chat.lastMessageAt ?? startedAt,
    working: chat.isStreaming,
    jobs: [],
    pullRequests: [],
  };
}

/**
 * The server's row for the active chat, brought up to what the store
 * already knows: it is working while Jamie replies, and a message the
 * store holds that the server has not listed yet counts now — so a fetch
 * that raced a send can't move the row back.
 */
export function overlayActiveChat(item: ControlPanelItem, chat: ActiveChatSnapshot): ControlPanelItem {
  const storeAhead = !!chat.lastMessageAt && chat.lastMessageAt > item.lastActivityAt;
  return {
    ...item,
    lastActivityAt: storeAhead ? chat.lastMessageAt! : item.lastActivityAt,
    working: item.working || chat.isStreaming,
    title: chat.title || item.title,
  };
}

// ─── Search + order ─────────────────────────────────────────────────────

/** Case-insensitive substring match on the chat's title, its jobs' and its pull requests'. */
export function matchesControlPanelQuery(item: ControlPanelItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.title, ...item.jobs.map((j) => j.title), ...item.pullRequests.map((p) => p.title)].some((text) =>
    text.toLowerCase().includes(q),
  );
}

/** Newest activity first. Stable on ties so server order survives. */
export function sortByActivity<T extends { lastActivityAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

// ─── Day groups ─────────────────────────────────────────────────────────

export interface ControlPanelGroup {
  /** `YYYY-MM-DD` of the group's day, local time. */
  key: string;
  /** "Today", "Yesterday", or a short date ("Oct 13"). */
  label: string;
  items: ControlPanelItem[];
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
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** Chats grouped by the day of their newest activity, newest first. */
export function buildControlPanelGroups(items: ControlPanelItem[], now: Date = new Date()): ControlPanelGroup[] {
  const groups: ControlPanelGroup[] = [];
  for (const item of sortByActivity(items)) {
    const date = new Date(item.lastActivityAt);
    const key = localDayKey(date);
    const group = groups[groups.length - 1];
    if (group?.key === key) group.items.push(item);
    else groups.push({ key, label: dayLabel(date, now), items: [item] });
  }
  return groups;
}

// ─── Archive ────────────────────────────────────────────────────────────

/** Optimistic archive: the chat leaves Active for the top of Archive. */
export function moveChatToArchive(
  items: ControlPanelItem[],
  archivedItems: ControlPanelItem[],
  chatId: string,
  archivedAt: string,
): { items: ControlPanelItem[]; archivedItems: ControlPanelItem[] } {
  const chat = items.find((item) => item.id === chatId);
  if (!chat) return { items, archivedItems };
  return {
    items: items.filter((item) => item.id !== chatId),
    archivedItems: [{ ...chat, archivedAt }, ...archivedItems.filter((item) => item.id !== chatId)],
  };
}

/** Optimistic restore: the chat leaves Archive for the top of Active. */
export function moveChatToActive(
  items: ControlPanelItem[],
  archivedItems: ControlPanelItem[],
  chatId: string,
): { items: ControlPanelItem[]; archivedItems: ControlPanelItem[] } {
  const chat = archivedItems.find((item) => item.id === chatId);
  if (!chat) return { items, archivedItems };
  return {
    items: [{ ...chat, archivedAt: null }, ...items.filter((item) => item.id !== chatId)],
    archivedItems: archivedItems.filter((item) => item.id !== chatId),
  };
}

/** A chat other than the active one, with the label and start its stand-in row needs. */
export interface BackgroundChat {
  chat: ActiveChatSnapshot;
  title: string;
  /** Used for the stand-in row's day while the chat has no message yet. */
  startedAt: string;
}

type ControlPanelLists = { displayItems: ControlPanelItem[]; displayArchivedItems: ControlPanelItem[] };

/**
 * Place one live chat into Active or Archive without re-injecting an
 * archived chat into the active list. Overlay live store data onto whichever
 * row already holds it; only a brand-new chat (in neither list) is prepended
 * into Active.
 */
function placeLiveChat(
  lists: ControlPanelLists,
  chat: ActiveChatSnapshot,
  startedAt: string,
  title: string,
  canStandIn = true,
) {
  const { displayItems, displayArchivedItems } = lists;
  const id = chat.serverId ?? chat.localId;
  if (displayItems.some((item) => item.id === id)) {
    return {
      displayItems: displayItems.map((item) => (item.id === id ? overlayActiveChat(item, chat) : item)),
      displayArchivedItems,
    };
  }
  if (displayArchivedItems.some((item) => item.id === id)) {
    return {
      displayItems,
      displayArchivedItems: displayArchivedItems.map((item) => (item.id === id ? overlayActiveChat(item, chat) : item)),
    };
  }
  // An empty new chat has nothing to list yet; it gets its row with its first message.
  if (!chat.hasMessages || !canStandIn) return lists;
  return { displayItems: [activeChatItem(chat, startedAt, title), ...displayItems], displayArchivedItems };
}

/**
 * Place the active chat — and the other chats the store holds, which the
 * list fetch trails just the same (a reply the user switched away from, one
 * that just settled) — into Active or Archive. A chat appears once,
 * whichever way the store names it.
 */
export function resolveControlPanelLists(
  items: ControlPanelItem[],
  archivedItems: ControlPanelItem[],
  activeChat: ActiveChatSnapshot | null,
  opts: { startedAt: string; titleForNew: string; backgroundChats?: BackgroundChat[] },
): ControlPanelLists {
  let lists: ControlPanelLists = { displayItems: items, displayArchivedItems: archivedItems };
  const activeId = activeChat ? (activeChat.serverId ?? activeChat.localId) : null;
  const seen = new Set<string>();
  for (const { chat, title, startedAt } of opts.backgroundChats ?? []) {
    const id = chat.serverId ?? chat.localId;
    if (id === activeId || seen.has(id)) continue;
    seen.add(id);
    // Only a chat still replying stands in for a row the server has not listed; a settled one just
    // keeps its row current until the list catches up with it.
    lists = placeLiveChat(lists, chat, startedAt, title, chat.isStreaming);
  }
  return activeChat ? placeLiveChat(lists, activeChat, opts.startedAt, opts.titleForNew) : lists;
}
