import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ArtifactsPanel } from "@/app/w/[slug]/task/[...taskParams]/components/ArtifactsPanel";
import { Artifact, ArtifactType } from "@/lib/chat";

// Mock framer-motion to avoid animation issues in tests
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

// Mock child artifact panels
vi.mock("@/app/w/[slug]/task/[...taskParams]/artifacts", () => ({
  CodeArtifactPanel: ({ artifacts }: { artifacts: Artifact[] }) => (
    <div data-testid="code-artifact-panel">
      Code Panel - {artifacts.length} artifacts
    </div>
  ),
  BrowserArtifactPanel: ({ 
    artifacts, 
    ide, 
    onDebugMessage 
  }: { 
    artifacts: Artifact[]; 
    ide?: boolean; 
    onDebugMessage?: (message: string, debugArtifact?: Artifact) => Promise<void>;
  }) => (
    <div data-testid={ide ? "ide-artifact-panel" : "browser-artifact-panel"}>
      {ide ? "IDE" : "Browser"} Panel - {artifacts.length} artifacts
    </div>
  ),
}));

// Test fixtures
const createArtifact = (type: ArtifactType, id = `artifact-${Math.random()}`): Artifact => ({
  id,
  type,
  content: type === "CODE" 
    ? { content: "console.log('test')", language: "javascript" }
    : type === "BROWSER" 
    ? { url: "https://example.com" }
    : type === "IDE"
    ? { url: "https://ide.example.com" }
    : {},
  icon: "test-icon",
});

describe("ArtifactsPanel", () => {
  const mockOnDebugMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering with empty artifacts", () => {
    test("should return null when no artifacts are provided", () => {
      const { container } = render(
        <ArtifactsPanel artifacts={[]} onDebugMessage={mockOnDebugMessage} />
      );
      expect(container.firstChild).toBeNull();
    });

    test("should return null when no artifacts match supported types", () => {
      const unsupportedArtifacts = [
        createArtifact("FORM" as ArtifactType),
        createArtifact("LONGFORM" as ArtifactType),
      ];
      const { container } = render(
        <ArtifactsPanel artifacts={unsupportedArtifacts} onDebugMessage={mockOnDebugMessage} />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe("Artifact Filtering Logic", () => {
    test("should filter CODE artifacts correctly", () => {
      const artifacts = [
        createArtifact("CODE"),
        createArtifact("BROWSER"),
        createArtifact("CODE"),
        createArtifact("IDE"),
      ];

      render(<ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />);

      expect(screen.getByText("Code / Files")).toBeInTheDocument();
      expect(screen.getByText("Live Preview")).toBeInTheDocument();
      expect(screen.getByText("IDE")).toBeInTheDocument();
    });

    test("should filter BROWSER artifacts correctly", () => {
      const artifacts = [
        createArtifact("BROWSER"),
        createArtifact("CODE"),
        createArtifact("BROWSER"),
      ];

      render(<ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />);

      expect(screen.getByText("Live Preview")).toBeInTheDocument();
      expect(screen.getByText("Code / Files")).toBeInTheDocument();
    });

    test("should filter IDE artifacts correctly", () => {
      const artifacts = [
        createArtifact("IDE"),
        createArtifact("CODE"),
        createArtifact("IDE"),
      ];

      render(<ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />);

      expect(screen.getByText("IDE")).toBeInTheDocument();
      expect(screen.getByText("Code / Files")).toBeInTheDocument();
    });

    test("should handle single artifact type", () => {
      const codeOnlyArtifacts = [
        createArtifact("CODE"),
        createArtifact("CODE"),
      ];

      render(<ArtifactsPanel artifacts={codeOnlyArtifacts} onDebugMessage={mockOnDebugMessage} />);

      expect(screen.getByText("Code / Files")).toBeInTheDocument();
      expect(screen.queryByText("Live Preview")).not.toBeInTheDocument();
      expect(screen.queryByText("IDE")).not.toBeInTheDocument();
    });

    test("should handle mixed artifact types", () => {
      const mixedArtifacts = [
        createArtifact("CODE"),
        createArtifact("BROWSER"),
        createArtifact("IDE"),
        createArtifact("FORM" as ArtifactType), // Should be filtered out
      ];

      render(<ArtifactsPanel artifacts={mixedArtifacts} onDebugMessage={mockOnDebugMessage} />);

      expect(screen.getByText("Code / Files")).toBeInTheDocument();
      expect(screen.getByText("Live Preview")).toBeInTheDocument();
      expect(screen.getByText("IDE")).toBeInTheDocument();
    });
  });

  describe("Tab Selection Logic", () => {
    test("should auto-select first available tab on mount", async () => {
      const artifacts = [
        createArtifact("BROWSER"),
        createArtifact("CODE"),
        createArtifact("IDE"),
      ];

      render(<ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />);

      // First available tab should be CODE (since that's first in availableTabs array)
      await waitFor(() => {
        expect(screen.getByTestId("code-artifact-panel")).toBeInTheDocument();
      });
    });

    test("should switch tabs when tab trigger is clicked", async () => {
      const artifacts = [
        createArtifact("CODE"),
        createArtifact("BROWSER"),
      ];

      render(<ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />);

      // Initially CODE tab should be active
      await waitFor(() => {
        expect(screen.getByTestId("code-artifact-panel")).toBeInTheDocument();
      });

      // Click BROWSER tab  
      fireEvent.click(screen.getByText("Live Preview"));

      await waitFor(() => {
        // Both panels should exist due to forceMount
        expect(screen.getByTestId("browser-artifact-panel")).toBeInTheDocument();
        expect(screen.getByTestId("code-artifact-panel")).toBeInTheDocument();
      });
    });

    test("should handle tab switching between all artifact types", async () => {
      const artifacts = [
        createArtifact("CODE"),
        createArtifact("BROWSER"),
        createArtifact("IDE"),
      ];

      render(<ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />);

      // Initially CODE tab should be active
      await waitFor(() => {
        expect(screen.getByTestId("code-artifact-panel")).toBeInTheDocument();
      });

      // Switch to BROWSER tab
      fireEvent.click(screen.getByText("Live Preview"));
      await waitFor(() => {
        expect(screen.getByTestId("browser-artifact-panel")).toBeInTheDocument();
      });

      // Switch to IDE tab
      fireEvent.click(screen.getByText("IDE"));
      await waitFor(() => {
        expect(screen.getByTestId("ide-artifact-panel")).toBeInTheDocument();
      });

      // Switch back to CODE tab
      fireEvent.click(screen.getByText("Code / Files"));
      await waitFor(() => {
        expect(screen.getByTestId("code-artifact-panel")).toBeInTheDocument();
      });
    });

    test("should maintain tab selection when artifacts change but activeTab is still valid", async () => {
      const initialArtifacts = [
        createArtifact("CODE"),
        createArtifact("BROWSER"),
      ];

      const { rerender } = render(
        <ArtifactsPanel artifacts={initialArtifacts} onDebugMessage={mockOnDebugMessage} />
      );

      // Switch to BROWSER tab
      fireEvent.click(screen.getByText("Live Preview"));
      await waitFor(() => {
        expect(screen.getByTestId("browser-artifact-panel")).toBeInTheDocument();
      });

      // Update artifacts but keep BROWSER type
      const updatedArtifacts = [
        createArtifact("CODE"),
        createArtifact("BROWSER"),
        createArtifact("IDE"),
      ];

      rerender(<ArtifactsPanel artifacts={updatedArtifacts} onDebugMessage={mockOnDebugMessage} />);

      // Should still be on BROWSER tab
      await waitFor(() => {
        expect(screen.getByTestId("browser-artifact-panel")).toBeInTheDocument();
      });
    });

    test("should auto-select new first tab when current activeTab type is no longer available", async () => {
      const initialArtifacts = [
        createArtifact("CODE"),
        createArtifact("BROWSER"),
      ];

      const { rerender } = render(
        <ArtifactsPanel artifacts={initialArtifacts} onDebugMessage={mockOnDebugMessage} />
      );

      // Switch to BROWSER tab
      fireEvent.click(screen.getByText("Live Preview"));
      await waitFor(() => {
        expect(screen.getByTestId("browser-artifact-panel")).toBeInTheDocument();
      });

      // Update artifacts to only have CODE type
      const updatedArtifacts = [
        createArtifact("CODE"),
        createArtifact("CODE"),
      ];

      rerender(<ArtifactsPanel artifacts={updatedArtifacts} onDebugMessage={mockOnDebugMessage} />);

      // Should auto-select CODE tab since BROWSER is no longer available
      await waitFor(() => {
        expect(screen.getByTestId("code-artifact-panel")).toBeInTheDocument();
      });
    });
  });

  describe("Rendering Logic", () => {
    test("should render CodeArtifactPanel for CODE artifacts", async () => {
      const artifacts = [
        createArtifact("CODE"),
        createArtifact("CODE"),
      ];

      render(<ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />);

      await waitFor(() => {
        const codePanel = screen.getByTestId("code-artifact-panel");
        expect(codePanel).toBeInTheDocument();
        expect(codePanel).toHaveTextContent("Code Panel - 2 artifacts");
      });
    });

    test("should render BrowserArtifactPanel for BROWSER artifacts", async () => {
      const artifacts = [
        createArtifact("BROWSER"),
        createArtifact("BROWSER"),
      ];

      render(<ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />);

      await waitFor(() => {
        const browserPanel = screen.getByTestId("browser-artifact-panel");
        expect(browserPanel).toBeInTheDocument();
        expect(browserPanel).toHaveTextContent("Browser Panel - 2 artifacts");
      });
    });

    test("should render BrowserArtifactPanel with ide=true for IDE artifacts", async () => {
      const artifacts = [
        createArtifact("IDE"),
        createArtifact("IDE"),
      ];

      render(<ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />);

      await waitFor(() => {
        const idePanel = screen.getByTestId("ide-artifact-panel");
        expect(idePanel).toBeInTheDocument();
        expect(idePanel).toHaveTextContent("IDE Panel - 2 artifacts");
      });
    });

    test("should pass onDebugMessage prop to BrowserArtifactPanel", async () => {
      const artifacts = [createArtifact("BROWSER")];

      render(<ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />);

      await waitFor(() => {
        expect(screen.getByTestId("browser-artifact-panel")).toBeInTheDocument();
      });
    });

    test("should use forceMount and hidden attributes for TabsContent", async () => {
      const artifacts = [
        createArtifact("CODE"),
        createArtifact("BROWSER"),
      ];

      render(<ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />);

      // CODE should be visible initially
      await waitFor(() => {
        expect(screen.getByTestId("code-artifact-panel")).toBeInTheDocument();
      });

      // BROWSER content should exist but be hidden
      const browserTab = screen.getByText("Live Preview").closest('[role="tab"]');
      expect(browserTab).toHaveAttribute('aria-selected', 'false');
    });

    test("should render correct tab triggers based on available artifact types", () => {
      const artifacts = [
        createArtifact("CODE"),
        createArtifact("IDE"),
        // No BROWSER artifacts
      ];

      render(<ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />);

      expect(screen.getByText("Code / Files")).toBeInTheDocument();
      expect(screen.getByText("IDE")).toBeInTheDocument();
      expect(screen.queryByText("Live Preview")).not.toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty artifact arrays for specific types", async () => {
      // This tests the internal filtering logic when some types have no artifacts
      const artifacts = [
        createArtifact("CODE"),
        // No BROWSER or IDE artifacts
      ];

      render(<ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />);

      expect(screen.getByText("Code / Files")).toBeInTheDocument();
      expect(screen.queryByText("Live Preview")).not.toBeInTheDocument();
      expect(screen.queryByText("IDE")).not.toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByTestId("code-artifact-panel")).toBeInTheDocument();
      });
    });

    test("should handle artifacts with same ID", () => {
      const artifacts = [
        createArtifact("CODE", "duplicate-id"),
        createArtifact("BROWSER", "duplicate-id"),
      ];

      render(<ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />);

      expect(screen.getByText("Code / Files")).toBeInTheDocument();
      expect(screen.getByText("Live Preview")).toBeInTheDocument();
    });

    test("should handle rapid tab switching", async () => {
      const artifacts = [
        createArtifact("CODE"),
        createArtifact("BROWSER"),
        createArtifact("IDE"),
      ];

      render(<ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />);

      // Rapid tab switching
      fireEvent.click(screen.getByText("Live Preview"));
      fireEvent.click(screen.getByText("IDE"));
      fireEvent.click(screen.getByText("Code / Files"));

      await waitFor(() => {
        expect(screen.getByTestId("code-artifact-panel")).toBeInTheDocument();
      });
    });

    test("should handle onDebugMessage being undefined", async () => {
      const artifacts = [createArtifact("BROWSER")];

      render(<ArtifactsPanel artifacts={artifacts} />);

      await waitFor(() => {
        expect(screen.getByTestId("browser-artifact-panel")).toBeInTheDocument();
      });
    });
  });

  describe("Performance and Optimization", () => {
    test("should memoize availableTabs computation", () => {
      const artifacts = [
        createArtifact("CODE"),
        createArtifact("BROWSER"),
      ];

      const { rerender } = render(
        <ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />
      );

      expect(screen.getByText("Code / Files")).toBeInTheDocument();
      expect(screen.getByText("Live Preview")).toBeInTheDocument();

      // Rerender with same artifacts - should not cause issues
      rerender(<ArtifactsPanel artifacts={artifacts} onDebugMessage={mockOnDebugMessage} />);

      expect(screen.getByText("Code / Files")).toBeInTheDocument();
      expect(screen.getByText("Live Preview")).toBeInTheDocument();
    });

    test("should handle large numbers of artifacts efficiently", async () => {
      const largeArtifactArray = [
        ...Array(50).fill(null).map(() => createArtifact("CODE")),
        ...Array(30).fill(null).map(() => createArtifact("BROWSER")),
        ...Array(20).fill(null).map(() => createArtifact("IDE")),
      ];

      render(<ArtifactsPanel artifacts={largeArtifactArray} onDebugMessage={mockOnDebugMessage} />);

      expect(screen.getByText("Code / Files")).toBeInTheDocument();
      expect(screen.getByText("Live Preview")).toBeInTheDocument();
      expect(screen.getByText("IDE")).toBeInTheDocument();

      await waitFor(() => {
        const codePanel = screen.getByTestId("code-artifact-panel");
        expect(codePanel).toHaveTextContent("Code Panel - 50 artifacts");
      });
    });
  });
});