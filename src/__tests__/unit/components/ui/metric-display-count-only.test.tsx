import React from "react";
import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricDisplayCountOnly } from "@/components/ui/metric-display-count-only";

describe("MetricDisplayCountOnly", () => {
  describe("Basic Rendering", () => {
    test("renders label and count", () => {
      render(<MetricDisplayCountOnly label="Test Metric" count={5} />);
      
      expect(screen.getByText("Test Metric")).toBeInTheDocument();
      expect(screen.getByText("5 tests")).toBeInTheDocument();
    });

    test("renders count with correct singular/plural", () => {
      const { rerender } = render(<MetricDisplayCountOnly label="Test" count={1} />);
      expect(screen.getByText("1 test")).toBeInTheDocument();
      
      rerender(<MetricDisplayCountOnly label="Test" count={2} />);
      expect(screen.getByText("2 tests")).toBeInTheDocument();
    });

    test("displays count of zero", () => {
      render(<MetricDisplayCountOnly label="E2E Tests" count={0} />);
      
      expect(screen.getByText("E2E Tests")).toBeInTheDocument();
      expect(screen.getByText("0 tests")).toBeInTheDocument();
    });
  });

  describe("Icon Rendering", () => {
    test("renders with icon when provided", () => {
      const icon = <span data-testid="test-icon">🧪</span>;
      render(<MetricDisplayCountOnly label="With Icon" count={10} icon={icon} />);
      
      expect(screen.getByTestId("test-icon")).toBeInTheDocument();
      expect(screen.getByText("With Icon")).toBeInTheDocument();
      expect(screen.getByText("10 tests")).toBeInTheDocument();
    });

    test("renders without icon when not provided", () => {
      render(<MetricDisplayCountOnly label="No Icon" count={5} />);
      
      expect(screen.queryByTestId("test-icon")).not.toBeInTheDocument();
      expect(screen.getByText("No Icon")).toBeInTheDocument();
      expect(screen.getByText("5 tests")).toBeInTheDocument();
    });
  });

  describe("Count Formatting", () => {
    test("formats large numbers correctly", () => {
      render(<MetricDisplayCountOnly label="Large Count" count={1000} />);
      expect(screen.getByText("1,000 tests")).toBeInTheDocument();
    });

    test("formats very large numbers correctly", () => {
      render(<MetricDisplayCountOnly label="Very Large" count={1234567} />);
      expect(screen.getByText("1,234,567 tests")).toBeInTheDocument();
    });

    test("handles small numbers without formatting", () => {
      render(<MetricDisplayCountOnly label="Small" count={42} />);
      expect(screen.getByText("42 tests")).toBeInTheDocument();
    });
  });

  describe("Badge Styling", () => {
    test("renders badge with outline variant", () => {
      render(<MetricDisplayCountOnly label="Test" count={5} />);
      
      const badge = screen.getByText("5 tests");
      expect(badge).toHaveClass("border-gray-300");
      expect(badge).toHaveClass("bg-gray-50");
    });
  });

  describe("Label Styling", () => {
    test("applies correct text styles to label", () => {
      render(<MetricDisplayCountOnly label="Test Label" count={5} />);
      
      const label = screen.getByText("Test Label");
      expect(label).toHaveClass("text-xs");
      expect(label).toHaveClass("font-medium");
      expect(label).toHaveClass("text-muted-foreground");
    });
  });

  describe("Edge Cases", () => {
    test("handles negative count gracefully", () => {
      render(<MetricDisplayCountOnly label="Negative" count={-1} />);
      expect(screen.getByText("Negative")).toBeInTheDocument();
      expect(screen.getByText(/test/)).toBeInTheDocument();
    });

    test("handles empty label string", () => {
      render(<MetricDisplayCountOnly label="" count={5} />);
      expect(screen.getByText(/5/)).toBeInTheDocument();
      expect(screen.getByText(/tests/)).toBeInTheDocument();
    });

    test("handles very long label text", () => {
      const longLabel = "This is a very long label that might wrap across multiple lines";
      render(<MetricDisplayCountOnly label={longLabel} count={5} />);
      expect(screen.getByText(longLabel)).toBeInTheDocument();
    });
  });

  describe("Layout and Structure", () => {
    test("maintains flexbox layout structure", () => {
      const { container } = render(<MetricDisplayCountOnly label="Layout Test" count={5} />);
      
      const outerDiv = container.firstChild as HTMLElement;
      expect(outerDiv).toHaveClass("space-y-2");
      
      const flexContainer = outerDiv.firstChild as HTMLElement;
      expect(flexContainer).toHaveClass("flex");
      expect(flexContainer).toHaveClass("items-center");
      expect(flexContainer).toHaveClass("justify-between");
    });

    test("groups icon and label together", () => {
      const icon = <span data-testid="icon">📊</span>;
      const { container } = render(
        <MetricDisplayCountOnly label="Grouped" count={5} icon={icon} />
      );
      
      const iconLabelContainer = container.querySelector(".flex.items-center.space-x-2");
      expect(iconLabelContainer).toBeInTheDocument();
      expect(iconLabelContainer).toContainElement(screen.getByTestId("icon"));
      expect(iconLabelContainer).toContainElement(screen.getByText("Grouped"));
    });
  });
});
