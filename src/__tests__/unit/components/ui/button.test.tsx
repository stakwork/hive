import React from "react";
import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button, buttonVariants } from "@/components/ui/button";

// Test data helpers following DRY principles
const createButtonProps = (overrides = {}) => ({
  children: "Test Button",
  ...overrides,
});

const BUTTON_VARIANTS = [
  "default",
  "destructive", 
  "outline",
  "secondary",
  "ghost",
  "link",
] as const;

const BUTTON_SIZES = ["default", "sm", "lg", "icon"] as const;

// Reusable assertion helpers
const expectButtonToBeRendered = (element: HTMLElement) => {
  expect(element).toBeInTheDocument();
  expect(element).toHaveAttribute("data-slot", "button");
};

const expectButtonToHaveVariantClasses = (
  element: HTMLElement,
  variant: typeof BUTTON_VARIANTS[number],
  size: typeof BUTTON_SIZES[number] = "default"
) => {
  const expectedClasses = buttonVariants({ variant, size });
  // Check that the element has the expected classes by checking className contains key classes
  expect(element.className).toMatch(/inline-flex items-center justify-center/);
  
  // Check variant-specific classes
  if (variant === "default") {
    expect(element.className).toMatch(/bg-primary/);
  } else if (variant === "destructive") {
    expect(element.className).toMatch(/bg-destructive/);
  } else if (variant === "outline") {
    expect(element.className).toMatch(/border.*bg-background/);
  } else if (variant === "secondary") {
    expect(element.className).toMatch(/bg-secondary/);
  } else if (variant === "ghost") {
    expect(element.className).toMatch(/hover:bg-accent/);
  } else if (variant === "link") {
    expect(element.className).toMatch(/underline-offset-4/);
  }
  
  // Check size-specific classes
  if (size === "sm") {
    expect(element.className).toMatch(/h-8/);
  } else if (size === "lg") {
    expect(element.className).toMatch(/h-10/);
  } else if (size === "icon") {
    expect(element.className).toMatch(/size-9/);
  } else {
    // Default size should include h-9 and px-4 classes
    expect(element.className).toMatch(/h-9/);
    expect(element.className).toMatch(/px-4/);
  }
};

describe("Button Component", () => {
  describe("Basic Rendering", () => {
    test("renders button element by default", () => {
      render(<Button {...createButtonProps()} />);
      
      const button = screen.getByRole("button", { name: /test button/i });
      expectButtonToBeRendered(button);
      expect(button.tagName).toBe("BUTTON");
    });

    test("renders with default variant and size classes", () => {
      render(<Button {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      expectButtonToHaveVariantClasses(button, "default", "default");
    });

    test("renders children content correctly", () => {
      const testContent = "Custom Button Text";
      render(<Button>{testContent}</Button>);
      
      expect(screen.getByText(testContent)).toBeInTheDocument();
    });
  });

  describe("Variants", () => {
    test.each(BUTTON_VARIANTS)("renders %s variant correctly", (variant) => {
      render(<Button variant={variant} {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      expectButtonToHaveVariantClasses(button, variant);
    });

    test("applies destructive variant with correct styling", () => {
      render(<Button variant="destructive" {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      expect(button.className).toMatch(/bg-destructive.*text-white/);
    });

    test("applies ghost variant with hover styling", () => {
      render(<Button variant="ghost" {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      expect(button.className).toMatch(/hover:bg-accent/);
    });

    test("applies link variant with underline styling", () => {
      render(<Button variant="link" {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      expect(button.className).toMatch(/underline-offset-4.*hover:underline/);
    });
  });

  describe("Sizes", () => {
    test.each(BUTTON_SIZES)("renders %s size correctly", (size) => {
      render(<Button size={size} {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      expectButtonToHaveVariantClasses(button, "default", size);
    });

    test("applies small size with correct dimensions", () => {
      render(<Button size="sm" {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      expect(button.className).toMatch(/h-8.*px-3/);
    });

    test("applies large size with correct dimensions", () => {
      render(<Button size="lg" {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      expect(button.className).toMatch(/h-10.*px-6/);
    });

    test("applies icon size for square buttons", () => {
      render(<Button size="icon" {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      expect(button.className).toMatch(/size-9/);
    });
  });

  describe("Variant and Size Combinations", () => {
    test("applies destructive + small combination correctly", () => {
      render(<Button variant="destructive" size="sm" {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      expectButtonToHaveVariantClasses(button, "destructive", "sm");
    });

    test("applies outline + large combination correctly", () => {
      render(<Button variant="outline" size="lg" {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      expectButtonToHaveVariantClasses(button, "outline", "lg");
    });

    test("applies ghost + icon combination correctly", () => {
      render(<Button variant="ghost" size="icon" {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      expectButtonToHaveVariantClasses(button, "ghost", "icon");
    });
  });

  describe("asChild Prop", () => {
    test("renders as Slot component when asChild is true", () => {
      render(
        <Button asChild {...createButtonProps()}>
          <a href="/test">Link Button</a>
        </Button>
      );
      
      const link = screen.getByRole("link", { name: /link button/i });
      expect(link).toBeInTheDocument();
      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href", "/test");
      expect(link).toHaveAttribute("data-slot", "button");
    });

    test("renders as button when asChild is false", () => {
      render(<Button asChild={false} {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      expect(button.tagName).toBe("BUTTON");
    });

    test("maintains button styling when rendered as different element", () => {
      render(
        <Button asChild variant="destructive" size="lg">
          <div>Div Button</div>
        </Button>
      );
      
      const element = screen.getByText("Div Button");
      expectButtonToHaveVariantClasses(element, "destructive", "lg");
    });
  });

  describe("Custom Styling", () => {
    test("merges custom className with button classes", () => {
      const customClass = "custom-button-style";
      render(<Button className={customClass} {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      expect(button.className).toContain(customClass);
      expect(button.className).toMatch(/inline-flex items-center/);
    });

    test("custom className takes precedence when conflicts arise", () => {
      render(
        <Button 
          className="bg-custom text-custom" 
          variant="destructive" 
          {...createButtonProps()} 
        />
      );
      
      const button = screen.getByRole("button");
      expect(button.className).toContain("bg-custom");
      expect(button.className).toContain("text-custom");
    });
  });

  describe("Props Forwarding", () => {
    test("forwards standard button props", () => {
      const handleClick = vi.fn();
      render(
        <Button 
          onClick={handleClick}
          disabled
          type="submit"
          {...createButtonProps()} 
        />
      );
      
      const button = screen.getByRole("button");
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("type", "submit");
    });

    test("forwards aria attributes", () => {
      render(
        <Button 
          aria-label="Custom label"
          aria-describedby="help-text"
          {...createButtonProps()} 
        />
      );
      
      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("aria-label", "Custom label");
      expect(button).toHaveAttribute("aria-describedby", "help-text");
    });

    test("forwards data attributes", () => {
      render(
        <Button 
          data-testid="custom-button"
          data-analytics="button-click"
          {...createButtonProps()} 
        />
      );
      
      const button = screen.getByTestId("custom-button");
      expect(button).toHaveAttribute("data-analytics", "button-click");
    });
  });

  describe("Event Handling", () => {
    test("handles click events correctly", () => {
      const handleClick = vi.fn();
      
      render(<Button onClick={handleClick} {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      fireEvent.click(button);
      
      expect(handleClick).toHaveBeenCalledOnce();
    });

    test("handles keyboard events", () => {
      const handleKeyDown = vi.fn();
      
      render(<Button onKeyDown={handleKeyDown} {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      fireEvent.keyDown(button, { key: "Enter", code: "Enter" });
      
      expect(handleKeyDown).toHaveBeenCalled();
    });

    test("does not handle events when disabled", () => {
      const handleClick = vi.fn();
      
      render(<Button onClick={handleClick} disabled {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      fireEvent.click(button);
      
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe("Accessibility", () => {
    test("maintains accessibility when using asChild", () => {
      render(
        <Button asChild {...createButtonProps()}>
          <a href="/test" role="button">Accessible Link</a>
        </Button>
      );
      
      const element = screen.getByRole("button");
      expect(element).toBeInTheDocument();
      expect(element).toHaveAttribute("href", "/test");
    });

    test("includes proper focus styling classes", () => {
      render(<Button {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      expect(button.className).toMatch(/focus-visible:/);
      expect(button.className).toMatch(/outline-none/);
    });

    test("includes proper disabled styling classes", () => {
      render(<Button disabled {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      expect(button.className).toMatch(/disabled:pointer-events-none/);
      expect(button.className).toMatch(/disabled:opacity-50/);
    });
  });

  describe("Icon Support", () => {
    test("applies proper styling for buttons with icons", () => {
      render(
        <Button {...createButtonProps()}>
          <svg data-testid="icon">
            <path />
          </svg>
          Icon Button
        </Button>
      );
      
      const button = screen.getByRole("button");
      const icon = screen.getByTestId("icon");
      
      expect(icon).toBeInTheDocument();
      expect(button.className).toMatch(/\[&_svg\]:pointer-events-none/);
      expect(button.className).toMatch(/has-\[\>svg\]:px-3/);
    });

    test("applies icon size classes correctly for icon variant", () => {
      render(
        <Button size="icon" {...createButtonProps()}>
          <svg data-testid="icon">
            <path />
          </svg>
        </Button>
      );
      
      const button = screen.getByRole("button");
      expect(button.className).toMatch(/size-9/);
    });
  });

  describe("Edge Cases", () => {
    test("handles empty children gracefully", () => {
      render(<Button />);
      
      const button = screen.getByRole("button");
      expectButtonToBeRendered(button);
    });

    test("handles null/undefined variant and size props", () => {
      render(<Button variant={undefined} size={null as any} {...createButtonProps()} />);
      
      const button = screen.getByRole("button");
      // When size is null/undefined, class-variance-authority doesn't apply default size classes
      // So we only check for the base classes and variant classes
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute("data-slot", "button");
      expect(button.className).toMatch(/inline-flex items-center justify-center/);
      expect(button.className).toMatch(/bg-primary/); // default variant is applied
    });

    test("maintains proper structure with complex children", () => {
      render(
        <Button {...createButtonProps()}>
          <span>Icon</span>
          <span>Text</span>
          <span>Badge</span>
        </Button>
      );
      
      const button = screen.getByRole("button");
      expect(button).toContainElement(screen.getByText("Icon"));
      expect(button).toContainElement(screen.getByText("Text"));
      expect(button).toContainElement(screen.getByText("Badge"));
    });
  });
});