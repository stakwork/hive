// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("WorkspaceSetup - shows spinner when not ready", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it("shows spinner for graph_mindset workspace when swarmId is null", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: makeWorkspace({ workspaceKind: "graph_mindset", swarmId: null }),
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

  it("shows spinner for graph_mindset workspace when hasKey is false", () => {
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

    const { getByText } = render(
      <WorkspaceSetup repositoryUrl="https://github.com/org/repo" />
    );

    expect(getByText(/preparing environment/i)).toBeInTheDocument();
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

  it("renders spinner overlay for graph_mindset when not ready", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: makeWorkspace({ workspaceKind: "graph_mindset", swarmId: null }),
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
});

describe("WorkspaceSetup - starting ingest", () => {
  const ingestCalls = () =>
    vi.mocked(global.fetch).mock.calls.filter(([url]) => url === "/api/swarm/stakgraph/ingest");

  function mockIngest(...responses: Array<{ status: number; body?: unknown }>) {
    const queue = [...responses];
    global.fetch = vi.fn(async (url: string) => {
      if (url !== "/api/swarm/stakgraph/ingest") return { ok: true, status: 200, json: async () => ({}) };
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      return { ok: next.status < 300, status: next.status, json: async () => next.body ?? {} };
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspace.mockReturnValue({
      workspace: makeWorkspace({ swarmId: "swarm-1", containerFilesSetUp: true }),
      slug: "my-workspace",
      id: "ws-1",
      updateWorkspace: mockUpdateWorkspace,
      refreshCurrentWorkspace: mockRefreshCurrentWorkspace,
    });
  });

  afterEach(() => vi.useRealTimers());

  it("keeps retrying while stakgraph answers 503, then saves the ingest request", async () => {
    vi.useFakeTimers();
    mockIngest({ status: 503 }, { status: 503 }, { status: 200, body: { data: { request_id: "req-1" } } });

    render(<WorkspaceSetup repositoryUrl="https://github.com/org/repo" />);
    await vi.advanceTimersByTimeAsync(0);
    expect(ingestCalls()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(ingestCalls()).toHaveLength(3);
    expect(mockUpdateWorkspace).toHaveBeenCalledWith({ ingestRefId: "req-1" });
  });

  it("gives up after the retry window and shows the server's message", async () => {
    vi.useFakeTimers();
    mockIngest({ status: 503, body: { message: "Stakgraph service is not available" } });

    const { findByText } = render(<WorkspaceSetup repositoryUrl="https://github.com/org/repo" />);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    vi.useRealTimers();

    expect(await findByText("Stakgraph service is not available")).toBeInTheDocument();
    expect(ingestCalls()).toHaveLength(21);
  });

  it("does not retry other failures", async () => {
    mockIngest({ status: 400, body: { message: "No GitHub credentials found for this workspace" } });

    const { findByText } = render(<WorkspaceSetup repositoryUrl="https://github.com/org/repo" />);

    expect(await findByText("No GitHub credentials found for this workspace")).toBeInTheDocument();
    expect(ingestCalls()).toHaveLength(1);
  });
});
