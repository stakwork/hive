import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/avatar";

// Mock dependencies
vi.mock("@/lib/utils", () => ({
  cn: vi.fn((...classes) => classes.filter(Boolean).join(" ")),
}));

// Mock Radix UI Avatar primitives
vi.mock("@radix-ui/react-avatar", () => ({
  Root: ({ children, ...props }: any) => (
    <div data-testid="radix-avatar-root" {...props}>
      {children}
    </div>
  ),
  Image: ({ children, onLoadingStatusChange, ...props }: any) => {
    // Simulate image loading
    React.useEffect(() => {
      if (onLoadingStatusChange && props.src) {
        // Simulate loaded status
        setTimeout(() => onLoadingStatusChange("loaded"), 0);
      }
    }, [onLoadingStatusChange, props.src]);

    return (
      <img data-testid="radix-avatar-image" {...props}>
        {children}
      </img>
    );
  },
  Fallback: ({ children, delayMs, ...props }: any) => (
    <div data-testid="radix-avatar-fallback" {...props}>
      {children}
    </div>
  ),
}));

const { cn } = await import("@/lib/utils");

// Test data factories
const TestDataFactories = {
  divProps: (overrides = {}) => ({
    "data-testid": "test-avatar",
    className: "custom-class",
    id: "test-id",
    ...overrides,
  }),

  avatarProps: (overrides = {}) => ({
    ...TestDataFactories.divProps(),
    ...overrides,
  }),

  imageProps: (overrides = {}) => ({
    "data-testid": "test-image",
    className: "custom-image-class",
    src: "https://example.com/avatar.jpg",
    alt: "User avatar",
    ...overrides,
  }),

  fallbackProps: (overrides = {}) => ({
    "data-testid": "test-fallback",
    className: "custom-fallback-class",
    ...overrides,
  }),

  completeAvatar: (overrides = {}) => ({
    src: "https://example.com/avatar.jpg",
    alt: "John Doe",
    fallback: "JD",
    ...overrides,
  }),
};

// Test utilities
const TestUtils = {
  renderComponent: (
    Component: React.ComponentType<any>,
    props = {},
    children = "Test Content"
  ) => {
    const defaultProps = TestDataFactories.avatarProps(props);
    return render(React.createElement(Component, defaultProps, children));
  },

  renderImage: (props = {}) => {
    const defaultProps = TestDataFactories.imageProps(props);
    return render(React.createElement(AvatarImage, defaultProps));
  },

  renderFallback: (props = {}, children = "FB") => {
    const defaultProps = TestDataFactories.fallbackProps(props);
    return render(React.createElement(AvatarFallback, defaultProps, children));
  },

  expectBasicRendering: (component: HTMLElement, dataSlot: string) => {
    expect(component).toBeInTheDocument();
    expect(component).toHaveAttribute("data-slot", dataSlot);
  },

  expectPropsForwarded: (component: HTMLElement, testId = "test-avatar") => {
    expect(component).toHaveAttribute("data-testid", testId);
    expect(component).toHaveAttribute("id", "test-id");
  },

  expectClassNameMerging: (
    expectedClasses: string,
    customClass = "custom-class"
  ) => {
    expect(cn).toHaveBeenCalledWith(expectedClasses, customClass);
  },

  expectImageClassNameMerging: (
    expectedClasses: string,
    customClass = "custom-image-class"
  ) => {
    expect(cn).toHaveBeenCalledWith(expectedClasses, customClass);
  },

  expectFallbackClassNameMerging: (
    expectedClasses: string,
    customClass = "custom-fallback-class"
  ) => {
    expect(cn).toHaveBeenCalledWith(expectedClasses, customClass);
  },

  renderCompleteAvatar: (props = {}) => {
    const avatarProps = TestDataFactories.completeAvatar(props);

    return render(
      <Avatar data-testid="complete-avatar">
        <AvatarImage
          src={avatarProps.src}
          alt={avatarProps.alt}
          data-testid="avatar-image"
        />
        <AvatarFallback data-testid="avatar-fallback">
          {avatarProps.fallback}
        </AvatarFallback>
      </Avatar>
    );
  },
};

describe("Avatar Components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Avatar (Root)", () => {
    test("renders with default data-slot and classes", () => {
      TestUtils.renderComponent(Avatar);
      const avatar = screen.getByTestId("test-avatar");

      TestUtils.expectBasicRendering(avatar, "avatar");
      TestUtils.expectPropsForwarded(avatar);
      TestUtils.expectClassNameMerging(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full"
      );
    });

    test("forwards all props to Radix Root", () => {
      render(
        <Avatar
          data-testid="root-test"
          role="img"
          aria-label="User profile picture"
        >
          Avatar Content
        </Avatar>
      );

      const avatar = screen.getByTestId("root-test");
      expect(avatar).toHaveAttribute("data-slot", "avatar");
      expect(avatar).toHaveAttribute("role", "img");
      expect(avatar).toHaveAttribute("aria-label", "User profile picture");
    });

    test("handles custom className merging", () => {
      render(
        <Avatar className="custom-avatar" data-testid="custom-avatar" />
      );

      TestUtils.expectClassNameMerging(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full",
        "custom-avatar"
      );
    });

    test("renders children correctly", () => {
      render(
        <Avatar data-testid="avatar-with-children">
          <div>Child Content</div>
        </Avatar>
      );

      const avatar = screen.getByTestId("avatar-with-children");
      expect(avatar).toHaveTextContent("Child Content");
    });

    test("handles multiple children", () => {
      render(
        <Avatar data-testid="multi-children">
          <AvatarImage src="test.jpg" alt="Test" />
          <AvatarFallback>FB</AvatarFallback>
        </Avatar>
      );

      const avatar = screen.getByTestId("multi-children");
      expect(screen.getByTestId("radix-avatar-image")).toBeInTheDocument();
      expect(screen.getByTestId("radix-avatar-fallback")).toBeInTheDocument();
    });
  });

  describe("AvatarImage", () => {
    test("renders with default data-slot and classes", () => {
      TestUtils.renderImage();
      const image = screen.getByTestId("test-image");

      TestUtils.expectBasicRendering(image, "avatar-image");
      expect(image.tagName).toBe("IMG");
      TestUtils.expectImageClassNameMerging("aspect-square size-full");
    });

    test("forwards image props correctly", () => {
      render(
        <AvatarImage
          src="https://example.com/user.jpg"
          alt="User profile"
          data-testid="img-props"
        />
      );

      const image = screen.getByTestId("img-props");
      expect(image).toHaveAttribute("src", "https://example.com/user.jpg");
      expect(image).toHaveAttribute("alt", "User profile");
      expect(image).toHaveAttribute("data-slot", "avatar-image");
    });

    test("handles custom className merging", () => {
      render(
        <AvatarImage
          src="test.jpg"
          className="custom-img"
          data-testid="custom-img"
        />
      );

      TestUtils.expectImageClassNameMerging("aspect-square size-full", "custom-img");
    });

    test("handles missing src gracefully", () => {
      render(<AvatarImage alt="No source" data-testid="no-src" />);

      const image = screen.getByTestId("no-src");
      expect(image).toBeInTheDocument();
      expect(image).not.toHaveAttribute("src");
    });

    test("handles loading states via onLoadingStatusChange", async () => {
      const onLoadingStatusChange = vi.fn();

      render(
        <AvatarImage
          src="test.jpg"
          alt="Loading test"
          onLoadingStatusChange={onLoadingStatusChange}
          data-testid="loading-img"
        />
      );

      await waitFor(() => {
        expect(onLoadingStatusChange).toHaveBeenCalledWith("loaded");
      });
    });

    test("supports additional image attributes", () => {
      render(
        <AvatarImage
          src="test.jpg"
          alt="Test"
          loading="lazy"
          crossOrigin="anonymous"
          data-testid="img-attrs"
        />
      );

      const image = screen.getByTestId("img-attrs");
      expect(image).toHaveAttribute("loading", "lazy");
      expect(image).toHaveAttribute("crossorigin", "anonymous");
    });
  });

  describe("AvatarFallback", () => {
    test("renders with default data-slot and classes", () => {
      TestUtils.renderFallback();
      const fallback = screen.getByTestId("test-fallback");

      TestUtils.expectBasicRendering(fallback, "avatar-fallback");
      TestUtils.expectFallbackClassNameMerging(
        "bg-muted flex size-full items-center justify-center rounded-full"
      );
    });

    test("renders fallback text correctly", () => {
      render(
        <AvatarFallback data-testid="fallback-text">JD</AvatarFallback>
      );

      const fallback = screen.getByTestId("fallback-text");
      expect(fallback).toHaveTextContent("JD");
    });

    test("handles custom className merging", () => {
      render(
        <AvatarFallback
          className="custom-fallback"
          data-testid="custom-fallback"
        >
          CF
        </AvatarFallback>
      );

      TestUtils.expectFallbackClassNameMerging(
        "bg-muted flex size-full items-center justify-center rounded-full",
        "custom-fallback"
      );
    });

    test("supports delayMs prop", () => {
      render(
        <AvatarFallback delayMs={600} data-testid="delayed-fallback">
          DL
        </AvatarFallback>
      );

      const fallback = screen.getByTestId("delayed-fallback");
      expect(fallback).toBeInTheDocument();
    });

    test("renders complex fallback content", () => {
      render(
        <AvatarFallback data-testid="complex-fallback">
          <span>Complex</span>
          <strong>Fallback</strong>
        </AvatarFallback>
      );

      const fallback = screen.getByTestId("complex-fallback");
      expect(fallback).toHaveTextContent("ComplexFallback");
      expect(fallback.querySelector("span")).toBeInTheDocument();
      expect(fallback.querySelector("strong")).toBeInTheDocument();
    });

    test("forwards all props to Radix Fallback", () => {
      render(
        <AvatarFallback
          data-testid="props-fallback"
          role="img"
          aria-label="Fallback content"
        >
          FB
        </AvatarFallback>
      );

      const fallback = screen.getByTestId("props-fallback");
      expect(fallback).toHaveAttribute("role", "img");
      expect(fallback).toHaveAttribute("aria-label", "Fallback content");
    });
  });

  describe("Component Integration", () => {
    test("renders complete avatar with image and fallback", () => {
      TestUtils.renderCompleteAvatar();

      expect(screen.getByTestId("complete-avatar")).toBeInTheDocument();
      expect(screen.getByTestId("avatar-image")).toBeInTheDocument();
      expect(screen.getByTestId("avatar-fallback")).toBeInTheDocument();
    });

    test("maintains proper DOM hierarchy", () => {
      TestUtils.renderCompleteAvatar();

      const avatar = screen.getByTestId("complete-avatar");
      const image = screen.getByTestId("avatar-image");
      const fallback = screen.getByTestId("avatar-fallback");

      expect(avatar).toContainElement(image);
      expect(avatar).toContainElement(fallback);
    });

    test("displays image when src is valid", async () => {
      TestUtils.renderCompleteAvatar({ src: "valid-image.jpg" });

      const image = screen.getByTestId("avatar-image");
      expect(image).toHaveAttribute("src", "valid-image.jpg");
    });

    test("handles image and fallback together", () => {
      render(
        <Avatar data-testid="complete">
          <AvatarImage
            src="https://example.com/avatar.jpg"
            alt="John Doe"
            data-testid="img"
          />
          <AvatarFallback data-testid="fb">JD</AvatarFallback>
        </Avatar>
      );

      expect(screen.getByTestId("complete")).toBeInTheDocument();
      expect(screen.getByTestId("img")).toBeInTheDocument();
      expect(screen.getByTestId("fb")).toBeInTheDocument();
      expect(screen.getByText("JD")).toBeInTheDocument();
    });

    test("handles multiple avatar instances", () => {
      render(
        <>
          <Avatar data-testid="avatar-1">
            <AvatarImage src="user1.jpg" alt="User 1" />
            <AvatarFallback>U1</AvatarFallback>
          </Avatar>
          <Avatar data-testid="avatar-2">
            <AvatarImage src="user2.jpg" alt="User 2" />
            <AvatarFallback>U2</AvatarFallback>
          </Avatar>
        </>
      );

      expect(screen.getByTestId("avatar-1")).toBeInTheDocument();
      expect(screen.getByTestId("avatar-2")).toBeInTheDocument();
      expect(screen.getByText("U1")).toBeInTheDocument();
      expect(screen.getByText("U2")).toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    test("handles null and undefined props gracefully", () => {
      const components = [
        { Component: Avatar, name: "Avatar" },
        { Component: AvatarImage, name: "AvatarImage" },
        { Component: AvatarFallback, name: "AvatarFallback" },
      ];

      components.forEach(({ Component, name }, index) => {
        render(
          React.createElement(
            Component,
            { "data-testid": `null-test-${index}`, className: null },
            null
          )
        );
        const element = screen.getByTestId(`null-test-${index}`);
        expect(element).toBeInTheDocument();
      });
    });

    test("handles empty children", () => {
      render(<Avatar data-testid="empty-avatar">{""}</Avatar>);
      const avatar = screen.getByTestId("empty-avatar");

      expect(avatar).toBeInTheDocument();
    });

    test("handles special characters in fallback", () => {
      const specialContent = "!@#$%^&*()";
      render(
        <AvatarFallback data-testid="special-chars">
          {specialContent}
        </AvatarFallback>
      );
      const fallback = screen.getByTestId("special-chars");

      expect(fallback).toHaveTextContent(specialContent);
    });

    test("handles React fragments as children", () => {
      render(
        <Avatar data-testid="fragment-avatar">
          <React.Fragment>
            <AvatarImage src="test.jpg" alt="Test" />
            <AvatarFallback>FB</AvatarFallback>
          </React.Fragment>
        </Avatar>
      );

      const avatar = screen.getByTestId("fragment-avatar");
      expect(avatar).toBeInTheDocument();
    });

    test("handles very long fallback text", () => {
      const longText = "ThisIsAVeryLongFallbackTextThatShouldBeHandled";
      render(
        <AvatarFallback data-testid="long-fallback">
          {longText}
        </AvatarFallback>
      );

      const fallback = screen.getByTestId("long-fallback");
      expect(fallback).toHaveTextContent(longText);
    });

    test("handles image with empty src", () => {
      render(<AvatarImage src="" alt="Empty" data-testid="empty-src" />);

      const image = screen.getByTestId("empty-src");
      // The mocked Radix component doesn't set empty string as src attribute
      expect(image).toBeInTheDocument();
    });

    test("handles conditional rendering", () => {
      const showImage = true;
      render(
        <Avatar data-testid="conditional">
          {showImage && <AvatarImage src="test.jpg" alt="Test" />}
          <AvatarFallback>FB</AvatarFallback>
        </Avatar>
      );

      expect(screen.getByTestId("radix-avatar-image")).toBeInTheDocument();
      expect(screen.getByText("FB")).toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    test("forwards ARIA attributes correctly", () => {
      const ariaProps = {
        "aria-label": "User profile picture",
        role: "img",
      };

      render(<Avatar data-testid="aria-avatar" {...ariaProps} />);
      const avatar = screen.getByTestId("aria-avatar");

      expect(avatar).toHaveAttribute("aria-label", "User profile picture");
      expect(avatar).toHaveAttribute("role", "img");
    });

    test("image has proper alt text", () => {
      render(
        <AvatarImage
          src="user.jpg"
          alt="John Doe profile picture"
          data-testid="accessible-img"
        />
      );

      const image = screen.getByTestId("accessible-img");
      expect(image).toHaveAttribute("alt", "John Doe profile picture");
    });

    test("fallback has proper accessibility attributes", () => {
      render(
        <AvatarFallback
          data-testid="accessible-fallback"
          role="img"
          aria-label="John Doe initials"
        >
          JD
        </AvatarFallback>
      );

      const fallback = screen.getByTestId("accessible-fallback");
      expect(fallback).toHaveAttribute("role", "img");
      expect(fallback).toHaveAttribute("aria-label", "John Doe initials");
    });

    test("supports keyboard navigation attributes", () => {
      render(
        <Avatar data-testid="keyboard-avatar" tabIndex={0}>
          <AvatarImage src="test.jpg" alt="Test" />
        </Avatar>
      );

      const avatar = screen.getByTestId("keyboard-avatar");
      expect(avatar).toHaveAttribute("tabindex", "0");
    });

    test("handles screen reader friendly fallback", () => {
      render(
        <Avatar>
          <AvatarImage src="user.jpg" alt="User profile" />
          <AvatarFallback aria-label="Fallback: JD">JD</AvatarFallback>
        </Avatar>
      );

      const fallback = screen.getByText("JD");
      expect(fallback).toHaveAttribute("aria-label", "Fallback: JD");
    });
  });

  describe("Data Slot Attributes", () => {
    test("all components have correct data-slot values", () => {
      const expectedSlots = [
        { Component: Avatar, slot: "avatar" },
        { Component: AvatarImage, slot: "avatar-image" },
        { Component: AvatarFallback, slot: "avatar-fallback" },
      ];

      expectedSlots.forEach(({ Component, slot }, index) => {
        render(
          React.createElement(Component, { "data-testid": `slot-test-${index}` })
        );
        const element = screen.getByTestId(`slot-test-${index}`);
        expect(element).toHaveAttribute("data-slot", slot);
      });
    });

    test("data-slot attributes can be overridden via props", () => {
      render(
        <Avatar
          data-testid="slot-override-test"
          data-slot="custom-slot"
        />
      );
      const avatar = screen.getByTestId("slot-override-test");

      expect(avatar).toHaveAttribute("data-slot", "custom-slot");
    });

    test("data-slot persists with custom classes", () => {
      render(
        <AvatarImage
          src="test.jpg"
          className="custom-class"
          data-testid="slot-with-class"
        />
      );

      const image = screen.getByTestId("slot-with-class");
      expect(image).toHaveAttribute("data-slot", "avatar-image");
    });
  });

  describe("Styling and Classes", () => {
    test("Avatar has correct default classes", () => {
      render(<Avatar data-testid="styled-avatar" />);

      // The default factory doesn't provide className for styled test
      expect(cn).toHaveBeenCalledWith(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full",
        undefined
      );
    });

    test("AvatarImage has correct default classes", () => {
      render(<AvatarImage src="test.jpg" data-testid="styled-image" />);

      // The default factory doesn't provide className for styled test  
      expect(cn).toHaveBeenCalledWith("aspect-square size-full", undefined);
    });

    test("AvatarFallback has correct default classes", () => {
      render(<AvatarFallback data-testid="styled-fallback">FB</AvatarFallback>);

      // The default factory doesn't provide className for styled test
      expect(cn).toHaveBeenCalledWith(
        "bg-muted flex size-full items-center justify-center rounded-full",
        undefined
      );
    });

    test("custom classes merge properly", () => {
      render(
        <Avatar className="w-16 h-16" data-testid="custom-size">
          <AvatarImage
            src="test.jpg"
            className="object-cover"
            data-testid="custom-img"
          />
          <AvatarFallback
            className="bg-blue-500"
            data-testid="custom-fallback"
          >
            FB
          </AvatarFallback>
        </Avatar>
      );

      expect(cn).toHaveBeenCalledWith(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full",
        "w-16 h-16"
      );
      expect(cn).toHaveBeenCalledWith("aspect-square size-full", "object-cover");
      expect(cn).toHaveBeenCalledWith(
        "bg-muted flex size-full items-center justify-center rounded-full",
        "bg-blue-500"
      );
    });
  });
});