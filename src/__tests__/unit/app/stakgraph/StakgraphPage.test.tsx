import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StakgraphPage from "@/app/w/[slug]/stakgraph/page";
import { useStakgraphStore } from "@/stores/useStakgraphStore";
import { useWorkspace } from "@/hooks/useWorkspace";

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    back: vi.fn(),
  })),
}));

// Mock hooks
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(),
}));

vi.mock("@/stores/useStakgraphStore", () => ({
  useStakgraphStore: vi.fn(),
}));

// Mock child form components
vi.mock("@/components/stakgraph", () => ({
  ProjectInfoForm: ({ data, onChange }: any) => (
    <div data-testid="project-info-form">
      <input
        data-testid="project-name-input"
        value={data.name || ""}
        onChange={(e) => onChange({ name: e.target.value })}
      />
    </div>
  ),
  RepositoryForm: ({ data, onChange, onValidationChange }: any) => (
    <div data-testid="repository-form">
      <input
        data-testid="repo-url-input"
        value={data.repositories?.[0]?.repositoryUrl || ""}
        onChange={(e) => onChange({ repositories: [{ repositoryUrl: e.target.value }] })}
      />
      {onValidationChange && (
        <button
          data-testid="trigger-validation-change"
          onClick={() => onValidationChange({ "repositories.0.adminVerification": "Admin access required" })}
        >
          Trigger Validation
        </button>
      )}
    </div>
  ),
  SwarmForm: ({ data, onChange }: any) => (
    <div data-testid="swarm-form">
      <input
        data-testid="swarm-url-input"
        value={data.swarmUrl || ""}
        onChange={(e) => onChange({ swarmUrl: e.target.value })}
      />
    </div>
  ),
  EnvironmentForm: ({ data, onChange, onEnvVarsChange }: any) => (
    <div data-testid="environment-form">
      <input
        data-testid="pool-name-input"
        value={data.poolName || ""}
        onChange={(e) => onChange({ poolName: e.target.value })}
      />
    </div>
  ),
  ServicesForm: ({ data, onChange }: any) => (
    <div data-testid="services-form">Services Form</div>
  ),
}));

vi.mock("@/components/stakgraph/forms/EditFilesForm", () => ({
  FileTabs: () => <div data-testid="file-tabs">File Tabs</div>,
}));

vi.mock("@/components/pod-repair", () => ({
  PodRepairSection: () => <div data-testid="pod-repair-section">Pod Repair</div>,
}));

vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, description }: any) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: any) => <div className={className}>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, type, variant, size, className }: any) => (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={className}
      data-variant={variant}
      data-size={size}
    >
      {children}
    </button>
  ),
}));

vi.mock("sonner", () => ({
  toast: vi.fn(),
}));

describe("StakgraphPage", () => {
  const mockWorkspace = {
    slug: "test-workspace",
    id: "workspace-123",
    refreshCurrentWorkspace: vi.fn(),
  };

  const mockStoreDefaults = {
    formData: {
      name: "Test Project",
      description: "Test Description",
      repositories: [
        {
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          name: "test-repo",
        },
      ],
      swarmUrl: "https://swarm.test",
      swarmApiKey: "",
      swarmSecretAlias: "test-secret",
      poolName: "test-pool",
      poolCpu: "2",
      poolMemory: "8Gi",
      environmentVariables: [],
      services: [],
      containerFiles: [],
      webhookEnsured: false,
    },
    errors: {},
    loading: false,
    initialLoading: false,
    saved: false,
    repoValidationErrors: {},
    loadSettings: vi.fn(),
    saveSettings: vi.fn(),
    setRepoValidationErrors: vi.fn(),
    handleProjectInfoChange: vi.fn(),
    handleRepositoryChange: vi.fn(),
    handleSwarmChange: vi.fn(),
    handleEnvironmentChange: vi.fn(),
    handleEnvVarsChange: vi.fn(),
    handleServicesChange: vi.fn(),
    handleFileChange: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(useWorkspace).mockReturnValue(mockWorkspace as any);
    vi.mocked(useStakgraphStore).mockReturnValue(mockStoreDefaults as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Save Button Behavior", () => {
    test("Save button should be enabled when repoValidationErrors is empty", () => {
      vi.mocked(useStakgraphStore).mockReturnValue({
        ...mockStoreDefaults,
        repoValidationErrors: {},
        loading: false,
      } as any);

      render(<StakgraphPage />);

      const saveButton = screen.getByRole("button", { name: /save/i });
      expect(saveButton).not.toBeDisabled();
    });

    test("Save button should be disabled when repoValidationErrors contains at least one key", () => {
      vi.mocked(useStakgraphStore).mockReturnValue({
        ...mockStoreDefaults,
        repoValidationErrors: {
          "repositories.0.adminVerification": "Admin access required",
        },
        loading: false,
      } as any);

      render(<StakgraphPage />);

      const saveButton = screen.getByRole("button", { name: /save/i });
      expect(saveButton).toBeDisabled();
    });

    test("Save button should be disabled when loading is true", () => {
      vi.mocked(useStakgraphStore).mockReturnValue({
        ...mockStoreDefaults,
        repoValidationErrors: {},
        loading: true,
      } as any);

      render(<StakgraphPage />);

      const saveButton = screen.getByRole("button", { name: /saving/i });
      expect(saveButton).toBeDisabled();
    });

    test("Save button should be disabled when both loading and repoValidationErrors exist", () => {
      vi.mocked(useStakgraphStore).mockReturnValue({
        ...mockStoreDefaults,
        repoValidationErrors: {
          "repositories.0.adminVerification": "Admin access required",
        },
        loading: true,
      } as any);

      render(<StakgraphPage />);

      const saveButton = screen.getByRole("button", { name: /saving/i });
      expect(saveButton).toBeDisabled();
    });
  });

  describe("Blocking Message Visibility", () => {
    test("blocking message should be visible when repoValidationErrors is non-empty", () => {
      vi.mocked(useStakgraphStore).mockReturnValue({
        ...mockStoreDefaults,
        repoValidationErrors: {
          "repositories.0.adminVerification": "Admin access required",
        },
        loading: false,
      } as any);

      render(<StakgraphPage />);

      const blockingMessage = screen.getByText(
        /All repositories must be verified with admin access before saving/i
      );
      expect(blockingMessage).toBeInTheDocument();
      expect(blockingMessage).toHaveClass("text-amber-600");
    });

    test("blocking message should NOT be visible when repoValidationErrors is empty", () => {
      vi.mocked(useStakgraphStore).mockReturnValue({
        ...mockStoreDefaults,
        repoValidationErrors: {},
        loading: false,
      } as any);

      render(<StakgraphPage />);

      const blockingMessage = screen.queryByText(
        /All repositories must be verified with admin access before saving/i
      );
      expect(blockingMessage).not.toBeInTheDocument();
    });

    test("blocking message should be visible with multiple repo validation errors", () => {
      vi.mocked(useStakgraphStore).mockReturnValue({
        ...mockStoreDefaults,
        repoValidationErrors: {
          "repositories.0.adminVerification": "Admin access required",
          "repositories.1.adminVerification": "Admin access required",
        },
        loading: false,
      } as any);

      render(<StakgraphPage />);

      const blockingMessage = screen.getByText(
        /All repositories must be verified with admin access before saving/i
      );
      expect(blockingMessage).toBeInTheDocument();
    });
  });

  describe("onValidationChange Prop", () => {
    test("setRepoValidationErrors should be passed as onValidationChange prop to RepositoryForm", () => {
      const setRepoValidationErrorsMock = vi.fn();
      vi.mocked(useStakgraphStore).mockReturnValue({
        ...mockStoreDefaults,
        setRepoValidationErrors: setRepoValidationErrorsMock,
      } as any);

      render(<StakgraphPage />);

      const repositoryForm = screen.getByTestId("repository-form");
      expect(repositoryForm).toBeInTheDocument();

      // Trigger the onValidationChange callback through the mock button
      const triggerButton = screen.getByTestId("trigger-validation-change");
      triggerButton.click();

      expect(setRepoValidationErrorsMock).toHaveBeenCalledWith({
        "repositories.0.adminVerification": "Admin access required",
      });
    });
  });

  describe("Form Submission", () => {
    test("should call saveSettings when form is submitted and no validation errors", async () => {
      const saveSettingsMock = vi.fn();
      const refreshWorkspaceMock = vi.fn();

      vi.mocked(useStakgraphStore).mockReturnValue({
        ...mockStoreDefaults,
        saveSettings: saveSettingsMock,
        repoValidationErrors: {},
      } as any);

      vi.mocked(useWorkspace).mockReturnValue({
        ...mockWorkspace,
        refreshCurrentWorkspace: refreshWorkspaceMock,
      } as any);

      render(<StakgraphPage />);

      const saveButton = screen.getByRole("button", { name: /save/i });
      await userEvent.click(saveButton);

      await waitFor(() => {
        expect(saveSettingsMock).toHaveBeenCalledWith("test-workspace");
        expect(refreshWorkspaceMock).toHaveBeenCalled();
      });
    });

    test("form submission should not proceed when save button is disabled due to validation errors", async () => {
      const saveSettingsMock = vi.fn();

      vi.mocked(useStakgraphStore).mockReturnValue({
        ...mockStoreDefaults,
        saveSettings: saveSettingsMock,
        repoValidationErrors: {
          "repositories.0.adminVerification": "Admin access required",
        },
      } as any);

      render(<StakgraphPage />);

      const saveButton = screen.getByRole("button", { name: /save/i });
      expect(saveButton).toBeDisabled();

      // Attempt to click disabled button (should not trigger saveSettings)
      await userEvent.click(saveButton);

      expect(saveSettingsMock).not.toHaveBeenCalled();
    });
  });

  describe("Loading States", () => {
    test("should show loading state when initialLoading is true", () => {
      vi.mocked(useStakgraphStore).mockReturnValue({
        ...mockStoreDefaults,
        initialLoading: true,
      } as any);

      render(<StakgraphPage />);

      expect(screen.getByText(/Loading settings/i)).toBeInTheDocument();
      expect(screen.queryByTestId("repository-form")).not.toBeInTheDocument();
    });

    test("should render forms when initialLoading is false", () => {
      vi.mocked(useStakgraphStore).mockReturnValue({
        ...mockStoreDefaults,
        initialLoading: false,
      } as any);

      render(<StakgraphPage />);

      expect(screen.queryByText(/Loading settings/i)).not.toBeInTheDocument();
      expect(screen.getByTestId("repository-form")).toBeInTheDocument();
      expect(screen.getByTestId("project-info-form")).toBeInTheDocument();
      expect(screen.getByTestId("swarm-form")).toBeInTheDocument();
      expect(screen.getByTestId("environment-form")).toBeInTheDocument();
    });
  });
});
