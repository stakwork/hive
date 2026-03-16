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

  it("renders Infrastructure tab content when ?tab=infrastructure", () => {
    mockSearchParams = new URLSearchParams("tab=infrastructure");
    render(<SettingsTabs {...defaultProps} />);
    expect(screen.getByTestId("vm-config-section")).toBeInTheDocument();
    expect(screen.getByTestId("rerun-ingest")).toBeInTheDocument();
    expect(screen.getByTestId("neo4j-config-settings")).toBeInTheDocument();
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


});
