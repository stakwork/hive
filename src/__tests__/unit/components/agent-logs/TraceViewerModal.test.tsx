/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

globalThis.React = React;

// --- Mocks ---

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, onOpenChange, children }: any) =>
    open ? React.createElement("div", { "data-testid": "dialog", onClick: () => onOpenChange(false) }, children) : null,
  DialogContent: ({ children, className }: any) =>
    React.createElement("div", { "data-testid": "dialog-content", className }, children),
  DialogHeader: ({ children, className }: any) =>
    React.createElement("div", { "data-testid": "dialog-header", className }, children),
  DialogTitle: ({ children }: any) =>
    React.createElement("h2", { "data-testid": "dialog-title" }, children),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, variant, size }: any) =>
    React.createElement("button", { onClick, "data-variant": variant, "data-size": size }, children),
}));

vi.mock("lucide-react", () => ({
  ExternalLink: () => React.createElement("span", { "data-testid": "external-link-icon" }),
  Loader2: ({ className }: any) => React.createElement("span", { "data-testid": "spinner", className }),
  X: () => React.createElement("span", { "data-testid": "close-icon" }),
}));

import { TraceViewerModal } from "@/components/agent-logs/TraceViewerModal";
import type { AgentLogRecord } from "@/types/agent-logs";

function makeLog(overrides: Partial<AgentLogRecord> = {}): AgentLogRecord {
  return {
    id: "log-1",
    blobUrl: "https://blob.example.com/log.json",
    agent: "Coding Agent",
    stakworkRunId: null,
    taskId: null,
    featureTitle: null,
    createdAt: new Date("2024-06-01T12:00:00Z"),
    phoenixTraceUrl: "https://phoenix.example.com/traces/abc",
    traceStatus: "ready",
    ...overrides,
  };
}

describe("TraceViewerModal", () => {
  it("renders nothing when log is null", () => {
    const { container } = render(
      React.createElement(TraceViewerModal, {
        open: true,
        log: null,
        onOpenChange: vi.fn(),
      })
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when phoenixTraceUrl is missing", () => {
    const log = makeLog({ phoenixTraceUrl: undefined });
    const { container } = render(
      React.createElement(TraceViewerModal, {
        open: true,
        log,
        onOpenChange: vi.fn(),
      })
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders dialog when open with a valid log", () => {
    const log = makeLog();
    render(
      React.createElement(TraceViewerModal, {
        open: true,
        log,
        onOpenChange: vi.fn(),
      })
    );
    expect(screen.getByTestId("dialog")).toBeDefined();
    expect(screen.getByTestId("dialog-title").textContent).toBe("Coding Agent");
  });

  it("shows spinner (loading state) on initial render", () => {
    const log = makeLog();
    render(
      React.createElement(TraceViewerModal, {
        open: true,
        log,
        onOpenChange: vi.fn(),
      })
    );
    expect(screen.getByTestId("spinner")).toBeDefined();
  });

  it("has correct href on 'Open in Phoenix' link", () => {
    const log = makeLog();
    render(
      React.createElement(TraceViewerModal, {
        open: true,
        log,
        onOpenChange: vi.fn(),
      })
    );
    const links = screen.getAllByRole("link");
    const phoenixLink = links.find((l) =>
      l.getAttribute("href") === "https://phoenix.example.com/traces/abc"
    );
    expect(phoenixLink).toBeDefined();
    expect(phoenixLink?.getAttribute("target")).toBe("_blank");
  });

  it("renders iframe with the phoenixTraceUrl as src", () => {
    const log = makeLog();
    const { container } = render(
      React.createElement(TraceViewerModal, {
        open: true,
        log,
        onOpenChange: vi.fn(),
      })
    );
    const iframe = container.querySelector("iframe");
    expect(iframe).toBeDefined();
    expect(iframe?.getAttribute("src")).toBe("https://phoenix.example.com/traces/abc");
  });

  it("transitions to error state when iframe onError fires", async () => {
    const log = makeLog();
    const { container } = render(
      React.createElement(TraceViewerModal, {
        open: true,
        log,
        onOpenChange: vi.fn(),
      })
    );
    // React's synthetic onError on <iframe> is not captured by fireEvent.error in
    // JSDOM (iframe error events fire on the window, not the element). Access the
    // React fiber directly to call the handler as React would in a real browser.
    const iframe = container.querySelector("iframe")!;
    const fiberKey = Object.keys(iframe).find(
      (k) => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance")
    );
    let onErrorCalled = false;
    if (fiberKey) {
      // Walk up the fiber tree to find the onError prop
      let fiber = (iframe as any)[fiberKey];
      while (fiber) {
        if (fiber.pendingProps?.onError) {
          act(() => { fiber.pendingProps.onError(new Event("error")); });
          onErrorCalled = true;
          break;
        }
        fiber = fiber.return;
      }
    }
    if (!onErrorCalled) {
      // Fallback: dispatch via fireEvent as last resort
      act(() => { fireEvent.error(iframe); });
    }
    expect(screen.getByText("Unable to load Phoenix trace.")).toBeDefined();
    expect(screen.queryByTestId("spinner")).toBeNull();
  });

  it("does not render when open=false", () => {
    const log = makeLog();
    const { container } = render(
      React.createElement(TraceViewerModal, {
        open: false,
        log,
        onOpenChange: vi.fn(),
      })
    );
    expect(screen.queryByTestId("dialog")).toBeNull();
  });
});
