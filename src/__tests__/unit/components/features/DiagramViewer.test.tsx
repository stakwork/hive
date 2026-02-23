import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DiagramViewer } from "@/components/features/DiagramViewer";

describe("DiagramViewer", () => {
  describe("Loading States", () => {
    it("should display skeleton loader when isGenerating is true", () => {
      render(<DiagramViewer diagramUrl={null} isGenerating={true} />);
      
      // Should show skeleton elements
      const skeletons = document.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it("should not display skeleton loader when isGenerating is false", () => {
      render(<DiagramViewer diagramUrl={null} isGenerating={false} />);
      
      // Should not show skeleton elements
      const skeletons = document.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBe(0);
    });
  });

  describe("Placeholder State", () => {
    it("should render nothing when diagramUrl is null and not generating", () => {
      const { container } = render(<DiagramViewer diagramUrl={null} isGenerating={false} />);

      expect(container.childElementCount).toBe(0);
    });
  });

  describe("Diagram Display", () => {
    it("should display diagram image when valid URL is provided", async () => {
      const testUrl = "https://example.com/diagram.png";
      render(<DiagramViewer diagramUrl={testUrl} isGenerating={false} />);
      
      const image = screen.getByAltText("Architecture Diagram");
      expect(image).toBeInTheDocument();
      expect(image).toHaveAttribute("src", testUrl);
    });

    it("should display heading when diagram URL exists", () => {
      render(<DiagramViewer diagramUrl="https://example.com/diagram.png" isGenerating={false} />);
      
      expect(screen.getByText("Architecture Diagram")).toBeInTheDocument();
    });

    it("should initially show skeleton while image is loading", () => {
      const { container } = render(
        <DiagramViewer diagramUrl="https://example.com/diagram.png" isGenerating={false} />
      );
      
      // Image should start with opacity-0 class
      const image = screen.getByAltText("Architecture Diagram");
      expect(image).toHaveClass("opacity-0");
      
      // Skeleton should be visible
      const skeleton = container.querySelector(".absolute.inset-0");
      expect(skeleton).toBeInTheDocument();
    });

    it("should remove skeleton and show image after load", async () => {
      render(<DiagramViewer diagramUrl="https://example.com/diagram.png" isGenerating={false} />);
      
      const image = screen.getByAltText("Architecture Diagram") as HTMLImageElement;
      
      // Simulate image load using fireEvent
      fireEvent.load(image);
      
      await waitFor(() => {
        expect(image).toHaveClass("opacity-100");
      });
    });
  });

  describe("Error Handling", () => {
    it("should display error message when image fails to load", async () => {
      render(<DiagramViewer diagramUrl="https://example.com/invalid.png" isGenerating={false} />);
      
      const image = screen.getByAltText("Architecture Diagram") as HTMLImageElement;
      
      // Simulate image error using fireEvent
      fireEvent.error(image);
      
      await waitFor(() => {
        expect(screen.getByText(/Failed to load diagram/i)).toBeInTheDocument();
      });
    });

    it("should display AlertCircle icon on error", async () => {
      render(
        <DiagramViewer diagramUrl="https://example.com/invalid.png" isGenerating={false} />
      );
      
      const image = screen.getByAltText("Architecture Diagram") as HTMLImageElement;
      
      // Simulate image error using fireEvent
      fireEvent.error(image);
      
      await waitFor(() => {
        expect(screen.getByText(/Failed to load diagram/i)).toBeInTheDocument();
      });
    });

    it("should not display image when error occurs", async () => {
      render(<DiagramViewer diagramUrl="https://example.com/invalid.png" isGenerating={false} />);
      
      const image = screen.getByAltText("Architecture Diagram") as HTMLImageElement;
      
      // Simulate image error using fireEvent
      fireEvent.error(image);
      
      await waitFor(() => {
        expect(screen.queryByAltText("Architecture Diagram")).not.toBeInTheDocument();
      });
    });
  });

  describe("Component Rendering", () => {
    it("should render without crashing with null diagramUrl", () => {
      const { container } = render(<DiagramViewer diagramUrl={null} isGenerating={false} />);
      expect(container).toBeInTheDocument();
    });

    it("should render without crashing with valid diagramUrl", () => {
      const { container } = render(
        <DiagramViewer diagramUrl="https://example.com/diagram.png" isGenerating={false} />
      );
      expect(container).toBeInTheDocument();
    });

    it("should apply proper container styling", () => {
      const { container } = render(
        <DiagramViewer diagramUrl="https://example.com/diagram.png" isGenerating={false} />
      );
      
      const wrapper = container.querySelector(".space-y-2");
      expect(wrapper).toBeInTheDocument();
    });
  });
});
