// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { WorkspaceSetup } from "@/components/swarm-setup/WorkspaceSetup";

const mockUpdateWorkspace = vi.fn();
const mockRefreshCurrentWorkspace = vi.fn();
const mockSetIsOnboarding = vi.fn();

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(),
}));

vi.mock("@/stores/useStores", () => ({
  useDataStore: vi.fn((selector: (s: { setIsOnboarding: typeof mockSetIsOnboarding }) => unknown) =>
    selector({ setIsOnboarding: mockSetIsOnboarding })
  ),
}));

vi.mock("@/utils/getRepositoryDefaultBranch", () => ({
  getRepositoryDefaultBranch: vi.fn(),
}));

vi.mock("@/utils/repositoryParser", () => ({
  parseGithubOwnerRepo: vi.fn(() => ({ owner: "org", repo: "repo" })),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

import { useWorkspace } from "@/hooks/useWorkspace";

const mockUseWorkspace = useWorkspace as ReturnType<typeof vi.fn>;

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    slug: "my-workspace",
    swarmId: null,
    ingestRefId: null,
    hasKey: false,
    containerFilesSetUp: false,
    workspaceKind: "hive",
    ...overrides,
  };
}

describe("WorkspaceSetup - graph_mindset returns null when not ready", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it("returns null for graph_mindset workspace when swarmId is null", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: makeWorkspace({ workspaceKind: "graph_mindset", swarmId: null }),
      slug: "my-workspace",
      id: "ws-1",
      updateWorkspace: mockUpdateWorkspace,
      refreshCurrentWorkspace: mockRefreshCurrentWorkspace,
    });

    const { container } = render(
      <WorkspaceSetup repositoryUrl="https://github.com/org/repo" />
    );

    expect(container.firstChild).toBeNull();
  });

  it("returns null for graph_mindset workspace when hasKey is false", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: makeWorkspace({
        workspaceKind: "graph_mindset",
        swarmId: "swarm-1",
        hasKey: false,
        ingestRefId: "ingest-1",
      }),
      slug: "my-workspace",
      id: "ws-1",
      updateWorkspace: mockUpdateWorkspace,
      refreshCurrentWorkspace: mockRefreshCurrentWorkspace,
    });

    const { container } = render(
      <WorkspaceSetup repositoryUrl="https://github.com/org/repo" />
    );

    expect(container.firstChild).toBeNull();
  });

  it("shows spinner overlay for non-graph_mindset workspace when swarmId is null", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: makeWorkspace({ workspaceKind: "hive", swarmId: null }),
      slug: "my-workspace",
      id: "ws-1",
      updateWorkspace: mockUpdateWorkspace,
      refreshCurrentWorkspace: mockRefreshCurrentWorkspace,
    });

    const { getByText } = render(
      <WorkspaceSetup repositoryUrl="https://github.com/org/repo" />
    );

    expect(getByText(/preparing environment/i)).toBeInTheDocument();
  });

  it("does NOT render DarkWizardShell overlay for graph_mindset (returns null instead)", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: makeWorkspace({ workspaceKind: "graph_mindset", swarmId: null }),
      slug: "my-workspace",
      id: "ws-1",
      updateWorkspace: mockUpdateWorkspace,
      refreshCurrentWorkspace: mockRefreshCurrentWorkspace,
    });

    const { container, queryByText } = render(
      <WorkspaceSetup repositoryUrl="https://github.com/org/repo" />
    );

    expect(container.firstChild).toBeNull();
    expect(queryByText(/preparing environment/i)).not.toBeInTheDocument();
  });
});
