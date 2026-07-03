/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

globalThis.React = React;

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", { "data-testid": "badge" }, children),
}));

import { TurnTokenUsage } from "@/components/agent-logs/TurnTokenUsage";

describe("TurnTokenUsage", () => {
  it("renders null when usage is undefined", () => {
    const { container } = render(React.createElement(TurnTokenUsage, { usage: undefined }));
    expect(container.firstChild).toBeNull();
  });

  it("renders null when usage is an empty object (all counts absent)", () => {
    const { container } = render(React.createElement(TurnTokenUsage, { usage: {} }));
    expect(container.firstChild).toBeNull();
  });

  it("renders null when all counts are zero-ish (undefined, not 0 values)", () => {
    const { container } = render(
      React.createElement(TurnTokenUsage, {
        usage: { inputTokens: undefined, outputTokens: undefined },
      }),
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders input and output tokens when present", () => {
    render(React.createElement(TurnTokenUsage, { usage: { inputTokens: 500, outputTokens: 120 } }));
    expect(screen.getByText(/in:/)).toBeTruthy();
    expect(screen.getByText(/500/)).toBeTruthy();
    expect(screen.getByText(/out:/)).toBeTruthy();
    expect(screen.getByText(/120/)).toBeTruthy();
  });

  it("shows cache total when cacheReadTokens or cacheWriteTokens are present", () => {
    render(
      React.createElement(TurnTokenUsage, {
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 200, cacheWriteTokens: 50 },
      }),
    );
    // cache total is 250
    expect(screen.getByText(/cache:/)).toBeTruthy();
    expect(screen.getByText(/250/)).toBeTruthy();
  });

  it("hides cache section when no cache tokens are provided", () => {
    render(
      React.createElement(TurnTokenUsage, { usage: { inputTokens: 100, outputTokens: 50 } }),
    );
    expect(screen.queryByText(/cache:/)).toBeNull();
  });

  it("abbreviates numbers > 10k with 'k' suffix", () => {
    render(
      React.createElement(TurnTokenUsage, { usage: { inputTokens: 15000, outputTokens: 2500 } }),
    );
    expect(screen.getByText(/15\.0k/)).toBeTruthy();
    // 2500 is ≤10k so shown as localeString
    expect(screen.getByText(/2,500/)).toBeTruthy();
  });

  it("expands to show cache read/write split on click", () => {
    render(
      React.createElement(TurnTokenUsage, {
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 200, cacheWriteTokens: 30 },
      }),
    );
    // Before expand: badges should not be visible
    expect(screen.queryByText(/read:/)).toBeNull();
    expect(screen.queryByText(/write:/)).toBeNull();

    // Click the toggle button
    const btn = screen.getByRole("button", { name: /toggle token usage detail/i });
    fireEvent.click(btn);

    // After expand: read and write badges should be visible
    expect(screen.getByText(/read: 200/)).toBeTruthy();
    expect(screen.getByText(/write: 30/)).toBeTruthy();
  });

  it("does not show expand toggle when no cache split is available", () => {
    render(
      React.createElement(TurnTokenUsage, { usage: { inputTokens: 100, outputTokens: 50 } }),
    );
    // No chevron icons expected — the toggle button exists but no expand chevron
    // Cache tokens are absent so the expanded section never renders
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText(/read:/)).toBeNull();
    expect(screen.queryByText(/write:/)).toBeNull();
  });
});
