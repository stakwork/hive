import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AITextareaSection } from "@/components/features/AITextareaSection";
import { toast } from "sonner";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: Object.assign(
    vi.fn((message, options) => {
      if (typeof message === "string" && message.includes("successfully")) {
        return;
      }
      if (options?.description) {
        return;
      }
    }),
    {
      error: vi.fn((message, options) => {}),
    }
  ),
}));

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
  DiagramViewer: ({ diagramUrl, isGenerating }: { diagramUrl: string | null; isGenerating: boolean }) => (
    <div data-testid="diagram-viewer">
      {isGenerating && <div>Generating diagram...</div>}
      {diagramUrl && <div>Diagram URL: {diagramUrl}</div>}
      {!diagramUrl && !isGenerating && <div>No diagram</div>}
    </div>
  ),
}));

vi.mock("@/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: string }) => <div data-testid="markdown-renderer">{children}</div>,
}));

vi.mock("@/components/features/GenerationControls", () => ({
  GenerationControls: ({ 
    showGenerateDiagram, 
    onGenerateDiagram, 
    isGeneratingDiagram 
  }: { 
    showGenerateDiagram?: boolean; 
    onGenerateDiagram?: () => void; 
    isGeneratingDiagram?: boolean;
  }) => (
    <div data-testid="generation-controls">
      {showGenerateDiagram && (
        <button onClick={onGenerateDiagram} disabled={isGeneratingDiagram}>
          {isGeneratingDiagram ? "Generating Diagram..." : "Generate Diagram"}
        </button>
      )}
    </div>
  ),
}));

vi.mock("@/components/ui/ai-button", () => ({
  AIButton: () => <button>Generate</button>,
}));

global.fetch = vi.fn();

describe("AITextareaSection - Diagram Generation", () => {
  const defaultProps = {
    id: "architecture",
    label: "Architecture",
    type: "architecture" as const,
    featureId: "feature-123",
    value: "Some architecture text",
    savedField: "architecture",
    saving: false,
    saved: true,
    onChange: vi.fn(),
    onBlur: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("AI Button and Generation Controls Visibility", () => {
    it("should not show AI Button for architecture type", () => {
      render(<AITextareaSection {...defaultProps} />);

      expect(screen.queryByText("Generate")).not.toBeInTheDocument();
    });

    it("should not show GenerationControls for architecture type", () => {
      render(<AITextareaSection {...defaultProps} />);

      expect(screen.queryByTestId("generation-controls")).not.toBeInTheDocument();
    });

    it("should show AI Button for requirements type", () => {
      render(
        <AITextareaSection
          {...defaultProps}
          type="requirements"
          id="requirements"
          label="Requirements"
        />
      );

      expect(screen.getByText("Generate")).toBeInTheDocument();
    });

    it("should show GenerationControls for requirements type", () => {
      render(
        <AITextareaSection
          {...defaultProps}
          type="requirements"
          id="requirements"
          label="Requirements"
        />
      );

      expect(screen.getByTestId("generation-controls")).toBeInTheDocument();
    });
  });

  describe("Generate Diagram Button Visibility", () => {
    it("should not show Generate Diagram button for architecture type (buttons removed)", () => {
      render(<AITextareaSection {...defaultProps} />);

      expect(screen.queryByText("Generate Diagram")).not.toBeInTheDocument();
    });

    it("should not show Generate Diagram button for requirements type", () => {
      render(
        <AITextareaSection
          {...defaultProps}
          type="requirements"
          id="requirements"
          label="Requirements"
        />
      );

      expect(screen.queryByText("Generate Diagram")).not.toBeInTheDocument();
    });
  });

  describe("DiagramViewer Integration", () => {
    it("should display DiagramViewer in preview mode for architecture type", () => {
      render(<AITextareaSection {...defaultProps} />);

      expect(screen.getByTestId("diagram-viewer")).toBeInTheDocument();
    });

    it("should not display DiagramViewer for non-architecture types", () => {
      render(
        <AITextareaSection
          {...defaultProps}
          type="requirements"
          id="requirements"
          label="Requirements"
        />
      );

      expect(screen.queryByTestId("diagram-viewer")).not.toBeInTheDocument();
    });
  });

  describe("Component Rendering", () => {
    it("should render without crashing", () => {
      const { container } = render(<AITextareaSection {...defaultProps} />);
      expect(container).toBeInTheDocument();
    });
  });
});
