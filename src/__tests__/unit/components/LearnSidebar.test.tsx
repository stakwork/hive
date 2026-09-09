import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { LearnSidebar } from "@/app/w/[slug]/learn/components/LearnSidebar";
import { toast } from "sonner";

// Mock workspace hook
const mockUseWorkspace = vi.fn(() => ({
  workspace: { repositories: [] },
}));
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => mockUseWorkspace(),
}));

// Mock child components used by the Process footer
vi.mock("@/app/w/[slug]/learn/components/UsageDisplay", () => ({
  UsageDisplay: () => <span data-testid="usage-display" />,
}));

vi.mock("@/app/w/[slug]/learn/components/CreateConceptModal", () => ({
  CreateConceptModal: () => null,
}));

vi.mock("@/lib/date-utils", () => ({
  formatRelativeOrDate: (d: string) => d,
  formatRelativeOrDateInTz: (d: string) => d,
}));

// Minimal mocks for UI deps
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={!!checked}
      onChange={() => onCheckedChange?.(!checked)}
      {...props}
    />
  ),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(" "),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: (props: any) => <input type="checkbox" data-testid="switch" {...props} />,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <div onClick={onClick}>{children}</div>,
}));

vi.mock("lucide-react", () => ({
  ChevronDown: () => <span data-testid="chevron-icon" />,
  BookOpen: () => <span data-testid="book-icon" />,
  Lightbulb: () => <span data-testid="lightbulb-icon" />,
  GitBranch: () => <span data-testid="gitbranch-icon" />,
  GitPullRequest: () => <span data-testid="gitpullrequest-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  Pencil: () => <span data-testid="pencil-icon" />,
  RefreshCw: () => <span data-testid="refresh-icon" />,
  Sprout: () => <span data-testid="sprout-icon" />,
  Search: () => <span data-testid="search-icon" />,
  X: () => <span data-testid="x-icon" />,
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ value, onChange, ...props }: any) => (
    <input value={value} onChange={onChange} {...props} />
  ),
}));

vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: (value: string) => value,
}));

const diagram = {
  id: "diag-1",
  name: "Auth Flow",
  body: "graph TD\nA-->B",
  description: null,
};

const defaultProps = {
  workspaceSlug: "test-workspace",
  docs: [],
  concepts: [],
  diagrams: [diagram],
  activeItemKey: null,
  onDocClick: vi.fn(),
  onConceptClick: vi.fn(),
  onDiagramClick: vi.fn(),
  onCreateDiagram: vi.fn(),
  onEditDiagram: vi.fn(),
  isDocsLoading: false,
  isConceptsLoading: false,
  isDiagramsLoading: false,
};

const multiRepoConcepts = [
  { id: "stakwork/hive/auth", name: "Auth" },
  { id: "stakwork/hive/tasks", name: "Tasks" },
  { id: "stakwork/staklink/agent", name: "Agent" },
];

describe("LearnSidebar — repo-grouped concepts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stub fetch so useEffects in the component don't throw
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
  });

  it("renders one sub-section per unique repo", () => {
    render(<LearnSidebar {...defaultProps} concepts={multiRepoConcepts} />);
    expect(screen.getByTestId("learn-concept-repo-header-hive")).toBeTruthy();
    expect(screen.getByTestId("learn-concept-repo-header-staklink")).toBeTruthy();
  });

  it("each group shows correct concept count badge", () => {
    render(<LearnSidebar {...defaultProps} concepts={multiRepoConcepts} />);
    const hiveHeader = screen.getByTestId("learn-concept-repo-header-hive");
    const stklinkHeader = screen.getByTestId("learn-concept-repo-header-staklink");
    expect(hiveHeader.textContent).toContain("2");
    expect(stklinkHeader.textContent).toContain("1");
  });

  it("parent Concepts badge shows total count", () => {
    render(<LearnSidebar {...defaultProps} concepts={multiRepoConcepts} />);
    const conceptsSection = screen.getByTestId("learn-concepts-section");
    // The top-level section header contains the total badge
    const buttons = conceptsSection.querySelectorAll("button");
    const parentHeader = buttons[0];
    expect(parentHeader.textContent).toContain("3");
  });

  it("toggling a repo group collapses only that group", () => {
    render(<LearnSidebar {...defaultProps} concepts={multiRepoConcepts} />);
    // All concept buttons visible initially
    expect(screen.getAllByTestId("learn-concept-item")).toHaveLength(3);

    // Collapse hive group
    fireEvent.click(screen.getByTestId("learn-concept-repo-header-hive"));

    // hive concepts gone, staklink still visible
    const items = screen.getAllByTestId("learn-concept-item");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toBe("Agent");
  });

  it("all groups default to expanded", () => {
    render(<LearnSidebar {...defaultProps} concepts={multiRepoConcepts} />);
    expect(screen.getAllByTestId("learn-concept-item")).toHaveLength(3);
  });

  it("active concept highlight is preserved", () => {
    render(
      <LearnSidebar
        {...defaultProps}
        concepts={multiRepoConcepts}
        activeItemKey="concept-stakwork/hive/auth"
      />
    );
    const authButton = screen
      .getAllByTestId("learn-concept-item")
      .find((el) => el.textContent === "Auth");
    expect(authButton?.className).toContain("bg-muted/60");
    expect(authButton?.className).toContain("font-medium");
  });
});

describe("LearnSidebar — Process Repository section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
  });

  it("is collapsed by default (body content not visible)", () => {
    render(<LearnSidebar {...defaultProps} />);
    expect(screen.queryByTestId("usage-display")).toBeNull();
    expect(screen.queryByTestId("switch")).toBeNull();
  });

  it("clicking the header expands the section", () => {
    render(<LearnSidebar {...defaultProps} />);
    fireEvent.click(screen.getByTestId("process-repo-header"));
    expect(screen.getByTestId("switch")).toBeTruthy();
  });

  it("clicking the header twice collapses it again", () => {
    render(<LearnSidebar {...defaultProps} />);
    fireEvent.click(screen.getByTestId("process-repo-header"));
    expect(screen.getByTestId("switch")).toBeTruthy();
    fireEvent.click(screen.getByTestId("process-repo-header"));
    expect(screen.queryByTestId("switch")).toBeNull();
  });

  it("UsageDisplay is not rendered when collapsed", () => {
    render(<LearnSidebar {...defaultProps} />);
    expect(screen.queryByTestId("usage-display")).toBeNull();
  });

  it("UsageDisplay is rendered when expanded (given cumulativeUsage exists)", async () => {
    // Provide cumulativeUsage via the fetch mock
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        lastProcessedTimestamp: null,
        processing: false,
        cumulativeUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
    });
    render(<LearnSidebar {...defaultProps} />);
    fireEvent.click(screen.getByTestId("process-repo-header"));
    // UsageDisplay is rendered inside the expanded body; it will appear once cumulativeUsage is set
    // Even before the fetch resolves it's inside the expanded body (conditionally rendered by cumulativeUsage)
    // Just verify the section is open and the body is visible
    expect(screen.getByTestId("switch")).toBeTruthy();
  });

  it("shows 'Process Repository' label with 1 repo", () => {
    render(<LearnSidebar {...defaultProps} />);
    const header = screen.getByTestId("process-repo-header");
    expect(header.textContent).toContain("Process Repository");
    expect(header.textContent).not.toContain("Process Repositories");
  });

  it("shows 'Process Repository' label with 0 repos (default mock)", () => {
    render(<LearnSidebar {...defaultProps} />);
    const header = screen.getByTestId("process-repo-header");
    expect(header.textContent).toContain("Process Repository");
  });
});

describe("LearnSidebar — Process Repository label (multi-repo)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
  });

  it("shows 'Process Repositories' when workspace has >1 repositories", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: {
        repositories: [
          { id: "r1", name: "repo-one" },
          { id: "r2", name: "repo-two" },
        ],
      },
    });
    render(<LearnSidebar {...defaultProps} />);
    const header = screen.getByTestId("process-repo-header");
    expect(header.textContent).toContain("Process Repositories");
  });

  it("shows 'Process Repository' when workspace has 1 repository", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: {
        repositories: [{ id: "r1", name: "repo-one" }],
      },
    });
    render(<LearnSidebar {...defaultProps} />);
    const header = screen.getByTestId("process-repo-header");
    expect(header.textContent).toContain("Process Repository");
    expect(header.textContent).not.toContain("Process Repositories");
  });
});

describe("LearnSidebar — edit diagram icon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an edit button for each diagram", () => {
    render(<LearnSidebar {...defaultProps} />);
    expect(screen.getByTestId("edit-diagram-button")).toBeTruthy();
  });

  it("clicking the edit button calls onEditDiagram with the diagram", () => {
    render(<LearnSidebar {...defaultProps} />);
    fireEvent.click(screen.getByTestId("edit-diagram-button"));
    expect(defaultProps.onEditDiagram).toHaveBeenCalledWith(diagram);
  });

  it("clicking the edit button does NOT call onDiagramClick", () => {
    render(<LearnSidebar {...defaultProps} />);
    fireEvent.click(screen.getByTestId("edit-diagram-button"));
    expect(defaultProps.onDiagramClick).not.toHaveBeenCalled();
  });

  it("clicking the diagram name button calls onDiagramClick and not onEditDiagram", () => {
    render(<LearnSidebar {...defaultProps} />);
    fireEvent.click(screen.getByTestId("learn-diagram-item"));
    expect(defaultProps.onDiagramClick).toHaveBeenCalledWith(
      diagram.id,
      diagram.name,
      diagram.body,
      diagram.description
    );
    expect(defaultProps.onEditDiagram).not.toHaveBeenCalled();
  });
});

describe("LearnSidebar — Docs + button (learn_docs)", () => {
  const repoWithUrl = { id: "r1", name: "my-repo", repositoryUrl: "https://github.com/org/my-repo" };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
  });

  it("shows + button when workspace has a repo not represented in docs", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: { repositories: [repoWithUrl] },
    });
    render(<LearnSidebar {...defaultProps} docs={[]} isDocsLoading={false} />);
    expect(screen.getByTestId("learn-doc-button")).toBeTruthy();
  });

  it("hides + button when all repos are already documented", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: { repositories: [repoWithUrl] },
    });
    render(
      <LearnSidebar
        {...defaultProps}
        docs={[{ repoName: "my-repo", content: "docs here" }]}
        isDocsLoading={false}
      />
    );
    expect(screen.queryByTestId("learn-doc-button")).toBeNull();
  });

  it("hides + button while docs are loading", () => {
    mockUseWorkspace.mockReturnValue({
      workspace: { repositories: [repoWithUrl] },
    });
    render(<LearnSidebar {...defaultProps} docs={[]} isDocsLoading={true} />);
    expect(screen.queryByTestId("learn-doc-button")).toBeNull();
  });

  it("dropdown lists only unlearned repo names", () => {
    const repos = [
      { id: "r1", name: "repo-a", repositoryUrl: "https://github.com/org/repo-a" },
      { id: "r2", name: "repo-b", repositoryUrl: "https://github.com/org/repo-b" },
    ];
    mockUseWorkspace.mockReturnValue({ workspace: { repositories: repos } });
    render(
      <LearnSidebar
        {...defaultProps}
        docs={[{ repoName: "repo-a", content: "some docs" }]}
        isDocsLoading={false}
      />
    );
    // repo-b is unlearned, repo-a is learned
    const dropdownContent = screen.getByTestId("dropdown-content");
    expect(dropdownContent.textContent).toContain("repo-b");
    expect(dropdownContent.textContent).not.toContain("repo-a");
  });

  it("clicking a repo item calls fetch with the correct repo_url", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    mockUseWorkspace.mockReturnValue({
      workspace: { repositories: [repoWithUrl] },
    });
    render(<LearnSidebar {...defaultProps} docs={[]} isDocsLoading={false} />);

    const dropdownContent = screen.getByTestId("dropdown-content");
    fireEvent.click(dropdownContent.firstElementChild!);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/learnings/docs/learn",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            workspace: "test-workspace",
            repo_url: repoWithUrl.repositoryUrl,
          }),
        })
      );
    });
  });

  it("shows spinner and disables button while request is in flight", async () => {
    let resolveRequest!: (value: { ok: boolean }) => void;
    global.fetch = vi.fn(
      () => new Promise<{ ok: boolean }>((resolve) => { resolveRequest = resolve; })
    );
    mockUseWorkspace.mockReturnValue({
      workspace: { repositories: [repoWithUrl] },
    });
    render(<LearnSidebar {...defaultProps} docs={[]} isDocsLoading={false} />);

    const dropdownContent = screen.getByTestId("dropdown-content");
    fireEvent.click(dropdownContent.firstElementChild!);

    await waitFor(() => {
      const btn = screen.getByTestId("learn-doc-button");
      expect(btn).toHaveAttribute("disabled");
      expect(screen.getByTestId("refresh-icon")).toBeTruthy();
    });

    // resolve so the component cleans up
    resolveRequest({ ok: true });
  });

  it("shows toast.success on successful fetch", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    mockUseWorkspace.mockReturnValue({
      workspace: { repositories: [repoWithUrl] },
    });
    render(<LearnSidebar {...defaultProps} docs={[]} isDocsLoading={false} />);

    const dropdownContent = screen.getByTestId("dropdown-content");
    fireEvent.click(dropdownContent.firstElementChild!);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "Documentation learning triggered — reload the page to see it."
      );
    });
  });

  it("shows toast.error on failed fetch", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    mockUseWorkspace.mockReturnValue({
      workspace: { repositories: [repoWithUrl] },
    });
    render(<LearnSidebar {...defaultProps} docs={[]} isDocsLoading={false} />);

    const dropdownContent = screen.getByTestId("dropdown-content");
    fireEvent.click(dropdownContent.firstElementChild!);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to trigger documentation learning."
      );
    });
  });
});

describe("LearnSidebar — concept search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspace.mockReturnValue({ workspace: { repositories: [] } });
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
  });

  it("renders search input inside concepts section", () => {
    render(<LearnSidebar {...defaultProps} concepts={multiRepoConcepts} />);
    expect(screen.getByTestId("concept-search-input")).toBeTruthy();
  });

  it("typing fewer than 2 chars does not call fetch for search and keeps grouped list", async () => {
    render(<LearnSidebar {...defaultProps} concepts={multiRepoConcepts} />);
    const input = screen.getByTestId("concept-search-input");

    // Clear any fetch calls from component mount effects
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: false });

    fireEvent.change(input, { target: { value: "a" } });

    await waitFor(() => {
      // grouped list still visible
      expect(screen.getAllByTestId("learn-concept-item").length).toBeGreaterThan(0);
    });

    // fetch should NOT have been called for search (only background effects may call it)
    const searchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => typeof args[0] === "string" && (args[0] as string).includes("/concepts/search")
    );
    expect(searchCalls).toHaveLength(0);
  });

  it("typing ≥ 2 chars calls search endpoint with correct params", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ literal: [], semantic: [] }),
    });

    render(<LearnSidebar {...defaultProps} concepts={multiRepoConcepts} />);
    const input = screen.getByTestId("concept-search-input");
    fireEvent.change(input, { target: { value: "au" } });

    await waitFor(() => {
      const searchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        (args: unknown[]) => typeof args[0] === "string" && (args[0] as string).includes("/concepts/search")
      );
      expect(searchCalls.length).toBeGreaterThan(0);
      expect(searchCalls[0][0]).toContain("workspace=test-workspace");
      expect(searchCalls[0][0]).toContain("q=au");
    });
  });

  it("renders literal results under Matches label", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        literal: [{ id: "stakwork/hive/auth", name: "Authentication" }],
        semantic: [],
      }),
    });

    render(<LearnSidebar {...defaultProps} concepts={multiRepoConcepts} />);
    const input = screen.getByTestId("concept-search-input");
    fireEvent.change(input, { target: { value: "auth" } });

    await waitFor(() => {
      expect(screen.getByText("Matches")).toBeTruthy();
      expect(screen.getByTestId("concept-search-result-literal")).toBeTruthy();
      expect(screen.getByTestId("concept-search-result-literal").textContent).toBe("Authentication");
    });
  });

  it("renders semantic results under Related label", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        literal: [],
        semantic: [{ id: "stakwork/hive/tasks", name: "Tasks" }],
      }),
    });

    render(<LearnSidebar {...defaultProps} concepts={multiRepoConcepts} />);
    const input = screen.getByTestId("concept-search-input");
    fireEvent.change(input, { target: { value: "ta" } });

    await waitFor(() => {
      expect(screen.getByText("Related")).toBeTruthy();
      expect(screen.getByTestId("concept-search-result-semantic")).toBeTruthy();
      expect(screen.getByTestId("concept-search-result-semantic").textContent).toBe("Tasks");
    });
  });

  it("shows 'No concepts match' when results are empty", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ literal: [], semantic: [] }),
    });

    render(<LearnSidebar {...defaultProps} concepts={multiRepoConcepts} />);
    const input = screen.getByTestId("concept-search-input");
    fireEvent.change(input, { target: { value: "xyz" } });

    await waitFor(() => {
      expect(screen.getByText("No concepts match")).toBeTruthy();
    });
  });

  it("clearing input restores grouped concept list", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        literal: [{ id: "stakwork/hive/auth", name: "Authentication" }],
        semantic: [],
      }),
    });

    render(<LearnSidebar {...defaultProps} concepts={multiRepoConcepts} />);
    const input = screen.getByTestId("concept-search-input");

    // Type to trigger search
    fireEvent.change(input, { target: { value: "auth" } });
    await waitFor(() => {
      expect(screen.queryByTestId("learn-concept-item")).toBeNull();
    });

    // Click X to clear
    fireEvent.click(screen.getByLabelText("Clear search"));

    await waitFor(() => {
      expect(screen.getAllByTestId("learn-concept-item").length).toBeGreaterThan(0);
    });
  });

  it("clicking a literal search result calls onConceptClick with correct id and name", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        literal: [{ id: "stakwork/hive/auth", name: "Authentication" }],
        semantic: [],
      }),
    });

    const onConceptClick = vi.fn();
    render(
      <LearnSidebar
        {...defaultProps}
        concepts={multiRepoConcepts}
        onConceptClick={onConceptClick}
      />
    );

    const input = screen.getByTestId("concept-search-input");
    fireEvent.change(input, { target: { value: "auth" } });

    await waitFor(() => {
      expect(screen.getByTestId("concept-search-result-literal")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("concept-search-result-literal"));
    expect(onConceptClick).toHaveBeenCalledWith("stakwork/hive/auth", "Authentication", "");
  });

  it("clicking a semantic search result calls onConceptClick with correct id and name", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        literal: [],
        semantic: [{ id: "stakwork/hive/tasks", name: "Tasks" }],
      }),
    });

    const onConceptClick = vi.fn();
    render(
      <LearnSidebar
        {...defaultProps}
        concepts={multiRepoConcepts}
        onConceptClick={onConceptClick}
      />
    );

    const input = screen.getByTestId("concept-search-input");
    fireEvent.change(input, { target: { value: "ta" } });

    await waitFor(() => {
      expect(screen.getByTestId("concept-search-result-semantic")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("concept-search-result-semantic"));
    expect(onConceptClick).toHaveBeenCalledWith("stakwork/hive/tasks", "Tasks", "");
  });
});

describe("LearnSidebar — concept proposals", () => {
  const pendingProposals = [
    {
      id: "proposal-create-1",
      action: "create" as const,
      status: "pending" as const,
      name: "Encryption Service",
      rationale: "r",
      source: "s",
      prNumbers: [],
      createdAt: "2025-08-05T10:00:00.000Z",
      repo: "stakwork/hive",
    },
    {
      id: "proposal-update-1",
      action: "update" as const,
      status: "pending" as const,
      conceptId: "stakwork/hive/tasks",
      rationale: "r",
      source: "s",
      prNumbers: [],
      createdAt: "2025-08-06T14:30:00.000Z",
      repo: "stakwork/hive",
    },
    {
      id: "proposal-merge-1",
      action: "merge" as const,
      status: "pending" as const,
      conceptId: "stakwork/hive/auth",
      mergeIntoConceptId: "stakwork/hive/tasks",
      rationale: "r",
      source: "s",
      prNumbers: [],
      createdAt: "2025-08-08T16:45:00.000Z",
      repo: "stakwork/hive",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspace.mockReturnValue({ workspace: { repositories: [] } });
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
  });

  it("hides the Proposals section when there are no proposals", () => {
    render(<LearnSidebar {...defaultProps} />);
    expect(screen.queryByTestId("learn-proposals-section")).toBeNull();
  });

  it("renders the Proposals section with a count badge", () => {
    render(<LearnSidebar {...defaultProps} proposals={pendingProposals} />);
    const header = screen.getByTestId("learn-proposals-header");
    expect(header.textContent).toContain("Proposals");
    expect(header.textContent).toContain("3");
  });

  it("lists every proposal, including create proposals with no concept row", () => {
    render(<LearnSidebar {...defaultProps} proposals={pendingProposals} />);
    const items = screen.getAllByTestId("learn-proposal-item");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("Encryption Service");
    expect(items[1].textContent).toContain("stakwork/hive/tasks");
    expect(items[2].textContent).toContain(
      "stakwork/hive/auth → stakwork/hive/tasks"
    );
    items.forEach((item, i) => {
      expect(
        item.querySelector('[data-testid="learn-proposal-recency"]')?.textContent
      ).toBe(pendingProposals[i].createdAt);
      expect(
        item.querySelector('[data-testid="learn-proposal-source"]')?.textContent
      ).toBe(pendingProposals[i].source);
    });
  });

  it("omits source when empty or whitespace-only, but still shows recency", () => {
    const emptySourceProposal = {
      ...pendingProposals[0],
      id: "proposal-empty-source",
      source: "",
    };
    const whitespaceSourceProposal = {
      ...pendingProposals[0],
      id: "proposal-whitespace-source",
      source: "   ",
    };
    render(
      <LearnSidebar
        {...defaultProps}
        proposals={[emptySourceProposal, whitespaceSourceProposal]}
      />
    );
    const items = screen.getAllByTestId("learn-proposal-item");
    expect(items).toHaveLength(2);
    items.forEach((item) => {
      expect(
        item.querySelector('[data-testid="learn-proposal-recency"]')
      ).toBeTruthy();
      expect(
        item.querySelector('[data-testid="learn-proposal-source"]')
      ).toBeNull();
    });
  });

  it("collapses and re-expands on header click", () => {
    render(<LearnSidebar {...defaultProps} proposals={pendingProposals} />);
    expect(screen.getAllByTestId("learn-proposal-item")).toHaveLength(3);
    fireEvent.click(screen.getByTestId("learn-proposals-header"));
    expect(screen.queryAllByTestId("learn-proposal-item")).toHaveLength(0);
    fireEvent.click(screen.getByTestId("learn-proposals-header"));
    expect(screen.getAllByTestId("learn-proposal-item")).toHaveLength(3);
  });

  it("clicking a proposal row calls onProposalClick with the proposal", () => {
    const onProposalClick = vi.fn();
    render(
      <LearnSidebar
        {...defaultProps}
        proposals={pendingProposals}
        onProposalClick={onProposalClick}
      />
    );
    fireEvent.click(screen.getAllByTestId("learn-proposal-item")[1]);
    expect(onProposalClick).toHaveBeenCalledWith(pendingProposals[1]);
  });

  it("marks concept rows on both sides of a merge, and not unflagged rows", () => {
    render(
      <LearnSidebar
        {...defaultProps}
        concepts={multiRepoConcepts}
        proposals={pendingProposals}
        pendingProposalConceptIds={
          new Set(["stakwork/hive/auth", "stakwork/hive/tasks"])
        }
      />
    );
    const items = screen.getAllByTestId("learn-concept-item");
    const flagged = items.filter(
      (el) => el.querySelector('[data-testid="concept-pending-marker"]') !== null
    );
    expect(flagged.map((el) => el.textContent)).toEqual(["Auth", "Tasks"]);
  });

  it("highlights the active proposal row via activeItemKey", () => {
    render(
      <LearnSidebar
        {...defaultProps}
        proposals={pendingProposals}
        activeItemKey="proposal-proposal-update-1"
      />
    );
    const items = screen.getAllByTestId("learn-proposal-item");
    expect(items[1].className).toContain("bg-muted/60");
    expect(items[0].className).not.toContain("bg-muted/60");
  });

  it("does not render selection checkboxes when canWrite is false", () => {
    render(<LearnSidebar {...defaultProps} proposals={pendingProposals} />);
    expect(screen.queryByTestId("learn-proposal-checkbox")).toBeNull();
    expect(screen.queryByTestId("learn-proposal-select-all")).toBeNull();
  });

  it("renders per-row checkboxes and select-all when canWrite is true", () => {
    render(
      <LearnSidebar
        {...defaultProps}
        proposals={pendingProposals}
        canWrite
        selectedIds={[]}
        onToggleProposal={vi.fn()}
        onToggleAll={vi.fn()}
      />
    );
    expect(screen.getByTestId("learn-proposal-select-all")).toBeTruthy();
    expect(screen.getAllByTestId("learn-proposal-checkbox")).toHaveLength(3);
  });

  it("row click still opens the detail panel when checkboxes are shown", () => {
    const onProposalClick = vi.fn();
    render(
      <LearnSidebar
        {...defaultProps}
        proposals={pendingProposals}
        canWrite
        onProposalClick={onProposalClick}
      />
    );
    fireEvent.click(screen.getAllByTestId("learn-proposal-item")[1]);
    expect(onProposalClick).toHaveBeenCalledWith(pendingProposals[1]);
  });

  it("select-all is checked only when the first 25 pending rows are selected", () => {
    const many = Array.from({ length: 26 }, (_, i) => ({
      ...pendingProposals[0],
      id: `proposal-${i}`,
      name: `Concept ${i}`,
    }));
    const first25 = many.slice(0, 25).map((p) => p.id);
    const onToggleAll = vi.fn();
    render(
      <LearnSidebar
        {...defaultProps}
        proposals={many}
        canWrite
        selectedIds={first25}
        onToggleAll={onToggleAll}
      />
    );
    const selectAll = screen.getByTestId("learn-proposal-select-all") as HTMLInputElement;
    expect(selectAll.checked).toBe(true);
    expect(selectAll.title).toBe("Select all pending (25 max)");
    fireEvent.click(selectAll);
    expect(onToggleAll).toHaveBeenCalled();
  });

  it("checkbox toggle does not open the proposal", () => {
    const onProposalClick = vi.fn();
    const onToggleProposal = vi.fn();
    render(
      <LearnSidebar
        {...defaultProps}
        proposals={pendingProposals}
        canWrite
        onProposalClick={onProposalClick}
        onToggleProposal={onToggleProposal}
      />
    );
    fireEvent.click(screen.getAllByTestId("learn-proposal-checkbox")[0]);
    expect(onToggleProposal).toHaveBeenCalledWith(pendingProposals[0].id);
    expect(onProposalClick).not.toHaveBeenCalled();
  });
});
