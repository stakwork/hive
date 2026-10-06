// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAFT_PERSIST_DEBOUNCE_MS,
  NEW_CONVERSATION_KEY,
  clearDraft,
  clearSlotDraft,
  discardPendingAttachments,
  draftStorageKey,
  flushDraftPersistence,
  getDraft,
  getPendingAttachments,
  isPersistableConversationId,
  resetConversationDraftsForTests,
  restoreDraftFromServerId,
  setDraft,
  setPendingAttachments,
  slotIsTouched,
} from "@/lib/conversationDrafts";

const org = (userId: string, conversationKey: string) => ({
  userId,
  scope: "org:acme",
  conversationKey,
});

describe("conversationDrafts", () => {
  beforeEach(() => {
    resetConversationDraftsForTests();
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetConversationDraftsForTests();
  });

  it("puts userId, scope and conversationKey in the storage key", () => {
    expect(draftStorageKey(org("user-a", "srv-1"))).toBe("jamie-draft:user-a:org:acme:srv-1");
    expect(draftStorageKey({ userId: null, scope: "ws:hive", conversationKey: "srv-1" })).toBe(
      "jamie-draft:anon:ws:hive:srv-1",
    );
  });

  it("does not persist an empty or whitespace draft", () => {
    setDraft(org("user-a", "srv-1"), "   ");
    flushDraftPersistence();
    expect(getDraft(org("user-a", "srv-1"))).toBe("");
    expect(localStorage.getItem(draftStorageKey(org("user-a", "srv-1")))).toBeNull();
  });

  it("keeps A and B separate across a switch", () => {
    setDraft(org("user-a", "conv-a"), "alpha");
    setDraft(org("user-a", "conv-b"), "beta");
    expect(getDraft(org("user-a", "conv-a"))).toBe("alpha");
    expect(getDraft(org("user-a", "conv-b"))).toBe("beta");
    setDraft(org("user-a", "conv-a"), "alpha again");
    expect(getDraft(org("user-a", "conv-b"))).toBe("beta");
  });

  it("never writes conv-* or __new__ to localStorage; server ids are debounced", () => {
    setDraft(org("user-a", "conv-123"), "local slot");
    setDraft(org("user-a", NEW_CONVERSATION_KEY), "unsaved ask");
    setDraft(org("user-a", "srv-1"), "saved chat");
    expect(localStorage.length).toBe(0);
    expect(getDraft(org("user-a", "conv-123"))).toBe("local slot");
    expect(getDraft(org("user-a", NEW_CONVERSATION_KEY))).toBe("unsaved ask");

    vi.advanceTimersByTime(DRAFT_PERSIST_DEBOUNCE_MS);
    expect(localStorage.getItem(draftStorageKey(org("user-a", "srv-1")))).toBe("saved chat");
    expect(localStorage.getItem(draftStorageKey(org("user-a", "conv-123")))).toBeNull();
    expect(localStorage.getItem(draftStorageKey(org("user-a", NEW_CONVERSATION_KEY)))).toBeNull();
  });

  it("does not leak drafts across userIds on the same browser", () => {
    setDraft(org("user-a", "srv-1"), "a only");
    expect(getDraft(org("user-b", "srv-1"))).toBe("");
    expect(isPersistableConversationId("conv-1")).toBe(false);
    expect(isPersistableConversationId(NEW_CONVERSATION_KEY)).toBe(false);
    expect(isPersistableConversationId("srv-1")).toBe(true);
  });

  it("get is safe with no window and does not read storage during a plain get", () => {
    const storage = window.localStorage;
    vi.stubGlobal("window", undefined);
    expect(() => getDraft(org("user-a", "srv-1"))).not.toThrow();
    expect(getDraft(org("user-a", "srv-1"))).toBe("");
    vi.stubGlobal("window", { localStorage: storage });
  });

  it("restores a server-id localStorage entry into a new slot memory key once", () => {
    localStorage.setItem(draftStorageKey(org("user-a", "srv-1")), "still typing");
    const restored = restoreDraftFromServerId(org("user-a", "conv-new"), "srv-1");
    expect(restored).toBe("still typing");
    expect(getDraft(org("user-a", "conv-new"))).toBe("still typing");
    localStorage.setItem(draftStorageKey(org("user-a", "srv-1")), "later edit");
    expect(restoreDraftFromServerId(org("user-a", "conv-new"), "srv-1")).toBe("still typing");
  });

  it("clear drops the memory key and the server-id localStorage entry", () => {
    setDraft(org("user-a", "srv-1"), "gone soon");
    flushDraftPersistence(org("user-a", "srv-1"));
    expect(localStorage.getItem(draftStorageKey(org("user-a", "srv-1")))).toBe("gone soon");
    clearDraft(org("user-a", "srv-1"));
    expect(getDraft(org("user-a", "srv-1"))).toBe("");
    expect(localStorage.getItem(draftStorageKey(org("user-a", "srv-1")))).toBeNull();
  });

  it("keeps attachments in memory, keyed by conversation, and revokes only on discard", () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", { ...URL, revokeObjectURL: revoke });
    setPendingAttachments("conv-a", [
      { id: "f1", preview: "blob:a", filename: "a.png", mimeType: "image/png", size: 1, uploading: false },
    ]);
    setPendingAttachments("conv-b", [
      { id: "f2", preview: "blob:b", filename: "b.png", mimeType: "image/png", size: 1, uploading: false },
    ]);
    expect(getPendingAttachments("conv-a").map((f) => f.id)).toEqual(["f1"]);
    expect(revoke).not.toHaveBeenCalled();
    discardPendingAttachments("conv-a");
    expect(revoke).toHaveBeenCalledWith("blob:a");
    expect(getPendingAttachments("conv-a")).toEqual([]);
    expect(getPendingAttachments("conv-b")).toHaveLength(1);
  });

  it("treats a draft or files as touched even with no messages", () => {
    const scope = { userId: "user-a", scope: "org:acme" };
    expect(slotIsTouched(scope, "conv-a", false)).toBe(false);
    setDraft({ ...scope, conversationKey: "conv-a" }, "hi");
    expect(slotIsTouched(scope, "conv-a", false)).toBe(true);
    clearSlotDraft(scope, "conv-a");
    setPendingAttachments("conv-b", [
      { id: "f", preview: "blob:b", filename: "b.png", mimeType: "image/png", size: 1, uploading: false },
    ]);
    expect(slotIsTouched(scope, "conv-b", false)).toBe(true);
  });

  it("falls back to memory when localStorage throws", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    setDraft(org("user-a", "srv-1"), "kept");
    flushDraftPersistence(org("user-a", "srv-1"));
    expect(getDraft(org("user-a", "srv-1"))).toBe("kept");
    setItem.mockRestore();
  });
});
