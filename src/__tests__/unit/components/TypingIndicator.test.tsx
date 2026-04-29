import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TypingIndicator } from "@/components/chat/TypingIndicator";

vi.mock("lucide-react", () => ({
  Pencil: () => <svg data-testid="pencil-icon" />,
}));

describe("TypingIndicator", () => {
  it("renders nothing when typingUsers is empty", () => {
    const { container } = render(<TypingIndicator typingUsers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders '[Name] is typing…' for a single user", () => {
    render(<TypingIndicator typingUsers={["Paul"]} />);
    expect(screen.getByText("Paul is typing…")).toBeInTheDocument();
  });

  it("renders 'Several people are typing…' for two users", () => {
    render(<TypingIndicator typingUsers={["Alice", "Bob"]} />);
    expect(screen.getByText("Several people are typing…")).toBeInTheDocument();
  });

  it("renders 'Several people are typing…' for three or more users", () => {
    render(<TypingIndicator typingUsers={["Alice", "Bob", "Carol"]} />);
    expect(screen.getByText("Several people are typing…")).toBeInTheDocument();
  });

  it("renders the pencil icon", () => {
    render(<TypingIndicator typingUsers={["Tom"]} />);
    expect(screen.getByTestId("pencil-icon")).toBeInTheDocument();
  });
});
