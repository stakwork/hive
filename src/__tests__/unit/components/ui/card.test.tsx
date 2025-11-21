import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

// Mock the cn utility function
vi.mock("@/lib/utils", () => ({
  cn: vi.fn((...classes) => classes.filter(Boolean).join(" ")),
}));

const { cn } = await import("@/lib/utils");

// Test data factories
const TestDataFactories = {
  divProps: (overrides = {}) => ({
    "data-testid": "test-component",
    className: "custom-class",
    id: "test-id",
    role: "region",
    ...overrides,
  }),

  cardProps: (overrides = {}) => ({
    ...TestDataFactories.divProps(),
    ...overrides,
  }),

  createCardComponent: (Component: React.ComponentType<any>, props = {}) => {
    const defaultProps = TestDataFactories.cardProps(props);
    return { Component, props: defaultProps };
  },
};

// Test utilities
const TestUtils = {
  renderComponent: (Component: React.ComponentType<any>, props = {}, children = "Test Content") => {
    const defaultProps = TestDataFactories.cardProps(props);
    return render(React.createElement(Component, defaultProps, children));
  },

  expectBasicRendering: (component: HTMLElement, dataSlot: string) => {
    expect(component).toBeInTheDocument();
    expect(component.tagName).toBe("DIV");
    expect(component).toHaveAttribute("data-slot", dataSlot);
  },

  expectPropsForwarded: (component: HTMLElement, testId = "test-component") => {
    expect(component).toHaveAttribute("data-testid", testId);
    expect(component).toHaveAttribute("id", "test-id");
    expect(component).toHaveAttribute("role", "region");
  },

  expectClassNameMerging: (expectedClasses: string, customClass = "custom-class") => {
    expect(cn).toHaveBeenCalledWith(expectedClasses, customClass);
  },

  expectElementStructure: (element: HTMLElement, expectedContent: string) => {
    expect(element).toHaveTextContent(expectedContent);
    expect(element).toBeInTheDocument();
  },
};

describe("Card Components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Card", () => {
    test("renders with default classes and data-slot", () => {
      TestUtils.renderComponent(Card);
      const card = screen.getByTestId("test-component");

      TestUtils.expectBasicRendering(card, "card");
      TestUtils.expectPropsForwarded(card);
      TestUtils.expectClassNameMerging(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",
      );
      TestUtils.expectElementStructure(card, "Test Content");
    });

    test("forwards all HTML div props correctly", () => {
      const props = {
        "data-testid": "card-test",
        onClick: vi.fn(),
        onMouseEnter: vi.fn(),
        style: { background: "red" },
        title: "Card Title",
        tabIndex: 0,
      };

      render(<Card {...props}>Card Content</Card>);
      const card = screen.getByTestId("card-test");

      expect(card).toHaveAttribute("title", "Card Title");
      expect(card).toHaveStyle({ background: "red" });
      expect(card).toHaveAttribute("tabindex", "0");
      expect(card).toHaveTextContent("Card Content");
    });

    test("renders without children", () => {
      render(<Card data-testid="empty-card" />);
      const card = screen.getByTestId("empty-card");

      expect(card).toBeInTheDocument();
      expect(card).toBeEmptyDOMElement();
      expect(card).toHaveAttribute("data-slot", "card");
    });

    test("handles custom className merging", () => {
      render(<Card className="my-custom-class" data-testid="custom-card" />);

      TestUtils.expectClassNameMerging(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",
        "my-custom-class",
      );
    });
  });

  describe("CardHeader", () => {
    test("renders with default classes and data-slot", () => {
      TestUtils.renderComponent(CardHeader);
      const header = screen.getByTestId("test-component");

      TestUtils.expectBasicRendering(header, "card-header");
      TestUtils.expectPropsForwarded(header);
      TestUtils.expectClassNameMerging(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
      );
    });

    test("handles complex grid layouts with multiple children", () => {
      render(
        <CardHeader data-testid="header-with-children">
          <div data-slot="card-title">Title</div>
          <div data-slot="card-description">Description</div>
          <div data-slot="card-action">Action</div>
        </CardHeader>,
      );
      const header = screen.getByTestId("header-with-children");

      expect(header).toBeInTheDocument();
      expect(header).toHaveAttribute("data-slot", "card-header");
      expect(header).toHaveTextContent("Title");
      expect(header).toHaveTextContent("Description");
      expect(header).toHaveTextContent("Action");
    });

    test("forwards event handlers", () => {
      const handleClick = vi.fn();
      render(<CardHeader data-testid="clickable-header" onClick={handleClick} />);

      const header = screen.getByTestId("clickable-header");
      header.click();

      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("CardTitle", () => {
    test("renders with default classes and data-slot", () => {
      TestUtils.renderComponent(CardTitle);
      const title = screen.getByTestId("test-component");

      TestUtils.expectBasicRendering(title, "card-title");
      TestUtils.expectPropsForwarded(title);
      TestUtils.expectClassNameMerging("leading-none font-semibold");
    });

    test("renders with different content types", () => {
      const { rerender } = render(<CardTitle data-testid="title-test">String Title</CardTitle>);
      expect(screen.getByTestId("title-test")).toHaveTextContent("String Title");

      rerender(
        <CardTitle data-testid="title-test">
          <span>Complex Title</span>
        </CardTitle>,
      );
      expect(screen.getByTestId("title-test")).toHaveTextContent("Complex Title");

      rerender(
        <CardTitle data-testid="title-test">
          <h2>Heading Title</h2>
        </CardTitle>,
      );
      expect(screen.getByTestId("title-test")).toHaveTextContent("Heading Title");
    });

    test("handles semantic HTML attributes", () => {
      render(
        <CardTitle data-testid="semantic-title" role="heading" aria-level={2}>
          Semantic Title
        </CardTitle>,
      );

      const title = screen.getByTestId("semantic-title");
      expect(title).toHaveAttribute("role", "heading");
      expect(title).toHaveAttribute("aria-level", "2");
    });
  });

  describe("CardDescription", () => {
    test("renders with default classes and data-slot", () => {
      TestUtils.renderComponent(CardDescription);
      const description = screen.getByTestId("test-component");

      TestUtils.expectBasicRendering(description, "card-description");
      TestUtils.expectPropsForwarded(description);
      TestUtils.expectClassNameMerging("text-muted-foreground text-sm");
    });

    test("handles long text content", () => {
      const longText = "A".repeat(500);
      render(<CardDescription data-testid="long-desc">{longText}</CardDescription>);
      const description = screen.getByTestId("long-desc");

      expect(description).toHaveTextContent(longText);
      expect(description).toHaveAttribute("data-slot", "card-description");
    });

    test("handles multiline content", () => {
      const multilineContent = "Line 1\nLine 2\nLine 3";
      render(<CardDescription data-testid="multiline-desc">{multilineContent}</CardDescription>);
      const description = screen.getByTestId("multiline-desc");

      expect(description).toHaveTextContent("Line 1 Line 2 Line 3");
    });
  });

  describe("CardAction", () => {
    test("renders with default classes and data-slot", () => {
      TestUtils.renderComponent(CardAction);
      const action = screen.getByTestId("test-component");

      TestUtils.expectBasicRendering(action, "card-action");
      TestUtils.expectPropsForwarded(action);
      TestUtils.expectClassNameMerging("col-start-2 row-span-2 row-start-1 self-start justify-self-end");
    });

    test("works with interactive elements", () => {
      const handleClick = vi.fn();
      render(
        <CardAction data-testid="interactive-action">
          <button onClick={handleClick}>Action Button</button>
        </CardAction>,
      );
      const action = screen.getByTestId("interactive-action");
      const button = screen.getByRole("button", { name: "Action Button" });

      expect(action).toContainElement(button);
      expect(action).toHaveAttribute("data-slot", "card-action");

      button.click();
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    test("handles multiple action elements", () => {
      render(
        <CardAction data-testid="multiple-actions">
          <button>Edit</button>
          <button>Delete</button>
          <span>|</span>
        </CardAction>,
      );
      const action = screen.getByTestId("multiple-actions");

      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
      expect(action).toHaveTextContent("Edit");
      expect(action).toHaveTextContent("Delete");
      expect(action).toHaveTextContent("|");
    });
  });

  describe("CardContent", () => {
    test("renders with default classes and data-slot", () => {
      TestUtils.renderComponent(CardContent);
      const content = screen.getByTestId("test-component");

      TestUtils.expectBasicRendering(content, "card-content");
      TestUtils.expectPropsForwarded(content);
      TestUtils.expectClassNameMerging("px-6");
    });

    test("handles complex nested content", () => {
      render(
        <CardContent data-testid="complex-content">
          <div>
            <h3>Nested Header</h3>
            <p>Nested paragraph</p>
            <ul>
              <li>List item 1</li>
              <li>List item 2</li>
            </ul>
          </div>
        </CardContent>,
      );
      const content = screen.getByTestId("complex-content");

      expect(content).toHaveTextContent("Nested Header");
      expect(content).toHaveTextContent("Nested paragraph");
      expect(content).toHaveTextContent("List item 1");
      expect(content).toHaveTextContent("List item 2");
    });

    test("handles form elements", () => {
      render(
        <CardContent data-testid="form-content">
          <form>
            <input type="text" placeholder="Enter text" />
            <textarea placeholder="Enter description"></textarea>
            <select>
              <option value="1">Option 1</option>
              <option value="2">Option 2</option>
            </select>
          </form>
        </CardContent>,
      );
      const content = screen.getByTestId("form-content");

      expect(content).toContainElement(screen.getByPlaceholderText("Enter text"));
      expect(content).toContainElement(screen.getByPlaceholderText("Enter description"));
      expect(content).toContainElement(screen.getByRole("combobox"));
    });
  });

  describe("CardFooter", () => {
    test("renders with default classes and data-slot", () => {
      TestUtils.renderComponent(CardFooter);
      const footer = screen.getByTestId("test-component");

      TestUtils.expectBasicRendering(footer, "card-footer");
      TestUtils.expectPropsForwarded(footer);
      TestUtils.expectClassNameMerging("flex items-center px-6 [.border-t]:pt-6");
    });

    test("handles multiple footer elements with flex layout", () => {
      render(
        <CardFooter data-testid="multi-footer">
          <button>Cancel</button>
          <div style={{ flex: 1 }}></div>
          <button>Save</button>
        </CardFooter>,
      );
      const footer = screen.getByTestId("multi-footer");

      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
      expect(footer).toHaveAttribute("data-slot", "card-footer");
    });

    test("handles footer with links and text", () => {
      render(
        <CardFooter data-testid="link-footer">
          <a href="/terms">Terms</a>
          <span>|</span>
          <a href="/privacy">Privacy</a>
        </CardFooter>,
      );
      const footer = screen.getByTestId("link-footer");

      expect(screen.getByRole("link", { name: "Terms" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Privacy" })).toBeInTheDocument();
      expect(footer).toHaveTextContent("|");
    });
  });

  describe("Component Integration", () => {
    test("renders complete card structure", () => {
      render(
        <Card data-testid="complete-card">
          <CardHeader data-testid="card-header">
            <CardTitle data-testid="card-title">Card Title</CardTitle>
            <CardDescription data-testid="card-description">Card Description</CardDescription>
            <CardAction data-testid="card-action">
              <button>Action</button>
            </CardAction>
          </CardHeader>
          <CardContent data-testid="card-content">
            <p>Card content goes here</p>
          </CardContent>
          <CardFooter data-testid="card-footer">
            <button>Footer Button</button>
          </CardFooter>
        </Card>,
      );

      // Verify all components are rendered
      const componentTestIds = [
        "complete-card",
        "card-header",
        "card-title",
        "card-description",
        "card-action",
        "card-content",
        "card-footer",
      ];

      componentTestIds.forEach((testId) => {
        expect(screen.getByTestId(testId)).toBeInTheDocument();
      });

      // Verify content
      expect(screen.getByText("Card Title")).toBeInTheDocument();
      expect(screen.getByText("Card Description")).toBeInTheDocument();
      expect(screen.getByText("Card content goes here")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Action" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Footer Button" })).toBeInTheDocument();
    });

    test("maintains proper DOM hierarchy", () => {
      render(
        <Card data-testid="hierarchy-card">
          <CardHeader data-testid="hierarchy-header">
            <CardTitle data-testid="hierarchy-title">Title</CardTitle>
          </CardHeader>
          <CardContent data-testid="hierarchy-content">Content</CardContent>
        </Card>,
      );

      const card = screen.getByTestId("hierarchy-card");
      const header = screen.getByTestId("hierarchy-header");
      const title = screen.getByTestId("hierarchy-title");
      const content = screen.getByTestId("hierarchy-content");

      expect(card).toContainElement(header);
      expect(card).toContainElement(content);
      expect(header).toContainElement(title);
      expect(title).toHaveTextContent("Title");
      expect(content).toHaveTextContent("Content");
    });

    test("handles card with only header and content", () => {
      render(
        <Card data-testid="simple-card">
          <CardHeader>
            <CardTitle>Simple Title</CardTitle>
          </CardHeader>
          <CardContent>Simple Content</CardContent>
        </Card>,
      );

      expect(screen.getByTestId("simple-card")).toBeInTheDocument();
      expect(screen.getByText("Simple Title")).toBeInTheDocument();
      expect(screen.getByText("Simple Content")).toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    test("handles null and undefined props gracefully", () => {
      const components = [
        { Component: Card, name: "Card" },
        { Component: CardHeader, name: "CardHeader" },
        { Component: CardTitle, name: "CardTitle" },
        { Component: CardDescription, name: "CardDescription" },
        { Component: CardAction, name: "CardAction" },
        { Component: CardContent, name: "CardContent" },
        { Component: CardFooter, name: "CardFooter" },
      ];

      components.forEach(({ Component, name }, index) => {
        render(React.createElement(Component, { "data-testid": `null-test-${index}`, className: null }, null));
        const element = screen.getByTestId(`null-test-${index}`);
        expect(element).toBeInTheDocument();
        expect(element).toBeEmptyDOMElement();
      });
    });

    test("handles undefined children", () => {
      render(<Card data-testid="undefined-children">{undefined}</Card>);
      const card = screen.getByTestId("undefined-children");

      expect(card).toBeInTheDocument();
      expect(card).toBeEmptyDOMElement();
    });

    test("handles empty className", () => {
      render(<Card data-testid="empty-class" className="" />);
      const card = screen.getByTestId("empty-class");

      expect(card).toBeInTheDocument();
      expect(cn).toHaveBeenCalledWith(expect.any(String), "");
    });

    test("handles special characters in content", () => {
      const specialContent = "Special chars: !@#$%^&*()_+{}|:<>?[];',./`~";
      render(<CardTitle data-testid="special-chars">{specialContent}</CardTitle>);
      const title = screen.getByTestId("special-chars");

      expect(title).toHaveTextContent(specialContent);
    });

    test("handles React elements as children", () => {
      const reactElement = <span data-testid="react-child">React Element</span>;
      render(<CardContent data-testid="react-parent">{reactElement}</CardContent>);

      expect(screen.getByTestId("react-parent")).toBeInTheDocument();
      expect(screen.getByTestId("react-child")).toBeInTheDocument();
    });

    test("handles array of elements as children", () => {
      const arrayChildren = [<span key="1">First</span>, <span key="2">Second</span>, <span key="3">Third</span>];

      render(<CardContent data-testid="array-children">{arrayChildren}</CardContent>);
      const content = screen.getByTestId("array-children");

      expect(content).toHaveTextContent("First");
      expect(content).toHaveTextContent("Second");
      expect(content).toHaveTextContent("Third");
    });

    test("handles boolean and number children", () => {
      render(
        <CardContent data-testid="primitive-children">
          {true} {false} {0} {1} {null} {undefined}
        </CardContent>,
      );
      const content = screen.getByTestId("primitive-children");

      // React renders boolean, null, undefined as empty strings
      // Numbers are rendered as strings
      expect(content).toHaveTextContent("0 1");
    });
  });

  describe("Accessibility", () => {
    test("forwards ARIA attributes correctly", () => {
      const ariaProps = {
        "aria-label": "Card Label",
        "aria-describedby": "card-desc",
        "aria-expanded": "true",
        role: "article",
      };

      render(<Card data-testid="aria-card" {...ariaProps} />);
      const card = screen.getByTestId("aria-card");

      expect(card).toHaveAttribute("aria-label", "Card Label");
      expect(card).toHaveAttribute("aria-describedby", "card-desc");
      expect(card).toHaveAttribute("aria-expanded", "true");
      expect(card).toHaveAttribute("role", "article");
    });

    test("maintains semantic meaning with proper roles", () => {
      render(
        <Card data-testid="semantic-card" role="article">
          <CardHeader data-testid="semantic-header" role="banner">
            <CardTitle data-testid="semantic-title" role="heading" aria-level="1">
              Article Title
            </CardTitle>
          </CardHeader>
          <CardContent data-testid="semantic-content" role="main">
            Content
          </CardContent>
          <CardFooter data-testid="semantic-footer" role="contentinfo">
            Footer
          </CardFooter>
        </Card>,
      );

      expect(screen.getByRole("article")).toBeInTheDocument();
      expect(screen.getByRole("banner")).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
      expect(screen.getByRole("main")).toBeInTheDocument();
      expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    });

    test("supports keyboard navigation attributes", () => {
      render(
        <Card data-testid="keyboard-card" tabIndex={0} onKeyDown={vi.fn()} role="button" aria-pressed="false">
          Keyboard accessible card
        </Card>,
      );
      const card = screen.getByTestId("keyboard-card");

      expect(card).toHaveAttribute("tabindex", "0");
      expect(card).toHaveAttribute("role", "button");
      expect(card).toHaveAttribute("aria-pressed", "false");
    });

    test("handles screen reader specific attributes", () => {
      render(
        <CardDescription data-testid="screen-reader-desc" aria-live="polite" aria-atomic="true">
          Dynamic description
        </CardDescription>,
      );
      const description = screen.getByTestId("screen-reader-desc");

      expect(description).toHaveAttribute("aria-live", "polite");
      expect(description).toHaveAttribute("aria-atomic", "true");
    });
  });

  describe("ClassName Merging", () => {
    test("merges custom className with default classes for Card", () => {
      render(<Card className="custom-card-class" data-testid="merged-class" />);

      TestUtils.expectClassNameMerging(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",
        "custom-card-class",
      );
    });

    test("merges multiple custom classes", () => {
      render(<CardHeader className="custom-1 custom-2 custom-3" data-testid="multiple-classes" />);

      TestUtils.expectClassNameMerging(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        "custom-1 custom-2 custom-3",
      );
    });

    test("handles conditional classes", () => {
      const condition = true;
      render(
        <CardTitle className={condition ? "conditional-true" : "conditional-false"} data-testid="conditional-class" />,
      );

      TestUtils.expectClassNameMerging("leading-none font-semibold", "conditional-true");
    });

    test("handles falsy className values", () => {
      render(<CardContent className={false as any} data-testid="falsy-class" />);

      expect(cn).toHaveBeenCalledWith("px-6", false);
    });

    test("handles array of classes", () => {
      const classArray = ["class1", "class2", "class3"];
      render(<CardFooter className={classArray.join(" ")} data-testid="array-classes" />);

      TestUtils.expectClassNameMerging("flex items-center px-6 [.border-t]:pt-6", "class1 class2 class3");
    });
  });

  describe("Data Slot Attributes", () => {
    test("all components have correct data-slot attributes", () => {
      const expectedSlots = [
        { Component: Card, slot: "card" },
        { Component: CardHeader, slot: "card-header" },
        { Component: CardTitle, slot: "card-title" },
        { Component: CardDescription, slot: "card-description" },
        { Component: CardAction, slot: "card-action" },
        { Component: CardContent, slot: "card-content" },
        { Component: CardFooter, slot: "card-footer" },
      ];

      expectedSlots.forEach(({ Component, slot }, index) => {
        render(React.createElement(Component, { "data-testid": `slot-test-${index}` }));
        const element = screen.getByTestId(`slot-test-${index}`);
        expect(element).toHaveAttribute("data-slot", slot);
      });
    });

    test("data-slot attributes are not overridden by props", () => {
      render(<Card data-testid="slot-override-test" data-slot="custom-slot" />);
      const card = screen.getByTestId("slot-override-test");

      // The component's data-slot should take precedence
      expect(card).toHaveAttribute("data-slot", "card");
    });
  });
});
