"use client";

/**
 * Load a stored org-canvas conversation from the server and make it the
 * active conversation in the canvas chat store.
 *
 * Shared by every "open this chat" affordance on the org page — the
 * history popover, the automations inbox, the control panel and a
 * plan's "View in Chat" — so they all hydrate messages the same way and
 * never re-save what the server already holds
 * (`ephemeralSeedCount = messages.length`).
 *
 * A conversation this tab already holds is switched to, never fetched
 * into a second slot: its reply may still be streaming into the slot it
 * has, and the live-sync skips the server rows of turns this tab authored
 * on the assumption they are on screen — a fresh copy would show
 * "No reply yet" for good. The live-sync catches the slot up on
 * activation.
 *
 * Returns `true` when the conversation is now active, `false` on any
 * failure (callers leave their own UI state untouched in that case).
 */
import { clearSlotDraft, slotHasAttachments, slotHasDraft } from "@/lib/conversationDrafts";
import { useCanvasChatStore, type CanvasChatMessage } from "./canvasChatStore";

export interface OpenOrgConversationOptions {
  /**
   * Mirror the opened id into `?chat=<id>` (via `history.replaceState`,
   * never a router navigation — see CANVAS.md "Deep links") so the
   * conversation is shareable and survives a refresh. Skipped when a
   * concurrent open won the race for the active slot.
   */
  syncUrl?: boolean;
  /** Fire-and-forget `POST .../seen` so the unread marker clears on the next list load. */
  markSeen?: boolean;
}

interface RawStoredMessage {
  id?: string;
  role?: string;
  content?: unknown;
  timestamp?: string;
  toolCalls?: CanvasChatMessage["toolCalls"];
  timeline?: CanvasChatMessage["timeline"];
  artifactIds?: string[];
  attachments?: CanvasChatMessage["attachments"];
  approval?: CanvasChatMessage["approval"];
  rejection?: CanvasChatMessage["rejection"];
  approvalResult?: CanvasChatMessage["approvalResult"];
  deferredCheck?: CanvasChatMessage["deferredCheck"];
  source?: CanvasChatMessage["source"];
}

function toCanvasMessages(raw: unknown): CanvasChatMessage[] {
  const rows: unknown[] = Array.isArray(raw) ? raw : [];
  return rows
    .filter(
      (m): m is RawStoredMessage =>
        !!m &&
        typeof m === "object" &&
        ((m as RawStoredMessage).role === "user" || (m as RawStoredMessage).role === "assistant"),
    )
    .map((m, idx) => ({
      id: m.id || `loaded-${idx}`,
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : "",
      timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
      toolCalls: m.toolCalls,
      timeline: m.timeline,
      artifactIds: m.artifactIds,
      attachments: m.attachments,
      approval: m.approval,
      rejection: m.rejection,
      approvalResult: m.approvalResult,
      deferredCheck: m.deferredCheck,
      source: m.source,
    }));
}

type ConversationContext = Parameters<ReturnType<typeof useCanvasChatStore.getState>["startConversation"]>[0];

/** The context for a conversation started before any has been (e.g. the panel is still loading). */
function fallbackContext(githubLogin: string, workspaceSlugs: string[] = []): ConversationContext {
  return {
    orgId: "",
    githubLogin,
    workspaceSlug: null,
    workspaceSlugs,
    currentCanvasRef: "",
    currentCanvasBreadcrumb: "",
    selectedNodeId: null,
    selectedNodeIds: [],
  };
}

/** Mirror `conversationId` into `?chat=` (no-op when it is already there). */
function setChatParam(conversationId: string): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get("chat") === conversationId) return;
  params.set("chat", conversationId);
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function markSeen(githubLogin: string, conversationId: string): void {
  void fetch(`/api/orgs/${githubLogin}/chat/conversations/${conversationId}/seen`, { method: "POST" }).catch(() => {});
}

/**
 * The slot already holding `conversationId`, if any. Should a tab hold
 * two (opens from before slots were reused), the fuller one wins — it is
 * the one with the reply in flight.
 */
function openSlotFor(conversationId: string): string | null {
  const { conversations } = useCanvasChatStore.getState();
  // A history click on an unsaved slot passes the Zustand id (`conv-…`).
  // Match that before the server id so we never GET a local id.
  if (conversations[conversationId]) return conversationId;
  let best: { id: string; size: number } | null = null;
  for (const conv of Object.values(conversations)) {
    if (conv.serverConversationId !== conversationId) continue;
    const size = conv.messages?.length ?? 0;
    if (!best || size >= best.size) best = { id: conv.id, size };
  }
  return best?.id ?? null;
}

/** Scope for this org's composer drafts. userId is filled in by the composer; touched checks are in-memory. */
function orgDraftScope(githubLogin: string) {
  return { userId: null, scope: `org:${githubLogin}` };
}

function dropChatParam(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("chat")) return;
  params.delete("chat");
  const qs = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
}

/**
 * True when `conversationId` is a Zustand slot id (`conv-…`) rather than
 * a server `SharedConversation` id. Local history clicks must switch,
 * never fetch.
 */
export function isLocalCanvasSlotId(conversationId: string): boolean {
  return conversationId.startsWith("conv-") && !!useCanvasChatStore.getState().conversations[conversationId];
}

/**
 * Open a control-panel / history row. A Zustand slot id (`conv-…`) is
 * switched to in place — never fetched. A server id goes through
 * `openOrgConversation`. Returns whether the row is now the active chat.
 */
export async function openControlPanelChat(
  githubLogin: string,
  itemId: string,
  opts: OpenOrgConversationOptions = {},
): Promise<boolean> {
  if (isLocalCanvasSlotId(itemId)) {
    const store = useCanvasChatStore.getState();
    if (store.activeConversationId !== itemId) store.setActiveConversation(itemId);
    return true;
  }
  return openOrgConversation(githubLogin, itemId, opts);
}

export async function openOrgConversation(
  githubLogin: string,
  conversationId: string,
  opts: OpenOrgConversationOptions = {},
): Promise<boolean> {
  const held = openSlotFor(conversationId);
  if (held) {
    const store = useCanvasChatStore.getState();
    if (store.activeConversationId !== held) store.setActiveConversation(held);
    const serverId = store.conversations[held]?.serverConversationId;
    // A local unsaved slot has no shareable server id — don't write `conv-…` into `?chat=`.
    if (opts.syncUrl && typeof window !== "undefined" && serverId) setChatParam(serverId);
    if (opts.markSeen && serverId) markSeen(githubLogin, serverId);
    return true;
  }

  try {
    const res = await fetch(`/api/orgs/${githubLogin}/chat/conversations/${conversationId}`);
    if (!res.ok) return false;
    const conv = await res.json();
    const messages = toCanvasMessages(conv.messages);

    const store = useCanvasChatStore.getState();
    const activeId = store.activeConversationId;
    const context = activeId ? store.conversations[activeId]?.context : undefined;

    const newId = store.startConversation(
      context ?? fallbackContext(githubLogin, conv.settings?.extraWorkspaceSlugs ?? []),
      messages,
      undefined,
      messages.length, // already persisted — never re-save
      conversationId,
      typeof conv.title === "string" ? conv.title : null,
    );

    if (opts.syncUrl && typeof window !== "undefined") {
      // The isActive guard handles two rapid opens resolving out of order.
      const isActive = useCanvasChatStore.getState().activeConversationId === newId;
      if (isActive) setChatParam(conversationId);
    }

    if (opts.markSeen) markSeen(githubLogin, conversationId);

    return true;
  } catch {
    return false;
  }
}

/**
 * Start a fresh, empty conversation in its own slot — never wiping the
 * active one in place, so an in-flight stream on the previous chat keeps
 * writing to its own slot and can't bleed into the new one — and drop
 * `?chat=` so a refresh lands in the new chat rather than the old one.
 * An untouched fresh chat already on stage is what "new" means, so it is
 * reused rather than stacked. A slot with a draft or pending files is
 * touched — New switches away and leaves it listed; it is not discard.
 * Either way the composer takes focus (the store's draft hand-off; an
 * empty draft only focuses). Returns the local conversation id.
 */
export function startNewOrgConversation(githubLogin: string): string {
  const store = useCanvasChatStore.getState();
  const activeId = store.activeConversationId;
  const active = activeId ? store.conversations[activeId] : undefined;
  const scope = orgDraftScope(githubLogin);
  const hasDraft = !!active && slotHasDraft(scope, active.id);
  const hasFiles = !!active && slotHasAttachments(active.id);
  const untouched =
    !!active && !active.serverConversationId && (active.messages?.length ?? 0) === 0 && !hasDraft && !hasFiles;
  const id = untouched
    ? active.id
    : store.startConversation(active?.context ?? fallbackContext(githubLogin), [], undefined, 0);
  dropChatParam();
  store.setPendingInputDraft("");
  return id;
}

/**
 * Explicit Discard of the active unsaved slot: drop it, clear its draft
 * and file bag (revoking preview URLs), and focus a fresh empty composer.
 * Switching away must not call this. A saved chat (`serverConversationId`
 * set) is not discardable — New switches away instead.
 */
export function discardActiveUnsavedConversation(githubLogin: string, userId?: string | null): void {
  const store = useCanvasChatStore.getState();
  const activeId = store.activeConversationId;
  const active = activeId ? store.conversations[activeId] : undefined;
  if (!active || active.serverConversationId) return;
  clearSlotDraft({ userId: userId ?? null, scope: `org:${githubLogin}` }, active.id, null);
  const context = active.context;
  store.removeConversation(active.id);
  store.startConversation(context ?? fallbackContext(githubLogin), [], undefined, 0);
  dropChatParam();
  store.setPendingInputDraft("");
}
