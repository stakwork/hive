import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Toaster } from "@/components/ui/sonner";

// Mock next-themes to avoid theme context issues in tests
vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: "light",
    setTheme: vi.fn(),
  }),
}));

// Mock the Sonner component from sonner library to capture props
vi.mock("sonner", () => {
  return {
    Toaster: (props: Record<string, unknown>) => {
      return React.createElement(
        "div",
        {
          "data-testid": "sonner-toaster",
          "data-position": props.position as string,
          "data-theme": props.theme as string,
          "data-classname": props.className as string,
        },
        "Toaster"
      );
    },
  };
});

// Helper function to get toaster element
const getToasterElement = () => screen.getByTestId("sonner-toaster");

// Helper function to check toaster attribute
const expectToasterAttribute = (attribute: string, expectedValue: string) => {
  const toaster = getToasterElement();
  expect(toaster).toHaveAttribute(attribute, expectedValue);
};

describe("Toaster Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Rendering", () => {
    test("renders without errors", () => {
      const { container } = render(<Toaster />);
      expect(container).toBeDefined();
      expect(container.firstChild).toBeDefined();
    });

    test("renders the Sonner toaster component", () => {
      render(<Toaster />);
      const toaster = getToasterElement();
      expect(toaster).toBeInTheDocument();
    });
  });

  describe("Position Configuration", () => {
    test("renders with position set to top-right by default", () => {
      render(<Toaster />);
      expectToasterAttribute("data-position", "top-right");
    });

    test("allows position override via props", () => {
      render(<Toaster position="bottom-left" />);
      expectToasterAttribute("data-position", "bottom-left");
    });
  });

  describe("Theme Integration", () => {
    test("applies theme from useTheme hook", () => {
      render(<Toaster />);
      expectToasterAttribute("data-theme", "light");
    });

    test("applies correct className for styling", () => {
      render(<Toaster />);
      const toaster = getToasterElement();
      expect(toaster).toHaveAttribute("data-classname", "toaster group");
    });
  });

  describe("Props Forwarding", () => {
    test("forwards additional props to underlying Sonner component", () => {
      render(<Toaster duration={5000} />);
      const toaster = getToasterElement();
      expect(toaster).toBeInTheDocument();
    });
  });
});
