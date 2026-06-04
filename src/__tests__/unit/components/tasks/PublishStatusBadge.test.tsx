// @vitest-environment jsdom
import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PublishStatusBadge } from "@/components/tasks/PublishStatusBadge";

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className, style, variant }: any) => (
    <span className={className} style={style} data-variant={variant}>
      {children}
    </span>
  ),
}));

describe("PublishStatusBadge", () => {
  const mockOnClick = vi.fn();

  beforeEach(() => {
    mockOnClick.mockClear();
  });

  test('renders "Published" with green styling when published=true', () => {
    render(
      <PublishStatusBadge type="PUBLISH_WORKFLOW" published={true} onClick={mockOnClick} />
    );
    const badge = screen.getByRole("button").querySelector("span");
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute("style")).toContain("rgb(35, 134, 54)");
    expect(badge?.textContent).toContain("Published");
  });

  test('renders "Unpublished" when published=false', () => {
    render(
      <PublishStatusBadge type="PUBLISH_PROMPT" published={false} onClick={mockOnClick} />
    );
    expect(screen.getByRole("button").textContent).toContain("Unpublished");
  });

  test('renders "Workflow" label for PUBLISH_WORKFLOW', () => {
    render(
      <PublishStatusBadge type="PUBLISH_WORKFLOW" published={true} onClick={mockOnClick} />
    );
    expect(screen.getByRole("button").textContent).toContain("Workflow");
  });

  test('renders "Script" label for PUBLISH_SCRIPT', () => {
    render(
      <PublishStatusBadge type="PUBLISH_SCRIPT" published={false} onClick={mockOnClick} />
    );
    expect(screen.getByRole("button").textContent).toContain("Script");
  });

  test('renders "Prompt" label for PUBLISH_PROMPT', () => {
    render(
      <PublishStatusBadge type="PUBLISH_PROMPT" published={true} onClick={mockOnClick} />
    );
    expect(screen.getByRole("button").textContent).toContain("Prompt");
  });

  test("calls onClick when button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <PublishStatusBadge type="PUBLISH_SCRIPT" published={true} onClick={mockOnClick} />
    );
    await user.click(screen.getByRole("button"));
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  test("calls stopPropagation on click event", async () => {
    const user = userEvent.setup();
    const parentHandler = vi.fn();
    render(
      <div onClick={parentHandler}>
        <PublishStatusBadge type="PUBLISH_WORKFLOW" published={false} onClick={mockOnClick} />
      </div>
    );
    await user.click(screen.getByRole("button"));
    // onClick on badge is called
    expect(mockOnClick).toHaveBeenCalledTimes(1);
    // parent handler NOT called because stopPropagation was called
    expect(parentHandler).not.toHaveBeenCalled();
  });

  test("renders as a button element", () => {
    render(
      <PublishStatusBadge type="PUBLISH_PROMPT" published={false} onClick={mockOnClick} />
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
