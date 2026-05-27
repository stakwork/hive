/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: any) => (
    <span className={className}>{children}</span>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

import { TagInput } from "@/components/ui/tag-input";

describe("TagInput", () => {
  it("renders existing items as chips", () => {
    render(<TagInput items={["alpha", "beta"]} onChange={vi.fn()} />);
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
  });

  it("adds a chip on Enter and clears the input", async () => {
    const onChange = vi.fn();
    render(<TagInput items={[]} onChange={onChange} placeholder="Add item" />);

    const input = screen.getByPlaceholderText("Add item");
    await userEvent.type(input, "new item");
    await userEvent.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith(["new item"]);
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("is a no-op when Enter is pressed with empty value", async () => {
    const onChange = vi.fn();
    render(<TagInput items={[]} onChange={onChange} placeholder="Add item" />);

    const input = screen.getByPlaceholderText("Add item");
    await userEvent.click(input);
    await userEvent.keyboard("{Enter}");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("is a no-op when Enter is pressed with whitespace-only value", async () => {
    const onChange = vi.fn();
    render(<TagInput items={[]} onChange={onChange} placeholder="Add item" />);

    const input = screen.getByPlaceholderText("Add item");
    await userEvent.type(input, "   ");
    await userEvent.keyboard("{Enter}");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("is a no-op when Enter is pressed with a duplicate value", async () => {
    const onChange = vi.fn();
    render(<TagInput items={["existing"]} onChange={onChange} placeholder="Add item" />);

    const input = screen.getByPlaceholderText("Add item");
    await userEvent.type(input, "existing");
    await userEvent.keyboard("{Enter}");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes the correct chip when × is clicked", () => {
    const onChange = vi.fn();
    render(<TagInput items={["alpha", "beta", "gamma"]} onChange={onChange} />);

    // Click the × button for "beta" (index 1)
    const removeButtons = screen.getAllByRole("button");
    fireEvent.click(removeButtons[1]);

    expect(onChange).toHaveBeenCalledWith(["alpha", "gamma"]);
  });

  it("renders the error message when error prop is provided", () => {
    render(
      <TagInput items={[]} onChange={vi.fn()} error="At least one item is required" />,
    );
    expect(screen.getByText("At least one item is required")).toBeTruthy();
  });

  it("does not render error paragraph when error prop is absent", () => {
    const { container } = render(<TagInput items={[]} onChange={vi.fn()} />);
    expect(container.querySelector("p")).toBeNull();
  });
});
