import React, { useRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentChatMessage } from "@/app/w/[slug]/task/[...taskParams]/components/AgentChatMessage";
import type { ChatMessage } from "@/lib/chat";
import type { AgentStreamingMessage } from "@/types/agent";
import { ChatRole } from "@/lib/chat";

// Mock framer-motion
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

// Mock MarkdownRenderer
vi.mock("@/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children, variant }: { children: string; variant?: string }) => (
    <div data-testid="markdown-renderer" data-variant={variant}>
      {children}
    </div>
  ),
}));

// Mock streaming components
vi.mock("@/components/streaming", () => ({
  StreamingMessage: ({ message }: any) => (
    <div data-testid="streaming-message">{message.content}</div>
  ),
  StreamErrorBoundary: ({ children }: any) => <>{children}</>,
}));

// Mock ThinkingIndicator
vi.mock("@/components/ThinkingIndicator", () => ({
  ThinkingIndicator: () => <div data-testid="thinking-indicator">Thinking...</div>,
}));

// Mock artifacts
vi.mock("@/app/w/[slug]/task/[...taskParams]/artifacts/pull-request", () => ({
  PullRequestArtifact: ({ artifact }: any) => (
    <div data-testid={`pr-artifact-${artifact.id}`}>PR Artifact</div>
  ),
}));
vi.mock("@/app/w/[slug]/task/[...taskParams]/artifacts/bounty", () => ({
  BountyArtifact: ({ artifact }: any) => (
    <div data-testid={`bounty-artifact-${artifact.id}`}>Bounty Artifact</div>
  ),
}));

function createChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    message: "Hello world",
    role: ChatRole.ASSISTANT,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    artifacts: [],
    workflowUrl: null,
    ...overrides,
  } as ChatMessage;
}

function createStreamingMessage(overrides: Partial<AgentStreamingMessage> = {}): AgentStreamingMessage {
  return {
    id: "stream-1",
    role: "assistant",
    content: "Streaming content",
    isStreaming: true,
    textParts: [{ id: "part-1", content: "Streaming content" }],
    toolCalls: [],
    reasoningParts: [],
    ...overrides,
  } as AgentStreamingMessage;
}

describe("AgentChatMessage", () => {
  describe("rendering", () => {
    it("renders assistant message with MarkdownRenderer", () => {
      const message = createChatMessage({ message: "Assistant reply" });
      render(<AgentChatMessage message={message} />);
      expect(screen.getByTestId("markdown-renderer")).toHaveTextContent("Assistant reply");
      expect(screen.getByTestId("markdown-renderer")).toHaveAttribute("data-variant", "assistant");
    });

    it("renders user message with user variant", () => {
      const message = createChatMessage({ role: ChatRole.USER, message: "User message" });
      render(<AgentChatMessage message={message} />);
      expect(screen.getByTestId("markdown-renderer")).toHaveAttribute("data-variant", "user");
    });

    it("renders thinking indicator when streaming with no content", () => {
      const message = createStreamingMessage({
        isStreaming: true,
        content: "",
        textParts: [],
        toolCalls: [],
      });
      render(<AgentChatMessage message={message} />);
      expect(screen.getByTestId("thinking-indicator")).toBeInTheDocument();
    });

    it("renders streaming message when textParts are present", () => {
      const message = createStreamingMessage({
        isStreaming: true,
        content: "Some content",
        textParts: [{ id: "p1", content: "Some content" }],
      });
      render(<AgentChatMessage message={message} />);
      expect(screen.getByTestId("streaming-message")).toBeInTheDocument();
    });
  });

  describe("memoization", () => {
    it("does not re-render when unrelated parent state changes but props stay the same", () => {
      let renderCount = 0;

      // Spy on MarkdownRenderer to count renders
      const MarkdownRendererMock = vi.fn(({ children, variant }: any) => {
        renderCount++;
        return (
          <div data-testid="markdown-renderer" data-variant={variant}>
            {children}
          </div>
        );
      });

      vi.doMock("@/components/MarkdownRenderer", () => ({
        MarkdownRenderer: MarkdownRendererMock,
      }));

      const message = createChatMessage({ message: "Stable message" });

      // Wrap in a parent that re-renders
      function Parent({ counter }: { counter: number }) {
        return (
          <div data-counter={counter}>
            <AgentChatMessage message={message} />
          </div>
        );
      }

      const { rerender } = render(<Parent counter={0} />);
      const initialRenderCount = renderCount;

      // Re-render parent with a different counter (unrelated prop) but same message
      rerender(<Parent counter={1} />);
      rerender(<Parent counter={2} />);

      // AgentChatMessage is memoized — MarkdownRenderer should not re-render
      // (render count should stay the same as after the initial render)
      expect(renderCount).toBe(initialRenderCount);
    });

    it("re-renders when message updatedAt changes", () => {
      const message1 = createChatMessage({ message: "Original message", updatedAt: new Date("2024-01-01") });
      const message2 = createChatMessage({ message: "Updated message", updatedAt: new Date("2024-01-02") });

      const { rerender } = render(<AgentChatMessage message={message1} />);
      expect(screen.getByTestId("markdown-renderer")).toHaveTextContent("Original message");

      rerender(<AgentChatMessage message={message2} />);
      expect(screen.getByTestId("markdown-renderer")).toHaveTextContent("Updated message");
    });

    it("re-renders when streaming message content changes", () => {
      const msg1 = createStreamingMessage({
        content: "First chunk",
        isStreaming: true,
        textParts: [{ id: "p1", content: "First chunk" }],
      });
      const msg2 = createStreamingMessage({
        content: "Second chunk",
        isStreaming: true,
        textParts: [{ id: "p1", content: "Second chunk" }],
      });

      const { rerender } = render(<AgentChatMessage message={msg1} />);
      expect(screen.getByTestId("streaming-message")).toBeInTheDocument();

      rerender(<AgentChatMessage message={msg2} />);
      expect(screen.getByTestId("streaming-message")).toBeInTheDocument();
    });
  });

  describe("no hover state handlers", () => {
    it("does not attach onMouseEnter or onMouseLeave to the container", () => {
      const message = createChatMessage({ message: "Test" });
      const { container } = render(<AgentChatMessage message={message} />);
      const outerDiv = container.firstChild as HTMLElement;
      expect(outerDiv.onmouseenter).toBeNull();
      expect(outerDiv.onmouseleave).toBeNull();
    });
  });
});
