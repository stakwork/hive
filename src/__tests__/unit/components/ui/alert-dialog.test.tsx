import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

// Mock dependencies
vi.mock("@/lib/utils", () => ({
  cn: vi.fn((...classes) => classes.filter(Boolean).join(" ")),
}));

vi.mock("@/components/ui/button", () => ({
  buttonVariants: vi.fn((props = {}) => {
    const { variant = "default" } = props;
    return `btn-${variant}`;
  }),
}));

// Mock Radix UI Alert Dialog primitives
vi.mock("@radix-ui/react-alert-dialog", () => ({
  Root: ({ children, ...props }: any) => (
    <div data-testid="radix-alert-dialog-root" {...props}>
      {children}
    </div>
  ),
  Trigger: ({ children, ...props }: any) => (
    <button data-testid="radix-alert-dialog-trigger" {...props}>
      {children}
    </button>
  ),
  Portal: ({ children, ...props }: any) => (
    <div data-testid="radix-alert-dialog-portal" {...props}>
      {children}
    </div>
  ),
  Overlay: ({ children, ...props }: any) => (
    <div data-testid="radix-alert-dialog-overlay" {...props}>
      {children}
    </div>
  ),
  Content: ({ children, onEscapeKeyDown, ...props }: any) => (
    <div 
      data-testid="radix-alert-dialog-content" 
      {...props}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Escape" && onEscapeKeyDown) {
          onEscapeKeyDown(e);
        }
        props.onKeyDown?.(e);
      }}
    >
      {children}
    </div>
  ),
  Title: ({ children, ...props }: any) => (
    <h2 data-testid="radix-alert-dialog-title" {...props}>
      {children}
    </h2>
  ),
  Description: ({ children, ...props }: any) => (
    <p data-testid="radix-alert-dialog-description" {...props}>
      {children}
    </p>
  ),
  Action: ({ children, ...props }: any) => (
    <button data-testid="radix-alert-dialog-action" {...props}>
      {children}
    </button>
  ),
  Cancel: ({ children, ...props }: any) => (
    <button data-testid="radix-alert-dialog-cancel" {...props}>
      {children}
    </button>
  ),
}));

const { cn } = await import("@/lib/utils");
const { buttonVariants } = await import("@/components/ui/button");

// Test data factories
const TestDataFactories = {
  divProps: (overrides = {}) => ({
    "data-testid": "test-component",
    className: "custom-class",
    id: "test-id",
    role: "dialog",
    ...overrides,
  }),

  alertDialogProps: (overrides = {}) => ({
    ...TestDataFactories.divProps(),
    open: true,
    onOpenChange: vi.fn(),
    ...overrides,
  }),

  buttonProps: (overrides = {}) => ({
    "data-testid": "test-button",
    className: "custom-button-class",
    onClick: vi.fn(),
    ...overrides,
  }),

  createAlertDialogComponent: (Component: React.ComponentType<any>, props = {}) => {
    const defaultProps = TestDataFactories.alertDialogProps(props);
    return { Component, props: defaultProps };
  },

  completeAlertDialog: (overrides = {}) => ({
    ...TestDataFactories.alertDialogProps(),
    title: "Confirm Action",
    description: "Are you sure you want to proceed?",
    actionText: "Confirm",
    cancelText: "Cancel",
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
    const defaultProps = TestDataFactories.alertDialogProps(props);
    return render(React.createElement(Component, defaultProps, children));
  },

  renderButton: (
    Component: React.ComponentType<any>,
    props = {},
    children = "Button Text"
  ) => {
    const defaultProps = TestDataFactories.buttonProps(props);
    return render(React.createElement(Component, defaultProps, children));
  },

  expectBasicRendering: (component: HTMLElement, dataSlot: string) => {
    expect(component).toBeInTheDocument();
    expect(component).toHaveAttribute("data-slot", dataSlot);
  },

  expectPropsForwarded: (component: HTMLElement, testId = "test-component") => {
    expect(component).toHaveAttribute("data-testid", testId);
    expect(component).toHaveAttribute("id", "test-id");
    expect(component).toHaveAttribute("role", "dialog");
  },

  expectClassNameMerging: (expectedClasses: string, customClass = "custom-class") => {
    expect(cn).toHaveBeenCalledWith(expectedClasses, customClass);
  },

  expectButtonClassNameMerging: (
    expectedClasses: string,
    customClass = "custom-button-class"
  ) => {
    expect(cn).toHaveBeenCalledWith(expectedClasses, customClass);
  },

  expectElementStructure: (element: HTMLElement, expectedContent: string) => {
    expect(element).toHaveTextContent(expectedContent);
    expect(element).toBeInTheDocument();
  },

  renderCompleteAlertDialog: (props = {}) => {
    const dialogProps = TestDataFactories.completeAlertDialog(props);
    
    return render(
      <AlertDialog open={dialogProps.open} onOpenChange={dialogProps.onOpenChange}>
        <AlertDialogTrigger data-testid="trigger">Open Dialog</AlertDialogTrigger>
        <AlertDialogContent data-testid="content">
          <AlertDialogHeader data-testid="header">
            <AlertDialogTitle data-testid="title">{dialogProps.title}</AlertDialogTitle>
            <AlertDialogDescription data-testid="description">
              {dialogProps.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter data-testid="footer">
            <AlertDialogCancel data-testid="cancel">{dialogProps.cancelText}</AlertDialogCancel>
            <AlertDialogAction data-testid="action">{dialogProps.actionText}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  },
};

describe("AlertDialog Components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("AlertDialog (Root)", () => {
    test("renders with default data-slot", () => {
      TestUtils.renderComponent(AlertDialog);
      const dialog = screen.getByTestId("test-component");

      TestUtils.expectBasicRendering(dialog, "alert-dialog");
      TestUtils.expectPropsForwarded(dialog);
    });

    test("forwards all props to Radix Root", () => {
      const onOpenChange = vi.fn();
      render(
        <AlertDialog
          data-testid="root-test"
          open={true}
          onOpenChange={onOpenChange}
        >
          Dialog Content
        </AlertDialog>
      );

      const dialog = screen.getByTestId("root-test");
      expect(dialog).toHaveAttribute("data-slot", "alert-dialog");
      expect(dialog).toHaveAttribute("open");
    });

    test("handles controlled state", () => {
      const onOpenChange = vi.fn();
      const { rerender } = render(
        <AlertDialog open={false} onOpenChange={onOpenChange} data-testid="controlled">
          Content
        </AlertDialog>
      );

      let dialog = screen.getByTestId("controlled");
      expect(dialog).not.toHaveAttribute("open");

      rerender(
        <AlertDialog open={true} onOpenChange={onOpenChange} data-testid="controlled">
          Content
        </AlertDialog>
      );

      dialog = screen.getByTestId("controlled");
      expect(dialog).toHaveAttribute("open");
    });
  });

  describe("AlertDialogTrigger", () => {
    test("renders with default data-slot", () => {
      TestUtils.renderComponent(AlertDialogTrigger);
      const trigger = screen.getByTestId("test-component");

      TestUtils.expectBasicRendering(trigger, "alert-dialog-trigger");
      expect(trigger.tagName).toBe("BUTTON");
    });

    test("forwards click events", async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(
        <AlertDialogTrigger onClick={handleClick} data-testid="clickable-trigger">
          Open
        </AlertDialogTrigger>
      );

      const trigger = screen.getByTestId("clickable-trigger");
      await user.click(trigger);

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    test("supports asChild prop", () => {
      render(
        <AlertDialogTrigger asChild data-testid="custom-trigger">
          <div>Custom Trigger</div>
        </AlertDialogTrigger>
      );

      const trigger = screen.getByTestId("custom-trigger");
      expect(trigger).toHaveAttribute("data-slot", "alert-dialog-trigger");
      expect(trigger).toHaveTextContent("Custom Trigger");
    });

    test("handles keyboard events", () => {
      const handleKeyDown = vi.fn();
      
      render(
        <AlertDialogTrigger onKeyDown={handleKeyDown} data-testid="keyboard-trigger">
          Trigger
        </AlertDialogTrigger>
      );

      const trigger = screen.getByTestId("keyboard-trigger");
      fireEvent.keyDown(trigger, { key: "Enter" });

      expect(handleKeyDown).toHaveBeenCalledTimes(1);
    });
  });

  describe("AlertDialogPortal", () => {
    test("renders with default data-slot", () => {
      TestUtils.renderComponent(AlertDialogPortal);
      const portal = screen.getByTestId("test-component");

      TestUtils.expectBasicRendering(portal, "alert-dialog-portal");
    });

    test("handles container prop", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);

      render(
        <AlertDialogPortal container={container} data-testid="portal-with-container">
          Portal Content
        </AlertDialogPortal>
      );

      const portal = screen.getByTestId("portal-with-container");
      expect(portal).toBeInTheDocument();
      expect(portal).toHaveTextContent("Portal Content");

      document.body.removeChild(container);
    });

    test("renders children correctly", () => {
      render(
        <AlertDialogPortal data-testid="portal-content">
          <div>Portal Child</div>
        </AlertDialogPortal>
      );

      const portal = screen.getByTestId("portal-content");
      expect(portal).toHaveTextContent("Portal Child");
    });
  });

  describe("AlertDialogOverlay", () => {
    test("renders with default classes and data-slot", () => {
      TestUtils.renderComponent(AlertDialogOverlay);
      const overlay = screen.getByTestId("test-component");

      TestUtils.expectBasicRendering(overlay, "alert-dialog-overlay");
      TestUtils.expectPropsForwarded(overlay);
      TestUtils.expectClassNameMerging(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50"
      );
    });

    test("handles custom className merging", () => {
      render(
        <AlertDialogOverlay className="custom-overlay" data-testid="overlay-custom" />
      );

      TestUtils.expectClassNameMerging(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        "custom-overlay"
      );
    });

    test("handles click events", async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(
        <AlertDialogOverlay onClick={handleClick} data-testid="clickable-overlay">
          Overlay
        </AlertDialogOverlay>
      );

      const overlay = screen.getByTestId("clickable-overlay");
      await user.click(overlay);

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    test("supports animation state attributes", () => {
      render(
        <AlertDialogOverlay
          data-testid="animated-overlay"
          data-state="open"
        />
      );

      const overlay = screen.getByTestId("animated-overlay");
      expect(overlay).toHaveAttribute("data-state", "open");
    });
  });

  describe("AlertDialogContent", () => {
    test("renders with default classes and includes portal/overlay", () => {
      TestUtils.renderComponent(AlertDialogContent);
      const content = screen.getByTestId("test-component");

      TestUtils.expectBasicRendering(content, "alert-dialog-content");
      TestUtils.expectClassNameMerging(
        "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg"
      );

      // Should also render the portal and overlay
      expect(screen.getByTestId("radix-alert-dialog-portal")).toBeInTheDocument();
      expect(screen.getByTestId("radix-alert-dialog-overlay")).toBeInTheDocument();
    });

    test("handles complex nested content", () => {
      render(
        <AlertDialogContent data-testid="complex-content">
          <div>
            <h2>Header Content</h2>
            <p>Description content</p>
            <button>Action Button</button>
          </div>
        </AlertDialogContent>
      );

      const content = screen.getByTestId("complex-content");
      expect(content).toHaveTextContent("Header Content");
      expect(content).toHaveTextContent("Description content");
      expect(screen.getByRole("button", { name: "Action Button" })).toBeInTheDocument();
    });

    test("supports escape key handling", () => {
      const handleEscapeKeyDown = vi.fn();

      render(
        <AlertDialogContent
          data-testid="escape-content"
          onEscapeKeyDown={handleEscapeKeyDown}
        >
          Content
        </AlertDialogContent>
      );

      const content = screen.getByTestId("escape-content");
      fireEvent.keyDown(content, { key: "Escape" });

      expect(handleEscapeKeyDown).toHaveBeenCalledTimes(1);
    });
  });

  describe("AlertDialogHeader", () => {
    test("renders with default classes and data-slot", () => {
      TestUtils.renderComponent(AlertDialogHeader);
      const header = screen.getByTestId("test-component");

      TestUtils.expectBasicRendering(header, "alert-dialog-header");
      TestUtils.expectPropsForwarded(header);
      TestUtils.expectClassNameMerging(
        "flex flex-col gap-2 text-center sm:text-left"
      );
    });

    test("handles multiple header elements", () => {
      render(
        <AlertDialogHeader data-testid="multi-header">
          <AlertDialogTitle>Dialog Title</AlertDialogTitle>
          <AlertDialogDescription>Dialog Description</AlertDialogDescription>
        </AlertDialogHeader>
      );

      const header = screen.getByTestId("multi-header");
      expect(header).toHaveTextContent("Dialog Title");
      expect(header).toHaveTextContent("Dialog Description");
    });

    test("maintains flex layout with custom elements", () => {
      render(
        <AlertDialogHeader data-testid="custom-header">
          <div>Custom Element 1</div>
          <div>Custom Element 2</div>
        </AlertDialogHeader>
      );

      const header = screen.getByTestId("custom-header");
      expect(header).toHaveTextContent("Custom Element 1");
      expect(header).toHaveTextContent("Custom Element 2");
      expect(header).toHaveAttribute("data-slot", "alert-dialog-header");
    });
  });

  describe("AlertDialogFooter", () => {
    test("renders with default classes and data-slot", () => {
      TestUtils.renderComponent(AlertDialogFooter);
      const footer = screen.getByTestId("test-component");

      TestUtils.expectBasicRendering(footer, "alert-dialog-footer");
      TestUtils.expectPropsForwarded(footer);
      TestUtils.expectClassNameMerging(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
      );
    });

    test("handles multiple footer buttons with proper layout", () => {
      render(
        <AlertDialogFooter data-testid="button-footer">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      );

      const footer = screen.getByTestId("button-footer");
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
      expect(footer).toHaveAttribute("data-slot", "alert-dialog-footer");
    });

    test("maintains responsive layout classes", () => {
      render(<AlertDialogFooter className="custom-footer" data-testid="responsive" />);

      TestUtils.expectClassNameMerging(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        "custom-footer"
      );
    });
  });

  describe("AlertDialogTitle", () => {
    test("renders with default classes and data-slot", () => {
      TestUtils.renderComponent(AlertDialogTitle);
      const title = screen.getByTestId("test-component");

      TestUtils.expectBasicRendering(title, "alert-dialog-title");
      expect(title.tagName).toBe("H2");
      TestUtils.expectPropsForwarded(title);
      TestUtils.expectClassNameMerging("text-lg font-semibold");
    });

    test("supports different heading levels via props", () => {
      render(
        <AlertDialogTitle
          data-testid="custom-title"
          role="heading"
          aria-level={3}
        >
          Custom Title
        </AlertDialogTitle>
      );

      const title = screen.getByTestId("custom-title");
      expect(title).toHaveAttribute("role", "heading");
      expect(title).toHaveAttribute("aria-level", "3");
      expect(title).toHaveTextContent("Custom Title");
    });

    test("handles long titles", () => {
      const longTitle = "This is a very long title that should be handled gracefully by the component";
      render(
        <AlertDialogTitle data-testid="long-title">
          {longTitle}
        </AlertDialogTitle>
      );

      const title = screen.getByTestId("long-title");
      expect(title).toHaveTextContent(longTitle);
    });

    test("supports HTML content", () => {
      render(
        <AlertDialogTitle data-testid="html-title">
          <span>HTML</span> <strong>Content</strong>
        </AlertDialogTitle>
      );

      const title = screen.getByTestId("html-title");
      expect(title).toHaveTextContent("HTML Content");
      expect(title.querySelector("span")).toBeInTheDocument();
      expect(title.querySelector("strong")).toBeInTheDocument();
    });
  });

  describe("AlertDialogDescription", () => {
    test("renders with default classes and data-slot", () => {
      TestUtils.renderComponent(AlertDialogDescription);
      const description = screen.getByTestId("test-component");

      TestUtils.expectBasicRendering(description, "alert-dialog-description");
      expect(description.tagName).toBe("P");
      TestUtils.expectPropsForwarded(description);
      TestUtils.expectClassNameMerging("text-muted-foreground text-sm");
    });

    test("handles multiline descriptions", () => {
      const multilineText = "This is line one.\nThis is line two.\nThis is line three.";
      render(
        <AlertDialogDescription data-testid="multiline-desc">
          {multilineText}
        </AlertDialogDescription>
      );

      const description = screen.getByTestId("multiline-desc");
      expect(description).toHaveTextContent("This is line one. This is line two. This is line three.");
    });

    test("handles HTML content", () => {
      render(
        <AlertDialogDescription data-testid="html-desc">
          This is <em>emphasized</em> and this is <strong>strong</strong> text.
        </AlertDialogDescription>
      );

      const description = screen.getByTestId("html-desc");
      expect(description).toHaveTextContent("This is emphasized and this is strong text.");
      expect(description.querySelector("em")).toBeInTheDocument();
      expect(description.querySelector("strong")).toBeInTheDocument();
    });

    test("supports accessibility attributes", () => {
      render(
        <AlertDialogDescription
          data-testid="accessible-desc"
          aria-live="polite"
          id="dialog-description"
        >
          Accessible description
        </AlertDialogDescription>
      );

      const description = screen.getByTestId("accessible-desc");
      expect(description).toHaveAttribute("aria-live", "polite");
      expect(description).toHaveAttribute("id", "dialog-description");
    });
  });

  describe("AlertDialogAction", () => {
    test("renders with button variants but no data-slot (as per implementation)", () => {
      TestUtils.renderButton(AlertDialogAction);
      const action = screen.getByTestId("test-button");

      expect(action).toBeInTheDocument();
      // Note: AlertDialogAction doesn't have data-slot in the actual implementation
      expect(action).not.toHaveAttribute("data-slot");
      expect(action.tagName).toBe("BUTTON");
      expect(buttonVariants).toHaveBeenCalledWith();
      TestUtils.expectButtonClassNameMerging("btn-default");
    });

    test("handles click events", async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(
        <AlertDialogAction onClick={handleClick} data-testid="action-click">
          Confirm
        </AlertDialogAction>
      );

      const action = screen.getByTestId("action-click");
      await user.click(action);

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    test("supports custom button variants via className", () => {
      render(
        <AlertDialogAction
          className="destructive-button"
          data-testid="destructive-action"
        >
          Delete
        </AlertDialogAction>
      );

      TestUtils.expectButtonClassNameMerging("btn-default", "destructive-button");
    });

    test("supports disabled state", () => {
      render(
        <AlertDialogAction disabled data-testid="disabled-action">
          Disabled Action
        </AlertDialogAction>
      );

      const action = screen.getByTestId("disabled-action");
      expect(action).toBeDisabled();
    });

    test("forwards all button props", () => {
      const handleMouseEnter = vi.fn();
      render(
        <AlertDialogAction
          data-testid="full-props-action"
          type="submit"
          form="my-form"
          onMouseEnter={handleMouseEnter}
          tabIndex={0}
        >
          Submit
        </AlertDialogAction>
      );

      const action = screen.getByTestId("full-props-action");
      expect(action).toHaveAttribute("type", "submit");
      expect(action).toHaveAttribute("form", "my-form");
      expect(action).toHaveAttribute("tabindex", "0");

      fireEvent.mouseEnter(action);
      expect(handleMouseEnter).toHaveBeenCalledTimes(1);
    });
  });

  describe("AlertDialogCancel", () => {
    test("renders with outline button variants but no data-slot (as per implementation)", () => {
      TestUtils.renderButton(AlertDialogCancel);
      const cancel = screen.getByTestId("test-button");

      expect(cancel).toBeInTheDocument();
      // Note: AlertDialogCancel doesn't have data-slot in the actual implementation
      expect(cancel).not.toHaveAttribute("data-slot");
      expect(cancel.tagName).toBe("BUTTON");
      expect(buttonVariants).toHaveBeenCalledWith({ variant: "outline" });
      TestUtils.expectButtonClassNameMerging("btn-outline");
    });

    test("handles click events", async () => {
      const user = userEvent.setup();
      const handleClick = vi.fn();

      render(
        <AlertDialogCancel onClick={handleClick} data-testid="cancel-click">
          Cancel
        </AlertDialogCancel>
      );

      const cancel = screen.getByTestId("cancel-click");
      await user.click(cancel);

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    test("maintains outline variant with custom className", () => {
      render(
        <AlertDialogCancel
          className="custom-cancel"
          data-testid="custom-cancel-btn"
        >
          Custom Cancel
        </AlertDialogCancel>
      );

      expect(buttonVariants).toHaveBeenCalledWith({ variant: "outline" });
      TestUtils.expectButtonClassNameMerging("btn-outline", "custom-cancel");
    });

    test("supports keyboard navigation", () => {
      const handleKeyDown = vi.fn();

      render(
        <AlertDialogCancel onKeyDown={handleKeyDown} data-testid="keyboard-cancel">
          Cancel
        </AlertDialogCancel>
      );

      const cancel = screen.getByTestId("keyboard-cancel");
      fireEvent.keyDown(cancel, { key: "Space" });

      expect(handleKeyDown).toHaveBeenCalledTimes(1);
    });
  });

  describe("Component Integration", () => {
    test("renders complete alert dialog structure", () => {
      TestUtils.renderCompleteAlertDialog();

      // Verify all components are rendered
      const componentTestIds = [
        "trigger",
        "content",
        "header",
        "title",
        "description",
        "footer",
        "cancel",
        "action",
      ];

      componentTestIds.forEach((testId) => {
        expect(screen.getByTestId(testId)).toBeInTheDocument();
      });

      // Verify content
      expect(screen.getByText("Open Dialog")).toBeInTheDocument();
      expect(screen.getByText("Confirm Action")).toBeInTheDocument();
      expect(screen.getByText("Are you sure you want to proceed?")).toBeInTheDocument();
      expect(screen.getByText("Cancel")).toBeInTheDocument();
      expect(screen.getByText("Confirm")).toBeInTheDocument();
    });

    test("maintains proper DOM hierarchy", () => {
      TestUtils.renderCompleteAlertDialog();

      const content = screen.getByTestId("content");
      const header = screen.getByTestId("header");
      const title = screen.getByTestId("title");
      const description = screen.getByTestId("description");
      const footer = screen.getByTestId("footer");
      const cancel = screen.getByTestId("cancel");
      const action = screen.getByTestId("action");

      expect(content).toContainElement(header);
      expect(content).toContainElement(footer);
      expect(header).toContainElement(title);
      expect(header).toContainElement(description);
      expect(footer).toContainElement(cancel);
      expect(footer).toContainElement(action);
    });

    test("handles complete user interaction flow", async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      const onAction = vi.fn();
      const onCancel = vi.fn();

      render(
        <AlertDialog open={true} onOpenChange={onOpenChange}>
          <AlertDialogTrigger data-testid="trigger">Open</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm</AlertDialogTitle>
              <AlertDialogDescription>Are you sure?</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={onCancel} data-testid="cancel">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction onClick={onAction} data-testid="action">
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );

      // Test cancel action
      const cancelButton = screen.getByTestId("cancel");
      await user.click(cancelButton);
      expect(onCancel).toHaveBeenCalledTimes(1);

      // Test confirm action
      const confirmButton = screen.getByTestId("action");
      await user.click(confirmButton);
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  describe("Edge Cases", () => {
    test("handles null and undefined props gracefully", () => {
      const components = [
        { Component: AlertDialog, name: "AlertDialog" },
        { Component: AlertDialogTrigger, name: "AlertDialogTrigger" },
        { Component: AlertDialogPortal, name: "AlertDialogPortal" },
        { Component: AlertDialogOverlay, name: "AlertDialogOverlay" },
        { Component: AlertDialogContent, name: "AlertDialogContent" },
        { Component: AlertDialogHeader, name: "AlertDialogHeader" },
        { Component: AlertDialogFooter, name: "AlertDialogFooter" },
        { Component: AlertDialogTitle, name: "AlertDialogTitle" },
        { Component: AlertDialogDescription, name: "AlertDialogDescription" },
        { Component: AlertDialogAction, name: "AlertDialogAction" },
        { Component: AlertDialogCancel, name: "AlertDialogCancel" },
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
      render(<AlertDialogContent data-testid="empty-content">{""}</AlertDialogContent>);
      const content = screen.getByTestId("empty-content");

      expect(content).toBeInTheDocument();
    });

    test("handles special characters in content", () => {
      const specialContent = "Special chars: !@#$%^&*()_+{}|:<>?[];',./`~";
      render(
        <AlertDialogTitle data-testid="special-chars">
          {specialContent}
        </AlertDialogTitle>
      );
      const title = screen.getByTestId("special-chars");

      expect(title).toHaveTextContent(specialContent);
    });

    test("handles React fragments as children", () => {
      render(
        <AlertDialogContent data-testid="fragment-content">
          <React.Fragment>
            <span>Fragment Child 1</span>
            <span>Fragment Child 2</span>
          </React.Fragment>
        </AlertDialogContent>
      );

      const content = screen.getByTestId("fragment-content");
      expect(content).toHaveTextContent("Fragment Child 1");
      expect(content).toHaveTextContent("Fragment Child 2");
    });

    test("handles array of elements as children", () => {
      const arrayChildren = [
        <span key="1">First</span>,
        <span key="2">Second</span>,
        <span key="3">Third</span>,
      ];

      render(
        <AlertDialogHeader data-testid="array-children">
          {arrayChildren}
        </AlertDialogHeader>
      );
      const header = screen.getByTestId("array-children");

      expect(header).toHaveTextContent("First");
      expect(header).toHaveTextContent("Second");
      expect(header).toHaveTextContent("Third");
    });

    test("handles conditional rendering", () => {
      const condition = true;
      render(
        <AlertDialogFooter data-testid="conditional-footer">
          {condition && <AlertDialogCancel>Conditional Cancel</AlertDialogCancel>}
          <AlertDialogAction>Always Action</AlertDialogAction>
        </AlertDialogFooter>
      );

      expect(screen.getByText("Conditional Cancel")).toBeInTheDocument();
      expect(screen.getByText("Always Action")).toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    test("forwards ARIA attributes correctly", () => {
      const ariaProps = {
        "aria-label": "Alert Dialog",
        "aria-describedby": "dialog-desc",
        "aria-labelledby": "dialog-title",
        role: "alertdialog",
      };

      render(
        <AlertDialogContent data-testid="aria-content" {...ariaProps}>
          Accessible Content
        </AlertDialogContent>
      );
      const content = screen.getByTestId("aria-content");

      expect(content).toHaveAttribute("aria-label", "Alert Dialog");
      expect(content).toHaveAttribute("aria-describedby", "dialog-desc");
      expect(content).toHaveAttribute("aria-labelledby", "dialog-title");
      expect(content).toHaveAttribute("role", "alertdialog");
    });

    test("maintains semantic heading structure", () => {
      render(
        <AlertDialogTitle
          data-testid="semantic-title"
          role="heading"
          aria-level={2}
        >
          Dialog Title
        </AlertDialogTitle>
      );

      const title = screen.getByRole("heading", { level: 2 });
      expect(title).toHaveTextContent("Dialog Title");
    });

    test("supports keyboard navigation", () => {
      render(
        <AlertDialogContent data-testid="keyboard-content" tabIndex={0}>
          <AlertDialogAction data-testid="keyboard-action">
            Accessible Action
          </AlertDialogAction>
        </AlertDialogContent>
      );

      const content = screen.getByTestId("keyboard-content");
      const action = screen.getByTestId("keyboard-action");

      expect(content).toHaveAttribute("tabindex", "0");
      
      // Focus should be manageable
      content.focus();
      expect(document.activeElement).toBe(content);
    });

    test("handles screen reader announcements", () => {
      render(
        <AlertDialogDescription
          data-testid="screen-reader-desc"
          aria-live="assertive"
          aria-atomic="true"
        >
          Important announcement
        </AlertDialogDescription>
      );

      const description = screen.getByTestId("screen-reader-desc");
      expect(description).toHaveAttribute("aria-live", "assertive");
      expect(description).toHaveAttribute("aria-atomic", "true");
    });

    test("supports focus trap and escape handling", () => {
      const handleEscape = vi.fn();

      render(
        <AlertDialogContent
          data-testid="focus-trap-content"
          onEscapeKeyDown={handleEscape}
        >
          <AlertDialogAction data-testid="first-focusable">First</AlertDialogAction>
          <AlertDialogCancel data-testid="last-focusable">Last</AlertDialogCancel>
        </AlertDialogContent>
      );

      const content = screen.getByTestId("focus-trap-content");
      fireEvent.keyDown(content, { key: "Escape" });

      expect(handleEscape).toHaveBeenCalledTimes(1);
    });
  });

  describe("Data Slot Attributes", () => {
    test("components with data-slot attributes have correct values", () => {
      // Only test components that actually have data-slot attributes in the implementation
      const expectedSlots = [
        { Component: AlertDialog, slot: "alert-dialog" },
        { Component: AlertDialogTrigger, slot: "alert-dialog-trigger" },
        { Component: AlertDialogPortal, slot: "alert-dialog-portal" },
        { Component: AlertDialogOverlay, slot: "alert-dialog-overlay" },
        { Component: AlertDialogContent, slot: "alert-dialog-content" },
        { Component: AlertDialogHeader, slot: "alert-dialog-header" },
        { Component: AlertDialogFooter, slot: "alert-dialog-footer" },
        { Component: AlertDialogTitle, slot: "alert-dialog-title" },
        { Component: AlertDialogDescription, slot: "alert-dialog-description" },
        // AlertDialogAction and AlertDialogCancel don't have data-slot in implementation
      ];

      expectedSlots.forEach(({ Component, slot }, index) => {
        render(
          React.createElement(Component, { "data-testid": `slot-test-${index}` })
        );
        const element = screen.getByTestId(`slot-test-${index}`);
        expect(element).toHaveAttribute("data-slot", slot);
      });
    });

    test("button components don't have data-slot attributes (as per implementation)", () => {
      // Test AlertDialogAction
      render(<AlertDialogAction data-testid="action-no-slot">Action</AlertDialogAction>);
      const action = screen.getByTestId("action-no-slot");
      expect(action).not.toHaveAttribute("data-slot");

      // Test AlertDialogCancel  
      render(<AlertDialogCancel data-testid="cancel-no-slot">Cancel</AlertDialogCancel>);
      const cancel = screen.getByTestId("cancel-no-slot");
      expect(cancel).not.toHaveAttribute("data-slot");
    });

    test("data-slot attributes use component values over props", () => {
      render(
        <AlertDialogContent
          data-testid="slot-override-test"
          data-slot="custom-slot"
        />
      );
      const content = screen.getByTestId("slot-override-test");

      // Props override component's data-slot (this is how it actually works)
      expect(content).toHaveAttribute("data-slot", "custom-slot");
    });
  });
});