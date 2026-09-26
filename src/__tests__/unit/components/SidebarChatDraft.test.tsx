// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarChat, SidebarChatActions } from "@/app/org/[githubLogin]/_components/SidebarChat";
import { useCanvasChatStore, type ConversationContext } from "@/app/org/[githubLogin]/_state/canvasChatStore";
import {
  getDraft,
  getPendingAttachments,
  resetConversationDraftsForTests,
  setDraft,
  setPendingAttachments,
} from "@/lib/conversationDrafts";
import { discardActiveUnsavedConversation, startNewOrgConversation } from "@/app/org/[githubLogin]/_state/openOrgConversation";

const sendMessage = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ id: "ws-1", slug: "hive" }),
}));

vi.mock("@/hooks/useCanvasAgentActivity", () => ({
  useCanvasAgentActivity: () => ({ isActive: false }),
}));

vi.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    transcript: "",
    isSupported: false,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    resetTranscript: vi.fn(),
  }),
}));

vi.mock("@/hooks/useControlKeyHold", () => ({ useControlKeyHold: vi.fn() }));
vi.mock("@/hooks/useVoiceCorrectionCapture", () => ({
  useVoiceCorrectionCapture: () => ({ capture: vi.fn() }),
}));
vi.mock("@/hooks/useVoiceLearningPreference", () => ({
  useVoiceLearningPreference: () => ({ nudgeIfNeeded: vi.fn() }),
}));
vi.mock("@/hooks/useFileDrop", () => ({
  useFileDrop: () => ({ isDragging: false, dragProps: {} }),
}));
vi.mock("@/lib/upload-image-to-s3", () => ({ uploadFileToS3: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/app/org/[githubLogin]/_state/useSendCanvasChatMessage", () => ({
  useSendCanvasChatMessage: () => sendMessage,
}));

vi.mock("@/app/org/[githubLogin]/_components/CanvasHistoryPopover", () => ({
  CanvasHistoryPopover: () => null,
}));
vi.mock("@/app/org/[githubLogin]/_components/CanvasAgentSettingsPopover", () => ({
  CanvasAgentSettingsPopover: () => null,
}));
vi.mock("@/components/dashboard/DashboardChat/StreamScrollIndicator", () => ({
  StreamScrollIndicator: () => null,
}));
vi.mock("framer-motion", () => ({
  motion: { div: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>, span: ({ children }: { children?: React.ReactNode }) => <span>{children}</span> },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const context: ConversationContext = {
  orgId: "org-1",
  githubLogin: "acme",
  workspaceSlug: null,
  workspaceSlugs: [],
  currentCanvasRef: "",
  currentCanvasBreadcrumb: "",
  selectedNodeId: null,
  selectedNodeIds: [],
};

function scope(conversationKey: string) {
  return { userId: "user-1", scope: "org:acme", conversationKey };
}

describe("SidebarChat composer drafts", () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    resetConversationDraftsForTests();
    sendMessage.mockReset();
    useCanvasChatStore.setState({
      conversations: {},
      activeConversationId: null,
      ephemeralSeedCounts: {},
      pendingInputDraft: null,
      draftRevision: 0,
    });
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:preview"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("remounting by activeId saves A's text and restores it without leaking into B", () => {
    const store = useCanvasChatStore.getState();
    const a = store.startConversation(context);
    store.startConversation(context);
    store.setActiveConversation(a);
    setDraft(scope(a), "");

    const { rerender } = render(<SidebarChat githubLogin="acme" />);
    fireEvent.change(screen.getByPlaceholderText(/Message/), { target: { value: "for A" } });

    const b = useCanvasChatStore.getState().conversations;
    const bId = Object.keys(b).find((id) => id !== a)!;
    act(() => {
      useCanvasChatStore.getState().setActiveConversation(bId);
    });
    rerender(<SidebarChat githubLogin="acme" />);

    expect(getDraft(scope(a))).toBe("for A");
    expect((screen.getByPlaceholderText(/Message/) as HTMLTextAreaElement).value).toBe("");

    act(() => {
      useCanvasChatStore.getState().setActiveConversation(a);
    });
    rerender(<SidebarChat githubLogin="acme" />);
    expect((screen.getByPlaceholderText(/Message/) as HTMLTextAreaElement).value).toBe("for A");
    expect(getDraft(scope(bId))).toBe("");
  });

  it("saves pending files on switch and does not revoke preview URLs", () => {
    const store = useCanvasChatStore.getState();
    const a = store.startConversation(context);
    const b = store.startConversation(context);
    store.setActiveConversation(a);
    setPendingAttachments(a, [
      { id: "f1", preview: "blob:keep", filename: "a.png", mimeType: "image/png", size: 4, uploading: false, s3Path: "k" },
    ]);

    const { rerender } = render(<SidebarChat githubLogin="acme" />);
    expect(screen.getByTestId("pending-file-f1")).toBeInTheDocument();

    act(() => useCanvasChatStore.getState().setActiveConversation(b));
    rerender(<SidebarChat githubLogin="acme" />);
    expect(screen.queryByTestId("pending-file-f1")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(getPendingAttachments(a).map((f) => f.id)).toEqual(["f1"]);
  });

  it("leaves text and files when send fails, and clears them when the first chunk arrives", async () => {
    const store = useCanvasChatStore.getState();
    const a = store.startConversation(context);
    let clearInput: (() => void) | undefined;
    sendMessage.mockImplementation(async (args: { onResponseStart?: () => void }) => {
      clearInput = args.onResponseStart;
      return Promise.reject(new Error("post failed"));
    });

    render(<SidebarChat githubLogin="acme" />);
    fireEvent.change(screen.getByPlaceholderText(/Message/), { target: { value: "retry me" } });
    fireEvent.click(screen.getByLabelText("Send"));

    await act(async () => {
      await Promise.resolve();
    });
    expect((screen.getByPlaceholderText(/Message/) as HTMLTextAreaElement).value).toBe("retry me");
    expect(getDraft(scope(a))).toBe("retry me");

    sendMessage.mockImplementation(async (args: { onResponseStart?: () => void }) => {
      args.onResponseStart?.();
    });
    fireEvent.click(screen.getByLabelText("Send"));
    await act(async () => {
      await Promise.resolve();
    });
    expect((screen.getByPlaceholderText(/Message/) as HTMLTextAreaElement).value).toBe("");
    expect(getDraft(scope(a))).toBe("");
    expect(clearInput).toBeTypeOf("function");
  });

  it("does not write a non-empty pendingInputDraft into the draft map", () => {
    const store = useCanvasChatStore.getState();
    const a = store.startConversation(context);
    store.setPendingInputDraft("prefill from connections");
    render(<SidebarChat githubLogin="acme" />);
    expect((screen.getByPlaceholderText(/Message/) as HTMLTextAreaElement).value).toBe("prefill from connections");
    expect(getDraft(scope(a))).toBe("");
    expect(useCanvasChatStore.getState().pendingInputDraft).toBeNull();
  });

  it("enables New for a draft-only slot and leaves that slot listed; Discard drops it", () => {
    const store = useCanvasChatStore.getState();
    const a = store.startConversation({ ...context });
    // The touched check uses the in-memory anon scope (userId null) so a
    // header that has not resolved the session still keeps the slot.
    setDraft({ userId: null, scope: "org:acme", conversationKey: a }, "unsent");
    setDraft(scope(a), "unsent");
    useCanvasChatStore.getState().bumpDraftRevision();

    render(<SidebarChatActions githubLogin="acme" draftUserId="user-1" />);
    const newButton = screen.getByLabelText("New chat");
    expect(newButton).not.toBeDisabled();

    fireEvent.click(newButton);
    const afterNew = useCanvasChatStore.getState();
    expect(afterNew.conversations[a]).toBeDefined();
    expect(afterNew.activeConversationId).not.toBe(a);
    expect(getDraft(scope(a))).toBe("unsent");

    afterNew.setActiveConversation(a);
    render(<SidebarChatActions githubLogin="acme" draftUserId="user-1" />);
    fireEvent.click(screen.getAllByLabelText("Discard chat")[0]);
    expect(useCanvasChatStore.getState().conversations[a]).toBeUndefined();
    expect(getDraft(scope(a))).toBe("");
    expect(getDraft({ userId: null, scope: "org:acme", conversationKey: a })).toBe("");
  });
});

describe("startNewOrgConversation touched slots", () => {
  beforeEach(() => {
    resetConversationDraftsForTests();
    useCanvasChatStore.setState({
      conversations: {},
      activeConversationId: null,
      ephemeralSeedCounts: {},
      pendingInputDraft: null,
    });
  });

  it("reuses an untouched empty slot and mints a new one when the slot has a draft or files", () => {
    const store = useCanvasChatStore.getState();
    const empty = store.startConversation({ ...context, githubLogin: "acme" });
    expect(startNewOrgConversation("acme")).toBe(empty);
    expect(Object.keys(useCanvasChatStore.getState().conversations)).toHaveLength(1);

    setDraft({ userId: null, scope: "org:acme", conversationKey: empty }, "typed");
    const next = startNewOrgConversation("acme");
    expect(next).not.toBe(empty);
    expect(useCanvasChatStore.getState().conversations[empty]).toBeDefined();

    setPendingAttachments(next, [
      { id: "f", preview: "blob:x", filename: "x.png", mimeType: "image/png", size: 1, uploading: false },
    ]);
    const third = startNewOrgConversation("acme");
    expect(third).not.toBe(next);
    expect(useCanvasChatStore.getState().conversations[next]).toBeDefined();
    discardActiveUnsavedConversation("acme");
  });
});
