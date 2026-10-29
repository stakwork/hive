import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JamieWorkingIndicator } from "@/components/chat/JamieWorkingIndicator";

describe("JamieWorkingIndicator", () => {
  it("renders an accessible polite status with text", () => {
    render(<JamieWorkingIndicator />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-live")).toBe("polite");
    expect(el.textContent).toContain("Jamie is working…");
  });

  it("renders three dots that respect reduced motion", () => {
    render(<JamieWorkingIndicator />);
    const dots = screen.getAllByTestId("jamie-working-dot");
    expect(dots).toHaveLength(3);
    dots.forEach((d) => expect(d.className).toContain("motion-reduce:animate-none"));
  });
});
