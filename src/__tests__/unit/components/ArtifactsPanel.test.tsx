import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactsPanel } from "@/app/w/[slug]/task/[...taskParams]/components/ArtifactsPanel";
import type { FeatureDetail } from "@/types/roadmap";

// Mock Pusher
vi.mock("pusher-js", () => ({
  default: vi.fn(() => ({
    subscribe: vi.fn(() => ({
      bind: vi.fn(),
      unbind: vi.fn(),
    })),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

// Mock framer-motion
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, className, ...props }: any) => (
      <div className={className} {...props}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock dependencies
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: { id: "workspace-1", slug: "test-workspace" },
    workspaceId: "workspace-1",
  }),
}));

vi.mock("@/hooks/useStakworkGeneration", () => ({
  useStakworkGeneration: vi.fn(() => ({
    latestRun: null,
    refetch: vi.fn(),
  })),
}));

vi.mock("@/hooks/useAutoSave", () => ({
  useAutoSave: vi.fn(() => ({
    saving: false,
    saved: false,
    savedField: null,
    triggerSaved: vi.fn(),
  })),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
    className,
    ...props
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    className?: string;
  }) => (
    <button disabled={disabled} onClick={onClick} className={className} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children, value, onValueChange }: any) => (
    <div data-testid="tabs" data-value={value}>
      {children}
    </div>
  ),
  TabsList: ({ children }: any) => <div data-testid="tabs-list">{children}</div>,
  TabsTrigger: ({ children, value, onClick }: any) => (
    <button data-testid={`tab-${value}`} onClick={onClick}>
      {children}
    </button>
  ),
  TabsContent: ({ children, value }: any) => (
    <div data-testid={`tab-content-${value}`}>{children}</div>
  ),
}));

vi.mock("@/components/chat/StreamingMessage", () => ({
  StreamingMessage: () => <div data-testid="streaming-message">Streaming...</div>,
}));

// Mock artifact components
vi.mock("@/app/w/[slug]/task/[...taskParams]/components/CodeArtifact", () => ({
  CodeArtifact: () => <div data-testid="code-artifact">Code</div>,
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/BrowserPreview", () => ({
  BrowserPreview: () => <div data-testid="browser-preview">Browser</div>,
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/IDEPreview", () => ({
  IDEPreview: () => <div data-testid="ide-preview">IDE</div>,
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/GraphArtifact", () => ({
  GraphArtifact: () => <div data-testid="graph-artifact">Graph</div>,
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/WorkflowArtifact", () => ({
  WorkflowArtifact: () => <div data-testid="workflow-artifact">Workflow</div>,
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/DiffArtifact", () => ({
  DiffArtifact: () => <div data-testid="diff-artifact">Diff</div>,
}));

vi.mock("@/app/w/[slug]/plan/[featureId]/components/PlanArtifact", () => ({
  PlanArtifactPanel: () => <div data-testid="plan-artifact">Plan</div>,
}));

vi.mock("@/components/features/TicketsList", () => ({
  TicketsList: () => <div data-testid="tickets-list">Tickets</div>,
}));

describe("ArtifactsPanel - Generate Tasks Button", () => {
  const mockFeature: FeatureDetail = {
    id: "feature-1",
    workspaceId: "workspace-1",
    title: "Test Feature",
    brief: "Test brief",
    requirements: "Test requirements",
    architecture: "Test architecture with enough content",
    userStories: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    owner: {
      id: "user-1",
      name: "Test User",
      email: "test@example.com",
      image: null,
    },
    ownerId: "user-1",
    workflowStatus: null,
    workflowStartedAt: null,
    workflowCompletedAt: null,
    stakworkProjectId: null,
    phases: [],
    _count: {
      tasks: 0,
    },
  };

  const mockPlanData = {
    brief: "Test brief",
    requirements: "Test requirements",
    architecture: "Test architecture",
    userStories: null,
  };

  const defaultProps = {
    artifacts: [],
    workspaceId: "workspace-1",
    taskId: "feature-1",
    planData: mockPlanData,
    feature: mockFeature,
    featureId: "feature-1",
    onFeatureUpdate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when isPlanInProgress is true", () => {
    it("should disable the button", () => {
      render(<ArtifactsPanel {...defaultProps} isPlanInProgress={true} />);

      const generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).toBeDisabled();
    });

    it("should show 'AI is still responding' tooltip", () => {
      render(<ArtifactsPanel {...defaultProps} isPlanInProgress={true} />);

      const tooltip = screen.getByText(/AI is still responding — please wait/i);
      expect(tooltip).toBeInTheDocument();
    });

    it("should apply disabled styles", () => {
      render(<ArtifactsPanel {...defaultProps} isPlanInProgress={true} />);

      const generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).toHaveClass("disabled:opacity-40");
      expect(generateButton).toHaveClass("disabled:cursor-not-allowed");
    });
  });

  describe("when isPlanInProgress is false", () => {
    it("should enable the button when architecture exists and not generating", () => {
      render(<ArtifactsPanel {...defaultProps} isPlanInProgress={false} />);

      const generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).not.toBeDisabled();
    });

    it("should not show the plan-in-progress tooltip", () => {
      render(<ArtifactsPanel {...defaultProps} isPlanInProgress={false} />);

      const tooltip = screen.queryByText(/AI is still responding — please wait/i);
      expect(tooltip).not.toBeInTheDocument();
    });
  });

  describe("when architecture is missing", () => {
    const featureWithoutArchitecture: FeatureDetail = {
      ...mockFeature,
      architecture: null,
    };

    const planDataWithoutArchitecture = {
      ...mockPlanData,
      architecture: null,
    };

    it("should disable the button even if isPlanInProgress is false", () => {
      render(
        <ArtifactsPanel
          {...defaultProps}
          feature={featureWithoutArchitecture}
          planData={planDataWithoutArchitecture}
          isPlanInProgress={false}
        />
      );

      const generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).toBeDisabled();
    });

    it("should show 'Architecture required' tooltip", () => {
      render(
        <ArtifactsPanel
          {...defaultProps}
          feature={featureWithoutArchitecture}
          planData={planDataWithoutArchitecture}
          isPlanInProgress={false}
        />
      );

      const tooltip = screen.getByText(/Architecture required to generate tasks/i);
      expect(tooltip).toBeInTheDocument();
    });
  });

  describe("combined disabled conditions", () => {
    it("should be disabled when both isPlanInProgress and no architecture", () => {
      const featureWithoutArchitecture: FeatureDetail = {
        ...mockFeature,
        architecture: null,
      };

      render(
        <ArtifactsPanel
          {...defaultProps}
          feature={featureWithoutArchitecture}
          planData={{ ...mockPlanData, architecture: null }}
          isPlanInProgress={true}
        />
      );

      const generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).toBeDisabled();
    });

    it("should prioritize isPlanInProgress tooltip when both conditions are true", () => {
      const featureWithoutArchitecture: FeatureDetail = {
        ...mockFeature,
        architecture: null,
      };

      render(
        <ArtifactsPanel
          {...defaultProps}
          feature={featureWithoutArchitecture}
          planData={{ ...mockPlanData, architecture: null }}
          isPlanInProgress={true}
        />
      );

      const tooltip = screen.getByText(/AI is still responding — please wait/i);
      expect(tooltip).toBeInTheDocument();
    });

    it("should be disabled when architecture exists but isPlanInProgress is true", () => {
      render(<ArtifactsPanel {...defaultProps} isPlanInProgress={true} />);

      const generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).toBeDisabled();
    });

    it("should be enabled only when architecture exists, not generating, and isPlanInProgress is false", () => {
      render(<ArtifactsPanel {...defaultProps} isPlanInProgress={false} />);

      const generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).not.toBeDisabled();
    });
  });

  describe("independent condition checks", () => {
    it("isPlanInProgress should work independently of other conditions", () => {
      // With architecture, without generating
      render(<ArtifactsPanel {...defaultProps} isPlanInProgress={true} />);
      let generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).toBeDisabled();
    });

    it("architecture requirement should work independently", () => {
      const featureWithoutArchitecture: FeatureDetail = {
        ...mockFeature,
        architecture: null,
      };

      render(
        <ArtifactsPanel
          {...defaultProps}
          feature={featureWithoutArchitecture}
          planData={{ ...mockPlanData, architecture: null }}
          isPlanInProgress={false}
        />
      );

      const generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).toBeDisabled();
    });
  });

  describe("button label", () => {
    it("should show 'Generate Tasks' by default", () => {
      render(<ArtifactsPanel {...defaultProps} isPlanInProgress={false} />);

      expect(screen.getByRole("button", { name: /generate tasks/i })).toBeInTheDocument();
    });

    it("should not change label when isPlanInProgress is true", () => {
      render(<ArtifactsPanel {...defaultProps} isPlanInProgress={true} />);

      const generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).toHaveTextContent("Generate Tasks");
    });
  });

  describe("real-time workflow status updates", () => {
    it("should re-enable button when isPlanInProgress changes from true to false", () => {
      const { rerender } = render(<ArtifactsPanel {...defaultProps} isPlanInProgress={true} />);

      let generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).toBeDisabled();

      // Simulate workflow completion
      rerender(<ArtifactsPanel {...defaultProps} isPlanInProgress={false} />);

      generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).not.toBeDisabled();
    });

    it("should disable button when isPlanInProgress changes from false to true", () => {
      const { rerender } = render(<ArtifactsPanel {...defaultProps} isPlanInProgress={false} />);

      let generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).not.toBeDisabled();

      // Simulate workflow start
      rerender(<ArtifactsPanel {...defaultProps} isPlanInProgress={true} />);

      generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).toBeDisabled();
    });

    it("should update tooltip when isPlanInProgress state changes", () => {
      const { rerender } = render(<ArtifactsPanel {...defaultProps} isPlanInProgress={true} />);

      let tooltip = screen.getByText(/AI is still responding — please wait/i);
      expect(tooltip).toBeInTheDocument();

      // Workflow completes, architecture exists
      rerender(<ArtifactsPanel {...defaultProps} isPlanInProgress={false} />);

      // Tooltip should not be shown when enabled
      tooltip = screen.queryByText(/AI is still responding — please wait/i);
      expect(tooltip).not.toBeInTheDocument();
    });
  });

  describe("visual disabled state", () => {
    it("should have opacity-40 class when disabled", () => {
      render(<ArtifactsPanel {...defaultProps} isPlanInProgress={true} />);

      const generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).toHaveClass("disabled:opacity-40");
    });

    it("should have cursor-not-allowed class when disabled", () => {
      render(<ArtifactsPanel {...defaultProps} isPlanInProgress={true} />);

      const generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).toHaveClass("disabled:cursor-not-allowed");
    });
  });

  describe("no regression tests", () => {
    it("should maintain existing disabled behavior for missing architecture", () => {
      const featureWithoutArchitecture: FeatureDetail = {
        ...mockFeature,
        architecture: null,
      };

      render(
        <ArtifactsPanel
          {...defaultProps}
          feature={featureWithoutArchitecture}
          planData={{ ...mockPlanData, architecture: null }}
          isPlanInProgress={false}
        />
      );

      const generateButton = screen.getByRole("button", { name: /generate tasks/i });
      expect(generateButton).toBeDisabled();
    });

    it("should not break when isPlanInProgress is undefined", () => {
      render(<ArtifactsPanel {...defaultProps} />);

      const generateButton = screen.getByRole("button", { name: /generate tasks/i });
      // Should behave as if isPlanInProgress is false (not disabled by this condition)
      expect(generateButton).not.toBeDisabled();
    });
  });
});
