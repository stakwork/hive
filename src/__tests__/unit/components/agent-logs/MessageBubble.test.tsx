/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

globalThis.React = React;

// Mock child UI dependencies
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) =>
    asChild ? React.createElement(React.Fragment, null, children) : React.createElement("div", null, children),
  TooltipContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "tooltip-content" }, children),
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children),
}));

vi.mock("@/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "markdown" }, children),
}));

vi.mock("date-fns", () => ({
  format: (date: Date, fmt: string) => {
    // Simple HH:mm implementation for tests
    if (fmt === "HH:mm") {
      const h = String(date.getUTCHours()).padStart(2, "0");
      const m = String(date.getUTCMinutes()).padStart(2, "0");
      return `${h}:${m}`;
    }
    return date.toISOString();
  },
}));

import { MessageBubble } from "@/components/agent-logs/LogDetailContent";
import type { ParsedMessage } from "@/lib/utils/agent-log-stats";

describe("MessageBubble timestamp rendering", () => {
  it("renders HH:mm label and tooltip when timestamp is present on a user message", () => {
    const message: ParsedMessage = {
      role: "user",
      content: "Hello",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    render(React.createElement(MessageBubble, { message }));

    // HH:mm label should be visible
    expect(screen.getByText("10:30")).toBeDefined();

    // Tooltip content should show the full locale string
    const tooltip = screen.getByTestId("tooltip-content");
    expect(tooltip.textContent).toBeTruthy();
  });

  it("renders HH:mm label and tooltip when timestamp is present on an assistant message", () => {
    const message: ParsedMessage = {
      role: "assistant",
      content: "Hi there",
      timestamp: "2024-01-15T14:05:00.000Z",
    };
    render(React.createElement(MessageBubble, { message }));

    expect(screen.getByText("14:05")).toBeDefined();
    const tooltip = screen.getByTestId("tooltip-content");
    expect(tooltip.textContent).toBeTruthy();
  });

  it("does not render a timestamp label when timestamp is null", () => {
    const message: ParsedMessage = {
      role: "user",
      content: "No timestamp here",
      timestamp: null,
    };
    render(React.createElement(MessageBubble, { message }));

    // No tooltip content should be rendered
    expect(screen.queryByTestId("tooltip-content")).toBeNull();
  });

  it("does not render a timestamp label when timestamp is absent", () => {
    const message: ParsedMessage = {
      role: "assistant",
      content: "No timestamp here",
    };
    render(React.createElement(MessageBubble, { message }));

    expect(screen.queryByTestId("tooltip-content")).toBeNull();
  });
});
