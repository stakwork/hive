import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCanvasChatStore } from "@/app/org/[githubLogin]/_state/canvasChatStore";

let mockArtifacts: unknown[] = [];
vi.mock("@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel", () => ({
  useActiveArtifacts: () => mockArtifacts,
}));
vi.mock("@/app/org/[githubLogin]/_state/canvasChatArtifacts", () => ({
  artifactIdentity: (a: { id: string }) => a.id,
}));

import { useArtifactUrlParam, writeArtifactParam } from "@/hooks/useArtifactUrlParam";

const art = (id: string) => ({ id });
const store = () => useCanvasChatStore.getState();

describe("useArtifactUrlParam", () => {
  beforeEach(() => {
    mockArtifacts = [];
    act(() => {
      useCanvasChatStore.setState({ artifactPanel: null, activeConversationId: null });
    });
    window.history.replaceState(null, "", "/org/acme");
  });

  it("writes the param on select and removes it on close, keeping other params and hash", () => {
    window.history.replaceState(null, "", "/org/acme?view=chats&x=1#h");
    renderHook(() => useArtifactUrlParam());
    act(() => store().openArtifactPanel("a1"));
    expect(window.location.search).toBe("?view=chats&x=1&artifact=a1");
    expect(window.location.hash).toBe("#h");
    act(() => store().closeArtifactPanel());
    expect(window.location.search).toBe("?view=chats&x=1");
    expect(window.location.hash).toBe("#h");
  });

  it("opens the artifact from the URL once it has loaded, without clobbering the URL meanwhile", () => {
    window.history.replaceState(null, "", "/org/acme?artifact=a2");
    const { rerender } = renderHook(() => useArtifactUrlParam());
    expect(window.location.search).toBe("?artifact=a2");
    expect(store().artifactPanel).toBeNull();
    mockArtifacts = [art("a1"), art("a2")];
    rerender();
    expect(store().artifactPanel?.identity).toBe("a2");
    expect(window.location.search).toBe("?artifact=a2");
  });

  it("applies only once: later closing is not overridden", () => {
    window.history.replaceState(null, "", "/org/acme?artifact=a1");
    mockArtifacts = [art("a1")];
    const { rerender } = renderHook(() => useArtifactUrlParam());
    expect(store().artifactPanel?.identity).toBe("a1");
    act(() => store().closeArtifactPanel());
    mockArtifacts = [art("a1")];
    rerender();
    expect(store().artifactPanel).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("ignores unknown ids, then drops them when the user selects another artifact", () => {
    window.history.replaceState(null, "", "/org/acme?artifact=nope");
    mockArtifacts = [art("a1")];
    const { rerender } = renderHook(() => useArtifactUrlParam());
    rerender();
    expect(store().artifactPanel).toBeNull();
    act(() => store().openArtifactPanel("a1"));
    expect(window.location.search).toBe("?artifact=a1");
  });

  it("abandons an unresolved deep link when switching chats", () => {
    window.history.replaceState(null, "", "/org/acme?artifact=a1");
    act(() => useCanvasChatStore.setState({ activeConversationId: "c1" }));
    const { rerender } = renderHook(() => useArtifactUrlParam());
    act(() => useCanvasChatStore.setState({ activeConversationId: "c2" }));
    mockArtifacts = [art("a1")];
    rerender();
    expect(store().artifactPanel).toBeNull();
  });

  it("clears the param when the panel resets on a chat switch", () => {
    renderHook(() => useArtifactUrlParam());
    act(() => store().openArtifactPanel("a1"));
    act(() => useCanvasChatStore.setState({ artifactPanel: null, activeConversationId: "c2" }));
    expect(window.location.search).toBe("");
  });
});

describe("writeArtifactParam", () => {
  it("preserves history state", () => {
    window.history.replaceState({ k: 1 }, "", "/p");
    writeArtifactParam("z");
    expect(window.history.state).toEqual({ k: 1 });
    expect(window.location.search).toBe("?artifact=z");
  });
});
