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
import userEvent from "@testing-library/user-event";

// Add missing mocks needed by ReasoningSection
vi.mock("@/lib/utils", () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(" "),
}));

vi.mock("lucide-react", () => ({
  Loader2: () => React.createElement("span", { "data-testid": "loader" }),
  User: () => React.createElement("span", { "data-testid": "icon-user" }),
  Bot: () => React.createElement("span", { "data-testid": "icon-bot" }),
  Wrench: () => React.createElement("span", { "data-testid": "icon-wrench" }),
  Code2: () => React.createElement("span", { "data-testid": "icon-code" }),
  ChevronDown: () => React.createElement("span", { "data-testid": "chevron-down" }),
  ChevronRight: () => React.createElement("span", { "data-testid": "chevron-right" }),
  Copy: () => React.createElement("span", { "data-testid": "icon-copy" }),
  Check: () => React.createElement("span", { "data-testid": "icon-check" }),
}));

describe("MessageBubble reasoning rendering", () => {
  it("shows a collapsed Reasoning toggle for content with reasoning block", async () => {
    const user = userEvent.setup();
    const message: ParsedMessage = {
      role: "assistant",
      content: [
        { type: "reasoning", text: "Thinking hard..." },
        { type: "text", text: "Final answer." },
      ],
    };
    render(React.createElement(MessageBubble, { message }));

    // "Reasoning" toggle should be visible
    expect(screen.getByText("Reasoning")).toBeDefined();
    // Collapsed by default — body not rendered yet
    expect(screen.queryByText("Thinking hard...")).toBeNull();

    // Expand it
    await user.click(screen.getByText("Reasoning"));
    expect(screen.getByText("Thinking hard...")).toBeDefined();
  });

  it("still renders when message has only a reasoning block (no text part)", () => {
    const message: ParsedMessage = {
      role: "assistant",
      content: [{ type: "reasoning", text: "Only reasoning here." }],
    };
    const { container } = render(React.createElement(MessageBubble, { message }));
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText("Reasoning")).toBeDefined();
  });

  it("never shows providerOptions or signature content", () => {
    const message: ParsedMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "Answer text." },
      ],
      providerOptions: { anthropic: { signature: "secret-signature-value" } },
    } as ParsedMessage & { providerOptions: unknown };
    render(React.createElement(MessageBubble, { message }));

    expect(screen.queryByText(/providerOptions/)).toBeNull();
    expect(screen.queryByText(/secret-signature-value/)).toBeNull();
    expect(screen.queryByText(/signature/)).toBeNull();
  });

  it("renders reasoning from top-level reasoning string fallback", async () => {
    const user = userEvent.setup();
    const message: ParsedMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Answer." }],
      reasoning: "fallback reasoning text",
    };
    render(React.createElement(MessageBubble, { message }));

    expect(screen.getByText("Reasoning")).toBeDefined();
    await user.click(screen.getByText("Reasoning"));
    expect(screen.getByText("fallback reasoning text")).toBeDefined();
  });
});

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
