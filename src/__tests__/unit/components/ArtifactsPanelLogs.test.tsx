/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

globalThis.React = React;

// ── Heavy dependency mocks ────────────────────────────────────────────────────

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) =>
      React.createElement("div", rest, children),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  layout: undefined,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null) }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("lucide-react", () => ({
  ArrowLeft: () => React.createElement("span", null, "←"),
  Sparkles: () => React.createElement("span", null, "✨"),
  Loader2: () => React.createElement("span", null, "loading"),
  Monitor: () => React.createElement("span", null, "monitor"),
  Network: () => React.createElement("span", null, "network"),
  FileCode: () => React.createElement("span", null, "filecode"),
  Code2: () => React.createElement("span", null, "code2"),
  Terminal: () => React.createElement("span", null, "terminal"),
  ClipboardList: () => React.createElement("span", null, "clipboard"),
  ListChecks: () => React.createElement("span", null, "listchecks"),
  ShieldCheck: () => React.createElement("span", null, "shieldcheck"),
  ScrollText: () => React.createElement("span", null, "scrolltext"),
  Download: () => React.createElement("span", null, "download"),
}));

vi.mock("react-icons/pi", () => ({
  PiGraphFill: () => React.createElement("span", null, "graph"),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) =>
    React.createElement("button", { onClick, disabled, ...rest }, children),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  TooltipContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("@/hooks/useAutoSave", () => ({
  useAutoSave: () => ({ saving: false, saved: false, savedField: null, triggerSaved: vi.fn() }),
}));

vi.mock("@/hooks/useStakworkGeneration", () => ({
  useStakworkGeneration: () => ({
    latestRun: null,
    refetch: vi.fn(),
    isStale: false,
  }),
}));

// Mock useWorkflowLogs so ArtifactsPanel doesn't need Pusher or fetch
const mockUseWorkflowLogs = vi.fn(() => ({ agentLogs: [], lastUpdated: {} }));
vi.mock("@/hooks/useWorkflowLogs", () => ({
  useWorkflowLogs: (...args: unknown[]) => mockUseWorkflowLogs(...args),
}));

vi.mock("@/app/w/[slug]/plan/[featureId]/components/PlanArtifact", () => ({
  PlanArtifactPanel: () => React.createElement("div", { "data-testid": "plan-panel" }),
}));

vi.mock("@/components/features/CompactTasksList", () => ({
  CompactTasksList: () => React.createElement("div", { "data-testid": "tasks-panel" }),
}));

vi.mock("@/app/w/[slug]/plan/[featureId]/components/VerifyPanel", () => ({
  VerifyPanel: () => React.createElement("div", { "data-testid": "verify-panel" }),
}));

vi.mock("@/components/agent-logs/LogsArtifactPanel", () => ({
  LogsArtifactPanel: ({
    logs,
    lastUpdated,
    streamingLog,
  }: {
    logs: { id: string; agent: string }[];
    lastUpdated?: Record<string, number>;
    streamingLog?: { agent: string; conversation: { role: string; content: string }[] } | null;
  }) =>
    React.createElement("div", {
      "data-testid": "logs-panel",
      "data-log-ids": logs.map((l) => l.id).join(","),
      "data-last-updated": lastUpdated ? JSON.stringify(lastUpdated) : "",
      "data-streaming-agent": streamingLog?.agent ?? "",
    }),
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/artifacts", () => ({
  CodeArtifactPanel: () => null,
  BrowserArtifactPanel: () => null,
  GraphArtifactPanel: () => null,
  WorkflowArtifactPanel: () => null,
  DiffArtifactPanel: () => null,
}));

// ── Components under test ─────────────────────────────────────────────────────

import { ArtifactsPanel } from "@/app/w/[slug]/task/[...taskParams]/components/ArtifactsPanel";
import type { FeatureDetail } from "@/types/roadmap";

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function makeFeature(overrides: Partial<FeatureDetail> = {}): FeatureDetail {
  return {
    id: "feat-1",
    title: "Test Feature",
    brief: "A brief",
    requirements: "Some requirements",
    architecture: "Some architecture",
    userStories: [],
    phases: [{ id: "phase-1", name: "Phase 1", order: 0, tasks: [] }],
    workflowStatus: "COMPLETED",
    ...overrides,
  } as unknown as FeatureDetail;
}

const planData = { featureTitle: "Test Feature", sections: [] };

// ── ArtifactsPanel — LOGS tab ─────────────────────────────────────────────────

describe("ArtifactsPanel — LOGS tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // attachments count call (still uses fetch directly)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ count: 0 }),
    });
  });

  it("does not show LOGS tab when useAgentLogs returns empty list", async () => {
    mockUseWorkflowLogs.mockReturnValue({ agentLogs: [], lastUpdated: {} });

    const feature = makeFeature();
    render(
      React.createElement(ArtifactsPanel, {
        artifacts: [],
        workspaceId: "ws-1",
        featureId: "feat-1",
        feature,
        onFeatureUpdate: vi.fn(),
        planData,
      })
    );

    await waitFor(() => {
      expect(screen.queryByTestId("logs-panel")).toBeNull();
    });
    expect(screen.queryByText("Logs")).toBeNull();
  });

  it("shows LOGS tab and renders LogsArtifactPanel when useAgentLogs returns logs", async () => {
    mockUseWorkflowLogs.mockReturnValue({
      agentLogs: [
        { id: "log-abc", agent: "coding-agent-feat-1", createdAt: "2026-05-28T09:00:00Z" },
      ],
      lastUpdated: {},
    });

    const feature = makeFeature();
    render(
      React.createElement(ArtifactsPanel, {
        artifacts: [],
        workspaceId: "ws-1",
        featureId: "feat-1",
        feature,
        onFeatureUpdate: vi.fn(),
        planData,
        controlledTab: "LOGS" as const,
        onControlledTabChange: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("logs-panel")).toBeDefined();
    });

    expect(screen.getByTestId("logs-panel").getAttribute("data-log-ids")).toBe("log-abc");
  });

  it("passes lastUpdated from useAgentLogs to LogsArtifactPanel", async () => {
    const lastUpdated = { "log-abc": 1234567890 };
    mockUseWorkflowLogs.mockReturnValue({
      agentLogs: [
        { id: "log-abc", agent: "coding-agent-feat-1", createdAt: "2026-05-28T09:00:00Z" },
      ],
      lastUpdated,
    });

    const feature = makeFeature();
    render(
      React.createElement(ArtifactsPanel, {
        artifacts: [],
        workspaceId: "ws-1",
        featureId: "feat-1",
        feature,
        onFeatureUpdate: vi.fn(),
        planData,
        controlledTab: "LOGS" as const,
        onControlledTabChange: vi.fn(),
      })
    );

    await waitFor(() => {
      const panel = screen.getByTestId("logs-panel");
      const passed = JSON.parse(panel.getAttribute("data-last-updated") || "{}");
      expect(passed["log-abc"]).toBe(1234567890);
    });
  });

  it("calls useWorkflowLogs with taskId, featureId, and workspaceId", async () => {
    mockUseWorkflowLogs.mockReturnValue({ agentLogs: [], lastUpdated: {} });

    const feature = makeFeature();
    render(
      React.createElement(ArtifactsPanel, {
        artifacts: [],
        workspaceId: "ws-42",
        taskId: "task-99",
        featureId: "feat-99",
        feature,
        onFeatureUpdate: vi.fn(),
        planData,
      })
    );

    await waitFor(() => {
      expect(mockUseWorkflowLogs).toHaveBeenCalledWith("task-99", "feat-99", "ws-42");
    });
  });

  it("passes null taskId and featureId to useWorkflowLogs when none are provided", async () => {
    mockUseWorkflowLogs.mockReturnValue({ agentLogs: [], lastUpdated: {} });

    render(
      React.createElement(ArtifactsPanel, {
        artifacts: [],
        workspaceId: "ws-1",
        planData,
      })
    );

    await waitFor(() => {
      expect(mockUseWorkflowLogs).toHaveBeenCalledWith(null, null, "ws-1");
    });
  });

  it("shows LOGS tab for a workflow task with no linked feature", async () => {
    mockUseWorkflowLogs.mockReturnValue({
      agentLogs: [
        { id: "log-wf1", agent: "workflow-agent", createdAt: "2026-05-28T10:00:00Z" },
      ],
      lastUpdated: {},
    });

    // No feature / featureId / onFeatureUpdate — pure workflow task
    render(
      React.createElement(ArtifactsPanel, {
        artifacts: [],
        workspaceId: "ws-1",
        taskId: "task-wf-1",
        controlledTab: "LOGS" as const,
        onControlledTabChange: vi.fn(),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("logs-panel")).toBeDefined();
    });

    expect(screen.getByTestId("logs-panel").getAttribute("data-log-ids")).toBe("log-wf1");
  });

  it("shows LOGS tab when streamingLog is set even with no canonical logs", async () => {
    mockUseWorkflowLogs.mockReturnValue({ agentLogs: [], lastUpdated: {} });

    const feature = makeFeature();
    render(
      React.createElement(ArtifactsPanel, {
        artifacts: [],
        workspaceId: "ws-1",
        featureId: "feat-1",
        feature,
        onFeatureUpdate: vi.fn(),
        planData,
        controlledTab: "LOGS" as const,
        onControlledTabChange: vi.fn(),
        streamingLog: { agent: "plan-agent-abc", conversation: [] },
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("logs-panel")).toBeDefined();
    });
  });

  it("passes streamingLog to LogsArtifactPanel", async () => {
    mockUseWorkflowLogs.mockReturnValue({ agentLogs: [], lastUpdated: {} });

    const feature = makeFeature();
    const streamingLog = {
      agent: "plan-agent-xyz",
      conversation: [{ role: "assistant" as const, content: "🔧 search_files" }],
    };

    render(
      React.createElement(ArtifactsPanel, {
        artifacts: [],
        workspaceId: "ws-1",
        featureId: "feat-1",
        feature,
        onFeatureUpdate: vi.fn(),
        planData,
        controlledTab: "LOGS" as const,
        onControlledTabChange: vi.fn(),
        streamingLog,
      })
    );

    await waitFor(() => {
      const panel = screen.getByTestId("logs-panel");
      expect(panel.getAttribute("data-streaming-agent")).toBe("plan-agent-xyz");
    });
  });

  it("does not show LOGS tab when both agentLogs and streamingLog are empty/null", async () => {
    mockUseWorkflowLogs.mockReturnValue({ agentLogs: [], lastUpdated: {} });

    const feature = makeFeature();
    render(
      React.createElement(ArtifactsPanel, {
        artifacts: [],
        workspaceId: "ws-1",
        featureId: "feat-1",
        feature,
        onFeatureUpdate: vi.fn(),
        planData,
        streamingLog: null,
      })
    );

    await waitFor(() => {
      expect(screen.queryByTestId("logs-panel")).toBeNull();
    });
    expect(screen.queryByText("Logs")).toBeNull();
  });
});


