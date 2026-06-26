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



vi.mock("gpt-tokenizer", () => ({
  encode: (text: string) => Array.from(text),
}));

vi.mock("@/hooks/useUserTimezone", () => ({
  useUserTimezone: () => ({ timezone: "UTC" }),
}));

vi.mock("@/lib/date-utils", () => ({
  formatInUserTz: (date: Date) => date.toISOString(),
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
  it("puts the timestamp in tooltip content (not a visible label) for a user message", () => {
    const message: ParsedMessage = {
      role: "user",
      content: "Hello",
      timestamp: "2024-01-15T10:30:00.000Z",
    };
    render(React.createElement(MessageBubble, { message }));

    // There should be NO always-visible HH:mm span
    expect(screen.queryByText("10:30")).toBeNull();

    // The tooltip content should contain the formatted timestamp
    const tooltip = screen.getByTestId("tooltip-content");
    expect(tooltip.textContent).toBeTruthy();
    // toLocaleString of the timestamp should appear somewhere
    expect(tooltip.textContent).toContain(new Date("2024-01-15T10:30:00.000Z").toLocaleString());
  });

  it("puts the timestamp in tooltip content (not a visible label) for an assistant message", () => {
    const message: ParsedMessage = {
      role: "assistant",
      content: "Hi there",
      timestamp: "2024-01-15T14:05:00.000Z",
    };
    render(React.createElement(MessageBubble, { message }));

    // No always-visible time label
    expect(screen.queryByText("14:05")).toBeNull();

    const tooltip = screen.getByTestId("tooltip-content");
    expect(tooltip.textContent).toContain(new Date("2024-01-15T14:05:00.000Z").toLocaleString());
  });

  it("does not render tooltip content when timestamp is null", () => {
    const message: ParsedMessage = {
      role: "user",
      content: "No timestamp here",
      timestamp: null,
    };
    render(React.createElement(MessageBubble, { message }));

    expect(screen.queryByTestId("tooltip-content")).toBeNull();
  });

  it("does not render tooltip content when timestamp is absent", () => {
    const message: ParsedMessage = {
      role: "assistant",
      content: "No timestamp here",
    };
    render(React.createElement(MessageBubble, { message }));

    expect(screen.queryByTestId("tooltip-content")).toBeNull();
  });
});
