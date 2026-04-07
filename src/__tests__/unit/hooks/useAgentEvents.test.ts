import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentEvents } from "@/hooks/useAgentEvents";

// Minimal EventSource mock
class MockEventSource {
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closeCalled = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closeCalled = true;
  }

  // Helper to emit a message
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  static instances: MockEventSource[] = [];
  static reset() {
    MockEventSource.instances = [];
  }
}

describe("useAgentEvents", () => {
  beforeEach(() => {
    MockEventSource.reset();
    // @ts-expect-error override global
    global.EventSource = MockEventSource;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts with idle status and null latestEvent when params are null", () => {
    const { result } = renderHook(() => useAgentEvents(null, null, null));
    expect(result.current.status).toBe("idle");
    expect(result.current.latestEvent).toBeNull();
  });

  it("opens an EventSource and sets status to streaming when params are provided", () => {
    renderHook(() => useAgentEvents("req-1", "tok-1", "https://agent.example.com"));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe(
      "https://agent.example.com/events/req-1?token=tok-1"
    );
  });

  it("sets latestEvent to text event on text message", () => {
    const { result } = renderHook(() =>
      useAgentEvents("req-1", "tok-1", "https://agent.example.com")
    );

    act(() => {
      MockEventSource.instances[0].emit({ type: "text", text: "Hello world" });
    });

    expect(result.current.latestEvent).toEqual({ type: "text", text: "Hello world" });
    expect(result.current.status).toBe("streaming");
  });

  it("sets latestEvent to tool_call event on tool_call message", () => {
    const { result } = renderHook(() =>
      useAgentEvents("req-1", "tok-1", "https://agent.example.com")
    );

    act(() => {
      MockEventSource.instances[0].emit({ type: "tool_call", toolName: "search_files" });
    });

    expect(result.current.latestEvent).toEqual({ type: "tool_call", toolName: "search_files", input: null });
  });

  it("replaces (not accumulates) latestEvent on each new event", () => {
    const { result } = renderHook(() =>
      useAgentEvents("req-1", "tok-1", "https://agent.example.com")
    );
    const es = MockEventSource.instances[0];

    act(() => { es.emit({ type: "text", text: "First" }); });
    expect(result.current.latestEvent).toEqual({ type: "text", text: "First" });

    act(() => { es.emit({ type: "tool_call", toolName: "read_file" }); });
    expect(result.current.latestEvent).toEqual({ type: "tool_call", toolName: "read_file", input: null });

    act(() => { es.emit({ type: "text", text: "Second" }); });
    expect(result.current.latestEvent).toEqual({ type: "text", text: "Second" });
  });

  it("sets status to done and closes EventSource on done event", () => {
    const { result } = renderHook(() =>
      useAgentEvents("req-1", "tok-1", "https://agent.example.com")
    );
    const es = MockEventSource.instances[0];

    act(() => { es.emit({ type: "done" }); });

    expect(result.current.status).toBe("done");
    expect(es.closeCalled).toBe(true);
  });

  it("sets status to error and closes EventSource on error event type", () => {
    const { result } = renderHook(() =>
      useAgentEvents("req-1", "tok-1", "https://agent.example.com")
    );
    const es = MockEventSource.instances[0];

    act(() => { es.emit({ type: "error" }); });

    expect(result.current.status).toBe("error");
    expect(es.closeCalled).toBe(true);
  });

  it("sets status to error and closes EventSource on onerror", () => {
    const { result } = renderHook(() =>
      useAgentEvents("req-1", "tok-1", "https://agent.example.com")
    );
    const es = MockEventSource.instances[0];

    act(() => { es.onerror?.(new Event("error")); });

    expect(result.current.status).toBe("error");
    expect(es.closeCalled).toBe(true);
  });

  it("closes EventSource on unmount", () => {
    const { unmount } = renderHook(() =>
      useAgentEvents("req-1", "tok-1", "https://agent.example.com")
    );
    const es = MockEventSource.instances[0];
    expect(es.closeCalled).toBe(false);

    unmount();
    expect(es.closeCalled).toBe(true);
  });

  it("does not open EventSource when only some params are provided", () => {
    renderHook(() => useAgentEvents("req-1", null, "https://agent.example.com"));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("encodes token in URL", () => {
    renderHook(() =>
      useAgentEvents("req-1", "tok+special=chars", "https://agent.example.com")
    );
    expect(MockEventSource.instances[0].url).toContain(
      encodeURIComponent("tok+special=chars")
    );
  });

  it("captures input on tool_call event", () => {
    const { result } = renderHook(() =>
      useAgentEvents("req-1", "tok-1", "https://agent.example.com")
    );

    act(() => {
      MockEventSource.instances[0].emit({
        type: "tool_call",
        toolName: "developer__shell",
        input: { command: "ls -la" },
      });
    });

    expect(result.current.latestEvent).toEqual({
      type: "tool_call",
      toolName: "developer__shell",
      input: { command: "ls -la" },
    });
  });

  it("sets input to null when absent on tool_call event", () => {
    const { result } = renderHook(() =>
      useAgentEvents("req-1", "tok-1", "https://agent.example.com")
    );

    act(() => {
      MockEventSource.instances[0].emit({ type: "tool_call", toolName: "search_files" });
    });

    expect(result.current.latestEvent).toEqual({
      type: "tool_call",
      toolName: "search_files",
      input: null,
    });
  });
});
