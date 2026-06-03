// @vitest-environment jsdom
import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuggestionChips } from "@/components/plan/SuggestionChips";

// Mock framer-motion
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    button: React.forwardRef(
      (
        { children, onClick, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode },
        ref: React.Ref<HTMLButtonElement>
      ) => (
        <button ref={ref} onClick={onClick} className={className} {...props}>
          {children}
        </button>
      )
    ),
  },
}));

describe("SuggestionChips", () => {
  const mockOnSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("renders nothing when suggestions array is empty", () => {
    const { container } = render(
      <SuggestionChips suggestions={[]} onSelect={mockOnSelect} />
    );
    expect(container.firstChild).toBeNull();
  });

  test("renders correct number of chips", () => {
    render(
      <SuggestionChips
        suggestions={["Yes, go ahead", "Looks good to me", "LGTM!"]}
        onSelect={mockOnSelect}
      />
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
  });

  test("renders chip text correctly", () => {
    render(
      <SuggestionChips
        suggestions={["Yes, go ahead", "Looks good to me", "LGTM!"]}
        onSelect={mockOnSelect}
      />
    );
    expect(screen.getByText("Yes, go ahead")).toBeInTheDocument();
    expect(screen.getByText("Looks good to me")).toBeInTheDocument();
    expect(screen.getByText("LGTM!")).toBeInTheDocument();
  });

  test("fires onSelect with correct string when chip is clicked", () => {
    render(
      <SuggestionChips
        suggestions={["Yes, go ahead", "Looks good to me", "LGTM!"]}
        onSelect={mockOnSelect}
      />
    );
    fireEvent.click(screen.getByText("Yes, go ahead"));
    expect(mockOnSelect).toHaveBeenCalledTimes(1);
    expect(mockOnSelect).toHaveBeenCalledWith("Yes, go ahead");
  });

  test("fires onSelect with the specific chip that was clicked", () => {
    render(
      <SuggestionChips
        suggestions={["Yes, go ahead", "Looks good to me", "LGTM!"]}
        onSelect={mockOnSelect}
      />
    );
    fireEvent.click(screen.getByText("LGTM!"));
    expect(mockOnSelect).toHaveBeenCalledWith("LGTM!");
  });

  test("each click fires onSelect independently", () => {
    render(
      <SuggestionChips
        suggestions={["Option A", "Option B"]}
        onSelect={mockOnSelect}
      />
    );
    fireEvent.click(screen.getByText("Option A"));
    fireEvent.click(screen.getByText("Option B"));
    expect(mockOnSelect).toHaveBeenCalledTimes(2);
    expect(mockOnSelect).toHaveBeenNthCalledWith(1, "Option A");
    expect(mockOnSelect).toHaveBeenNthCalledWith(2, "Option B");
  });

  test("renders with two suggestions", () => {
    render(
      <SuggestionChips
        suggestions={["Looks good", "Go for it"]}
        onSelect={mockOnSelect}
      />
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});
