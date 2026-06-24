// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useCanvasChatStore } from "@/app/org/[githubLogin]/_state/canvasChatStore";

// ── helpers ────────────────────────────────────────────────────────────────

const baseContext = {
  workspaceSlug: null,
  workspaceSlugs: [],
  orgId: "org-1",
  githubLogin: "test-org",
  currentCanvasRef: "root",
  currentCanvasBreadcrumb: "",
  selectedNodeId: null,
  selectedNodeIds: [],
};

function freshStore() {
  // Reset the store to initial state between tests
  useCanvasChatStore.setState({
    conversations: {},
    activeConversationId: null,
    ephemeralSeedCounts: {},
    pendingInputDraft: null,
    proposals: {},
    subAgentRuns: {},
    artifacts: {},
    dismissedArtifactIds: {},
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("canvasChatStore — isStreaming", () => {
  beforeEach(freshStore);

  it("initialises isStreaming=false when startConversation is called", () => {
    const id = useCanvasChatStore.getState().startConversation(baseContext);
    const conv = useCanvasChatStore.getState().conversations[id];
    expect(conv).toBeDefined();
    expect(conv.isStreaming).toBe(false);
  });

  it("setIsStreaming(true) sets isStreaming on the target conversation", () => {
    const id = useCanvasChatStore.getState().startConversation(baseContext);
    useCanvasChatStore.getState().setIsStreaming(id, true);
    const conv = useCanvasChatStore.getState().conversations[id];
    expect(conv.isStreaming).toBe(true);
  });

  it("setIsStreaming(false) clears isStreaming on the target conversation", () => {
    const id = useCanvasChatStore.getState().startConversation(baseContext);
    // Set to true first
    useCanvasChatStore.getState().setIsStreaming(id, true);
    expect(useCanvasChatStore.getState().conversations[id].isStreaming).toBe(true);
    // Now clear
    useCanvasChatStore.getState().setIsStreaming(id, false);
    expect(useCanvasChatStore.getState().conversations[id].isStreaming).toBe(false);
  });

  it("setIsStreaming does not mutate other conversations", () => {
    const id1 = useCanvasChatStore.getState().startConversation(baseContext);
    const id2 = useCanvasChatStore.getState().startConversation(baseContext);

    // Only set streaming on id1
    useCanvasChatStore.getState().setIsStreaming(id1, true);

    expect(useCanvasChatStore.getState().conversations[id1].isStreaming).toBe(true);
    // id2 must remain untouched
    expect(useCanvasChatStore.getState().conversations[id2].isStreaming).toBe(false);
  });

  it("setIsStreaming is a no-op for an unknown conversationId", () => {
    const before = { ...useCanvasChatStore.getState().conversations };
    useCanvasChatStore.getState().setIsStreaming("nonexistent-id", true);
    // Store should be unchanged
    expect(useCanvasChatStore.getState().conversations).toEqual(before);
  });

  it("isStreaming is independent of isLoading", () => {
    const id = useCanvasChatStore.getState().startConversation(baseContext);

    // They start out both false
    expect(useCanvasChatStore.getState().conversations[id].isLoading).toBe(false);
    expect(useCanvasChatStore.getState().conversations[id].isStreaming).toBe(false);

    // Set isLoading=true — isStreaming must remain false
    useCanvasChatStore.getState().setIsLoading(id, true);
    expect(useCanvasChatStore.getState().conversations[id].isLoading).toBe(true);
    expect(useCanvasChatStore.getState().conversations[id].isStreaming).toBe(false);

    // Set isStreaming=true — isLoading must remain true
    useCanvasChatStore.getState().setIsStreaming(id, true);
    expect(useCanvasChatStore.getState().conversations[id].isLoading).toBe(true);
    expect(useCanvasChatStore.getState().conversations[id].isStreaming).toBe(true);

    // Clear isLoading — isStreaming still true
    useCanvasChatStore.getState().setIsLoading(id, false);
    expect(useCanvasChatStore.getState().conversations[id].isLoading).toBe(false);
    expect(useCanvasChatStore.getState().conversations[id].isStreaming).toBe(true);
  });
});

describe("canvasChatStore — pendingDeeplink", () => {
  beforeEach(() => {
    useCanvasChatStore.setState({
      conversations: {},
      activeConversationId: null,
      ephemeralSeedCounts: {},
      pendingInputDraft: null,
      pendingDeeplink: null,
      proposals: {},
      subAgentRuns: {},
      artifacts: {},
      dismissedArtifactIds: {},
    });
  });

  it("initialises pendingDeeplink as null", () => {
    expect(useCanvasChatStore.getState().pendingDeeplink).toBeNull();
  });

  it("triggerDeeplink sets pendingDeeplink correctly", () => {
    useCanvasChatStore.getState().triggerDeeplink({
      nodeId: "initiative:abc",
      canvasRef: "initiative:abc",
      label: "Q3 Roadmap",
    });

    expect(useCanvasChatStore.getState().pendingDeeplink).toEqual({
      nodeId: "initiative:abc",
      canvasRef: "initiative:abc",
      label: "Q3 Roadmap",
      x: undefined,
      y: undefined,
    });
  });

  it("triggerDeeplink passes x and y coordinates through", () => {
    useCanvasChatStore.getState().triggerDeeplink({
      nodeId: "feature:123",
      canvasRef: "initiative:xyz",
      label: "Launch Beta",
      x: 100,
      y: 200,
    });

    const dl = useCanvasChatStore.getState().pendingDeeplink;
    expect(dl?.x).toBe(100);
    expect(dl?.y).toBe(200);
  });

  it("clearDeeplink sets pendingDeeplink to null", () => {
    useCanvasChatStore.getState().triggerDeeplink({
      nodeId: "initiative:abc",
      canvasRef: "initiative:abc",
      label: "Q3 Roadmap",
    });

    expect(useCanvasChatStore.getState().pendingDeeplink).not.toBeNull();

    useCanvasChatStore.getState().clearDeeplink();
    expect(useCanvasChatStore.getState().pendingDeeplink).toBeNull();
  });

  it("calling triggerDeeplink twice overwrites the previous pending deeplink", () => {
    useCanvasChatStore.getState().triggerDeeplink({
      nodeId: "initiative:abc",
      canvasRef: "initiative:abc",
      label: "First",
    });
    useCanvasChatStore.getState().triggerDeeplink({
      nodeId: "feature:999",
      canvasRef: "initiative:xyz",
      label: "Second",
    });

    const dl = useCanvasChatStore.getState().pendingDeeplink;
    expect(dl?.nodeId).toBe("feature:999");
    expect(dl?.label).toBe("Second");
  });
});
