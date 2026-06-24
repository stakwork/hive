/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

globalThis.React = React;

vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: React.ReactNode }) =>
    React.createElement("table", null, children),
  TableBody: ({ children }: { children: React.ReactNode }) =>
    React.createElement("tbody", null, children),
  TableCell: ({ children, onClick }: any) =>
    React.createElement("td", { onClick }, children),
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
  Loader2: ({ className }: any) =>
    React.createElement("span", { "data-testid": "spinner", className }),
}));

// Stub TraceViewerModal to avoid deep rendering
vi.mock("@/components/agent-logs/TraceViewerModal", () => ({
  TraceViewerModal: ({ open, log }: { open: boolean; log: any }) =>
    open
      ? React.createElement("div", { "data-testid": "trace-modal" }, log?.agent)
      : null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, className, variant, size, disabled }: any) =>
    React.createElement(
      "button",
      { onClick, className, "data-variant": variant, "data-size": size, disabled },
      children
    ),
}));

// Pusher channel mock — captures the bind/unbind calls
let capturedBindHandler: ((payload: any) => void) | null = null;
const mockChannel = {
  bind: vi.fn((event: string, handler: any) => { capturedBindHandler = handler; }),
  unbind: vi.fn(),
};

vi.mock("@/hooks/usePusherChannel", () => ({
  usePusherChannel: vi.fn(() => null),
}));

vi.mock("@/lib/pusher", () => ({
  PUSHER_EVENTS: { AGENT_TRACE_READY: "agent-trace-ready" },
}));

import { AgentLogsTable } from "@/components/agent-logs/AgentLogsTable";
import { usePusherChannel } from "@/hooks/usePusherChannel";
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

beforeEach(() => {
  vi.clearAllMocks();
  capturedBindHandler = null;
  (usePusherChannel as any).mockReturnValue(null);
});

// ─── Model column (existing) ──────────────────────────────────────────────

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
    const log = makeLog({ model: "gpt-4o" });
    const { unmount } = render(React.createElement(AgentLogsTable, { logs: [log], onRowClick: vi.fn() }));
    const headers = screen.getAllByRole("columnheader");
    const modelHeader = headers.find((h) => h.textContent === "Model");
    expect(modelHeader).toBeDefined();
    unmount();
  });
});

// ─── Trace column states ──────────────────────────────────────────────────

describe("AgentLogsTable — Trace column", () => {
  it("renders 'Generate Trace' button when traceStatus is null", () => {
    const log = makeLog({ traceStatus: null });
    render(
      React.createElement(AgentLogsTable, {
        logs: [log],
        onRowClick: vi.fn(),
        slug: "my-workspace",
      })
    );
    expect(screen.getByText("Generate Trace")).toBeDefined();
  });

  it("renders 'Generate Trace' button when traceStatus is undefined", () => {
    const log = makeLog();
    render(
      React.createElement(AgentLogsTable, {
        logs: [log],
        onRowClick: vi.fn(),
        slug: "my-workspace",
      })
    );
    expect(screen.getByText("Generate Trace")).toBeDefined();
  });

  it("renders spinner and 'Generating…' when traceStatus is 'pending'", () => {
    const log = makeLog({ traceStatus: "pending" });
    render(
      React.createElement(AgentLogsTable, {
        logs: [log],
        onRowClick: vi.fn(),
        slug: "my-workspace",
      })
    );
    expect(screen.getByTestId("spinner")).toBeDefined();
    expect(screen.getByText("Generating…")).toBeDefined();
  });

  it("renders 'View Trace →' button when traceStatus is 'ready'", () => {
    const log = makeLog({
      traceStatus: "ready",
      phoenixTraceUrl: "https://phoenix.example.com/traces/abc",
    });
    render(
      React.createElement(AgentLogsTable, {
        logs: [log],
        onRowClick: vi.fn(),
        slug: "my-workspace",
      })
    );
    expect(screen.getByText("View Trace →")).toBeDefined();
  });

  it("renders 'Retry' button when traceStatus is 'error'", () => {
    const log = makeLog({ traceStatus: "error" });
    render(
      React.createElement(AgentLogsTable, {
        logs: [log],
        onRowClick: vi.fn(),
        slug: "my-workspace",
      })
    );
    expect(screen.getByText("Retry")).toBeDefined();
  });

  it("does not render Trace column when slug is not provided", () => {
    const log = makeLog({ traceStatus: null });
    render(
      React.createElement(AgentLogsTable, {
        logs: [log],
        onRowClick: vi.fn(),
      })
    );
    expect(screen.queryByText("Generate Trace")).toBeNull();
    const headers = screen.getAllByRole("columnheader");
    expect(headers.find((h) => h.textContent === "Trace")).toBeUndefined();
  });

  it("shows 'Trace' column header when slug is provided", () => {
    const log = makeLog();
    render(
      React.createElement(AgentLogsTable, {
        logs: [log],
        onRowClick: vi.fn(),
        slug: "my-workspace",
      })
    );
    const headers = screen.getAllByRole("columnheader");
    expect(headers.find((h) => h.textContent === "Trace")).toBeDefined();
  });

  it("opens TraceViewerModal when 'View Trace →' is clicked", () => {
    const log = makeLog({
      id: "log-1",
      traceStatus: "ready",
      phoenixTraceUrl: "https://phoenix.example.com/traces/abc",
    });
    render(
      React.createElement(AgentLogsTable, {
        logs: [log],
        onRowClick: vi.fn(),
        slug: "my-workspace",
      })
    );
    expect(screen.queryByTestId("trace-modal")).toBeNull();
    fireEvent.click(screen.getByText("View Trace →"));
    expect(screen.getByTestId("trace-modal")).toBeDefined();
  });
});

// ─── Pusher real-time updates ─────────────────────────────────────────────

describe("AgentLogsTable — Pusher AGENT_TRACE_READY", () => {
  it("flips row from 'pending' to 'ready' on Pusher event", async () => {
    (usePusherChannel as any).mockReturnValue(mockChannel);

    const log = makeLog({ id: "log-1", traceStatus: "pending" });
    render(
      React.createElement(AgentLogsTable, {
        logs: [log],
        onRowClick: vi.fn(),
        slug: "my-workspace",
        pusherChannelName: "feature-feat-1",
      })
    );

    // Spinner should be visible initially
    expect(screen.getByTestId("spinner")).toBeDefined();
    expect(mockChannel.bind).toHaveBeenCalledWith("agent-trace-ready", expect.any(Function));

    // Simulate Pusher event
    act(() => {
      capturedBindHandler?.({
        agentLogId: "log-1",
        traceStatus: "ready",
        phoenixTraceUrl: "https://phoenix.example.com/traces/abc",
      });
    });

    // Row should now show "View Trace →"
    expect(screen.getByText("View Trace →")).toBeDefined();
    expect(screen.queryByTestId("spinner")).toBeNull();
  });

  it("does not affect other rows when Pusher event targets a different log", async () => {
    (usePusherChannel as any).mockReturnValue(mockChannel);

    const log1 = makeLog({ id: "log-1", traceStatus: "pending" });
    const log2 = makeLog({ id: "log-2", traceStatus: null, agent: "other-agent" });
    render(
      React.createElement(AgentLogsTable, {
        logs: [log1, log2],
        onRowClick: vi.fn(),
        slug: "my-workspace",
        pusherChannelName: "feature-feat-1",
      })
    );

    act(() => {
      capturedBindHandler?.({
        agentLogId: "log-1",
        traceStatus: "ready",
        phoenixTraceUrl: "https://phoenix.example.com/traces/abc",
      });
    });

    // log-1 → ready, log-2 → still null (shows Generate Trace)
    expect(screen.getByText("View Trace →")).toBeDefined();
    expect(screen.getByText("Generate Trace")).toBeDefined();
  });

  it("unbinds handler on unmount", () => {
    (usePusherChannel as any).mockReturnValue(mockChannel);

    const log = makeLog({ id: "log-1", traceStatus: "pending" });
    const { unmount } = render(
      React.createElement(AgentLogsTable, {
        logs: [log],
        onRowClick: vi.fn(),
        slug: "my-workspace",
        pusherChannelName: "feature-feat-1",
      })
    );

    unmount();
    expect(mockChannel.unbind).toHaveBeenCalledWith("agent-trace-ready", expect.any(Function));
  });
});
