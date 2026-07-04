/**
 * @vitest-environment jsdom
 *
 * Tests for ArtifactsPanel WORKFLOW tab visibility when PUBLISH_PROMPT or
 * PUBLISH_SCRIPT artifacts are present (with or without a WORKFLOW artifact).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

globalThis.React = React;

// ── Framer motion stub ────────────────────────────────────────────────────────

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

// ── Navigation stubs ──────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null) }),
}));

// ── Shared hooks ──────────────────────────────────────────────────────────────

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

vi.mock("@/hooks/useWorkflowLogs", () => ({
  useWorkflowLogs: () => ({ agentLogs: [], lastUpdated: {} }),
}));

// ── UI mocks ──────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

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

vi.mock("lucide-react", () => ({
  ArrowLeft: () => null,
  Sparkles: () => null,
  Loader2: () => null,
  Monitor: () => null,
  Network: () => null,
  FileCode: () => null,
  Code2: () => null,
  Terminal: () => null,
  ClipboardList: () => null,
  ListChecks: () => null,
  ShieldCheck: () => null,
  ScrollText: () => null,
  Download: () => null,
  Plus: () => null,
  Minus: () => null,
  AlignLeft: () => null,
}));

vi.mock("react-icons/pi", () => ({
  PiGraphFill: () => null,
}));

// ── Feature/plan stubs ────────────────────────────────────────────────────────

vi.mock("@/app/w/[slug]/plan/[featureId]/components/PlanArtifact", () => ({
  PlanArtifactPanel: () => null,
}));

vi.mock("@/components/features/CompactTasksList", () => ({
  CompactTasksList: () => null,
}));

vi.mock("@/app/w/[slug]/plan/[featureId]/components/VerifyPanel", () => ({
  VerifyPanel: () => null,
}));

vi.mock("@/components/agent-logs/LogsArtifactPanel", () => ({
  LogsArtifactPanel: () => null,
}));

// ── Artifact panel stubs (capture WorkflowArtifactPanel calls) ────────────────

let lastWorkflowArtifactPanelProps: { artifacts?: unknown[] } = {};

vi.mock("@/app/w/[slug]/task/[...taskParams]/artifacts", () => ({
  CodeArtifactPanel: () => null,
  BrowserArtifactPanel: () => null,
  GraphArtifactPanel: () => null,
  WorkflowArtifactPanel: (props: { artifacts: unknown[] }) => {
    lastWorkflowArtifactPanelProps = props;
    return React.createElement("div", { "data-testid": "workflow-artifact-panel" });
  },
  DiffArtifactPanel: () => null,
}));

// ── ArtifactsHeader — render tabs by label ────────────────────────────────────

vi.mock(
  "@/app/w/[slug]/task/[...taskParams]/components/ArtifactsHeader",
  () => ({
    ArtifactsHeader: ({
      availableArtifacts,
      activeArtifact,
      onArtifactChange,
    }: {
      availableArtifacts: string[];
      activeArtifact: string | null;
      onArtifactChange: (tab: string) => void;
    }) =>
      React.createElement(
        "div",
        { "data-testid": "artifacts-header" },
        availableArtifacts.map((tab) =>
          React.createElement(
            "button",
            {
              key: tab,
              role: "tab",
              "data-tab": tab,
              "aria-selected": activeArtifact === tab,
              onClick: () => onArtifactChange(tab),
            },
            tab,
          ),
        ),
      ),
  }),
);

// ── Component under test ──────────────────────────────────────────────────────

import { ArtifactsPanel } from "@/app/w/[slug]/task/[...taskParams]/components/ArtifactsPanel";
import type { Artifact } from "@/lib/chat";

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockFetch = vi.fn().mockResolvedValue({ json: async () => ({ count: 0 }) });
globalThis.fetch = mockFetch;

function makeWorkflowArtifact(id = "wf-1"): Artifact {
  return {
    id,
    type: "WORKFLOW",
    content: { workflowJson: "{}", workflowId: 1 },
  } as unknown as Artifact;
}

function makePublishPromptArtifact(id = "pp-1"): Artifact {
  return {
    id,
    type: "PUBLISH_PROMPT",
    content: { promptId: "p-1", promptVersionId: "v-1", promptName: "MY_PROMPT" },
  } as unknown as Artifact;
}

function makePublishScriptArtifact(id = "ps-1"): Artifact {
  return {
    id,
    type: "PUBLISH_SCRIPT",
    content: { scriptId: 42, scriptVersionId: 7, scriptName: "my_script.py" },
  } as unknown as Artifact;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ArtifactsPanel — WORKFLOW tab visibility with publish artifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastWorkflowArtifactPanelProps = {};
    mockFetch.mockResolvedValue({ json: async () => ({ count: 0 }) });
  });

  it("shows WORKFLOW tab when only WORKFLOW artifact is present (existing behavior)", () => {
    render(
      <ArtifactsPanel artifacts={[makeWorkflowArtifact()]} />,
    );
    const tab = screen.queryByRole("tab", { name: "WORKFLOW" });
    expect(tab).toBeInTheDocument();
  });

  it("shows WORKFLOW tab when only PUBLISH_PROMPT artifact is present (no WORKFLOW)", () => {
    render(
      <ArtifactsPanel artifacts={[makePublishPromptArtifact()]} />,
    );
    const tab = screen.queryByRole("tab", { name: "WORKFLOW" });
    expect(tab).toBeInTheDocument();
  });

  it("shows WORKFLOW tab when only PUBLISH_SCRIPT artifact is present (no WORKFLOW)", () => {
    render(
      <ArtifactsPanel artifacts={[makePublishScriptArtifact()]} />,
    );
    const tab = screen.queryByRole("tab", { name: "WORKFLOW" });
    expect(tab).toBeInTheDocument();
  });

  it("shows WORKFLOW tab when both PUBLISH_PROMPT and PUBLISH_SCRIPT present (no WORKFLOW)", () => {
    render(
      <ArtifactsPanel
        artifacts={[makePublishPromptArtifact(), makePublishScriptArtifact()]}
      />,
    );
    const tab = screen.queryByRole("tab", { name: "WORKFLOW" });
    expect(tab).toBeInTheDocument();
  });

  it("shows WORKFLOW tab when all three types are present together", () => {
    render(
      <ArtifactsPanel
        artifacts={[
          makeWorkflowArtifact(),
          makePublishPromptArtifact(),
          makePublishScriptArtifact(),
        ]}
      />,
    );
    const tab = screen.queryByRole("tab", { name: "WORKFLOW" });
    expect(tab).toBeInTheDocument();
  });

  it("does NOT show WORKFLOW tab when no relevant artifacts are present", () => {
    const codeArtifact: Artifact = {
      id: "code-1",
      type: "CODE",
      content: { code: "console.log()" },
    } as unknown as Artifact;
    render(<ArtifactsPanel artifacts={[codeArtifact]} />);
    const tab = screen.queryByRole("tab", { name: "WORKFLOW" });
    expect(tab).not.toBeInTheDocument();
  });

  it("passes PUBLISH_PROMPT artifact to WorkflowArtifactPanel (prompt-only)", () => {
    const promptArt = makePublishPromptArtifact();
    render(<ArtifactsPanel artifacts={[promptArt]} />);

    expect(screen.getByTestId("workflow-artifact-panel")).toBeInTheDocument();
    // The panel should receive the publish prompt artifact
    expect(
      (lastWorkflowArtifactPanelProps.artifacts as Artifact[]).some(
        (a) => a.type === "PUBLISH_PROMPT",
      ),
    ).toBe(true);
  });

  it("passes all relevant artifacts (WORKFLOW + PUBLISH_PROMPT + PUBLISH_SCRIPT) to WorkflowArtifactPanel", () => {
    const wfArt = makeWorkflowArtifact();
    const ppArt = makePublishPromptArtifact();
    const psArt = makePublishScriptArtifact();

    render(
      <ArtifactsPanel artifacts={[wfArt, ppArt, psArt]} />,
    );

    const receivedArtifacts = lastWorkflowArtifactPanelProps.artifacts as Artifact[];
    expect(receivedArtifacts.some((a) => a.type === "WORKFLOW")).toBe(true);
    expect(receivedArtifacts.some((a) => a.type === "PUBLISH_PROMPT")).toBe(true);
    expect(receivedArtifacts.some((a) => a.type === "PUBLISH_SCRIPT")).toBe(true);
  });
});
