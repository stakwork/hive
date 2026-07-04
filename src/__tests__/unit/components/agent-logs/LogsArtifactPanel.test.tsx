/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Track onFlag calls per message index for testing
const capturedOnFlags: Array<{ index: number; handler: () => void }> = [];

vi.mock("@/components/agent-logs/LogDetailContent", () => ({
  MessageBubble: ({ message, onFlag }: { message: { role: string; content: string }; onFlag?: () => void }) => {
    // Store onFlag handler with a data attr so tests can detect presence
    return React.createElement(
      "div",
      {
        "data-testid": "log-message",
        "data-has-flag": onFlag ? "true" : "false",
        onClick: onFlag,
      },
      `${message.role}:${message.content}`,
    );
  },
  StatsBar: ({ stats }: { stats: { messageCount: number } }) =>
    React.createElement("div", { "data-testid": "log-stats" }, `messages:${stats.messageCount}`),
  unescapeLogString: (s: string) => s,
}));

vi.mock("@/components/evals/AgentSessionCaptureModal", () => ({
  AgentSessionCaptureModal: ({ open, logId, turnIndex }: { open: boolean; logId: string; turnIndex?: number }) =>
    open
      ? React.createElement("div", { "data-testid": "capture-modal", "data-log-id": logId, "data-turn-index": turnIndex ?? "" }, "CaptureModal")
      : null,
}));

let mockSlug = "stakwork";
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: mockSlug }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) =>
    React.createElement("button", { onClick, disabled, ...props }, children),
}));

vi.mock("lucide-react", () => ({
  Download: () => React.createElement("span", null, "download-icon"),
  Loader2: () => React.createElement("span", { "data-testid": "log-loading" }, "loading-icon"),
}));

// Mock useUserTimezone — prevents the hook from issuing real fetch calls that
// would consume queued mockFetch responses.  vi.resetModules() re-imports the
// real module, so we also intercept /api/user/preferences in the fetch shim.
vi.mock("@/hooks/useUserTimezone", () => ({
  useUserTimezone: () => ({ timezone: "UTC" }),
  resetTimezoneCache: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
// Silently handle /api/user/preferences so useUserTimezone (when re-imported
// after vi.resetModules()) never steals a queued response.
globalThis.fetch = ((url: string, ...args: unknown[]) => {
  if (typeof url === "string" && url.includes("/api/user/preferences")) {
    return Promise.resolve({ ok: true, json: async () => ({ timezone: "UTC" }) } as Response);
  }
  return mockFetch(url, ...args);
}) as typeof fetch;

const FEATURE_ID = "feat-abc";

const fakeStats = {
  conversation: [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
  ],
  stats: { messageCount: 2, tokenEstimate: 50, toolUsage: {}, bashCommands: [] },
};

const singleLog = [{ id: "log-123", agent: `coding-agent-${FEATURE_ID}` }];
const singleLogWithTimestamp = [{ id: "log-123", agent: `coding-agent-${FEATURE_ID}`, createdAt: "2026-06-09T14:34:00.000Z" }];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LogsArtifactPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:fake");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading state initially", async () => {
    mockFetch.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: async () => fakeStats }), 200))
    );

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(React.createElement(LogsArtifactPanel, { logs: singleLog }));

    expect(screen.getByTestId("log-loading")).toBeDefined();
  });

  it("renders conversation content after fetch resolves", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => fakeStats,
    });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(React.createElement(LogsArtifactPanel, { logs: singleLog }));

    await waitFor(() => {
      expect(screen.getAllByTestId("log-message")).toHaveLength(2);
    });
  });

  it("renders error state when fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: "Internal Server Error",
    });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(
      React.createElement(LogsArtifactPanel, {
        logs: [{ id: "log-456", agent: `coding-agent-${FEATURE_ID}` }],
  
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch log/)).toBeDefined();
    });
  });

  it("renders a download button", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => fakeStats,
    });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(React.createElement(LogsArtifactPanel, { logs: singleLog }));

    await waitFor(() => screen.getAllByTestId("log-message"));
    expect(screen.getByText("Download")).toBeDefined();
  });

  it("triggers download for the selected log when clicked", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => fakeStats })
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(["{}"], { type: "application/json" }),
      });

    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string, ...args: unknown[]) => {
      const el = origCreateElement(tag, ...(args as []));
      if (tag === "a") {
        vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {});
      }
      return el;
    });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(
      React.createElement(LogsArtifactPanel, {
        logs: [{ id: "log-789", agent: `coding-agent-${FEATURE_ID}` }],
  
      }),
    );

    await waitFor(() => screen.getAllByTestId("log-message"));
    await userEvent.click(screen.getByText("Download"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/agent-logs/log-789/content");
    });
  });

  it("renders one tab per agent log with formatted labels", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => fakeStats });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(
      React.createElement(LogsArtifactPanel, {
        logs: [
          { id: "log-plan", agent: `plan-agent-${FEATURE_ID}` },
          { id: "log-code", agent: `coding-agent-${FEATURE_ID}` },
          { id: "log-test", agent: `test-agent-${FEATURE_ID}` },
        ],
  
      }),
    );

    expect(screen.getByRole("tab", { name: "Plan Agent" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Coding Agent" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Test Agent" })).toBeDefined();
  });

  it("numbers duplicate agent labels by timestamp order", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => fakeStats });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(
      React.createElement(LogsArtifactPanel, {
        logs: [
          { id: "log-plan", agent: "plan-agent-task1" },
          { id: "log-code-1", agent: "coding-agent-task1" },
          { id: "log-code-2", agent: "coding-agent-task2" },
          { id: "log-code-3", agent: "coding-agent-task3" },
        ],
      }),
    );

    expect(screen.getByRole("tab", { name: "Plan Agent" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Coding Agent 1" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Coding Agent 2" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Coding Agent 3" })).toBeDefined();
  });

  it("defaults to the last (latest) log tab", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => fakeStats });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(
      React.createElement(LogsArtifactPanel, {
        logs: [
          { id: "log-plan", agent: `plan-agent-${FEATURE_ID}` },
          { id: "log-code", agent: `coding-agent-${FEATURE_ID}` },
          { id: "log-test", agent: `test-agent-${FEATURE_ID}` },
        ],
  
      }),
    );

    const testTab = screen.getByRole("tab", { name: "Test Agent" });
    expect(testTab.getAttribute("aria-selected")).toBe("true");

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/agent-logs/log-test/stats");
    });
  });

  it("switches the displayed log when a tab is clicked", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => fakeStats });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(
      React.createElement(LogsArtifactPanel, {
        logs: [
          { id: "log-plan", agent: `plan-agent-${FEATURE_ID}` },
          { id: "log-code", agent: `coding-agent-${FEATURE_ID}` },
        ],
  
      }),
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/agent-logs/log-code/stats");
    });

    await userEvent.click(screen.getByRole("tab", { name: "Plan Agent" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/agent-logs/log-plan/stats");
    });
  });

  it("renders a formatted timestamp below the agent label when createdAt is provided", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => fakeStats });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(React.createElement(LogsArtifactPanel, { logs: singleLogWithTimestamp }));

    // The formatted time for "2026-06-09T14:34:00.000Z" should appear in the tab button
    const expectedTime = new Date("2026-06-09T14:34:00.000Z").toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(screen.getByText(expectedTime)).toBeDefined();
  });

  it("renders full datetime as title attribute on tab button when createdAt is provided", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => fakeStats });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(React.createElement(LogsArtifactPanel, { logs: singleLogWithTimestamp }));

    const tab = screen.getByRole("tab", { name: /Coding Agent/i });
    // Component now uses formatInUserTz(date, timezone) — with timezone="UTC" from
    // the mocked hook, this produces an Intl-formatted string that includes "UTC".
    const title = tab.getAttribute("title");
    expect(title).toBeTruthy();
    expect(title).toContain("Jun 9, 2026");
    expect(title).toContain("2:34 PM");
    expect(title).toContain("UTC");
  });

  it("does not render a timestamp for a log without createdAt", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => fakeStats });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(React.createElement(LogsArtifactPanel, { logs: singleLog }));

    const tab = screen.getByRole("tab", { name: /Coding Agent/i });
    expect(tab.getAttribute("title")).toBeNull();
  });

  it("does not render a timestamp for the provisional streaming tab", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => fakeStats });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    const streamingLog = {
      agent: "streaming-agent-task1",
      conversation: [{ role: "assistant", content: "Working…", toolCalls: [] }],
      status: "streaming" as const,
    };
    // No real logs so provisional tab is shown
    render(
      React.createElement(LogsArtifactPanel, {
        logs: [],
        streamingLog,
      })
    );

    const tab = screen.getByRole("tab", { name: /Streaming Agent/i });
    expect(tab.getAttribute("title")).toBeNull();
  });

  it("shows provisional tab for second run even when a canonical log with the same agent name already exists", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => fakeStats });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    const streamingLog = {
      agent: "plan-agent",
      conversation: [],
      status: "streaming" as const,
    };

    render(
      React.createElement(LogsArtifactPanel, {
        logs: [{ id: "log-1", agent: "plan-agent" }],
        streamingLog,
      })
    );

    // Provisional tab should be present despite the canonical log sharing the same agent name
    const provisionalTab = screen.getByRole("tab", { name: /Plan Agent/i, selected: false });
    expect(provisionalTab).toBeDefined();
    // The streaming indicator (animate-pulse dot) is only on the provisional tab
    const allTabs = screen.getAllByRole("tab");
    const provisionalTabWithPulse = allTabs.find((tab) =>
      tab.querySelector("[aria-label='streaming']") !== null
    );
    expect(provisionalTabWithPulse).toBeDefined();
  });
});

// ── lastUpdated cache invalidation ────────────────────────────────────────────

describe("LogsArtifactPanel — lastUpdated cache invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:fake");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it("re-fetches stats when lastUpdated changes for the selected log", async () => {
    const logId = "log-xyz";
    const statsResponse = {
      conversation: [{ role: "user", content: "Hello", toolCalls: [] }],
      stats: { messageCount: 1, estimatedTokens: 10, toolCalls: {}, bashCommands: [] },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => statsResponse,
    });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    const { rerender } = render(
      React.createElement(LogsArtifactPanel, {
        logs: [{ id: logId, agent: "plan-agent-x" }],
        lastUpdated: {},
      })
    );

    // Wait for initial fetch
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(`/api/agent-logs/${logId}/stats`);
    });

    const callCountAfterMount = mockFetch.mock.calls.length;

    // Simulate lastUpdated bump (Pusher event landed)
    act(() => {
      rerender(
        React.createElement(LogsArtifactPanel, {
          logs: [{ id: logId, agent: "plan-agent-x" }],
          lastUpdated: { [logId]: Date.now() },
        })
      );
    });

    // Should have triggered a new stats fetch
    await waitFor(() => {
      expect(mockFetch.mock.calls.length).toBeGreaterThan(callCountAfterMount);
    });
  });

  it("does not re-fetch when lastUpdated changes for a different (non-selected) log", async () => {
    // Component auto-selects the LAST log in the array
    const otherId = "log-other";
    const selectedId = "log-selected";

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        conversation: [{ role: "user", content: "Hi", toolCalls: [] }],
        stats: { messageCount: 1, estimatedTokens: 5, toolCalls: {}, bashCommands: [] },
      }),
    });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    const { rerender } = render(
      React.createElement(LogsArtifactPanel, {
        logs: [
          { id: otherId, agent: "coding-agent-x" },
          { id: selectedId, agent: "plan-agent-x" },
        ],
        lastUpdated: {},
      })
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(`/api/agent-logs/${selectedId}/stats`);
    });

    const callCountAfterMount = mockFetch.mock.calls.length;

    // Bump lastUpdated for the non-selected log only
    act(() => {
      rerender(
        React.createElement(LogsArtifactPanel, {
          logs: [
            { id: otherId, agent: "coding-agent-x" },
            { id: selectedId, agent: "plan-agent-x" },
          ],
          lastUpdated: { [otherId]: Date.now() },
        })
      );
    });

    // No additional fetch should have been triggered
    await waitFor(() => {
      expect(mockFetch.mock.calls.length).toBe(callCountAfterMount);
    });
  });
});

// ── Flag button gating tests ───────────────────────────────────────────────────

describe("LogsArtifactPanel — flag button gating", () => {
  const assistantConversation = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi there" },
    { role: "assistant", content: "doing more work" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:fake");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it("passes onFlag to assistant messages when slug is 'stakwork'", async () => {
    mockSlug = "stakwork";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversation: assistantConversation,
        stats: { messageCount: 3, estimatedTokens: 30, toolFrequency: {}, bashFrequency: {}, developerShellFrequency: {} },
      }),
    });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(React.createElement(LogsArtifactPanel, { logs: [{ id: "log-1", agent: "coding-agent" }] }));

    await waitFor(() => {
      const messages = screen.getAllByTestId("log-message");
      // assistant messages (index 1 and 2) should have onFlag; user (index 0) should not
      const assistantMessages = messages.filter((m) => m.getAttribute("data-has-flag") === "true");
      expect(assistantMessages.length).toBe(2);
    });
  });

  it("passes onFlag to assistant messages when slug is 'hive'", async () => {
    mockSlug = "hive";
    vi.resetModules();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversation: assistantConversation,
        stats: { messageCount: 3, estimatedTokens: 30, toolFrequency: {}, bashFrequency: {}, developerShellFrequency: {} },
      }),
    });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(React.createElement(LogsArtifactPanel, { logs: [{ id: "log-hive-1", agent: "coding-agent" }] }));

    await waitFor(() => {
      const messages = screen.getAllByTestId("log-message");
      const assistantMessages = messages.filter((m) => m.getAttribute("data-has-flag") === "true");
      expect(assistantMessages.length).toBe(2);
    });
  });

  it("does NOT pass onFlag to any message when slug is NOT in the allowlist", async () => {
    mockSlug = "other-workspace";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversation: assistantConversation,
        stats: { messageCount: 3, estimatedTokens: 30, toolFrequency: {}, bashFrequency: {}, developerShellFrequency: {} },
      }),
    });

    // Re-import to pick up new mock slug
    vi.resetModules();
    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(React.createElement(LogsArtifactPanel, { logs: [{ id: "log-2", agent: "coding-agent" }] }));

    await waitFor(() => {
      const messages = screen.getAllByTestId("log-message");
      const flaggedMessages = messages.filter((m) => m.getAttribute("data-has-flag") === "true");
      expect(flaggedMessages.length).toBe(0);
    });
  });

  it("passes turnIndex as i-1 when assistant message at index i is flagged", async () => {
    mockSlug = "stakwork";
    vi.resetModules();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversation: assistantConversation,
        stats: { messageCount: 3, estimatedTokens: 30, toolFrequency: {}, bashFrequency: {}, developerShellFrequency: {} },
      }),
    });

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(React.createElement(LogsArtifactPanel, { logs: [{ id: "log-3", agent: "coding-agent" }] }));

    await waitFor(() => {
      const messages = screen.getAllByTestId("log-message");
      // assistant at index 1 → turnIndex = 0; at index 2 → turnIndex = 1
      // Click the first assistant (index 1)
      const firstAssistant = messages[1];
      expect(firstAssistant.getAttribute("data-has-flag")).toBe("true");
      firstAssistant.click();
    });

    // After clicking, the capture modal should open with turnIndex = 0 (i-1 where i=1)
    await waitFor(() => {
      const modal = screen.queryByTestId("capture-modal");
      expect(modal).not.toBeNull();
      expect(modal?.getAttribute("data-turn-index")).toBe("0");
    });
  });

  it("does not render capture modal on provisional (streaming) tab", async () => {
    mockSlug = "stakwork";
    vi.resetModules();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        conversation: assistantConversation,
        stats: { messageCount: 3, estimatedTokens: 30, toolFrequency: {}, bashFrequency: {}, developerShellFrequency: {} },
      }),
    });

    const streamingLog = {
      agent: "streaming-agent",
      conversation: [{ role: "assistant", content: "working…", toolCalls: [] }],
      status: "streaming" as const,
    };

    const { LogsArtifactPanel } = await import("@/components/agent-logs/LogsArtifactPanel");
    render(React.createElement(LogsArtifactPanel, { logs: [], streamingLog }));

    // No canonical log selected, so modal should not render
    await waitFor(() => {
      expect(screen.queryByTestId("capture-modal")).toBeNull();
    });
  });
});
