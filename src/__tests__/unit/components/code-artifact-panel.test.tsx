import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { CodeArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/code";
import { Artifact, CodeContent, ArtifactType } from "@/lib/chat";

// Mock clipboard API
const mockWriteText = vi.fn();
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
});

// Mock Prism highlighting and components
vi.mock("prismjs", () => ({
  default: {
    highlightElement: vi.fn(),
  },
}));

// Mock Prism language components
vi.mock("prismjs/components/prism-javascript", () => ({}));
vi.mock("prismjs/components/prism-typescript", () => ({}));
vi.mock("prismjs/components/prism-jsx", () => ({}));
vi.mock("prismjs/components/prism-tsx", () => ({}));
vi.mock("prismjs/components/prism-css", () => ({}));
vi.mock("prismjs/components/prism-python", () => ({}));
vi.mock("prismjs/components/prism-ruby", () => ({}));
vi.mock("prismjs/components/prism-json", () => ({}));

// Mock CSS import
vi.mock("@/app/w/[slug]/task/[...taskParams]/artifacts/prism-dark-plus.css", () => ({}));

describe("CodeArtifactPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  const createMockArtifact = (
    id: string, 
    content: CodeContent, 
    overrides: Partial<Artifact> = {}
  ): Artifact => ({
    id,
    messageId: "msg-1",
    type: ArtifactType.CODE,
    content,
    icon: "Code",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  });

  describe("Component Rendering", () => {
    test("should render nothing when no artifacts provided", () => {
      const { container } = render(<CodeArtifactPanel artifacts={[]} />);
      expect(container.firstChild).toBeNull();
    });

    test("should render single artifact without tabs", () => {
      const artifacts = [
        createMockArtifact("1", {
          content: "console.log('hello');",
          language: "javascript",
          file: "test.js",
        }),
      ];

      render(<CodeArtifactPanel artifacts={artifacts} />);

      expect(screen.queryByRole("button", { name: /test\.js/i })).not.toBeInTheDocument();
      expect(screen.getByText("test.js")).toBeInTheDocument();
      expect(screen.getByText("console.log('hello');")).toBeInTheDocument();
    });

    test("should render multiple artifacts with tabs", () => {
      const artifacts = [
        createMockArtifact("1", {
          content: "console.log('hello');",
          language: "javascript",
          file: "test.js",
        }),
        createMockArtifact("2", {
          content: "print('world')",
          language: "python",
          file: "test.py",
        }),
      ];

      render(<CodeArtifactPanel artifacts={artifacts} />);

      expect(screen.getByRole("button", { name: "test.js" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "test.py" })).toBeInTheDocument();
      expect(screen.getByText("console.log('hello');")).toBeInTheDocument();
    });

    test("should show file action icons when action is specified", () => {
      const artifacts = [
        createMockArtifact("1", {
          content: "new file content",
          file: "new-file.js",
          action: "create",
        }),
      ];

      render(<CodeArtifactPanel artifacts={artifacts} />);

      expect(screen.getByText("new-file.js")).toBeInTheDocument();
      // The action icon should be rendered (green FileText icon for create)
      const actionIcon = screen.getByText("new-file.js").closest("div")?.querySelector("svg");
      expect(actionIcon).toBeInTheDocument();
    });

    test("should display change description when provided", () => {
      const artifacts = [
        createMockArtifact("1", {
          content: "updated content",
          file: "updated.js",
          change: "Add error handling",
        }),
      ];

      render(<CodeArtifactPanel artifacts={artifacts} />);

      expect(screen.getByText("Add error handling")).toBeInTheDocument();
    });
  });

  describe("Tab Switching Functionality", () => {
    test("should start with first tab active", () => {
      const artifacts = [
        createMockArtifact("1", {
          content: "first content",
          file: "first.js",
        }),
        createMockArtifact("2", {
          content: "second content",
          file: "second.js",
        }),
      ];

      render(<CodeArtifactPanel artifacts={artifacts} />);

      const firstTab = screen.getByRole("button", { name: "first.js" });
      const secondTab = screen.getByRole("button", { name: "second.js" });

      expect(firstTab).toHaveClass("border-primary");
      expect(secondTab).toHaveClass("border-transparent");
      expect(screen.getByText("first content")).toBeInTheDocument();
      expect(screen.queryByText("second content")).not.toBeInTheDocument();
    });

    test("should switch tabs when clicked", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const artifacts = [
        createMockArtifact("1", {
          content: "first content",
          file: "first.js",
        }),
        createMockArtifact("2", {
          content: "second content",
          file: "second.js",
        }),
      ];

      render(<CodeArtifactPanel artifacts={artifacts} />);

      const secondTab = screen.getByRole("button", { name: "second.js" });
      await user.click(secondTab);

      expect(secondTab).toHaveClass("border-primary");
      expect(screen.getByText("second content")).toBeInTheDocument();
      expect(screen.queryByText("first content")).not.toBeInTheDocument();
    });

    test("should handle tab switching with fallback names", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const artifacts = [
        createMockArtifact("1", {
          content: "first content",
        }),
        createMockArtifact("2", {
          content: "second content",
        }),
      ];

      render(<CodeArtifactPanel artifacts={artifacts} />);

      const secondTab = screen.getByRole("button", { name: "Code 2" });
      await user.click(secondTab);

      expect(secondTab).toHaveClass("border-primary");
      expect(screen.getByText("second content")).toBeInTheDocument();
    });

    test("should maintain tab state across multiple switches", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const artifacts = [
        createMockArtifact("1", { content: "first", file: "first.js" }),
        createMockArtifact("2", { content: "second", file: "second.js" }),
        createMockArtifact("3", { content: "third", file: "third.js" }),
      ];

      render(<CodeArtifactPanel artifacts={artifacts} />);

      // Switch to third tab
      await user.click(screen.getByRole("button", { name: "third.js" }));
      expect(screen.getByText("third")).toBeInTheDocument();

      // Switch back to first tab
      await user.click(screen.getByRole("button", { name: "first.js" }));
      expect(screen.getByText("first")).toBeInTheDocument();

      // Switch to second tab
      await user.click(screen.getByRole("button", { name: "second.js" }));
      expect(screen.getByText("second")).toBeInTheDocument();
    });
  });

  describe("Code Normalization", () => {
    test("should handle string content directly", () => {
      const stringContent = "const x = 'hello world';";
      const artifacts = [
        createMockArtifact("1", {
          content: stringContent,
          language: "javascript",
        }),
      ];

      render(<CodeArtifactPanel artifacts={artifacts} />);

      expect(screen.getByText(stringContent)).toBeInTheDocument();
    });

    test("should normalize object content to JSON string", () => {
      const objectContent = {
        name: "test-package",
        version: "1.0.0",
        scripts: {
          start: "node index.js",
          test: "jest",
        },
      };
      const artifacts = [
        createMockArtifact("1", {
          content: objectContent,
          language: "json",
          file: "package.json",
        }),
      ];

      render(<CodeArtifactPanel artifacts={artifacts} />);

      const expectedJSON = JSON.stringify(objectContent, null, 2);
      expect(screen.getByText(expectedJSON)).toBeInTheDocument();
    });

    test("should handle nested object content", () => {
      const complexObject = {
        database: {
          host: "localhost",
          port: 5432,
          credentials: {
            username: "admin",
            password: "secret",
          },
        },
        features: ["auth", "logging", "cache"],
      };
      const artifacts = [
        createMockArtifact("1", {
          content: complexObject,
          language: "json",
        }),
      ];

      render(<CodeArtifactPanel artifacts={artifacts} />);

      const expectedJSON = JSON.stringify(complexObject, null, 2);
      expect(screen.getByText(expectedJSON)).toBeInTheDocument();
    });

    test("should handle null and undefined content", () => {
      const artifacts = [
        createMockArtifact("1", {
          content: null,
        }),
        createMockArtifact("2", {
          content: undefined,
        }),
      ];

      render(<CodeArtifactPanel artifacts={artifacts} />);

      expect(screen.getByText("null")).toBeInTheDocument();
    });

    test("should handle array content", () => {
      const arrayContent = ["item1", "item2", { nested: "object" }];
      const artifacts = [
        createMockArtifact("1", {
          content: arrayContent,
          language: "json",
        }),
      ];

      render(<CodeArtifactPanel artifacts={artifacts} />);

      // Check that each part is present instead of exact match
      expect(screen.getByText(/"item1"/)).toBeInTheDocument();
      expect(screen.getByText(/"item2"/)).toBeInTheDocument();
      expect(screen.getByText(/"nested": "object"/)).toBeInTheDocument();
    });
  });

  describe("Copy-to-Clipboard Functionality", () => {
    test("should copy string content to clipboard", async () => {
      const content = "console.log('test');";
      const artifacts = [
        createMockArtifact("1", {
          content,
          language: "javascript",
        }),
      ];

      mockWriteText.mockResolvedValue(undefined);

      render(<CodeArtifactPanel artifacts={artifacts} />);

      const copyButton = screen.getByRole("button", { name: /copy/i });
      fireEvent.click(copyButton);

      expect(mockWriteText).toHaveBeenCalledWith(content);
    });

    test("should handle copy failures gracefully", async () => {
      const artifacts = [
        createMockArtifact("1", {
          content: "test content",
        }),
      ];

      // Mock clipboard failure
      mockWriteText.mockRejectedValue(new Error("Clipboard access denied"));

      render(<CodeArtifactPanel artifacts={artifacts} />);

      const copyButton = screen.getByRole("button", { name: /copy/i });
      fireEvent.click(copyButton);

      // Should not show success feedback on failure
      expect(screen.queryByLabelText(/check/i)).not.toBeInTheDocument();
    });
  });

  describe("Language Detection", () => {
    test("should detect language from file extension", () => {
      const artifacts = [
        createMockArtifact("1", {
          content: "const x = 1;",
          file: "test.ts",
        }),
      ];

      const { container } = render(<CodeArtifactPanel artifacts={artifacts} />);

      // Should apply typescript language class
      const codeElement = container.querySelector("code");
      expect(codeElement).toHaveClass("language-typescript");
    });

    test("should use explicit language when provided", () => {
      const artifacts = [
        createMockArtifact("1", {
          content: "print('hello')",
          language: "python",
        }),
      ];

      const { container } = render(<CodeArtifactPanel artifacts={artifacts} />);

      const codeElement = container.querySelector("code");
      expect(codeElement).toHaveClass("language-python");
    });

    test("should fallback to 'text' for unknown extensions", () => {
      const artifacts = [
        createMockArtifact("1", {
          content: "some content",
          file: "unknown.xyz",
        }),
      ];

      const { container } = render(<CodeArtifactPanel artifacts={artifacts} />);

      const codeElement = container.querySelector("code");
      expect(codeElement).toHaveClass("language-text");
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty content", () => {
      const artifacts = [
        createMockArtifact("1", {
          content: "",
          file: "empty.js",
        }),
      ];

      render(<CodeArtifactPanel artifacts={artifacts} />);

      expect(screen.getByText("empty.js")).toBeInTheDocument();
      // Empty content should still be rendered
      const codeElement = screen.getByRole("code");
      expect(codeElement).toBeInTheDocument();
    });

    test("should handle missing file names with appropriate fallbacks", () => {
      const artifacts = [
        createMockArtifact("1", { content: "first" }),
        createMockArtifact("2", { content: "second" }),
      ];

      render(<CodeArtifactPanel artifacts={artifacts} />);

      expect(screen.getByRole("button", { name: "Code 1" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Code 2" })).toBeInTheDocument();
    });

    test("should handle artifacts with long file paths", () => {
      const longPath = "src/components/deeply/nested/directories/component.tsx";
      const artifacts = [
        createMockArtifact("1", {
          content: "export const Component = () => {};",
          file: longPath,
        }),
      ];

      render(<CodeArtifactPanel artifacts={artifacts} />);

      // Since it's a single artifact, tabs won't be shown - the full path will be in header
      expect(screen.getByText(longPath)).toBeInTheDocument();
    });
  });
});