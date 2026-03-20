import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsTabs } from "@/components/settings/SettingsTabs";

// --- Next.js navigation mocks ---
let mockSearchParams = new URLSearchParams();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

// --- useWorkspace mock ---
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    id: "ws-123",
    slug: "my-workspace",
    refreshCurrentWorkspace: vi.fn(),
  }),
}));

// --- useStakgraphStore mock ---
const mockLoadSettings = vi.fn();
vi.mock("@/stores/useStakgraphStore", () => ({
  useStakgraphStore: () => ({
    formData: { webhookEnsured: false, repositories: [], services: [], containerFiles: {} },
    errors: {},
    loading: false,
    initialLoading: false,
    saved: false,
    repoValidationErrors: {},
    loadSettings: mockLoadSettings,
    saveSettings: vi.fn(),
    setRepoValidationErrors: vi.fn(),
    handleProjectInfoChange: vi.fn(),
    handleRepositoryChange: vi.fn(),
    handleSwarmChange: vi.fn(),
    handleEnvironmentChange: vi.fn(),
    handleEnvVarsChange: vi.fn(),
    handleServicesChange: vi.fn(),
    handleFileChange: vi.fn(),
  }),
}));

// --- Component mocks (lightweight stubs) ---
vi.mock("@/components/WorkspaceSettings", () => ({
  WorkspaceSettings: () => <div data-testid="workspace-settings">WorkspaceSettings</div>,
}));
vi.mock("@/components/workspace/WorkspaceMembers", () => ({
  WorkspaceMembers: () => <div data-testid="workspace-members">WorkspaceMembers</div>,
}));
vi.mock("@/components/pool-status", () => ({
  VMConfigSection: () => <div data-testid="vm-config-section">VMConfigSection</div>,
}));
vi.mock("@/components/RerunIngest", () => ({
  RerunIngest: () => <div data-testid="rerun-ingest">RerunIngest</div>,
}));
vi.mock("@/components/settings/Neo4jConfigSettings", () => ({
  Neo4jConfigSettings: () => <div data-testid="neo4j-config-settings">Neo4jConfigSettings</div>,
}));
vi.mock("@/components/settings/VercelIntegrationSettings", () => ({
  VercelIntegrationSettings: () => (
    <div data-testid="vercel-integration-settings">VercelIntegrationSettings</div>
  ),
}));
vi.mock("@/components/settings/SphinxIntegrationSettings", () => ({
  SphinxIntegrationSettings: () => (
    <div data-testid="sphinx-integration-settings">SphinxIntegrationSettings</div>
  ),
}));
vi.mock("@/components/settings/ApiKeysSettings", () => ({
  ApiKeysSettings: () => <div data-testid="api-keys-settings">ApiKeysSettings</div>,
}));
vi.mock("@/components/settings/NodeTypeOrderSettings", () => ({
  NodeTypeOrderSettings: () => (
    <div data-testid="node-type-order-settings">NodeTypeOrderSettings</div>
  ),
}));
vi.mock("@/components/DeleteWorkspace", () => ({
  DeleteWorkspace: () => <div data-testid="delete-workspace">DeleteWorkspace</div>,
}));
vi.mock("@/components/stakgraph", () => ({
  ProjectInfoForm: () => <div data-testid="project-info-form">ProjectInfoForm</div>,
  RepositoryForm: () => <div data-testid="repository-form">RepositoryForm</div>,
  SwarmForm: () => <div data-testid="swarm-form">SwarmForm</div>,
  EnvironmentForm: () => <div data-testid="environment-form">EnvironmentForm</div>,
  ServicesForm: () => <div data-testid="services-form">ServicesForm</div>,
}));
vi.mock("@/components/stakgraph/forms/EditFilesForm", () => ({
  FileTabs: () => <div data-testid="file-tabs">FileTabs</div>,
}));
vi.mock("@/components/pod-repair", () => ({
  PodRepairSection: () => <div data-testid="pod-repair-section">PodRepairSection</div>,
}));

const defaultProps = {
  workspaceId: "ws-123",
  workspaceName: "My Workspace",
  workspaceSlug: "my-workspace",
  isOwner: true,
};

describe("SettingsTabs", () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    mockReplace.mockClear();
    mockLoadSettings.mockClear();
  });

  it("defaults to the General tab when no ?tab param is present", () => {
    render(<SettingsTabs {...defaultProps} />);
    expect(screen.getByTestId("workspace-settings")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-members")).toBeInTheDocument();
  });

  it("renders General tab content: WorkspaceSettings and WorkspaceMembers", () => {
    mockSearchParams = new URLSearchParams("tab=general");
    render(<SettingsTabs {...defaultProps} />);
    expect(screen.getByTestId("workspace-settings")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-members")).toBeInTheDocument();
  });

  it("renders Pool tab content when ?tab=pool", () => {
    mockSearchParams = new URLSearchParams("tab=pool");
    render(<SettingsTabs {...defaultProps} />);
    expect(screen.getByTestId("vm-config-section")).toBeInTheDocument();
    expect(screen.getByTestId("project-info-form")).toBeInTheDocument();
    expect(screen.getByTestId("repository-form")).toBeInTheDocument();
    expect(screen.getByTestId("swarm-form")).toBeInTheDocument();
    expect(screen.getByTestId("environment-form")).toBeInTheDocument();
    expect(screen.getByTestId("services-form")).toBeInTheDocument();
    expect(screen.getByTestId("file-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("rerun-ingest")).toBeInTheDocument();
    expect(screen.getByTestId("pod-repair-section")).toBeInTheDocument();
  });

  it("calls loadSettings with the workspace slug when Pool tab is active", () => {
    mockSearchParams = new URLSearchParams("tab=pool");
    render(<SettingsTabs {...defaultProps} />);
    expect(mockLoadSettings).toHaveBeenCalledWith("my-workspace");
  });

  it("does not call loadSettings when General tab is active", () => {
    mockSearchParams = new URLSearchParams("tab=general");
    render(<SettingsTabs {...defaultProps} />);
    expect(mockLoadSettings).not.toHaveBeenCalled();
  });

  it("renders Infrastructure tab content (Neo4j only) when ?tab=infrastructure", () => {
    mockSearchParams = new URLSearchParams("tab=infrastructure");
    render(<SettingsTabs {...defaultProps} />);
    expect(screen.getByTestId("neo4j-config-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("vm-config-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rerun-ingest")).not.toBeInTheDocument();
  });

  it("renders Integrations tab content when ?tab=integrations", () => {
    mockSearchParams = new URLSearchParams("tab=integrations");
    render(<SettingsTabs {...defaultProps} />);
    expect(screen.getByTestId("vercel-integration-settings")).toBeInTheDocument();
    expect(screen.getByTestId("sphinx-integration-settings")).toBeInTheDocument();
  });

  it("renders Developer tab content when ?tab=developer", () => {
    mockSearchParams = new URLSearchParams("tab=developer");
    render(<SettingsTabs {...defaultProps} />);
    expect(screen.getByTestId("api-keys-settings")).toBeInTheDocument();
    expect(screen.getByTestId("node-type-order-settings")).toBeInTheDocument();
  });

  it("renders DeleteWorkspace in General tab when isOwner=true", () => {
    render(<SettingsTabs {...defaultProps} isOwner={true} />);
    expect(screen.getByTestId("delete-workspace")).toBeInTheDocument();
  });

  it("hides DeleteWorkspace in General tab when isOwner=false", () => {
    render(<SettingsTabs {...defaultProps} isOwner={false} />);
    expect(screen.queryByTestId("delete-workspace")).not.toBeInTheDocument();
  });

  it("falls back to General tab when ?tab param is invalid", () => {
    mockSearchParams = new URLSearchParams("tab=not-a-real-tab");
    render(<SettingsTabs {...defaultProps} />);
    expect(screen.getByTestId("workspace-settings")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-members")).toBeInTheDocument();
  });

  it("calls router.replace with correct ?tab= value on tab change", async () => {
    const user = userEvent.setup();
    render(<SettingsTabs {...defaultProps} />);

    await user.click(screen.getByRole("tab", { name: "Infrastructure" }));
    expect(mockReplace).toHaveBeenCalledWith("?tab=infrastructure", { scroll: false });
  });

  it("calls router.replace with ?tab=pool when Pool tab is clicked", async () => {
    const user = userEvent.setup();
    render(<SettingsTabs {...defaultProps} />);

    await user.click(screen.getByRole("tab", { name: "Pool" }));
    expect(mockReplace).toHaveBeenCalledWith("?tab=pool", { scroll: false });
  });
});
