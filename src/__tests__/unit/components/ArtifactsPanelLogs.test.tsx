/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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
  LogsArtifactPanel: ({ logId }: { logId: string }) =>
    React.createElement("div", { "data-testid": "logs-panel", "data-log-id": logId }),
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/artifacts", () => ({
  CodeArtifactPanel: () => null,
  BrowserArtifactPanel: () => null,
  GraphArtifactPanel: () => null,
  WorkflowArtifactPanel: () => null,
  DiffArtifactPanel: () => null,
}));

// ── Component under test ──────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ArtifactsPanel — LOGS tab", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("does not show LOGS tab when no agent log exists for the feature", async () => {
    // Simulate fetch returning empty data
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], total: 0, hasMore: false }),
    });

    // attachments count call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ count: 0 }),
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
      })
    );

    // Wait for async effects to settle
    await waitFor(() => {
      expect(screen.queryByTestId("logs-panel")).toBeNull();
    });

    expect(screen.queryByText("Logs")).toBeNull();
  });

  it("shows LOGS tab and renders LogsArtifactPanel when an agent log exists", async () => {
    // First fetch: agent logs resolver → returns a log
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: "log-abc" }], total: 1, hasMore: false }),
    });

    // Second fetch: attachments count
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ count: 0 }),
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

    expect(screen.getByTestId("logs-panel").getAttribute("data-log-id")).toBe("log-abc");
  });

  it("calls the correct API endpoint to resolve agent log for feature", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], total: 0, hasMore: false }),
    });

    const feature = makeFeature();
    render(
      React.createElement(ArtifactsPanel, {
        artifacts: [],
        workspaceId: "ws-42",
        featureId: "feat-99",
        feature,
        onFeatureUpdate: vi.fn(),
        planData,
      })
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/agent-logs?feature_id=feat-99&workspace_id=ws-42&limit=1")
      );
    });
  });
});
