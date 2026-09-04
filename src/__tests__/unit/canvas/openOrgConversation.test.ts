// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasChatStore, type ConversationContext } from "@/app/org/[githubLogin]/_state/canvasChatStore";
import { openOrgConversation } from "@/app/org/[githubLogin]/_state/openOrgConversation";

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

const serverConversation = (messages: unknown[]) =>
  new Response(JSON.stringify({ messages, settings: {} }), { status: 200 });

const userMessage = (id: string) => ({
  id,
  role: "user" as const,
  content: `message ${id}`,
  timestamp: new Date("2026-09-04T10:00:00Z"),
});

describe("openOrgConversation", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    useCanvasChatStore.setState({ conversations: {}, activeConversationId: null, ephemeralSeedCounts: {} });
    window.history.replaceState(null, "", "/org/acme");
  });

  it("switches to the slot already holding the conversation instead of fetching a copy", async () => {
    const store = useCanvasChatStore.getState();
    // The chat whose reply is still streaming into its own slot.
    const held = store.startConversation(context, [userMessage("u1")], undefined, 1, "srv-a");
    store.setIsStreaming(held, true);
    // The user moved on to another chat, then comes back to the first.
    store.startConversation(context, [], undefined, 0, "srv-b");

    const opened = await openOrgConversation("acme", "srv-a", { syncUrl: true });

    expect(opened).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    const state = useCanvasChatStore.getState();
    expect(state.activeConversationId).toBe(held);
    expect(Object.keys(state.conversations)).toHaveLength(2);
    expect(state.conversations[held].isStreaming).toBe(true);
    expect(new URLSearchParams(window.location.search).get("chat")).toBe("srv-a");
  });

  it("prefers the fuller slot when the tab holds the conversation twice", async () => {
    const store = useCanvasChatStore.getState();
    const full = store.startConversation(context, [userMessage("u1"), userMessage("u2")], undefined, 2, "srv-a");
    store.startConversation(context, [userMessage("u1")], undefined, 1, "srv-a");

    await openOrgConversation("acme", "srv-a");

    expect(useCanvasChatStore.getState().activeConversationId).toBe(full);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches a conversation the tab does not hold into a new slot", async () => {
    fetchMock.mockResolvedValueOnce(
      serverConversation([
        { id: "u1", role: "user", content: "hi", timestamp: "2026-09-04T10:00:00Z" },
        { id: "a1", role: "assistant", content: "hello", timestamp: "2026-09-04T10:00:01Z" },
      ]),
    );

    const opened = await openOrgConversation("acme", "srv-new", { syncUrl: true });

    expect(opened).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/orgs/acme/chat/conversations/srv-new");
    const state = useCanvasChatStore.getState();
    const active = state.activeConversationId;
    expect(active).not.toBeNull();
    expect(state.conversations[active!].serverConversationId).toBe("srv-new");
    expect(state.conversations[active!].messages.map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(state.ephemeralSeedCounts[active!]).toBe(2);
    expect(new URLSearchParams(window.location.search).get("chat")).toBe("srv-new");
  });

  it("returns false and leaves the store alone when the fetch fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));

    const opened = await openOrgConversation("acme", "srv-missing");

    expect(opened).toBe(false);
    expect(useCanvasChatStore.getState().activeConversationId).toBeNull();
  });
});
