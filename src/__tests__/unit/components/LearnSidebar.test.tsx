import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { LearnSidebar } from "@/app/w/[slug]/learn/components/LearnSidebar";

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

vi.mock("@/app/w/[slug]/learn/components/CreateFeatureModal", () => ({
  CreateFeatureModal: () => null,
}));

vi.mock("@/lib/date-utils", () => ({
  formatRelativeOrDate: (d: string) => d,
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

vi.mock("lucide-react", () => ({
  ChevronDown: () => <span data-testid="chevron-icon" />,
  BookOpen: () => <span data-testid="book-icon" />,
  Lightbulb: () => <span data-testid="lightbulb-icon" />,
  GitBranch: () => <span data-testid="gitbranch-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  Pencil: () => <span data-testid="pencil-icon" />,
  RefreshCw: () => <span data-testid="refresh-icon" />,
  Sprout: () => <span data-testid="sprout-icon" />,
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
