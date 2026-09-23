"use client";

import { useEffect, useState } from "react";

/**
 * Per-conversation unsent Jamie composer drafts.
 *
 * A module-level Map holds every draft for the session, including
 * ephemeral local ids (`conv-*`) and `__new__`. `localStorage` is written
 * only for real server conversation ids so unsent text on saved chats
 * survives reload. Never write `conv-*` or `__new__` to storage — those
 * ids are minted fresh each session.
 *
 * Call `getDraft` from mount/`useEffect` only — never during render.
 */

export const NEW_CONVERSATION_KEY = "__new__";
export const DRAFT_PERSIST_DEBOUNCE_MS = 300;
export const ANON_USER_ID = "anon";

export type DraftScope = `org:${string}` | `ws:${string}`;

export interface DraftRef {
  userId: string;
  scope: DraftScope;
  conversationKey: string;
}

const MEMORY = new Map<string, string>();
const FILE_BAG = new Map<string, unknown[]>();
const PENDING_WRITES = new Map<string, { timer: ReturnType<typeof setTimeout>; value: string }>();
const DISCARDED_KEYS = new Set<string>();
const LISTENERS = new Set<() => void>();

export function orgDraftScope(githubLogin: string): DraftScope {
  return `org:${githubLogin}`;
}

export function workspaceDraftScope(slug: string): DraftScope {
  return `ws:${slug}`;
}

export function draftStorageKey(ref: DraftRef): string {
  return `jamie-draft:${ref.userId}:${ref.scope}:${ref.conversationKey}`;
}

export function isEphemeralConversationKey(conversationKey: string): boolean {
  return conversationKey === NEW_CONVERSATION_KEY || conversationKey.startsWith("conv-");
}

function notifyDrafts(): void {
  for (const listener of LISTENERS) listener();
}

export function subscribeConversationDrafts(listener: () => void): () => void {
  LISTENERS.add(listener);
  return () => {
    LISTENERS.delete(listener);
  };
}

/** Subscribe to draft-map changes. Safe to call from client components. */
export function useConversationDraftsVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeConversationDrafts(() => setVersion((v) => v + 1)), []);
  return version;
}

function cancelPendingWrite(storageKey: string): void {
  const pending = PENDING_WRITES.get(storageKey);
  if (pending) {
    clearTimeout(pending.timer);
    PENDING_WRITES.delete(storageKey);
  }
}

function readLocalStorage(storageKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeLocalStorage(storageKey: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // QuotaExceededError or storage unavailable — memory is the fallback.
  }
}

function removeLocalStorage(storageKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
}

function persistStorageKey(ref: DraftRef, persistAs?: string | null): string | null {
  if (ref.userId === ANON_USER_ID) return null;
  const persistKey = persistAs || ref.conversationKey;
  if (!persistKey || isEphemeralConversationKey(persistKey)) return null;
  return draftStorageKey({ ...ref, conversationKey: persistKey });
}

function schedulePersist(storageKey: string, value: string): void {
  cancelPendingWrite(storageKey);
  const timer = setTimeout(() => {
    PENDING_WRITES.delete(storageKey);
    writeLocalStorage(storageKey, value);
  }, DRAFT_PERSIST_DEBOUNCE_MS);
  PENDING_WRITES.set(storageKey, { timer, value });
}

function memoryValueForConversationKey(conversationKey: string): string {
  const suffix = `:${conversationKey}`;
  for (const [key, value] of MEMORY) {
    if (key.endsWith(suffix) && value.trim()) return value;
  }
  return "";
}

function deleteMemoryForConversationKey(conversationKey: string): void {
  const suffix = `:${conversationKey}`;
  for (const key of [...MEMORY.keys()]) {
    if (key.endsWith(suffix)) MEMORY.delete(key);
  }
}

export function getDraft(ref: DraftRef): string {
  const key = draftStorageKey(ref);
  const cached = MEMORY.get(key);
  if (cached !== undefined) return cached;
  if (isEphemeralConversationKey(ref.conversationKey)) return "";
  const stored = readLocalStorage(key);
  if (stored && stored.trim()) {
    MEMORY.set(key, stored);
    return stored;
  }
  return "";
}

export function hasDraft(ref: DraftRef): boolean {
  return getDraft(ref).trim().length > 0;
}

export function setDraft(ref: DraftRef, text: string, persistAs?: string | null): void {
  if (DISCARDED_KEYS.has(ref.conversationKey)) {
    if (!text.trim()) DISCARDED_KEYS.delete(ref.conversationKey);
    return;
  }

  const key = draftStorageKey(ref);
  const trimmed = text.trim();
  const persistKey = persistStorageKey(ref, persistAs);

  if (!trimmed) {
    const had = MEMORY.delete(key);
    if (persistKey) {
      cancelPendingWrite(persistKey);
      removeLocalStorage(persistKey);
    }
    if (had) notifyDrafts();
    return;
  }

  const prev = MEMORY.get(key);
  MEMORY.set(key, trimmed);
  if (persistKey) schedulePersist(persistKey, trimmed);
  if (prev !== trimmed) notifyDrafts();
}

export function clearDraft(ref: DraftRef, persistAs?: string | null): void {
  DISCARDED_KEYS.delete(ref.conversationKey);
  const key = draftStorageKey(ref);
  const had = MEMORY.delete(key);
  const persistKey = persistStorageKey(ref, persistAs);
  if (persistKey) {
    cancelPendingWrite(persistKey);
    removeLocalStorage(persistKey);
  }
  if (had) notifyDrafts();
}

/**
 * After reload a saved chat mints a fresh `conv-*` slot. Copy the
 * server-id localStorage entry into that slot's memory key without
 * changing the composer's lookup key.
 */
export function adoptServerDraft(slotRef: DraftRef, serverConversationId: string): string {
  const existing = getDraft(slotRef);
  if (existing.trim()) return existing;
  if (!serverConversationId || isEphemeralConversationKey(serverConversationId)) return "";
  const fromServer = getDraft({ ...slotRef, conversationKey: serverConversationId });
  if (!fromServer.trim()) return "";
  MEMORY.set(draftStorageKey(slotRef), fromServer);
  notifyDrafts();
  return fromServer;
}

export function getDraftFiles<T>(conversationKey: string): T[] {
  const files = FILE_BAG.get(conversationKey);
  return files ? ([...files] as T[]) : [];
}

export function hasDraftFiles(conversationKey: string): boolean {
  return (FILE_BAG.get(conversationKey)?.length ?? 0) > 0;
}

export function setDraftFiles<T>(conversationKey: string, files: T[]): void {
  if (DISCARDED_KEYS.has(conversationKey)) return;
  const prevLen = FILE_BAG.get(conversationKey)?.length ?? 0;
  if (!files.length) {
    FILE_BAG.delete(conversationKey);
    if (prevLen > 0) notifyDrafts();
    return;
  }
  FILE_BAG.set(conversationKey, [...files]);
  if (prevLen !== files.length) notifyDrafts();
}

export function hasLocalUnsavedState(conversationKey: string): boolean {
  return memoryValueForConversationKey(conversationKey).length > 0 || hasDraftFiles(conversationKey);
}

export function localDraftPreview(conversationKey: string): string {
  return memoryValueForConversationKey(conversationKey);
}

/** Ignore a trailing unmount-save after Discard drops this slot. */
export function markConversationKeyDiscarded(conversationKey: string): void {
  DISCARDED_KEYS.add(conversationKey);
  deleteMemoryForConversationKey(conversationKey);
  const files = FILE_BAG.get(conversationKey) ?? [];
  for (const file of files) {
    const preview = (file as { preview?: string }).preview;
    if (preview) {
      try {
        URL.revokeObjectURL(preview);
      } catch {
        // ignore
      }
    }
  }
  FILE_BAG.delete(conversationKey);
  notifyDrafts();
}

export function isConversationTouched(conversationKey: string): boolean {
  return hasLocalUnsavedState(conversationKey);
}

/** Test-only: drop maps, timers, and discarded markers. */
export function resetConversationDraftsForTests(): void {
  MEMORY.clear();
  FILE_BAG.clear();
  DISCARDED_KEYS.clear();
  for (const pending of PENDING_WRITES.values()) clearTimeout(pending.timer);
  PENDING_WRITES.clear();
}

export function flushDraftPersistenceForTests(): void {
  for (const [key, pending] of PENDING_WRITES) {
    clearTimeout(pending.timer);
    writeLocalStorage(key, pending.value);
    PENDING_WRITES.delete(key);
  }
}

export function flushDraft(ref: DraftRef, persistAs?: string | null): void {
  const persistKey = persistStorageKey(ref, persistAs);
  if (!persistKey) return;
  const pending = PENDING_WRITES.get(persistKey);
  cancelPendingWrite(persistKey);
  const value = pending?.value ?? MEMORY.get(draftStorageKey(ref));
  if (value?.trim()) writeLocalStorage(persistKey, value);
}
