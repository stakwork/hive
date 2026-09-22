// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANON_USER_ID,
  DRAFT_PERSIST_DEBOUNCE_MS,
  NEW_CONVERSATION_KEY,
  adoptServerDraft,
  clearDraft,
  draftStorageKey,
  flushDraftPersistenceForTests,
  getDraft,
  getDraftFiles,
  hasDraft,
  hasLocalUnsavedState,
  isEphemeralConversationKey,
  orgDraftScope,
  resetConversationDraftsForTests,
  setDraft,
  setDraftFiles,
  workspaceDraftScope,
} from "@/lib/conversationDrafts";

const userA = "user-a";
const userB = "user-b";
const orgScope = orgDraftScope("acme");
const wsScope = workspaceDraftScope("hive");

function ref(userId: string, conversationKey: string, scope = orgScope) {
  return { userId, scope, conversationKey };
}

describe("conversationDrafts", () => {
  beforeEach(() => {
    resetConversationDraftsForTests();
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetConversationDraftsForTests();
    window.localStorage.clear();
  });

  it("get/set/clear round-trips non-empty trimmed text", () => {
    setDraft(ref(userA, "srv-1"), "  hello  ");
    expect(getDraft(ref(userA, "srv-1"))).toBe("hello");
    clearDraft(ref(userA, "srv-1"));
    expect(getDraft(ref(userA, "srv-1"))).toBe("");
  });

  it("switch A→B→A restores A and does not leak into B", () => {
    setDraft(ref(userA, "conv-a"), "draft A");
    setDraft(ref(userA, "conv-b"), "draft B");
    expect(getDraft(ref(userA, "conv-a"))).toBe("draft A");
    expect(getDraft(ref(userA, "conv-b"))).toBe("draft B");
  });

  it("does not store an empty string", () => {
    setDraft(ref(userA, "srv-1"), "hello");
    setDraft(ref(userA, "srv-1"), "   ");
    expect(getDraft(ref(userA, "srv-1"))).toBe("");
    vi.advanceTimersByTime(DRAFT_PERSIST_DEBOUNCE_MS);
    expect(window.localStorage.getItem(draftStorageKey(ref(userA, "srv-1")))).toBeNull();
  });

  it("never writes conv-* or __new__ to localStorage", () => {
    setDraft(ref(userA, "conv-abc123"), "local slot");
    setDraft(ref(userA, NEW_CONVERSATION_KEY, wsScope), "new chat");
    vi.advanceTimersByTime(DRAFT_PERSIST_DEBOUNCE_MS);
    flushDraftPersistenceForTests();
    expect(window.localStorage.length).toBe(0);
    expect(getDraft(ref(userA, "conv-abc123"))).toBe("local slot");
    expect(getDraft(ref(userA, NEW_CONVERSATION_KEY, wsScope))).toBe("new chat");
  });

  it("writes server-id keys to localStorage after debounce", () => {
    setDraft(ref(userA, "srv-42"), "saved chat draft");
    expect(window.localStorage.getItem(draftStorageKey(ref(userA, "srv-42")))).toBeNull();
    vi.advanceTimersByTime(DRAFT_PERSIST_DEBOUNCE_MS);
    expect(window.localStorage.getItem(draftStorageKey(ref(userA, "srv-42")))).toBe("saved chat draft");
  });

  it("get is safe with no window", () => {
    const original = globalThis.window;
    // Simulate SSR: getDraft must not throw when localStorage is unavailable.
    vi.stubGlobal("window", undefined as unknown as Window);
    expect(() => getDraft(ref(userA, "srv-1"))).not.toThrow();
    vi.stubGlobal("window", original);
  });

  it("includes userId in the key so accounts do not leak drafts", () => {
    setDraft(ref(userA, "srv-1"), "alice");
    setDraft(ref(userB, "srv-1"), "bob");
    expect(getDraft(ref(userA, "srv-1"))).toBe("alice");
    expect(getDraft(ref(userB, "srv-1"))).toBe("bob");
    vi.advanceTimersByTime(DRAFT_PERSIST_DEBOUNCE_MS);
    expect(window.localStorage.getItem(draftStorageKey(ref(userA, "srv-1")))).toBe("alice");
    expect(window.localStorage.getItem(draftStorageKey(ref(userB, "srv-1")))).toBe("bob");
  });

  it("does not persist anon drafts to localStorage", () => {
    setDraft(ref(ANON_USER_ID, "srv-1"), "anon text");
    vi.advanceTimersByTime(DRAFT_PERSIST_DEBOUNCE_MS);
    expect(window.localStorage.length).toBe(0);
    expect(getDraft(ref(ANON_USER_ID, "srv-1"))).toBe("anon text");
  });

  it("adopts a server-id localStorage draft into a new conv-* slot after reload", () => {
    const storageKey = draftStorageKey(ref(userA, "srv-99"));
    window.localStorage.setItem(storageKey, "unsent after reload");
    const slot = ref(userA, "conv-fresh");
    const adopted = adoptServerDraft(slot, "srv-99");
    expect(adopted).toBe("unsent after reload");
    expect(getDraft(slot)).toBe("unsent after reload");
  });

  it("keeps a canvas draft on the conv-* key when persistAs is a server id", () => {
    const slot = ref(userA, "conv-live");
    setDraft(slot, "still typing", "srv-live");
    expect(getDraft(slot)).toBe("still typing");
    expect(getDraft(ref(userA, "srv-live"))).toBe("");
    vi.advanceTimersByTime(DRAFT_PERSIST_DEBOUNCE_MS);
    expect(window.localStorage.getItem(draftStorageKey(ref(userA, "srv-live")))).toBe("still typing");
    expect(window.localStorage.getItem(draftStorageKey(slot))).toBeNull();
  });

  it("file bag is in-memory only and keyed by conversationKey", () => {
    setDraftFiles("conv-a", [{ id: "f1" }]);
    expect(getDraftFiles("conv-a")).toEqual([{ id: "f1" }]);
    expect(getDraftFiles("conv-b")).toEqual([]);
    expect(hasLocalUnsavedState("conv-a")).toBe(true);
    expect(hasLocalUnsavedState("conv-b")).toBe(false);
  });

  it("hasDraft is false for empty and true for stored text", () => {
    expect(hasDraft(ref(userA, "srv-1"))).toBe(false);
    setDraft(ref(userA, "srv-1"), "x");
    expect(hasDraft(ref(userA, "srv-1"))).toBe(true);
  });

  it("identifies ephemeral conversation keys", () => {
    expect(isEphemeralConversationKey("conv-abc")).toBe(true);
    expect(isEphemeralConversationKey(NEW_CONVERSATION_KEY)).toBe(true);
    expect(isEphemeralConversationKey("clxyz123")).toBe(false);
  });
});
