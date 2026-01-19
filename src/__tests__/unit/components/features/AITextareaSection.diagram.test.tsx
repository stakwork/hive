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

  describe("Generate Diagram Button Visibility", () => {
    it("should NOT show Generate Diagram button for architecture type (removed as per requirements)", () => {
      render(<AITextareaSection {...defaultProps} />);

      expect(screen.queryByText("Generate Diagram")).not.toBeInTheDocument();
    });

    it("should not show Generate Diagram button for non-architecture types", () => {
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

    it("should not show Generate Diagram button when architecture text is empty", () => {
      render(<AITextareaSection {...defaultProps} value="" />);

      expect(screen.queryByText("Generate Diagram")).not.toBeInTheDocument();
    });

    it("should not show Generate Diagram button when architecture text is null", () => {
      render(<AITextareaSection {...defaultProps} value={null} />);

      expect(screen.queryByText("Generate Diagram")).not.toBeInTheDocument();
    });
  });

  // Note: The following tests are commented out because the Generate Diagram button
  // has been removed from the Architecture section UI as per requirements.
  // The handleGenerateDiagram functionality still exists but is not accessible via UI.
  
  /* 
  describe("Diagram Generation API Integration", () => {
    it("should call API endpoint when Generate Diagram button is clicked", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ diagramUrl: "https://example.com/diagram.png", s3Key: "key123" }),
      });
      global.fetch = mockFetch;

      render(<AITextareaSection {...defaultProps} />);

      const generateButton = screen.getByText("Generate Diagram");
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/features/feature-123/diagram/generate",
          expect.objectContaining({
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          })
        );
      });
    });

    it("should update diagram URL after successful generation", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ diagramUrl: "https://example.com/diagram.png", s3Key: "key123" }),
      });
      global.fetch = mockFetch;

      render(<AITextareaSection {...defaultProps} />);

      const generateButton = screen.getByText("Generate Diagram");
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByText("Diagram URL: https://example.com/diagram.png")).toBeInTheDocument();
      });
    });

    it("should show loading state during diagram generation", async () => {
      const mockFetch = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: async () => ({ diagramUrl: "test.png" }) }), 100))
      );
      global.fetch = mockFetch;

      render(<AITextareaSection {...defaultProps} />);

      const generateButton = screen.getByText("Generate Diagram");
      fireEvent.click(generateButton);

      // Should show loading state
      await waitFor(() => {
        expect(screen.getByText("Generating Diagram...")).toBeInTheDocument();
      });
    });
  });

  describe("Error Handling", () => {
    it("should display error toast when API call fails", async () => {
      const mockToast = vi.mocked(toast);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ message: "Generation failed" }),
      });
      global.fetch = mockFetch;

      render(<AITextareaSection {...defaultProps} />);

      const generateButton = screen.getByText("Generate Diagram");
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            description: expect.any(String),
          })
        );
      });
    });

    it("should show error toast when architecture text is missing", async () => {
      const mockToast = vi.mocked(toast);

      render(<AITextareaSection {...defaultProps} value={null} />);

      // When value is null, button shouldn't appear at all
      const generateButton = screen.queryByText("Generate Diagram");
      expect(generateButton).not.toBeInTheDocument();
    });

    it("should retry on failure", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ message: "Generation failed" }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ message: "Generation failed" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ diagramUrl: "https://example.com/diagram.png" }),
        });
      global.fetch = mockFetch;

      render(<AITextareaSection {...defaultProps} />);

      const generateButton = screen.getByText("Generate Diagram");
      fireEvent.click(generateButton);

      // Should eventually succeed after retries
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      }, { timeout: 8000 });
    });
  });
  */

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
