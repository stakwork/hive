import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStreamContext } from "@/hooks/useStreamContext";
import { WorkflowStatus } from "@/lib/chat";
import type { ChatMessage } from "@/lib/chat";
import type { WorkflowStatusUpdate } from "@/hooks/usePusherConnection";

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    message: "hello",
    role: "USER",
    status: "SENT",
    artifacts: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as ChatMessage;
}

describe("useStreamContext", () => {
  it("starts with null streamContext", () => {
    const { result } = renderHook(() => useStreamContext());
    expect(result.current.streamContext).toBeNull();
  });

  it("onMessage sets streamContext when a STREAM artifact is present", () => {
    const { result } = renderHook(() => useStreamContext());

    const message = makeMessage({
      artifacts: [
        {
          type: "STREAM",
          content: {
            requestId: "req-123",
            eventsToken: "tok-abc",
            baseUrl: "https://agent.example.com",
          },
        },
      ] as ChatMessage["artifacts"],
    });

    act(() => {
      result.current.onMessage(message);
    });

    expect(result.current.streamContext).toEqual({
      requestId: "req-123",
      eventsToken: "tok-abc",
      baseUrl: "https://agent.example.com",
    });
  });

  it("onMessage leaves streamContext as null when no STREAM artifact present", () => {
    const { result } = renderHook(() => useStreamContext());

    const message = makeMessage({
      artifacts: [
        { type: "CODE", content: { code: "console.log()" } },
      ] as ChatMessage["artifacts"],
    });

    act(() => {
      result.current.onMessage(message);
    });

    expect(result.current.streamContext).toBeNull();
  });

  it("onMessage leaves streamContext as null when message has no artifacts", () => {
    const { result } = renderHook(() => useStreamContext());

    const message = makeMessage({ artifacts: [] });

    act(() => {
      result.current.onMessage(message);
    });

    expect(result.current.streamContext).toBeNull();
  });

  it.each([
    WorkflowStatus.COMPLETED,
    WorkflowStatus.FAILED,
    WorkflowStatus.ERROR,
    WorkflowStatus.HALTED,
  ])("onWorkflowStatusUpdate clears streamContext for terminal status: %s", (status) => {
    const { result } = renderHook(() => useStreamContext());

    // First set a stream context
    const message = makeMessage({
      artifacts: [
        {
          type: "STREAM",
          content: {
            requestId: "req-1",
            eventsToken: "tok-1",
            baseUrl: "https://example.com",
          },
        },
      ] as ChatMessage["artifacts"],
    });

    act(() => {
      result.current.onMessage(message);
    });

    expect(result.current.streamContext).not.toBeNull();

    act(() => {
      result.current.onWorkflowStatusUpdate({ workflowStatus: status } as WorkflowStatusUpdate);
    });

    expect(result.current.streamContext).toBeNull();
  });

  it("onWorkflowStatusUpdate does NOT clear streamContext for IN_PROGRESS", () => {
    const { result } = renderHook(() => useStreamContext());

    // Set a stream context
    const message = makeMessage({
      artifacts: [
        {
          type: "STREAM",
          content: {
            requestId: "req-1",
            eventsToken: "tok-1",
            baseUrl: "https://example.com",
          },
        },
      ] as ChatMessage["artifacts"],
    });

    act(() => {
      result.current.onMessage(message);
    });

    expect(result.current.streamContext).not.toBeNull();

    act(() => {
      result.current.onWorkflowStatusUpdate({
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      } as WorkflowStatusUpdate);
    });

    // Should still be set
    expect(result.current.streamContext).not.toBeNull();
    expect(result.current.streamContext?.requestId).toBe("req-1");
  });
});
