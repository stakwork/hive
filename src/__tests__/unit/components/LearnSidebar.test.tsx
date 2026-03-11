import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { LearnSidebar } from "@/app/w/[slug]/learn/components/LearnSidebar";

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

vi.mock("lucide-react", () => ({
  ChevronDown: () => <span data-testid="chevron-icon" />,
  BookOpen: () => <span data-testid="book-icon" />,
  Lightbulb: () => <span data-testid="lightbulb-icon" />,
  GitBranch: () => <span data-testid="gitbranch-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  Pencil: () => <span data-testid="pencil-icon" />,
}));

const diagram = {
  id: "diag-1",
  name: "Auth Flow",
  body: "graph TD\nA-->B",
  description: null,
};

const defaultProps = {
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
