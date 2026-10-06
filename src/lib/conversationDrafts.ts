/**
 * One unsent Jamie composer draft per conversation, kept on the device.
 *
 * The module-level map holds every draft for the session, including
 * ephemeral canvas slot ids (`conv-…`) and Ask Jamie's `__new__`.
 * `localStorage` is written only for real server conversation ids so an
 * unsent draft on a saved chat survives reload. Canvas mints a fresh
 * `conv-${Date.now()}…` on every `startConversation` and the Zustand
 * store is not persisted, so writing those keys (or `__new__`) would
 * orphan them.
 *
 * Composers must call `get` from mount / `useEffect` only — never during
 * render — so SSR never touches `localStorage`.
 */

export const NEW_CONVERSATION_KEY = "__new__";
export const DRAFT_PERSIST_DEBOUNCE_MS = 300;

const STORAGE_PREFIX = "jamie-draft:";
const ANON_USER_ID = "anon";

export interface DraftScope {
  /** Signed-in user id. `anon` is the in-memory path only. */
  userId: string | null | undefined;
  /** `org:{githubLogin}` or `ws:{slug}`. */
  scope: string;
  /**
   * Canvas: the stable Zustand local slot id. Ask Jamie: the loaded
   * server conversation id, or `__new__` while unsaved.
   */
  conversationKey: string;
}

export interface PendingAttachment {
  id: string;
  preview: string;
  filename: string;
  mimeType: string;
  size: number;
  uploading: boolean;
  error?: string;
  s3Path?: string;
  /** The original file, so a restored chip can retry an upload. */
  file?: File;
}

interface DraftRecord {
  text: string;
  /** Server id whose localStorage entry was copied into this memory key. */
  restoredFromServerId?: string;
}

const memory = new Map<string, DraftRecord>();
const files = new Map<string, PendingAttachment[]>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function draftStorageKey(scope: DraftScope): string {
  return `${STORAGE_PREFIX}${scope.userId || ANON_USER_ID}:${scope.scope}:${scope.conversationKey}`;
}

/**
 * Ephemeral keys must never hit `localStorage`. A real server id is
 * anything else (cuid, uuid, …) — canvas local slots always start with
 * `conv-`.
 */
export function isEphemeralConversationKey(conversationKey: string): boolean {
  return !conversationKey || conversationKey === NEW_CONVERSATION_KEY || conversationKey.startsWith("conv-");
}

export function isPersistableConversationId(conversationKey: string): boolean {
  if (!conversationKey) return false;
  if (conversationKey === NEW_CONVERSATION_KEY) return false;
  if (conversationKey.startsWith("conv-")) return false;
  return true;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStored(key: string): string {
  if (!canUseStorage()) return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStored(key: string, text: string): void {
  if (!canUseStorage()) return;
  try {
    if (text) window.localStorage.setItem(key, text);
    else window.localStorage.removeItem(key);
  } catch {
    // QuotaExceededError / private mode — the in-memory map already holds it.
  }
}

function cancelPersist(storageKey: string): void {
  const timer = persistTimers.get(storageKey);
  if (timer === undefined) return;
  clearTimeout(timer);
  persistTimers.delete(storageKey);
}

function schedulePersist(storageKey: string, text: string): void {
  cancelPersist(storageKey);
  const timer = setTimeout(() => {
    persistTimers.delete(storageKey);
    writeStored(storageKey, text);
  }, DRAFT_PERSIST_DEBOUNCE_MS);
  persistTimers.set(storageKey, timer);
}

/** Flush a debounced write now. Tests and unmount use this so a switch is not lost. */
export function flushDraftPersistence(scope?: DraftScope): void {
  const keys = scope ? [draftStorageKey(scope)] : [...persistTimers.keys()];
  for (const storageKey of keys) {
    const timer = persistTimers.get(storageKey);
    if (timer === undefined) continue;
    clearTimeout(timer);
    persistTimers.delete(storageKey);
    const record = memory.get(storageKey);
    writeStored(storageKey, record?.text ?? "");
  }
}

/**
 * Non-empty trimmed draft for this key, or `""`. Safe with no `window`
 * (returns the in-memory value, never throws). Does not read
 * `localStorage` unless `allowStorage` is set — composers pass that only
 * from an effect.
 */
export function getDraft(scope: DraftScope, opts?: { allowStorage?: boolean }): string {
  const storageKey = draftStorageKey(scope);
  const held = memory.get(storageKey);
  if (held) return held.text;
  if (!opts?.allowStorage) return "";
  if (!isPersistableConversationId(scope.conversationKey)) return "";
  const stored = readStored(storageKey).trim();
  if (!stored) return "";
  memory.set(storageKey, { text: stored });
  return stored;
}

/**
 * After a reload the canvas slot id is new, but the server id's
 * localStorage entry still holds the unsent text. Copy it into the
 * slot's memory key once. Later lookups stay on the slot id so
 * `setServerConversationId` cannot strand the composer.
 */
export function restoreDraftFromServerId(scope: DraftScope, serverId: string | null | undefined): string {
  const storageKey = draftStorageKey(scope);
  const held = memory.get(storageKey);
  if (held?.text) return held.text;
  if (held?.restoredFromServerId) return "";
  if (!serverId || !isPersistableConversationId(serverId)) {
    memory.set(storageKey, { text: "", restoredFromServerId: serverId ?? "" });
    return "";
  }
  const stored = readStored(draftStorageKey({ ...scope, conversationKey: serverId })).trim();
  memory.set(storageKey, { text: stored, restoredFromServerId: serverId });
  return stored;
}

/** Persist non-empty trimmed text. Empty deletes the key. `conv-*` / `__new__` stay in memory only. */
export function setDraft(scope: DraftScope, text: string): void {
  const storageKey = draftStorageKey(scope);
  const trimmed = text.trim();
  const previous = memory.get(storageKey);
  if (!trimmed) {
    memory.delete(storageKey);
    cancelPersist(storageKey);
    if (isPersistableConversationId(scope.conversationKey)) writeStored(storageKey, "");
    return;
  }
  memory.set(storageKey, { text: trimmed, restoredFromServerId: previous?.restoredFromServerId });
  if (!isPersistableConversationId(scope.conversationKey)) {
    cancelPersist(storageKey);
    return;
  }
  schedulePersist(storageKey, trimmed);
}

/** Drop the draft (and its localStorage entry, for a real server id). */
export function clearDraft(scope: DraftScope): void {
  setDraft(scope, "");
  if (!isPersistableConversationId(scope.conversationKey)) return;
  // A canvas slot also mirrored its text under the server id on save.
  // Callers that only know the slot id clear that key; the server-id
  // entry is cleared by `clearDraftForSlot` when the slot is discarded
  // or the send succeeds.
}

export function getPendingAttachments(conversationKey: string): PendingAttachment[] {
  return files.get(conversationKey) ?? [];
}

export function setPendingAttachments(conversationKey: string, next: PendingAttachment[]): void {
  if (next.length === 0) files.delete(conversationKey);
  else files.set(conversationKey, next);
}

/** Revoke preview URLs and drop the bag. Switch must not call this. */
export function discardPendingAttachments(conversationKey: string): void {
  const held = files.get(conversationKey);
  if (!held) return;
  for (const file of held) {
    if (file.preview) {
      try {
        URL.revokeObjectURL(file.preview);
      } catch {
        // jsdom / already revoked
      }
    }
  }
  files.delete(conversationKey);
}

export function slotHasDraft(scope: Omit<DraftScope, "conversationKey">, conversationKey: string): boolean {
  if (getDraft({ ...scope, conversationKey }).length > 0) return true;
  // A composer may have saved under anon before the session resolved, or
  // the header may check before it has a user id. Either key counts.
  if (scope.userId) return getDraft({ ...scope, userId: null, conversationKey }).length > 0;
  return false;
}

export function slotHasAttachments(conversationKey: string): boolean {
  return getPendingAttachments(conversationKey).length > 0;
}

/**
 * A local canvas slot the user has typed into or attached a file to.
 * Messages are the caller's concern — this only knows the local bags.
 */
export function slotIsTouched(
  scope: Omit<DraftScope, "conversationKey">,
  conversationKey: string,
  hasMessages: boolean,
): boolean {
  return hasMessages || slotHasDraft(scope, conversationKey) || slotHasAttachments(conversationKey);
}

/**
 * Clear both the slot-id memory key and, when the slot has adopted a
 * server id, that id's localStorage entry. Used on successful send and
 * explicit discard — not on switch.
 */
export function clearSlotDraft(
  scope: Omit<DraftScope, "conversationKey">,
  conversationKey: string,
  serverId?: string | null,
): void {
  clearDraft({ ...scope, conversationKey });
  if (scope.userId) clearDraft({ ...scope, userId: null, conversationKey });
  discardPendingAttachments(conversationKey);
  if (serverId && serverId !== conversationKey) {
    clearDraft({ ...scope, conversationKey: serverId });
    if (scope.userId) clearDraft({ ...scope, userId: null, conversationKey: serverId });
  }
}

/** Test-only. Production callers must not wipe another tab's drafts. */
export function resetConversationDraftsForTests(): void {
  for (const timer of persistTimers.values()) clearTimeout(timer);
  persistTimers.clear();
  memory.clear();
  for (const key of [...files.keys()]) discardPendingAttachments(key);
}
