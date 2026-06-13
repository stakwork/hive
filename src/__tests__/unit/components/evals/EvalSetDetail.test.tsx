/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ slug: "test-ws" }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/evals/CreateRequirementModal", () => ({
  CreateRequirementModal: () => null,
}));

vi.mock("@/components/evals/CaptureEvalTriggerModal", () => ({
  CaptureEvalTriggerModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="capture-trigger-modal" /> : null,
}));

vi.mock("@/components/evals/EvalTriggerList", () => ({
  EvalTriggerList: ({ reqId }: { reqId: string }) => (
    <div data-testid={`eval-trigger-list-${reqId}`} />
  ),
}));

vi.mock("@/components/evals/EditRequirementModal", () => ({
  EditRequirementModal: ({
    open,
    requirement,
    onUpdated,
    onOpenChange,
  }: {
    open: boolean;
    requirement: { properties?: { name?: string }; ref_id: string };
    onUpdated: () => void;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="edit-req-modal">
        <span data-testid="edit-req-name">{String(requirement.properties?.name ?? "")}</span>
        <button data-testid="mock-save-req" onClick={onUpdated}>Save</button>
        <button data-testid="mock-close-req" onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : null,
}));

vi.mock("@/components/ui/action-menu", () => ({
  ActionMenu: ({
    actions,
  }: {
    actions: Array<{
      label: string;
      onClick?: () => void;
      confirmation?: { onConfirm: () => void };
    }>;
  }) => (
    <div data-testid="action-menu">
      {actions.map((action, i) => (
        <button
          key={i}
          data-testid={`req-action-${action.label.toLowerCase()}`}
          onClick={(e) => {
            e.stopPropagation();
            if (action.onClick) action.onClick();
            if (action.confirmation) action.confirmation.onConfirm();
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock("lucide-react", () => ({
  ArrowLeft: () => <span>←</span>,
  Zap: () => <span>⚡</span>,
  Pencil: () => <span>✏️</span>,
  Plus: () => <span>+</span>,
  Trash2: () => <span>🗑️</span>,
}));

import { EvalSetDetail } from "@/components/evals/EvalSetDetail";
import { toast } from "sonner";

const EVAL_SET = {
  ref_id: "eval-set-1",
  node_type: "EvalSet",
  properties: { name: "My Eval Set", description: "Test suite" },
};

const MOCK_REQUIREMENTS = [
  {
    ref_id: "req-1",
    node_type: "EvalRequirement",
    properties: {
      name: "Req Alpha",
      description: "First requirement",
      prompt_snippet: "When asked to...",
      desirable_cases: ["Does A", "Does B"],
      undesirable_cases: ["Does not C"],
      order: 0,
    },
  },
  {
    ref_id: "req-2",
    node_type: "EvalRequirement",
    properties: {
      name: "Req Beta",
      description: "Second requirement",
      prompt_snippet: "When instructed to...",
      desirable_cases: ["Does X"],
      undesirable_cases: ["Does not Y"],
      order: 1,
    },
  },
];

describe("EvalSetDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches from the correct requirements endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: [], total: 0 } }),
    });
    global.fetch = fetchMock as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const calledUrl: string = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe("/api/workspaces/test-ws/evals/eval-set-1/requirements");
    expect(calledUrl).not.toContain("?evalSetId=");
  });

  it("renders skeleton while loading", () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("renders empty state when no requirements are returned", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: [], total: 0 } }),
    }) as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/No requirements yet/)).toBeTruthy();
    });
  });

  it("renders requirement rows when requirements are returned", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_REQUIREMENTS, total: 2 } }),
    }) as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("requirement-row")).toHaveLength(2);
    });

    expect(screen.getByText("Req Alpha")).toBeTruthy();
    expect(screen.getByText("Req Beta")).toBeTruthy();
  });

  it("renders requirements sorted by order property", async () => {
    const reversedNodes = [...MOCK_REQUIREMENTS].reverse();
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: reversedNodes, total: 2 } }),
    }) as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("requirement-row")).toHaveLength(2);
    });

    const rows = screen.getAllByTestId("requirement-row");
    expect(rows[0].textContent).toContain("Req Alpha");
    expect(rows[1].textContent).toContain("Req Beta");
  });

  it("shows eval set name in header", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: [], total: 0 } }),
    }) as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("My Eval Set")).toBeTruthy();
    });
  });

  it("renders ActionMenu for each requirement row", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_REQUIREMENTS, total: 2 } }),
    }) as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("action-menu")).toHaveLength(2);
    });
  });

  it("opens EditRequirementModal with correct requirement when Edit is clicked", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_REQUIREMENTS, total: 2 } }),
    }) as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    await waitFor(() => expect(screen.getAllByTestId("requirement-row")).toHaveLength(2));

    const editButtons = screen.getAllByTestId("req-action-edit");
    await userEvent.click(editButtons[0]);

    expect(screen.getByTestId("edit-req-modal")).toBeTruthy();
    expect(screen.getByTestId("edit-req-name").textContent).toBe("Req Alpha");
  });

  it("re-fetches after requirement is updated and closes modal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_REQUIREMENTS, total: 2 } }),
    });
    global.fetch = fetchMock as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    await waitFor(() => expect(screen.getAllByTestId("requirement-row")).toHaveLength(2));

    await userEvent.click(screen.getAllByTestId("req-action-edit")[0]);
    await userEvent.click(screen.getByTestId("mock-save-req"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByTestId("edit-req-modal")).toBeNull();
  });

  it("calls DELETE API and refreshes list when Delete is confirmed", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ data: { nodes: MOCK_REQUIREMENTS, total: 2 } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }) // DELETE
      .mockResolvedValue({ json: async () => ({ data: { nodes: [MOCK_REQUIREMENTS[1]], total: 1 } }) });
    global.fetch = fetchMock as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    await waitFor(() => expect(screen.getAllByTestId("requirement-row")).toHaveLength(2));

    const deleteButtons = screen.getAllByTestId("req-action-delete");
    await userEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/test-ws/evals/eval-set-1/requirements/req-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Requirement deleted");
    });
  });

  it("shows error toast when DELETE requirement fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ data: { nodes: MOCK_REQUIREMENTS, total: 2 } }) })
      .mockResolvedValueOnce({ ok: false }); // DELETE fails
    global.fetch = fetchMock as any;

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);

    await waitFor(() => expect(screen.getAllByTestId("requirement-row")).toHaveLength(2));

    await userEvent.click(screen.getAllByTestId("req-action-delete")[0]);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to delete requirement");
    });
  });

  it("renders CaptureEvalTriggerModal (not LinkRunModal)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_REQUIREMENTS, total: 2 } }),
    });

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId("requirement-row")).toHaveLength(2));

    // Trigger the modal by clicking "Capture Trigger"
    const captureBtns = screen.getAllByText(/Capture Trigger/i);
    expect(captureBtns.length).toBeGreaterThan(0);
    await userEvent.click(captureBtns[0]);

    expect(screen.getByTestId("capture-trigger-modal")).toBeTruthy();
    // LinkRunModal should NOT be present at all
    expect(screen.queryByTestId("link-run-modal")).toBeNull();
  });

  it("does NOT render LinkRunModal anywhere", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_REQUIREMENTS, total: 2 } }),
    });

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId("requirement-row")).toHaveLength(2));

    expect(screen.queryByTestId("link-run-modal")).toBeNull();
    expect(screen.queryByText(/Link Run/i)).toBeNull();
  });

  it("mounts EvalTriggerList below each requirement row", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ data: { nodes: MOCK_REQUIREMENTS, total: 2 } }),
    });

    render(<EvalSetDetail evalSet={EVAL_SET} onBack={() => {}} />);
    await waitFor(() => expect(screen.getAllByTestId("requirement-row")).toHaveLength(2));

    expect(screen.getByTestId("eval-trigger-list-req-1")).toBeTruthy();
    expect(screen.getByTestId("eval-trigger-list-req-2")).toBeTruthy();
  });
});
