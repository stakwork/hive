import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AITextareaSection } from "@/components/features/AITextareaSection";

// Mock hooks
vi.mock("@/hooks/useAIGeneration", () => ({
  useAIGeneration: () => ({
    content: null,
    source: null,
    isLoading: false,
    setContent: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
    provideFeedback: vi.fn(),
    regenerate: vi.fn(),
  }),
}));

vi.mock("@/hooks/useStakworkGeneration", () => ({
  useStakworkGeneration: () => ({
    latestRun: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: { id: "workspace-123", slug: "test-workspace" },
  }),
}));

vi.mock("@/hooks/useImageUpload", () => ({
  useImageUpload: () => ({
    isDragging: false,
    isUploading: false,
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
    handlePaste: vi.fn(),
  }),
}));

// Mock components
vi.mock("@/components/features/DiagramViewer", () => ({
  DiagramViewer: () => <div data-testid="diagram-viewer">Diagram Viewer</div>,
}));

vi.mock("@/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: string }) => <div data-testid="markdown-renderer">{children}</div>,
}));

vi.mock("@/components/features/GenerationControls", () => ({
  GenerationControls: () => <div data-testid="generation-controls">Generation Controls</div>,
}));

vi.mock("@/components/ui/ai-button", () => ({
  AIButton: () => <button data-testid="ai-generate-button">Generate</button>,
}));

vi.mock("@/components/features/SaveIndicator", () => ({
  SaveIndicator: () => <div data-testid="save-indicator">Save Indicator</div>,
}));

describe("AITextareaSection - Generate Button Conditional Rendering", () => {
  const baseProps = {
    featureId: "feature-123",
    savedField: null,
    saving: false,
    saved: true,
    onChange: vi.fn(),
    onBlur: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Requirements Type", () => {
    const requirementsProps = {
      ...baseProps,
      id: "requirements",
      label: "Requirements",
      type: "requirements" as const,
      value: "Some requirements text",
    };

    it("should render Generate button for requirements type", () => {
      render(<AITextareaSection {...requirementsProps} />);
      
      const generateButton = screen.getByTestId("ai-generate-button");
      expect(generateButton).toBeInTheDocument();
      expect(generateButton).toHaveTextContent("Generate");
    });

    it("should render Generate button even when value is empty for requirements", () => {
      render(<AITextareaSection {...requirementsProps} value="" />);
      
      expect(screen.getByTestId("ai-generate-button")).toBeInTheDocument();
    });

    it("should render Generate button even when value is null for requirements", () => {
      render(<AITextareaSection {...requirementsProps} value={null} />);
      
      expect(screen.getByTestId("ai-generate-button")).toBeInTheDocument();
    });
  });

  describe("Architecture Type", () => {
    const architectureProps = {
      ...baseProps,
      id: "architecture",
      label: "Architecture",
      type: "architecture" as const,
      value: "Some architecture text",
    };

    it("should NOT render Generate button for architecture type", () => {
      render(<AITextareaSection {...architectureProps} />);
      
      expect(screen.queryByTestId("ai-generate-button")).not.toBeInTheDocument();
    });

    it("should NOT render Generate button for architecture type even with text", () => {
      render(<AITextareaSection {...architectureProps} value="Detailed architecture text" />);
      
      expect(screen.queryByTestId("ai-generate-button")).not.toBeInTheDocument();
    });

    it("should NOT render Generate button for architecture type when value is empty", () => {
      render(<AITextareaSection {...architectureProps} value="" />);
      
      expect(screen.queryByTestId("ai-generate-button")).not.toBeInTheDocument();
    });

    it("should NOT render Generate button for architecture type when value is null", () => {
      render(<AITextareaSection {...architectureProps} value={null} />);
      
      expect(screen.queryByTestId("ai-generate-button")).not.toBeInTheDocument();
    });

    it("should NOT render GenerationControls for architecture type", () => {
      render(<AITextareaSection {...architectureProps} />);
      
      expect(screen.queryByTestId("generation-controls")).not.toBeInTheDocument();
    });
  });

  describe("Other Component Features", () => {
    it("should still render SaveIndicator for both types", () => {
      const { rerender } = render(
        <AITextareaSection
          {...baseProps}
          id="requirements"
          label="Requirements"
          type="requirements"
          value="text"
        />
      );
      
      expect(screen.getByTestId("save-indicator")).toBeInTheDocument();
      
      rerender(
        <AITextareaSection
          {...baseProps}
          id="architecture"
          label="Architecture"
          type="architecture"
          value="text"
        />
      );
      
      expect(screen.getByTestId("save-indicator")).toBeInTheDocument();
    });

    it("should render DiagramViewer for architecture type", () => {
      render(
        <AITextareaSection
          {...baseProps}
          id="architecture"
          label="Architecture"
          type="architecture"
          value="text"
        />
      );
      
      expect(screen.getByTestId("diagram-viewer")).toBeInTheDocument();
    });

    it("should NOT render DiagramViewer for requirements type", () => {
      render(
        <AITextareaSection
          {...baseProps}
          id="requirements"
          label="Requirements"
          type="requirements"
          value="text"
        />
      );
      
      expect(screen.queryByTestId("diagram-viewer")).not.toBeInTheDocument();
    });
  });

  describe("Component Structure", () => {
    it("should render label for requirements type", () => {
      render(
        <AITextareaSection
          {...baseProps}
          id="requirements"
          label="Requirements"
          type="requirements"
          value="text"
        />
      );
      
      expect(screen.getByText("Requirements")).toBeInTheDocument();
    });

    it("should render label for architecture type", () => {
      render(
        <AITextareaSection
          {...baseProps}
          id="architecture"
          label="Architecture"
          type="architecture"
          value="text"
        />
      );
      
      expect(screen.getByText("Architecture")).toBeInTheDocument();
    });

    it("should render description when provided", () => {
      render(
        <AITextareaSection
          {...baseProps}
          id="requirements"
          label="Requirements"
          description="Test description"
          type="requirements"
          value="text"
        />
      );
      
      expect(screen.getByText("Test description")).toBeInTheDocument();
    });
  });
});
