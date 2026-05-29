import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStreamedAgentLog } from "@/hooks/useStreamedAgentLog";

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

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  static instances: MockEventSource[] = [];
  static reset() {
    MockEventSource.instances = [];
  }
}

describe("useStreamedAgentLog", () => {
  beforeEach(() => {
    MockEventSource.reset();
    // @ts-expect-error override global
    global.EventSource = MockEventSource;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when streamContext is null", () => {
    const { result } = renderHook(() => useStreamedAgentLog(null));
    expect(result.current).toBeNull();
  });

  it("returns null when streamContext has no agent", () => {
    const { result } = renderHook(() =>
      useStreamedAgentLog({
        requestId: "req-1",
        eventsToken: "tok-1",
        baseUrl: "https://agent.example.com",
        agent: undefined,
      })
    );
    expect(result.current).toBeNull();
  });

  it("returns { agent, conversation: [] } when streaming with no events yet", () => {
    const { result } = renderHook(() =>
      useStreamedAgentLog({
        requestId: "req-1",
        eventsToken: "tok-1",
        baseUrl: "https://agent.example.com",
        agent: "plan-agent-abc",
      })
    );
    expect(result.current).not.toBeNull();
    expect(result.current?.agent).toBe("plan-agent-abc");
    expect(result.current?.conversation).toEqual([]);
  });

  it("maps text events to assistant conversation messages", () => {
    const { result } = renderHook(() =>
      useStreamedAgentLog({
        requestId: "req-1",
        eventsToken: "tok-1",
        baseUrl: "https://agent.example.com",
        agent: "plan-agent-abc",
      })
    );

    act(() => {
      MockEventSource.instances[0].emit({ type: "text", text: "Hello world" });
    });

    expect(result.current?.conversation).toEqual([
      { role: "assistant", content: "Hello world" },
    ]);
  });

  it("maps tool_call events with input to formatted assistant messages", () => {
    const { result } = renderHook(() =>
      useStreamedAgentLog({
        requestId: "req-1",
        eventsToken: "tok-1",
        baseUrl: "https://agent.example.com",
        agent: "plan-agent-abc",
      })
    );

    act(() => {
      MockEventSource.instances[0].emit({
        type: "tool_call",
        toolName: "search_files",
        input: { query: "test", limit: 10 },
      });
    });

    expect(result.current?.conversation[0].role).toBe("assistant");
    expect(result.current?.conversation[0].content).toContain("🔧 search_files");
    expect(result.current?.conversation[0].content).toContain("query: test");
  });

  it("maps tool_call events without input to simple formatted messages", () => {
    const { result } = renderHook(() =>
      useStreamedAgentLog({
        requestId: "req-1",
        eventsToken: "tok-1",
        baseUrl: "https://agent.example.com",
        agent: "plan-agent-abc",
      })
    );

    act(() => {
      MockEventSource.instances[0].emit({ type: "tool_call", toolName: "read_file" });
    });

    expect(result.current?.conversation[0].content).toBe("🔧 read_file");
  });

  it("accumulates multiple events in order", () => {
    const { result } = renderHook(() =>
      useStreamedAgentLog({
        requestId: "req-1",
        eventsToken: "tok-1",
        baseUrl: "https://agent.example.com",
        agent: "plan-agent-abc",
      })
    );

    const es = MockEventSource.instances[0];
    act(() => {
      es.emit({ type: "text", text: "First" });
      es.emit({ type: "tool_call", toolName: "search" });
      es.emit({ type: "text", text: "Second" });
    });

    expect(result.current?.conversation).toHaveLength(3);
    expect(result.current?.conversation[0].content).toBe("First");
    expect(result.current?.conversation[1].content).toBe("🔧 search");
    expect(result.current?.conversation[2].content).toBe("Second");
  });

  it("returns null when status is done and no events exist", () => {
    const { result } = renderHook(() =>
      useStreamedAgentLog({
        requestId: "req-1",
        eventsToken: "tok-1",
        baseUrl: "https://agent.example.com",
        agent: "plan-agent-abc",
      })
    );

    act(() => {
      MockEventSource.instances[0].emit({ type: "done" });
    });

    expect(result.current).toBeNull();
  });

  it("returns conversation when status is done but events exist", () => {
    const { result } = renderHook(() =>
      useStreamedAgentLog({
        requestId: "req-1",
        eventsToken: "tok-1",
        baseUrl: "https://agent.example.com",
        agent: "plan-agent-abc",
      })
    );

    const es = MockEventSource.instances[0];
    act(() => {
      es.emit({ type: "text", text: "Working..." });
      es.emit({ type: "done" });
    });

    // Has events so should still return conversation
    expect(result.current).not.toBeNull();
    expect(result.current?.conversation).toHaveLength(1);
  });

  it("returns null when status is error and no events exist", () => {
    const { result } = renderHook(() =>
      useStreamedAgentLog({
        requestId: "req-1",
        eventsToken: "tok-1",
        baseUrl: "https://agent.example.com",
        agent: "plan-agent-abc",
      })
    );

    act(() => {
      MockEventSource.instances[0].emit({ type: "error" });
    });

    expect(result.current).toBeNull();
  });

  it("clears events on new requestId", () => {
    let requestId = "req-1";
    const { result, rerender } = renderHook(() =>
      useStreamedAgentLog({
        requestId,
        eventsToken: "tok-1",
        baseUrl: "https://agent.example.com",
        agent: "plan-agent-abc",
      })
    );

    act(() => {
      MockEventSource.instances[0].emit({ type: "text", text: "Old message" });
    });
    expect(result.current?.conversation).toHaveLength(1);

    // Change requestId
    requestId = "req-2";
    rerender();

    // New EventSource opened, events reset
    expect(result.current?.conversation).toHaveLength(0);
  });
});
