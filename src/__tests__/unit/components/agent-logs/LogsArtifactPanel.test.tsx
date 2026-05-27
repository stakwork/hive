/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/components/agent-logs/LogDetailContent", () => ({
  LogDetailContent: ({
    loading,
    error,
    conversation,
  }: {
    loading: boolean;
    error: string | null;
    conversation: unknown[] | null;
  }) => {
    if (loading) return React.createElement("div", { "data-testid": "log-loading" }, "Loading...");
    if (error) return React.createElement("div", { "data-testid": "log-error" }, error);
    return React.createElement(
      "div",
      { "data-testid": "log-conversation" },
      `${conversation?.length ?? 0} messages`
    );
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) =>
    React.createElement("button", { onClick, ...props }, children),
}));

vi.mock("lucide-react", () => ({
  Download: () => React.createElement("span", null, "download-icon"),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const fakeStats = {
  conversation: [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
  ],
  stats: { messageCount: 2, tokenEstimate: 50, toolUsage: {}, bashCommands: [] },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LogsArtifactPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset URL.createObjectURL
    globalThis.URL.createObjectURL = vi.fn(() => "blob:fake");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading state initially", async () => {
    // Delay the fetch so we can observe loading
    mockFetch.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: async () => fakeStats }), 200))
    );

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(React.createElement(LogsArtifactPanel, { logId: "log-123" }));

    expect(screen.getByTestId("log-loading")).toBeDefined();
  });

  it("renders conversation content after fetch resolves", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => fakeStats,
    });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(React.createElement(LogsArtifactPanel, { logId: "log-123" }));

    await waitFor(() => {
      expect(screen.getByTestId("log-conversation")).toBeDefined();
    });
    expect(screen.getByTestId("log-conversation").textContent).toContain("2 messages");
  });

  it("renders error state when fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Internal Server Error",
    });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(React.createElement(LogsArtifactPanel, { logId: "log-456" }));

    await waitFor(() => {
      expect(screen.getByTestId("log-error")).toBeDefined();
    });
    expect(screen.getByTestId("log-error").textContent).toContain("Failed to fetch log");
  });

  it("renders a download button", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => fakeStats,
    });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(React.createElement(LogsArtifactPanel, { logId: "log-123" }));

    await waitFor(() => screen.getByTestId("log-conversation"));
    expect(screen.getByText("Download")).toBeDefined();
  });

  it("triggers download when download button is clicked", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => fakeStats })
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["{}"], { type: "application/json" }) });

    // Track anchor clicks without interfering with React's DOM mounting
    const clickedHrefs: string[] = [];
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string, ...args: unknown[]) => {
      const el = origCreateElement(tag, ...(args as []));
      if (tag === "a") {
        vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {
          clickedHrefs.push((el as HTMLAnchorElement).href);
        });
      }
      return el;
    });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(React.createElement(LogsArtifactPanel, { logId: "log-789" }));

    await waitFor(() => screen.getByText("Download"));
    await userEvent.click(screen.getByText("Download"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/agent-logs/log-789/content");
    });
  });
});
