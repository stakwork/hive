import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GenerationPreview from "@/components/features/GenerationPreview";

// Define Highlight type locally to avoid import issues with mocked module
type Highlight = {
  id: string;
  text: string;
  comment: string;
  range: { start: number; end: number };
};

// Mock state for TextHighlighter
let mockHighlights: Highlight[] = [];
let mockOnHighlightsChange: ((highlights: Highlight[]) => void) | undefined;

// Mock TextHighlighter component
vi.mock("@/components/features/TextHighlighter", () => {
  const React = require("react");
  const MockTextHighlighter = ({ children, highlights, onHighlightsChange }: any) => {
    // Store the callback in module scope so tests can trigger it
    if (onHighlightsChange) {
      (global as any).__mockOnHighlightsChange = onHighlightsChange;
    }
    return React.createElement("div", { "data-testid": "text-highlighter" }, children);
  };
  
  return {
    TextHighlighter: MockTextHighlighter,
    default: MockTextHighlighter,
  };
});

// Mock MarkdownRenderer
vi.mock("@/components/MarkdownRenderer", () => {
  const React = require("react");
  const MockMarkdownRenderer = ({ markdown, children }: { markdown?: string; children?: string }) =>
    React.createElement("div", { "data-testid": "markdown-content" }, markdown || children);
  
  return {
    default: MockMarkdownRenderer,
    MarkdownRenderer: MockMarkdownRenderer,
  };
});

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Helper to simulate adding highlights
const simulateAddHighlight = (text: string, comment: string) => {
  const callback = (global as any).__mockOnHighlightsChange;
  if (!callback) return;
  
  const newHighlight: Highlight = {
    id: `highlight-${Date.now()}-${Math.random()}`,
    text,
    comment,
    range: { start: 0, end: text.length },
  };
  
  mockHighlights = [...mockHighlights, newHighlight];
  callback(mockHighlights);
};

describe("GenerationPreview Feedback Integration", () => {
  beforeEach(() => {
    mockHighlights = [];
    mockOnHighlightsChange = undefined;
  });

  describe("Complete Feedback Flow", () => {
    it("should format and submit feedback with highlights and general feedback", async () => {
      const user = userEvent.setup();
      const onProvideFeedback = vi.fn();

      render(
        <GenerationPreview
          content="This is a test architecture proposal. The API design needs review."
          source="deep"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onProvideFeedback={onProvideFeedback}
        />
      );

      // Simulate adding two highlights
      simulateAddHighlight("architecture proposal", "Consider using microservices");
      simulateAddHighlight("API design", "Add rate limiting");

      // Wait for highlights to be reflected in UI
      await waitFor(() => {
        expect(screen.getByText("2 comments")).toBeInTheDocument();
      });

      // Add general feedback
      const feedbackInput = screen.getByPlaceholderText("Provide feedback...");
      await user.type(feedbackInput, "Overall looks good");

      // Submit all feedback
      const submitButton = screen.getByRole("button", { name: /submit feedback/i });
      await user.click(submitButton);

      // Verify XML structure
      await waitFor(() => {
        const callArg = onProvideFeedback.mock.calls[0][0];
        expect(callArg).toContain("<highlight>architecture proposal</highlight>");
        expect(callArg).toContain("<comment>Consider using microservices</comment>");
        expect(callArg).toContain("<highlight>API design</highlight>");
        expect(callArg).toContain("<comment>Add rate limiting</comment>");
        expect(callArg).toContain("<general_feedback>Overall looks good</general_feedback>");
      });
    });

    it("should submit only highlights without general feedback", async () => {
      const user = userEvent.setup();
      const onProvideFeedback = vi.fn();

      render(
        <GenerationPreview
          content="Test content for highlighting"
          source="quick"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onProvideFeedback={onProvideFeedback}
        />
      );

      // Simulate adding highlight
      simulateAddHighlight("Test content", "This needs improvement");

      await waitFor(() => {
        expect(screen.getByText("1 comment")).toBeInTheDocument();
      });

      // Submit without general feedback
      const submitButton = screen.getByRole("button", { name: /submit feedback/i });
      await user.click(submitButton);

      // Should contain only highlight-comment pair, no general_feedback tag
      await waitFor(() => {
        expect(onProvideFeedback).toHaveBeenCalledWith(
          "<highlight>Test content</highlight><comment>This needs improvement</comment>"
        );
      });
    });

    it("should submit only general feedback without highlights", async () => {
      const user = userEvent.setup();
      const onProvideFeedback = vi.fn();

      render(
        <GenerationPreview
          content="Test content"
          source="quick"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onProvideFeedback={onProvideFeedback}
        />
      );

      // Add only general feedback
      const feedbackInput = screen.getByPlaceholderText("Provide feedback...");
      await user.type(feedbackInput, "Looks good overall");

      const submitButton = screen.getByRole("button", { name: /submit feedback/i });
      await user.click(submitButton);

      // Should contain only general_feedback tag
      await waitFor(() => {
        expect(onProvideFeedback).toHaveBeenCalledWith(
          "<general_feedback>Looks good overall</general_feedback>"
        );
      });
    });
  });

  describe("XML Encoding", () => {
    it("should handle very long text in highlights", async () => {
      const user = userEvent.setup();
      const onProvideFeedback = vi.fn();
      const longText = "a".repeat(1000);

      render(
        <GenerationPreview
          content={`Introduction: ${longText} Conclusion`}
          source="deep"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onProvideFeedback={onProvideFeedback}
        />
      );

      simulateAddHighlight(longText, "This section is too long");

      await waitFor(() => {
        expect(screen.getByText("1 comment")).toBeInTheDocument();
      });

      const submitButton = screen.getByRole("button", { name: /submit feedback/i });
      await user.click(submitButton);

      await waitFor(() => {
        const call = onProvideFeedback.mock.calls[0][0];
        expect(call).toContain("<highlight>");
        expect(call).toContain(longText);
        expect(call).toContain("</highlight>");
        expect(call).toContain("<comment>This section is too long</comment>");
      });
    });

    it("should escape special XML characters in highlights and comments", async () => {
      const user = userEvent.setup();
      const onProvideFeedback = vi.fn();

      render(
        <GenerationPreview
          content="Use <Component> & check props"
          source="deep"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onProvideFeedback={onProvideFeedback}
        />
      );

      simulateAddHighlight("<Component> & check", 'Use "props" & \'state\'');

      await waitFor(() => {
        expect(screen.getByText("1 comment")).toBeInTheDocument();
      });

      const submitButton = screen.getByRole("button", { name: /submit feedback/i });
      await user.click(submitButton);

      await waitFor(() => {
        const call = onProvideFeedback.mock.calls[0][0];
        expect(call).toContain("&lt;Component&gt; &amp; check");
        expect(call).toContain("&quot;props&quot; &amp; &apos;state&apos;");
      });
    });

    it("should handle markdown formatting in highlighted text", async () => {
      const user = userEvent.setup();
      const onProvideFeedback = vi.fn();

      render(
        <GenerationPreview
          content="Here is **bold text** and `code block`"
          source="deep"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onProvideFeedback={onProvideFeedback}
        />
      );

      simulateAddHighlight("**bold text** and `code block`", "Review formatting");

      await waitFor(() => {
        expect(screen.getByText("1 comment")).toBeInTheDocument();
      });

      const submitButton = screen.getByRole("button", { name: /submit feedback/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(onProvideFeedback).toHaveBeenCalledWith(
          expect.stringContaining("<highlight>**bold text** and `code block`</highlight>")
        );
      });
    });
  });

  describe("Highlight Badge Display", () => {
    it("should not show badge when no highlights exist", () => {
      render(
        <GenerationPreview
          content="Test content"
          source="quick"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onProvideFeedback={vi.fn()}
        />
      );

      expect(screen.queryByText(/comment/i)).not.toBeInTheDocument();
    });

    it("should show '1 comment' badge with single highlight", async () => {
      render(
        <GenerationPreview
          content="Test content"
          source="quick"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onProvideFeedback={vi.fn()}
        />
      );

      simulateAddHighlight("Test", "Comment text");

      await waitFor(() => {
        expect(screen.getByText("1 comment")).toBeInTheDocument();
      });
    });

    it("should show '2 comments' badge with multiple highlights", async () => {
      render(
        <GenerationPreview
          content="First section and second section"
          source="quick"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onProvideFeedback={vi.fn()}
        />
      );

      simulateAddHighlight("First", "First comment");
      simulateAddHighlight("second", "Second comment");

      await waitFor(() => {
        expect(screen.getByText("2 comments")).toBeInTheDocument();
      });
    });

    it("should hide badge after feedback submission", async () => {
      const user = userEvent.setup();

      render(
        <GenerationPreview
          content="Test content"
          source="quick"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onProvideFeedback={vi.fn()}
        />
      );

      simulateAddHighlight("Test", "Comment");

      await waitFor(() => {
        expect(screen.getByText("1 comment")).toBeInTheDocument();
      });

      const submitButton = screen.getByRole("button", { name: /submit feedback/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.queryByText(/comment/i)).not.toBeInTheDocument();
      });
    });
  });

  describe("State Management", () => {
    it("should clear highlights and feedback after submission", async () => {
      const user = userEvent.setup();
      const onProvideFeedback = vi.fn();

      render(
        <GenerationPreview
          content="Test content"
          source="quick"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onProvideFeedback={onProvideFeedback}
        />
      );

      simulateAddHighlight("Test", "Comment");

      await waitFor(() => {
        expect(screen.getByText("1 comment")).toBeInTheDocument();
      });

      const feedbackInput = screen.getByPlaceholderText("Provide feedback...");
      await user.type(feedbackInput, "General feedback");

      const submitButton = screen.getByRole("button", { name: /submit feedback/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.queryByText(/comment/i)).not.toBeInTheDocument();
        expect(feedbackInput).toHaveValue("");
      });
    });

    it("should maintain highlights until submission", async () => {
      render(
        <GenerationPreview
          content="Test content with multiple sections"
          source="quick"
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onProvideFeedback={vi.fn()}
        />
      );

      simulateAddHighlight("Test", "First comment");
      simulateAddHighlight("multiple", "Second comment");
      simulateAddHighlight("sections", "Third comment");

      await waitFor(() => {
        expect(screen.getByText("3 comments")).toBeInTheDocument();
      });

      // Highlights should persist until submit is clicked
      expect(screen.getByText("3 comments")).toBeInTheDocument();
    });
  });
});
