/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

globalThis.React = React;

vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: React.ReactNode }) =>
    React.createElement("table", null, children),
  TableBody: ({ children }: { children: React.ReactNode }) =>
    React.createElement("tbody", null, children),
  TableCell: ({ children }: { children: React.ReactNode }) =>
    React.createElement("td", null, children),
  TableHead: ({ children }: { children: React.ReactNode }) =>
    React.createElement("th", null, children),
  TableHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement("thead", null, children),
  TableRow: ({ children, onClick, className }: any) =>
    React.createElement("tr", { onClick, className }, children),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement("span", { "data-testid": "badge", className }, children),
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  AvatarFallback: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children),
  AvatarImage: ({ src }: { src?: string }) =>
    React.createElement("img", { src }),
}));

vi.mock("lucide-react", () => ({
  Download: () => React.createElement("span", null, "download-icon"),
}));

import { AgentLogsTable } from "@/components/agent-logs/AgentLogsTable";
import type { AgentLogRecord } from "@/types/agent-logs";

function makeLog(overrides: Partial<AgentLogRecord> = {}): AgentLogRecord {
  return {
    id: "log-1",
    blobUrl: "https://blob.example.com/log.json",
    agent: "coder",
    stakworkRunId: null,
    taskId: null,
    featureTitle: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("AgentLogsTable — Model column", () => {
  it("renders Model badge when log.model is set", () => {
    const log = makeLog({ model: "claude-sonnet-4-6" });
    render(React.createElement(AgentLogsTable, { logs: [log], onRowClick: vi.fn() }));
    expect(screen.getByText("claude-sonnet-4-6")).toBeDefined();
    expect(screen.getByTestId("badge")).toBeDefined();
  });

  it("renders em dash when log.model is null", () => {
    const log = makeLog({ model: null });
    render(React.createElement(AgentLogsTable, { logs: [log], onRowClick: vi.fn() }));
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders em dash when log.model is undefined", () => {
    const log = makeLog();
    render(React.createElement(AgentLogsTable, { logs: [log], onRowClick: vi.fn() }));
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders Model column header", () => {
    render(React.createElement(AgentLogsTable, { logs: [], onRowClick: vi.fn() }));
    // Empty state renders no table, so check with at least one log
    const log = makeLog({ model: "gpt-4o" });
    const { unmount } = render(React.createElement(AgentLogsTable, { logs: [log], onRowClick: vi.fn() }));
    const headers = screen.getAllByRole("columnheader");
    const modelHeader = headers.find((h) => h.textContent === "Model");
    expect(modelHeader).toBeDefined();
    unmount();
  });
});
