import React from "react";
import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";

// Type for button props
type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

// Helper function to create test props
const createButtonProps = (overrides: Partial<ButtonProps> = {}): ButtonProps => ({
  children: "Test Button",
  ...overrides,
});

// Helper function to assert button is rendered correctly
const expectButtonToBeRendered = (text: string = "Test Button") => {
  const button = screen.getByRole("button", { name: text });
  expect(button).toBeInTheDocument();
  return button;
};

// Helper function to check if button has specific variant classes
const expectButtonToHaveVariantClasses = (
  button: HTMLElement,
  variant?: ButtonProps["variant"],
  size?: ButtonProps["size"]
) => {
  const expectedClasses = buttonVariants({ variant, size });
  const classList = button.className.split(" ");
  
  // Check for presence of key variant classes
  if (variant === "default") {
    expect(classList.some(cls => cls.includes("bg-primary"))).toBe(true);
  } else if (variant === "destructive") {
    expect(classList.some(cls => cls.includes("bg-destructive"))).toBe(true);
  } else if (variant === "outline") {
    expect(classList.some(cls => cls.includes("border"))).toBe(true);
  } else if (variant === "secondary") {
    expect(classList.some(cls => cls.includes("bg-secondary"))).toBe(true);
  } else if (variant === "ghost") {
    expect(classList.some(cls => cls.includes("hover:bg-accent"))).toBe(true);
  } else if (variant === "link") {
    expect(classList.some(cls => cls.includes("underline"))).toBe(true);
  }
  
  // Check for size classes
  if (size === "sm") {
    expect(classList.some(cls => cls.includes("h-8"))).toBe(true);
  } else if (size === "lg") {
    expect(classList.some(cls => cls.includes("h-10"))).toBe(true);
  } else if (size === "icon") {
    expect(classList.some(cls => cls.includes("size-9"))).toBe(true);
  } else {
    // default size
    expect(classList.some(cls => cls.includes("h-9"))).toBe(true);
  }
};

describe("Button", () => {
  describe("Basic Rendering", () => {
    test("renders a button element by default", () => {
      render(<Button {...createButtonProps()} />);
      const button = expectButtonToBeRendered();
      expect(button.tagName).toBe("BUTTON");
    });

    test("renders with correct data-slot attribute", () => {
      render(<Button {...createButtonProps()} />);
      const button = expectButtonToBeRendered();
      expect(button).toHaveAttribute("data-slot", "button");
    });

    test("displays children text", () => {
      render(<Button>Custom Button Text</Button>);
      expectButtonToBeRendered("Custom Button Text");
    });

    test("renders with custom className", () => {
      render(<Button className="custom-class">Button</Button>);
      const button = expectButtonToBeRendered("Button");
      expect(button).toHaveClass("custom-class");
    });
  });

  describe("Button Variants", () => {
    const variants: Array<ButtonProps["variant"]> = [
      "default",
      "destructive", 
      "outline",
      "secondary",
      "ghost",
      "link"
    ];

    test.each(variants)("renders %s variant correctly", (variant) => {
      render(<Button variant={variant}>Test Button</Button>);
      const button = expectButtonToBeRendered();
      expectButtonToHaveVariantClasses(button, variant);
    });

    test("applies default variant when variant is undefined", () => {
      render(<Button>Test Button</Button>);
      const button = expectButtonToBeRendered();
      expectButtonToHaveVariantClasses(button, "default");
    });
  });

  describe("Button Sizes", () => {
    const sizes: Array<ButtonProps["size"]> = [
      "default",
      "sm",
      "lg", 
      "icon"
    ];

    test.each(sizes)("renders %s size correctly", (size) => {
      render(<Button size={size}>Test Button</Button>);
      const button = expectButtonToBeRendered();
      expectButtonToHaveVariantClasses(button, "default", size);
    });

    test("applies default size when size is undefined", () => {
      render(<Button>Test Button</Button>);
      const button = expectButtonToBeRendered();
      expectButtonToHaveVariantClasses(button, "default", "default");
    });
  });

  describe("Variant and Size Combinations", () => {
    test("renders destructive outline button with sm size", () => {
      render(<Button variant="outline" size="sm">Small Outline</Button>);
      const button = expectButtonToBeRendered("Small Outline");
      expectButtonToHaveVariantClasses(button, "outline", "sm");
    });

    test("renders ghost button with icon size", () => {
      render(<Button variant="ghost" size="icon">G</Button>);
      const button = expectButtonToBeRendered("G");
      expectButtonToHaveVariantClasses(button, "ghost", "icon");
    });

    test("renders link variant with large size", () => {
      render(<Button variant="link" size="lg">Large Link</Button>);
      const button = expectButtonToBeRendered("Large Link");
      expectButtonToHaveVariantClasses(button, "link", "lg");
    });
  });

  describe("asChild Prop", () => {
    test("renders as Slot component when asChild is true", () => {
      render(
        <Button asChild>
          <a href="/test">Link Button</a>
        </Button>
      );
      
      const link = screen.getByRole("link", { name: "Link Button" });
      expect(link).toBeInTheDocument();
      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href", "/test");
      expect(link).toHaveAttribute("data-slot", "button");
    });

    test("applies button classes to child element when asChild is true", () => {
      render(
        <Button asChild variant="destructive" size="sm">
          <div>Custom Element</div>
        </Button>
      );
      
      const element = screen.getByText("Custom Element");
      expect(element).toBeInTheDocument();
      expect(element.tagName).toBe("DIV");
      expectButtonToHaveVariantClasses(element, "destructive", "sm");
    });

    test("renders as button element when asChild is false", () => {
      render(<Button asChild={false}>Regular Button</Button>);
      const button = expectButtonToBeRendered("Regular Button");
      expect(button.tagName).toBe("BUTTON");
    });
  });

  describe("Props Forwarding", () => {
    test("forwards standard button props", () => {
      const handleClick = vi.fn();
      render(
        <Button 
          onClick={handleClick}
          disabled={true}
          type="submit"
          aria-label="Submit form"
          data-testid="submit-btn"
        >
          Submit
        </Button>
      );
      
      const button = expectButtonToBeRendered("Submit form");
      expect(button).toHaveAttribute("type", "submit");
      expect(button).toHaveAttribute("aria-label", "Submit form");
      expect(button).toHaveAttribute("data-testid", "submit-btn");
      expect(button).toBeDisabled();
    });

    test("forwards custom data attributes", () => {
      render(
        <Button data-custom="test-value" data-analytics="button-click">
          Custom Data
        </Button>
      );
      
      const button = expectButtonToBeRendered("Custom Data");
      expect(button).toHaveAttribute("data-custom", "test-value");
      expect(button).toHaveAttribute("data-analytics", "button-click");
    });
  });

  describe("Event Handling", () => {
    test("handles click events", async () => {
      const handleClick = vi.fn();
      const user = userEvent.setup();
      
      render(<Button onClick={handleClick}>Clickable Button</Button>);
      
      const button = expectButtonToBeRendered("Clickable Button");
      await user.click(button);
      
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    test("handles keyboard events", async () => {
      const handleKeyDown = vi.fn();
      const user = userEvent.setup();
      
      render(<Button onKeyDown={handleKeyDown}>Keyboard Button</Button>);
      
      const button = expectButtonToBeRendered("Keyboard Button");
      button.focus();
      await user.keyboard("{Enter}");
      
      expect(handleKeyDown).toHaveBeenCalledTimes(1);
    });

    test("does not trigger events when disabled", async () => {
      const handleClick = vi.fn();
      const user = userEvent.setup();
      
      render(<Button onClick={handleClick} disabled>Disabled Button</Button>);
      
      const button = expectButtonToBeRendered("Disabled Button");
      await user.click(button);
      
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe("Accessibility", () => {
    test("has correct role attribute", () => {
      render(<Button>Accessible Button</Button>);
      const button = expectButtonToBeRendered("Accessible Button");
      // Buttons have implicit role, no explicit role attribute
      expect(button).toHaveRole("button");
    });

    test("supports aria-label", () => {
      render(<Button aria-label="Close dialog">×</Button>);
      const button = screen.getByRole("button", { name: "Close dialog" });
      expect(button).toBeInTheDocument();
    });

    test("supports aria-describedby", () => {
      render(
        <div>
          <Button aria-describedby="help-text">Help Button</Button>
          <div id="help-text">This button provides help</div>
        </div>
      );
      
      const button = expectButtonToBeRendered("Help Button");
      expect(button).toHaveAttribute("aria-describedby", "help-text");
    });

    test("has correct disabled state", () => {
      render(<Button disabled>Disabled Button</Button>);
      const button = expectButtonToBeRendered("Disabled Button");
      expect(button).toBeDisabled();
      // aria-disabled is not automatically set by the component
    });
  });

  describe("CSS Classes", () => {
    test("merges custom className with variant classes", () => {
      render(<Button className="custom-padding" variant="outline">Styled Button</Button>);
      const button = expectButtonToBeRendered("Styled Button");
      expect(button).toHaveClass("custom-padding");
      // Should also have outline variant classes
      const classList = button.className.split(" ");
      expect(classList.some(cls => cls.includes("border"))).toBe(true);
    });

    test("applies base button classes", () => {
      render(<Button>Base Button</Button>);
      const button = expectButtonToBeRendered("Base Button");
      const classList = button.className.split(" ");
      
      // Check for some base classes from buttonVariants
      expect(classList.some(cls => cls.includes("inline-flex"))).toBe(true);
      expect(classList.some(cls => cls.includes("items-center"))).toBe(true);
      expect(classList.some(cls => cls.includes("justify-center"))).toBe(true);
    });
  });

  describe("Children Handling", () => {
    test("renders React elements as children", () => {
      render(
        <Button>
          <span data-testid="icon">🔥</span>
          Button Text
        </Button>
      );
      
      // Find button by its actual accessible name which includes both icon and text
      const button = screen.getByRole("button", { name: "🔥 Button Text" });
      expect(button).toBeInTheDocument();
      expect(screen.getByTestId("icon")).toBeInTheDocument();
      expect(screen.getByText("Button Text")).toBeInTheDocument();
    });

    test("handles empty children", () => {
      render(<Button />);
      const button = screen.getByRole("button");
      expect(button).toBeInTheDocument();
      expect(button).toBeEmptyDOMElement();
    });

    test("handles null children", () => {
      render(<Button>{null}</Button>);
      const button = screen.getByRole("button");
      expect(button).toBeInTheDocument();
      expect(button).toBeEmptyDOMElement();
    });
  });

  describe("Edge Cases", () => {
    test("handles undefined variant gracefully", () => {
      render(<Button variant={undefined}>Undefined Variant</Button>);
      const button = expectButtonToBeRendered("Undefined Variant");
      // Should fallback to default variant
      expectButtonToHaveVariantClasses(button, "default");
    });

    test("handles undefined size gracefully", () => {
      render(<Button size={undefined}>Undefined Size</Button>);
      const button = expectButtonToBeRendered("Undefined Size");
      // Should fallback to default size
      expectButtonToHaveVariantClasses(button, "default", "default");
    });

    test("handles multiple className values", () => {
      render(<Button className="class1 class2 class3">Multi Class</Button>);
      const button = expectButtonToBeRendered("Multi Class");
      expect(button).toHaveClass("class1");
      expect(button).toHaveClass("class2");
      expect(button).toHaveClass("class3");
    });

    test("handles empty className", () => {
      render(<Button className="">Empty Class</Button>);
      const button = expectButtonToBeRendered("Empty Class");
      // Should still render with default classes
      const classList = button.className.split(" ");
      expect(classList.some(cls => cls.includes("inline-flex"))).toBe(true);
    });
  });
});