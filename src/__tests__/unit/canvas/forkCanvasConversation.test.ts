// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasChatStore, type ConversationContext } from "@/app/org/[githubLogin]/_state/canvasChatStore";
import { forkCanvasConversation } from "@/app/org/[githubLogin]/_state/forkCanvasConversation";

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

describe("forkCanvasConversation", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    useCanvasChatStore.setState({ conversations: {}, activeConversationId: null, ephemeralSeedCounts: {} });
    useCanvasChatStore.getState().startConversation(context);
  });

  it("POSTs the source title and preserves settings.titleSource, then seeds the store", async () => {
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (!opts || opts.method !== "POST") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                { id: "m1", role: "user", content: "hello" },
                { id: "m2", role: "assistant", content: "hi" },
              ],
              title: "Auth token refresh",
              settings: { titleSource: "llm", extraWorkspaceSlugs: ["hive"] },
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: "fork-srv-1" }),
      });
    });

    const forkId = await forkCanvasConversation("acme", "srv-1");
    expect(forkId).toBe("fork-srv-1");

    const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(postCall?.[0]).toBe("/api/orgs/acme/chat/conversations");
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.title).toBe("Auth token refresh");
    expect(body.settings).toEqual({ titleSource: "llm", extraWorkspaceSlugs: ["hive"] });

    const state = useCanvasChatStore.getState();
    const active = state.conversations[state.activeConversationId!];
    expect(active.serverConversationId).toBe("fork-srv-1");
    expect(active.forkedFromShareId).toBe("srv-1");
    expect(active.title).toBe("Auth token refresh");
    expect(state.ephemeralSeedCounts[active.id]).toBe(2);
  });
});
