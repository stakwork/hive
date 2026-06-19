/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// Mock hooks
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ slug: "test-ws", workspace: { swarmUrl: "https://swarm.test" } }),
}));

vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: (v: unknown) => v,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Mock child components so we can test EvalDashboard in isolation
vi.mock("@/components/evals/EvalSetRow", () => ({
  EvalSetRow: ({
    evalSet,
    onClick,
    onEdit,
    onDelete,
  }: {
    evalSet: { properties?: { name?: string }; ref_id: string };
    onClick: () => void;
    onEdit: () => void;
    onDelete: () => void;
  }) => (
    <tr data-testid="eval-set-row" onClick={onClick}>
      <td>{String(evalSet.properties?.name ?? evalSet.ref_id)}</td>
      <td>
        <button data-testid={`edit-${evalSet.ref_id}`} onClick={(e) => { e.stopPropagation(); onEdit(); }}>
          Edit
        </button>
        <button data-testid={`delete-${evalSet.ref_id}`} onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          Delete
        </button>
      </td>
    </tr>
  ),
}));

vi.mock("@/components/evals/EvalSetDetail", () => ({
  EvalSetDetail: ({ evalSet, onBack }: { evalSet: { properties?: { name?: string } }; onBack: () => void }) => (
    <div data-testid="eval-set-detail">
      <button data-testid="back-btn" onClick={onBack}>Back</button>
      <span>{String(evalSet.properties?.name ?? "")}</span>
    </div>
  ),
}));

vi.mock("@/components/evals/CreateEvalSetModal", () => ({
  CreateEvalSetModal: ({ open, onCreated }: { open: boolean; onCreated: () => void }) =>
    open ? (
      <div data-testid="create-modal">
        <button data-testid="mock-create" onClick={onCreated}>Create</button>
      </div>
    ) : null,
}));

vi.mock("@/components/evals/EditEvalSetModal", () => ({
  EditEvalSetModal: ({
    open,
    evalSet,
    onUpdated,
    onOpenChange,
  }: {
    open: boolean;
    evalSet: { properties?: { name?: string } };
    onUpdated: () => void;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="edit-modal">
        <span data-testid="edit-modal-name">{String(evalSet.properties?.name ?? "")}</span>
        <button data-testid="mock-save" onClick={onUpdated}>Save</button>
        <button data-testid="mock-close" onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, size, ...props }: any) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: any) => <div data-testid="skeleton" className={className} />,
}));

vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: any) => <table>{children}</table>,
  TableHeader: ({ children, className }: any) => <thead className={className}>{children}</thead>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableRow: ({ children, className, onClick, "data-testid": testId }: any) => (
    <tr className={className} onClick={onClick} data-testid={testId}>{children}</tr>
  ),
  TableHead: ({ children, className }: any) => <th className={className}>{children}</th>,
  TableCell: ({ children, className, colSpan, onClick }: any) => (
    <td className={className} colSpan={colSpan} onClick={onClick}>{children}</td>
  ),
}));

vi.mock("lucide-react", () => ({
  Plus: () => <span>+</span>,
  Search: () => <span>search-icon</span>,
  X: () => <span>x-icon</span>,
}));

import { EvalDashboard } from "@/components/evals/EvalDashboard";
import { toast } from "sonner";

const MOCK_NODES = [
  { ref_id: "eval-1", node_type: "EvalSet", properties: { name: "Code Quality Evals", description: "desc1" } },
  { ref_id: "eval-2", node_type: "EvalSet", properties: { name: "Agent Accuracy Suite", description: "desc2" } },
];

describe("EvalDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows skeleton rows while loading", async () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any;

    render(<EvalDashboard />);

    const skeletons = screen.getAllByTestId("skeleton");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows empty state when no eval sets exist", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: [], total: 0 } }),
    }) as any;

    render(<EvalDashboard />);

    await waitFor(() => {
      expect(screen.getByText("No eval sets yet — create one to get started")).toBeTruthy();
    });
  });

  it("renders eval set rows when nodes are returned", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_NODES, total: 2 } }),
    }) as any;

    render(<EvalDashboard />);

    await waitFor(() => {
      expect(screen.getAllByTestId("eval-set-row")).toHaveLength(2);
    });
    expect(screen.getByText("Code Quality Evals")).toBeTruthy();
    expect(screen.getByText("Agent Accuracy Suite")).toBeTruthy();
  });

  it("navigates to detail view when a row is clicked", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_NODES, total: 2 } }),
    }) as any;

    render(<EvalDashboard />);

    await waitFor(() => {
      expect(screen.getAllByTestId("eval-set-row")).toHaveLength(2);
    });

    const firstRow = screen.getAllByTestId("eval-set-row")[0];
    await userEvent.click(firstRow);

    expect(screen.getByTestId("eval-set-detail")).toBeTruthy();
    expect(screen.queryByTestId("eval-set-row")).toBeNull();
  });

  it("returns to table when back button is clicked in detail view", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_NODES, total: 2 } }),
    }) as any;

    render(<EvalDashboard />);

    await waitFor(() => {
      expect(screen.getAllByTestId("eval-set-row")).toHaveLength(2);
    });

    await userEvent.click(screen.getAllByTestId("eval-set-row")[0]);
    expect(screen.getByTestId("eval-set-detail")).toBeTruthy();

    await userEvent.click(screen.getByTestId("back-btn"));
    await waitFor(() => {
      expect(screen.getAllByTestId("eval-set-row")).toHaveLength(2);
    });
  });

  it("opens create modal on 'New Eval Set' button click", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: [], total: 0 } }),
    }) as any;

    render(<EvalDashboard />);

    await waitFor(() =>
      screen.getByText("No eval sets yet — create one to get started")
    );

    const newBtn = screen.getByText(/New Eval Set/);
    await userEvent.click(newBtn);

    expect(screen.getByTestId("create-modal")).toBeTruthy();
  });

  it("re-fetches after a new eval set is created", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ data: { nodes: [], total: 0 } }) })
      .mockResolvedValue({ json: async () => ({ data: { nodes: MOCK_NODES, total: 2 } }) });
    global.fetch = fetchMock as any;

    render(<EvalDashboard />);

    await waitFor(() =>
      screen.getByText("No eval sets yet — create one to get started")
    );

    await userEvent.click(screen.getByText(/New Eval Set/));
    await userEvent.click(screen.getByTestId("mock-create"));

    await waitFor(() => {
      expect(screen.getAllByTestId("eval-set-row")).toHaveLength(2);
    });
  });

  it("opens EditEvalSetModal with the correct eval set when Edit is clicked", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_NODES, total: 2 } }),
    }) as any;

    render(<EvalDashboard />);

    await waitFor(() => expect(screen.getAllByTestId("eval-set-row")).toHaveLength(2));

    await userEvent.click(screen.getByTestId("edit-eval-1"));

    expect(screen.getByTestId("edit-modal")).toBeTruthy();
    expect(screen.getByTestId("edit-modal-name").textContent).toBe("Code Quality Evals");
  });

  it("re-fetches after eval set is updated and closes modal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_NODES, total: 2 } }),
    });
    global.fetch = fetchMock as any;

    render(<EvalDashboard />);

    await waitFor(() => expect(screen.getAllByTestId("eval-set-row")).toHaveLength(2));

    await userEvent.click(screen.getByTestId("edit-eval-1"));
    await userEvent.click(screen.getByTestId("mock-save"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByTestId("edit-modal")).toBeNull();
  });

  it("calls DELETE API and refreshes list when Delete is confirmed", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ data: { nodes: MOCK_NODES, total: 2 } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }) // DELETE
      .mockResolvedValue({ json: async () => ({ data: { nodes: [MOCK_NODES[1]], total: 1 } }) }); // re-fetch
    global.fetch = fetchMock as any;

    render(<EvalDashboard />);

    await waitFor(() => expect(screen.getAllByTestId("eval-set-row")).toHaveLength(2));

    await userEvent.click(screen.getByTestId("delete-eval-1"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/test-ws/evals/eval-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Eval set deleted");
    });
  });

  it("shows error toast when DELETE fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ data: { nodes: MOCK_NODES, total: 2 } }) })
      .mockResolvedValueOnce({ ok: false }); // DELETE fails
    global.fetch = fetchMock as any;

    render(<EvalDashboard />);

    await waitFor(() => expect(screen.getAllByTestId("eval-set-row")).toHaveLength(2));

    await userEvent.click(screen.getByTestId("delete-eval-1"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to delete eval set");
    });
  });

  it("search filters rows client-side by name", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_NODES, total: 2 } }),
    }) as any;

    render(<EvalDashboard />);

    await waitFor(() => expect(screen.getAllByTestId("eval-set-row")).toHaveLength(2));

    const searchInput = screen.getByPlaceholderText("Search eval sets...");
    await userEvent.type(searchInput, "Code");

    await waitFor(() => {
      expect(screen.getAllByTestId("eval-set-row")).toHaveLength(1);
      expect(screen.getByText("Code Quality Evals")).toBeTruthy();
      expect(screen.queryByText("Agent Accuracy Suite")).toBeNull();
    });
  });

  it("clears search and restores all rows when X is clicked", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_NODES, total: 2 } }),
    }) as any;

    render(<EvalDashboard />);

    await waitFor(() => expect(screen.getAllByTestId("eval-set-row")).toHaveLength(2));

    const searchInput = screen.getByPlaceholderText("Search eval sets...");
    await userEvent.type(searchInput, "Code");

    await waitFor(() => expect(screen.getAllByTestId("eval-set-row")).toHaveLength(1));

    // Click the X clear button
    const clearBtn = screen.getByText("x-icon").closest("button")!;
    await userEvent.click(clearBtn);

    await waitFor(() => expect(screen.getAllByTestId("eval-set-row")).toHaveLength(2));
  });

  it("shows 'No eval sets match your search' when search yields no results", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_NODES, total: 2 } }),
    }) as any;

    render(<EvalDashboard />);

    await waitFor(() => expect(screen.getAllByTestId("eval-set-row")).toHaveLength(2));

    const searchInput = screen.getByPlaceholderText("Search eval sets...");
    await userEvent.type(searchInput, "zzznomatch");

    await waitFor(() => {
      expect(screen.getByText("No eval sets match your search")).toBeTruthy();
    });
  });
});
