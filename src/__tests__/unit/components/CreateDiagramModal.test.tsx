import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { CreateDiagramModal } from "@/app/w/[slug]/learn/components/CreateDiagramModal";

// Mock UI components
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, type, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} type={type} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}));

vi.mock("lucide-react", () => ({
  RefreshCw: () => <span data-testid="refresh-icon" />,
}));

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  workspaceSlug: "test-workspace",
  onDiagramCreated: vi.fn(),
};

describe("CreateDiagramModal — create mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("renders 'New Diagram' title", () => {
    render(<CreateDiagramModal {...defaultProps} />);
    expect(screen.getByTestId("dialog-title").textContent).toBe("New Diagram");
  });

  it("name field is enabled and editable", () => {
    render(<CreateDiagramModal {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("e.g., Authentication Flow");
    expect(nameInput).not.toBeDisabled();
  });

  it("prompt placeholder says 'generate'", () => {
    render(<CreateDiagramModal {...defaultProps} />);
    expect(
      screen.getByPlaceholderText("Describe the diagram you want to generate...")
    ).toBeTruthy();
  });

  it("calls POST /api/learnings/diagrams/create on submit", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "d1", name: "Test", body: "graph TD", groupId: "d1" }),
    });
    global.fetch = mockFetch;

    render(<CreateDiagramModal {...defaultProps} />);

    fireEvent.change(screen.getByPlaceholderText("e.g., Authentication Flow"), {
      target: { value: "Auth Flow" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Describe the diagram you want to generate..."),
      { target: { value: "Show login flow" } }
    );

    fireEvent.click(screen.getByText("Generate"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/learnings/diagrams/create",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            workspace: "test-workspace",
            name: "Auth Flow",
            prompt: "Show login flow",
          }),
        })
      );
    });
    expect(defaultProps.onDiagramCreated).toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});

describe("CreateDiagramModal — edit mode", () => {
  const editProps = {
    ...defaultProps,
    editMode: true,
    diagramId: "diagram-123",
    initialName: "Existing Diagram",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("renders 'Edit Diagram' title", () => {
    render(<CreateDiagramModal {...editProps} />);
    expect(screen.getByTestId("dialog-title").textContent).toBe("Edit Diagram");
  });

  it("name field is pre-filled with initialName and disabled", () => {
    render(<CreateDiagramModal {...editProps} />);
    const nameInput = screen.getByDisplayValue("Existing Diagram");
    expect(nameInput).toBeDisabled();
  });

  it("prompt placeholder says 'changes'", () => {
    render(<CreateDiagramModal {...editProps} />);
    expect(
      screen.getByPlaceholderText("Describe the changes you want to make...")
    ).toBeTruthy();
  });

  it("calls POST /api/learnings/diagrams/edit on submit", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "d2",
        name: "Existing Diagram",
        body: "graph TD\nA-->B",
        groupId: "diagram-123",
      }),
    });
    global.fetch = mockFetch;

    render(<CreateDiagramModal {...editProps} />);

    fireEvent.change(
      screen.getByPlaceholderText("Describe the changes you want to make..."),
      { target: { value: "Add a database node" } }
    );

    fireEvent.click(screen.getByText("Generate"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/learnings/diagrams/edit",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            workspace: "test-workspace",
            diagramId: "diagram-123",
            prompt: "Add a database node",
          }),
        })
      );
    });
    expect(editProps.onDiagramCreated).toHaveBeenCalled();
    expect(editProps.onClose).toHaveBeenCalled();
  });

  it("does NOT call the create endpoint in edit mode", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "d2" }),
    });
    global.fetch = mockFetch;

    render(<CreateDiagramModal {...editProps} />);

    fireEvent.change(
      screen.getByPlaceholderText("Describe the changes you want to make..."),
      { target: { value: "Some change" } }
    );
    fireEvent.click(screen.getByText("Generate"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    const calledUrl = (mockFetch.mock.calls[0] as [string, ...unknown[]])[0];
    expect(calledUrl).not.toContain("create");
    expect(calledUrl).toContain("edit");
  });
});
