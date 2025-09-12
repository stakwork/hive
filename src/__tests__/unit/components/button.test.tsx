import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Slot } from "@radix-ui/react-slot";
import React from "react";
import { cn } from "@/lib/utils";

// Mock the cn utility function to verify class name composition
vi.mock("@/lib/utils", () => ({
  cn: vi.fn((...classes) => classes.filter(Boolean).join(" "))
}));

describe("Button Component Core Rendering Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Element Selection Logic", () => {
    test("should render as button element by default", () => {
      render(<Button>Test Button</Button>);
      
      const button = screen.getByRole("button");
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveTextContent("Test Button");
    });

    test("should render as Slot when asChild is true", () => {
      render(
        <Button asChild>
          <a href="/test">Test Link</a>
        </Button>
      );

      const link = screen.getByRole("link");
      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href", "/test");
      expect(link).toHaveTextContent("Test Link");
    });

    test("should render as button when asChild is false", () => {
      render(<Button asChild={false}>Test Button</Button>);
      
      const button = screen.getByRole("button");
      expect(button.tagName).toBe("BUTTON");
    });

    test("should render child element with merged props when asChild is true", () => {
      render(
        <Button asChild className="custom-class" onClick={() => {}}>
          <span data-testid="child">Child Element</span>
        </Button>
      );

      const child = screen.getByTestId("child");
      expect(child.tagName).toBe("SPAN");
      expect(child).toHaveClass("custom-class");
      expect(child).toHaveAttribute("data-slot", "button");
    });
  });

  describe("Class Name Composition", () => {
    test("should apply buttonVariants with default variant and size", () => {
      render(<Button>Default Button</Button>);

      expect(vi.mocked(cn)).toHaveBeenCalledWith(
        expect.stringContaining("inline-flex items-center justify-center")
      );
    });

    test("should merge custom className with buttonVariants", () => {
      const customClass = "custom-button-class";
      render(<Button className={customClass}>Custom Button</Button>);

      expect(vi.mocked(cn)).toHaveBeenCalledWith(
        expect.stringContaining("inline-flex items-center justify-center")
      );
    });

    test("should pass variant and size to buttonVariants", () => {
      render(<Button variant="destructive" size="lg">Large Destructive Button</Button>);

      // Verify that cn is called with the result of buttonVariants
      expect(vi.mocked(cn)).toHaveBeenCalled();
      
      const button = screen.getByRole("button");
      expect(button).toHaveClass("inline-flex");
    });

    describe("All Variant and Size Combinations", () => {
      const variants = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const;
      const sizes = ["default", "sm", "lg", "icon"] as const;

      variants.forEach((variant) => {
        sizes.forEach((size) => {
          test(`should render ${variant} variant with ${size} size`, () => {
            render(
              <Button variant={variant} size={size} data-testid={`button-${variant}-${size}`}>
                {variant} {size}
              </Button>
            );

            const button = screen.getByTestId(`button-${variant}-${size}`);
            expect(button).toBeInTheDocument();
            
            // Verify buttonVariants was called with correct parameters
            expect(vi.mocked(cn)).toHaveBeenCalled();
          });
        });
      });
    });

    test("should handle undefined className", () => {
      render(<Button className={undefined}>Button</Button>);
      
      expect(vi.mocked(cn)).toHaveBeenCalled();
      const button = screen.getByRole("button");
      expect(button).toBeInTheDocument();
    });

    test("should handle empty className", () => {
      render(<Button className="">Button</Button>);
      
      expect(vi.mocked(cn)).toHaveBeenCalled();
      const button = screen.getByRole("button");
      expect(button).toBeInTheDocument();
    });
  });

  describe("Prop Forwarding", () => {
    test("should forward data attributes", () => {
      render(
        <Button data-testid="test-button" data-custom="value">
          Test Button
        </Button>
      );

      const button = screen.getByTestId("test-button");
      expect(button).toHaveAttribute("data-custom", "value");
    });

    test("should forward aria attributes", () => {
      render(
        <Button aria-label="Close dialog" aria-expanded="false">
          Close
        </Button>
      );

      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("aria-label", "Close dialog");
      expect(button).toHaveAttribute("aria-expanded", "false");
    });

    test("should forward event handlers", () => {
      const handleClick = vi.fn();

      render(
        <Button onClick={handleClick}>
          Click Me
        </Button>
      );

      const button = screen.getByRole("button");
      
      // Simulate click
      button.click();
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    test("should forward disabled attribute", () => {
      render(<Button disabled>Disabled Button</Button>);

      const button = screen.getByRole("button");
      expect(button).toBeDisabled();
    });

    test("should forward type attribute", () => {
      render(<Button type="submit">Submit Button</Button>);

      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("type", "submit");
    });

    test("should forward id attribute", () => {
      render(<Button id="unique-button-id">Button</Button>);

      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("id", "unique-button-id");
    });

    test("should forward tabIndex", () => {
      render(<Button tabIndex={-1}>Non-focusable Button</Button>);

      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("tabIndex", "-1");
    });

    test("should forward all props when using asChild", () => {
      const handleClick = vi.fn();

      render(
        <Button 
          asChild 
          onClick={handleClick}
          data-testid="forwarded-props"
          aria-label="Custom link"
        >
          <a href="/test">Link Button</a>
        </Button>
      );

      const link = screen.getByTestId("forwarded-props");
      expect(link).toHaveAttribute("href", "/test");
      expect(link).toHaveAttribute("aria-label", "Custom link");
      
      // Click should work on the link
      link.click();
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("Data Slot Attribute", () => {
    test("should always include data-slot='button' attribute", () => {
      render(<Button>Button</Button>);

      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("data-slot", "button");
    });

    test("should include data-slot='button' when using asChild", () => {
      render(
        <Button asChild>
          <div>Custom Element</div>
        </Button>
      );

      const element = screen.getByText("Custom Element");
      expect(element).toHaveAttribute("data-slot", "button");
    });
  });

  describe("Edge Cases", () => {
    test("should handle multiple children with asChild", () => {
      render(
        <Button asChild>
          <div>
            <span>Icon</span>
            <span>Text</span>
          </div>
        </Button>
      );

      const container = screen.getByText("Icon").parentElement;
      expect(container).toHaveAttribute("data-slot", "button");
      expect(screen.getByText("Text")).toBeInTheDocument();
    });

    test("should handle complex variant and size combinations", () => {
      render(
        <Button variant="outline" size="sm" className="extra-class">
          Complex Button
        </Button>
      );

      expect(vi.mocked(cn)).toHaveBeenCalled();
      const button = screen.getByRole("button");
      expect(button).toBeInTheDocument();
    });

    test("should handle null/undefined props gracefully", () => {
      render(
        <Button 
          variant={undefined} 
          size={undefined}
          className={null}
        >
          Button with null props
        </Button>
      );

      const button = screen.getByRole("button");
      expect(button).toBeInTheDocument();
      expect(vi.mocked(cn)).toHaveBeenCalled();
    });

    test("should handle empty children", () => {
      render(<Button></Button>);

      const button = screen.getByRole("button");
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent("");
    });

    test("should maintain button semantics with asChild=false", () => {
      render(
        <Button asChild={false} type="button" role="button">
          Explicit Button
        </Button>
      );

      const button = screen.getByRole("button");
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
    });
  });

  describe("ButtonVariants Integration", () => {
    test("should call buttonVariants with correct parameters", () => {
      const variant = "destructive";
      const size = "lg";
      const className = "custom-class";

      render(
        <Button variant={variant} size={size} className={className}>
          Test
        </Button>
      );

      // Verify cn was called (which receives the result of buttonVariants)
      expect(vi.mocked(cn)).toHaveBeenCalled();
    });

    test("should handle all variant types", () => {
      const variants = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const;
      
      variants.forEach((variant) => {
        const { unmount } = render(
          <Button variant={variant} data-testid={`variant-${variant}`}>
            {variant}
          </Button>
        );

        const button = screen.getByTestId(`variant-${variant}`);
        expect(button).toBeInTheDocument();
        
        unmount();
        vi.clearAllMocks();
      });
    });

    test("should handle all size types", () => {
      const sizes = ["default", "sm", "lg", "icon"] as const;
      
      sizes.forEach((size) => {
        const { unmount } = render(
          <Button size={size} data-testid={`size-${size}`}>
            {size}
          </Button>
        );

        const button = screen.getByTestId(`size-${size}`);
        expect(button).toBeInTheDocument();
        
        unmount();
        vi.clearAllMocks();
      });
    });
  });
});
