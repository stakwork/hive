/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement("span", { "data-testid": "badge", className }, children),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) =>
    asChild ? React.createElement(React.Fragment, null, children) : React.createElement("div", null, children),
  TooltipContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "tooltip-content" }, children),
}));

vi.mock("@/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "markdown" }, children),
}));

vi.mock("date-fns", () => ({
  format: (date: Date, fmt: string) => {
    if (fmt === "HH:mm") {
      const h = String(date.getUTCHours()).padStart(2, "0");
      const m = String(date.getUTCMinutes()).padStart(2, "0");
      return `${h}:${m}`;
    }
    return date.toISOString();
  },
}));

vi.mock("lucide-react", () => ({
  Loader2: () => React.createElement("span", null, "loader"),
  User: () => React.createElement("span", null, "user-icon"),
  Bot: () => React.createElement("span", null, "bot-icon"),
  Wrench: () => React.createElement("span", null, "wrench-icon"),
  Code2: () => React.createElement("span", null, "code-icon"),
  ChevronDown: () => React.createElement("span", null, "chevron-down"),
  ChevronRight: () => React.createElement("span", null, "chevron-right"),
  Copy: () => React.createElement("span", null, "copy-icon"),
  Check: () => React.createElement("span", null, "check-icon"),
}));

vi.mock("@/lib/utils/agent-log-pairing", () => ({
  buildToolCallIndex: () => new Map(),
  getConsumedResultIds: () => new Set(),
}));

import { RunConfigPanel, LogDetailContent } from "@/components/agent-logs/LogDetailContent";
import type { AgentRunConfig } from "@/lib/utils/agent-log-stats";

const fullConfig: AgentRunConfig = {
  model: "claude-sonnet-4-6",
  provider: "anthropic",
  source: "repo_agent",
  repos: [{ name: "stakwork/hive" }],
  temperature: 0,
  tools: { bash: true, files: true },
  toolsConfig: {},
  schema: null,
  providerConfig: {},
};

const baseDetailProps = {
  conversation: [{ role: "user", content: "Hello" }],
  stats: {
    totalMessages: 1,
    estimatedTokens: 10,
    totalToolCalls: 0,
    toolFrequency: {},
    bashFrequency: {},
    developerShellFrequency: {},
  },
  rawContent: "",
  loading: false,
  error: null,
};

// ---------------------------------------------------------------------------
// RunConfigPanel unit tests
// ---------------------------------------------------------------------------

describe("RunConfigPanel — high-signal fields", () => {
  it("renders model, provider, source, repos, and tools", () => {
    render(React.createElement(RunConfigPanel, { config: fullConfig }));
    expect(screen.getByText("Run Config")).toBeDefined();
    expect(screen.getByText("claude-sonnet-4-6")).toBeDefined();
    expect(screen.getByText("anthropic")).toBeDefined();
    expect(screen.getByText("repo_agent")).toBeDefined();
    expect(screen.getByText("stakwork/hive")).toBeDefined();
    // Tools: bash + files
    const toolsCell = screen.getByText((t) => t.includes("bash") && t.includes("files"));
    expect(toolsCell).toBeDefined();
  });

  it("renders temperature when provided", () => {
    render(React.createElement(RunConfigPanel, { config: fullConfig }));
    // temperature: 0 → "0"
    expect(screen.getByText("0")).toBeDefined();
  });

  it("omits Repos row when repos is empty array", () => {
    const config: AgentRunConfig = { ...fullConfig, repos: [] };
    render(React.createElement(RunConfigPanel, { config }));
    expect(screen.queryByText("Repos:")).toBeNull();
  });

  it("omits Tools row when tools is empty object", () => {
    const config: AgentRunConfig = { ...fullConfig, tools: {} };
    render(React.createElement(RunConfigPanel, { config }));
    expect(screen.queryByText("Tools:")).toBeNull();
  });

  it("omits temperature row when temperature is undefined", () => {
    const { model, provider, source, repos, tools } = fullConfig;
    const config: AgentRunConfig = { model, provider, source, repos, tools };
    render(React.createElement(RunConfigPanel, { config }));
    expect(screen.queryByText("Temp:")).toBeNull();
  });

  it("expands raw JSON on 'Show raw config' click", async () => {
    const user = userEvent.setup();
    render(React.createElement(RunConfigPanel, { config: fullConfig }));
    const toggleBtn = screen.getByText("Show raw config");
    await user.click(toggleBtn);
    expect(screen.getByText("Hide raw config")).toBeDefined();
    // Raw JSON block should contain "claude-sonnet-4-6"
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toContain("claude-sonnet-4-6");
  });
});

// ---------------------------------------------------------------------------
// LogDetailContent — config panel integration
// ---------------------------------------------------------------------------

describe("LogDetailContent — Config panel integration", () => {
  it("renders config panel above conversation when config is provided", () => {
    render(React.createElement(LogDetailContent, { ...baseDetailProps, config: fullConfig }));
    expect(screen.getByText("Run Config")).toBeDefined();
  });

  it("does not render config panel when config is null (legacy compat)", () => {
    render(React.createElement(LogDetailContent, { ...baseDetailProps, config: null }));
    expect(screen.queryByText("Run Config")).toBeNull();
  });

  it("does not render config panel when config is undefined", () => {
    render(React.createElement(LogDetailContent, { ...baseDetailProps }));
    expect(screen.queryByText("Run Config")).toBeNull();
  });

  it("renders conversation normally without config (legacy compat)", () => {
    render(React.createElement(LogDetailContent, { ...baseDetailProps, config: null }));
    // Conversation should still render
    expect(screen.getByText("Hello")).toBeDefined();
  });

  it("omits empty/null fields from partial config — repos and tools not shown", () => {
    const partialConfig: AgentRunConfig = {
      model: "gpt-4o",
      provider: "openai",
      source: "task_agent",
      repos: [],
      temperature: 0.2,
      tools: {},
      schema: null,
    };
    render(React.createElement(LogDetailContent, { ...baseDetailProps, config: partialConfig }));
    expect(screen.getByText("Run Config")).toBeDefined();
    expect(screen.getByText("gpt-4o")).toBeDefined();
    expect(screen.queryByText("Repos:")).toBeNull();
    expect(screen.queryByText("Tools:")).toBeNull();
  });
});
