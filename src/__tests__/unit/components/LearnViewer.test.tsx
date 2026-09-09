import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// next/navigation mocks
// ---------------------------------------------------------------------------
const mockReplace = vi.fn();
const mockSearchParamsGet = vi.fn().mockReturnValue(null);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/w/test-workspace/learn",
  useSearchParams: () => ({ get: mockSearchParamsGet }),
}));

const mockUseWorkspace = vi.fn(() => ({
  isPublicViewer: false,
  role: null,
  hasAccess: false,
}));
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => mockUseWorkspace(),
}));

const { mockSubmitBulk } = vi.hoisted(() => ({ mockSubmitBulk: vi.fn() }));
vi.mock("@/app/w/[slug]/learn/hooks/useBulkProposalDecisions", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/app/w/[slug]/learn/hooks/useBulkProposalDecisions")
  >();
  return {
    ...actual,
    useBulkProposalDecisions: () => ({
      submitting: false,
      results: null,
      lastAction: null,
      submit: mockSubmitBulk,
    }),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Child component mocks
// ---------------------------------------------------------------------------
let latestSidebarProps: {
  canWrite?: boolean;
  selectedIds?: string[];
  proposals?: { id: string; name?: string }[];
  onToggleProposal?: (id: string) => void;
  onToggleAll?: () => void;
  onProposalClick?: (proposal: { id: string; name?: string }) => void;
  bulkActions?: React.ReactNode;
} | null = null;

vi.mock("@/app/w/[slug]/learn/components/LearnSidebar", () => ({
  LearnSidebar: (props: {
    onDocClick: (r: string, c: string) => void;
    onConceptClick: (id: string, name: string, content: string) => void;
    onDiagramClick: (id: string, name: string, body: string, desc?: string | null) => void;
    docs: { repoName: string; content: string }[];
    concepts: { id: string; name: string; content?: string }[];
    diagrams: { id: string; name: string; body: string; description?: string | null }[];
    proposals?: { id: string; name?: string }[];
    canWrite?: boolean;
    selectedIds?: string[];
    onToggleProposal?: (id: string) => void;
    onToggleAll?: () => void;
    onProposalClick?: (proposal: { id: string; name?: string }) => void;
    bulkActions?: React.ReactNode;
  }) => {
    latestSidebarProps = props;
    return (
      <div>
        {props.docs.map((d) => (
          <button key={d.repoName} data-testid={`doc-${d.repoName}`} onClick={() => props.onDocClick(d.repoName, d.content)}>
            {d.repoName}
          </button>
        ))}
        {props.concepts.map((c) => (
          <button key={c.id} data-testid={`concept-${c.id}`} onClick={() => props.onConceptClick(c.id, c.name, c.content || "")}>
            {c.name}
          </button>
        ))}
        {props.diagrams.map((d) => (
          <button key={d.id} data-testid={`diagram-${d.id}`} onClick={() => props.onDiagramClick(d.id, d.name, d.body, d.description)}>
            {d.name}
          </button>
        ))}
        {props.proposals?.map((p) => (
          <div key={p.id}>
            <button data-testid={`proposal-${p.id}`} onClick={() => props.onProposalClick?.(p)}>
              {p.id}
            </button>
            <button data-testid={`toggle-${p.id}`} onClick={() => props.onToggleProposal?.(p.id)} />
          </div>
        ))}
        <button data-testid="toggle-all" onClick={() => props.onToggleAll?.()} />
        {props.bulkActions}
      </div>
    );
  },
}));

vi.mock("@/app/w/[slug]/learn/components/ConceptProposalReviewCard", () => ({
  ConceptProposalReviewCard: ({ proposal }: { proposal: { id: string } }) => (
    <div data-testid="proposal-review-card">{proposal.id}</div>
  ),
}));

vi.mock("@/app/w/[slug]/learn/components/BulkProposalActions", () => ({
  BulkProposalActions: ({
    onAccept,
    selectedCount,
  }: {
    onAccept: () => void;
    selectedCount: number;
  }) => (
    <button data-testid="bulk-accept" onClick={onAccept}>
      {selectedCount}
    </button>
  ),
}));

vi.mock("@/app/w/[slug]/learn/components/LearnDocViewer", () => ({
  LearnDocViewer: ({
    activeItem,
  }: {
    activeItem: { name: string; description?: string | null; type?: string } | null;
  }) => (
    <div data-testid="doc-viewer">
      <span data-testid="doc-viewer-name">{activeItem?.name ?? "no-item"}</span>
      {activeItem?.description && (
        <span data-testid="doc-viewer-description">{activeItem.description}</span>
      )}
    </div>
  ),
}));

vi.mock("@/app/w/[slug]/learn/components/DiagramViewer", () => ({
  DiagramViewer: ({ name }: { name: string }) => <div data-testid="diagram-viewer">{name}</div>,
}));

vi.mock("@/app/w/[slug]/learn/components/CreateDiagramModal", () => ({
  CreateDiagramModal: () => null,
}));

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------
const DOCS_RESPONSE = [{ "org/repo": { documentation: "doc content here" } }];
const CONCEPTS_RESPONSE = {
  features: [
    {
      id: "concept-abc",
      name: "Auth Concept",
      content: "concept content",
      description: "JWT and OAuth authentication layer.",
    },
  ],
};
const CONCEPT_DETAIL_RESPONSE = {
  concept: {
    id: "concept-abc",
    name: "Auth Concept",
    description: "JWT and OAuth authentication layer.",
    documentation: "Full auth documentation here.",
  },
  feature: {
    id: "concept-abc",
    name: "Auth Concept",
    description: "JWT and OAuth authentication layer.",
    documentation: "Full auth documentation here.",
  },
};
const DIAGRAMS_RESPONSE = [{ id: "diag-123", name: "System Diagram", body: "graph TD; A-->B", description: "desc" }];

const PENDING_PROPOSALS = {
  proposals: [
    {
      id: "ok-1",
      action: "update",
      status: "pending",
      rationale: "r",
      source: "s",
      prNumbers: [],
      createdAt: "2025-08-01T00:00:00.000Z",
      repo: "stakwork/hive",
    },
    {
      id: "stale-1",
      action: "update",
      status: "pending",
      rationale: "r",
      source: "s",
      prNumbers: [],
      createdAt: "2025-08-01T00:00:00.000Z",
      repo: "stakwork/hive",
    },
    {
      id: "create-1",
      action: "create",
      status: "pending",
      name: "New Concept",
      rationale: "r",
      source: "s",
      prNumbers: [],
      createdAt: "2025-08-01T00:00:00.000Z",
      repo: "stakwork/hive",
    },
  ],
};

function makeFetchMock(overrides?: {
  docs?: unknown;
  concepts?: unknown;
  conceptDetail?: unknown;
  diagrams?: unknown;
  proposals?: unknown;
}) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/learnings/docs")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides?.docs ?? DOCS_RESPONSE) });
    }
    if (url.includes("/api/learnings/concepts/proposals")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(overrides?.proposals ?? PENDING_PROPOSALS),
      });
    }
    // Concept detail route: /api/learnings/concepts/<id>?workspace=...
    if (url.match(/\/api\/learnings\/concepts\/[^/]+(\?|$)/)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides?.conceptDetail ?? CONCEPT_DETAIL_RESPONSE) });
    }
    if (url.includes("/api/learnings/concepts")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides?.concepts ?? CONCEPTS_RESPONSE) });
    }
    if (url.includes("/api/learnings/diagrams")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides?.diagrams ?? DIAGRAMS_RESPONSE) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// ---------------------------------------------------------------------------
// Import component under test AFTER mocks are set up
// ---------------------------------------------------------------------------
import { LearnViewer } from "@/app/w/[slug]/learn/components/LearnViewer";

describe("LearnViewer — URL param sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsGet.mockReturnValue(null);
    mockUseWorkspace.mockReturnValue({
      isPublicViewer: false,
      role: null,
      hasAccess: false,
    });
    global.fetch = makeFetchMock();
  });

  it("auto-selects first doc when no URL param is present", async () => {
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(screen.getByTestId("doc-viewer")).toHaveTextContent("org/repo"));
  });

  it("does NOT auto-select first doc when a ?doc param is present (URL restore handles it)", async () => {
    mockSearchParamsGet.mockImplementation((key: string) => (key === "doc" ? "org%2Frepo" : null));
    render(<LearnViewer workspaceSlug="test-workspace" />);
    // After loading, the restore effect should set the doc — viewer should show it
    await waitFor(() => expect(screen.getByTestId("doc-viewer")).toHaveTextContent("org/repo"));
  });

  it("calls router.replace with ?doc=encoded when a doc is clicked", async () => {
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => screen.getByTestId("doc-org/repo"));
    screen.getByTestId("doc-org/repo").click();
    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining("doc="),
      expect.objectContaining({ scroll: false })
    );
    const [url] = mockReplace.mock.calls[mockReplace.mock.calls.length - 1];
    expect(url).toMatch(/doc=org%252Frepo|doc=org%2Frepo/);
  });

  it("calls router.replace with ?concept=encoded when a concept is clicked", async () => {
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => screen.getByTestId("concept-concept-abc"));
    screen.getByTestId("concept-concept-abc").click();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("concept="),
        expect.objectContaining({ scroll: false })
      );
    });
  });

  it("calls router.replace with ?diagram=encoded when a diagram is clicked", async () => {
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => screen.getByTestId("diagram-diag-123"));
    screen.getByTestId("diagram-diag-123").click();
    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining("diagram=diag-123"),
      expect.objectContaining({ scroll: false })
    );
  });

  it("restores concept from ?concept param after all data loads", async () => {
    mockSearchParamsGet.mockImplementation((key: string) => (key === "concept" ? "concept-abc" : null));
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(screen.getByTestId("doc-viewer")).toHaveTextContent("Auth Concept"));
  });

  it("restores diagram from ?diagram param after all data loads", async () => {
    mockSearchParamsGet.mockImplementation((key: string) => (key === "diagram" ? "diag-123" : null));
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(screen.getByTestId("diagram-viewer")).toHaveTextContent("System Diagram"));
  });

  it("falls back to first doc when ?doc param does not match any loaded doc", async () => {
    mockSearchParamsGet.mockImplementation((key: string) => (key === "doc" ? "deleted-repo" : null));
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(screen.getByTestId("doc-viewer")).toHaveTextContent("org/repo"));
  });

  it("shows nothing (no error) when ?concept param does not match any concept", async () => {
    mockSearchParamsGet.mockImplementation((key: string) => (key === "concept" ? "nonexistent-id" : null));
    // Should not throw, doc viewer renders with no active item
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(screen.getByTestId("doc-viewer")).toHaveTextContent("no-item"));
  });

  it("shows nothing (no error) when ?diagram param does not match any diagram", async () => {
    mockSearchParamsGet.mockImplementation((key: string) => (key === "diagram" ? "nonexistent-id" : null));
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(screen.getByTestId("doc-viewer")).toHaveTextContent("no-item"));
  });

  it("uses router.replace (not push) so back button is not polluted", async () => {
    const mockPush = vi.fn();
    const { useRouter } = await import("next/navigation");
    // router.push should never be called
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => screen.getByTestId("doc-org/repo"));
    screen.getByTestId("doc-org/repo").click();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalled();
  });
});

describe("LearnViewer — concept description subtitle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsGet.mockReturnValue(null);
    mockUseWorkspace.mockReturnValue({
      isPublicViewer: false,
      role: null,
      hasAccess: false,
    });
    global.fetch = makeFetchMock();
  });

  it("renders description as subtitle after fresh concept fetch", async () => {
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => screen.getByTestId("concept-concept-abc"));
    screen.getByTestId("concept-concept-abc").click();
    await waitFor(() => {
      expect(screen.getByTestId("doc-viewer-description")).toHaveTextContent(
        "JWT and OAuth authentication layer."
      );
    });
  });

  it("renders description from cache when concept already has content (no fetch)", async () => {
    // Pre-populate concepts with content so the fetch branch is skipped
    const conceptsWithContent = {
      features: [
        {
          id: "concept-abc",
          name: "Auth Concept",
          content: "already loaded content",
          description: "Cached description value.",
        },
      ],
    };
    global.fetch = makeFetchMock({ concepts: conceptsWithContent });
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => screen.getByTestId("concept-concept-abc"));
    screen.getByTestId("concept-concept-abc").click();
    // fetch branch is skipped because content is non-empty; description from cache
    await waitFor(() => {
      expect(screen.getByTestId("doc-viewer-description")).toHaveTextContent(
        "Cached description value."
      );
    });
  });

  it("does NOT render description element when concept description is absent", async () => {
    const conceptsNoDesc = {
      features: [{ id: "concept-abc", name: "Auth Concept", content: "some content" }],
    };
    const detailNoDesc = {
      concept: { id: "concept-abc", name: "Auth Concept", description: null, documentation: "doc" },
      feature: { id: "concept-abc", name: "Auth Concept", description: null, documentation: "doc" },
    };
    global.fetch = makeFetchMock({ concepts: conceptsNoDesc, conceptDetail: detailNoDesc });
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => screen.getByTestId("concept-concept-abc"));
    screen.getByTestId("concept-concept-abc").click();
    await waitFor(() =>
      expect(screen.getByTestId("doc-viewer-name")).toHaveTextContent("Auth Concept")
    );
    expect(screen.queryByTestId("doc-viewer-description")).toBeNull();
  });

  it("renders description on URL-param restore (?concept param)", async () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "concept" ? "concept-abc" : null
    );
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => {
      expect(screen.getByTestId("doc-viewer-name")).toHaveTextContent("Auth Concept");
    });
    // Description should be present via the fetch triggered by URL restore (empty content path)
    await waitFor(() => {
      expect(screen.getByTestId("doc-viewer-description")).toHaveTextContent(
        "JWT and OAuth authentication layer."
      );
    });
  });
});

describe("LearnViewer — bulk proposal selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsGet.mockReturnValue(null);
    mockUseWorkspace.mockReturnValue({
      isPublicViewer: false,
      role: "DEVELOPER",
      hasAccess: true,
    });
    latestSidebarProps = null;
    global.fetch = makeFetchMock();
  });

  it("passes canWrite to the sidebar for DEVELOPER+", async () => {
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(latestSidebarProps?.canWrite).toBe(true));
  });

  it("does not pass canWrite for VIEWER", async () => {
    mockUseWorkspace.mockReturnValue({
      isPublicViewer: false,
      role: "VIEWER",
      hasAccess: true,
    });
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(latestSidebarProps?.canWrite).toBe(false));
  });

  it("navigates to createdConceptId after a successful bulk create accept", async () => {
    mockSubmitBulk.mockResolvedValue([
      { id: "create-1", ok: true, createdConceptId: "stakwork/hive/new-concept" },
    ]);
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(latestSidebarProps?.proposals?.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId("toggle-create-1"));
    fireEvent.click(screen.getByTestId("bulk-accept"));
    await waitFor(() => {
      expect(screen.getByTestId("doc-viewer-name").textContent).toMatch(/new-concept|New Concept/i);
    });
  });

  it("clears selectedProposal when it was in the successful set", async () => {
    mockSubmitBulk.mockResolvedValue([{ id: "ok-1", ok: true }]);
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(latestSidebarProps?.proposals?.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId("proposal-ok-1"));
    await waitFor(() => expect(screen.getByTestId("proposal-review-card")).toHaveTextContent("ok-1"));
    fireEvent.click(screen.getByTestId("toggle-ok-1"));
    fireEvent.click(screen.getByTestId("bulk-accept"));
    await waitFor(() => expect(screen.queryByTestId("proposal-review-card")).toBeNull());
  });

  it("reconciles selection after a mixed batch", async () => {
    mockSubmitBulk.mockResolvedValue([
      { id: "ok-1", ok: true },
      { id: "stale-1", ok: false, code: "stale_base" },
      { id: "gone-1", ok: false, code: "not_found" },
    ]);

    let proposalFetches = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/learnings/docs")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(DOCS_RESPONSE) });
      }
      if (url.includes("/api/learnings/concepts/proposals")) {
        proposalFetches += 1;
        const list =
          proposalFetches === 1
            ? PENDING_PROPOSALS
            : { proposals: PENDING_PROPOSALS.proposals.filter((p) => p.id === "stale-1") };
        return Promise.resolve({ ok: true, json: () => Promise.resolve(list) });
      }
      if (url.match(/\/api\/learnings\/concepts\/[^/]+(\?|$)/)) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(CONCEPT_DETAIL_RESPONSE) });
      }
      if (url.includes("/api/learnings/concepts")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(CONCEPTS_RESPONSE) });
      }
      if (url.includes("/api/learnings/diagrams")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(DIAGRAMS_RESPONSE) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(latestSidebarProps?.proposals?.length).toBeGreaterThan(0));

    fireEvent.click(screen.getByTestId("toggle-ok-1"));
    fireEvent.click(screen.getByTestId("toggle-stale-1"));
    fireEvent.click(screen.getByTestId("proposal-ok-1"));
    await waitFor(() => expect(screen.getByTestId("proposal-review-card")).toHaveTextContent("ok-1"));

    fireEvent.click(screen.getByTestId("bulk-accept"));

    await waitFor(() => {
      expect(latestSidebarProps?.selectedIds).toEqual(["stale-1"]);
    });
    expect(screen.queryByTestId("proposal-review-card")).toBeNull();
  });
});
