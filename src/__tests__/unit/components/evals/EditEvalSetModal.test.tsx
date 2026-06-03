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

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, type, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} type={type ?? "button"} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: ({ onChange, value, id, placeholder, rows }: any) => (
    <textarea id={id} value={value} onChange={onChange} placeholder={placeholder} rows={rows} />
  ),
}));

import { EditEvalSetModal } from "@/components/evals/EditEvalSetModal";
import { toast } from "sonner";

const EVAL_SET = {
  ref_id: "eval-set-1",
  node_type: "EvalSet",
  properties: {
    name: "Existing Eval Set",
    description: "Existing description",
  },
};

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  evalSet: EVAL_SET,
  onUpdated: vi.fn(),
};

describe("EditEvalSetModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
  });

  it("renders the dialog when open", () => {
    render(<EditEvalSetModal {...defaultProps} />);
    expect(screen.getByTestId("dialog")).toBeTruthy();
    expect(screen.getByText("Edit Eval Set")).toBeTruthy();
  });

  it("pre-populates name and description from evalSet.properties", () => {
    render(<EditEvalSetModal {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("e.g. Code Quality Evals") as HTMLInputElement;
    expect(nameInput.value).toBe("Existing Eval Set");
    const descTextarea = screen.getByPlaceholderText("Optional description...") as HTMLTextAreaElement;
    expect(descTextarea.value).toBe("Existing description");
  });

  it("does not render when open=false", () => {
    render(<EditEvalSetModal {...defaultProps} open={false} />);
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("blocks submission when name is empty", async () => {
    render(<EditEvalSetModal {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("e.g. Code Quality Evals");
    await userEvent.clear(nameInput);

    const saveBtn = screen.getByRole("button", { name: "Save" });
    expect(saveBtn).toBeDisabled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls PUT with correct URL and body on submit", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }) as any;

    render(<EditEvalSetModal {...defaultProps} />);

    const nameInput = screen.getByPlaceholderText("e.g. Code Quality Evals");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Updated Name");

    const descTextarea = screen.getByPlaceholderText("Optional description...");
    await userEvent.clear(descTextarea);
    await userEvent.type(descTextarea, "Updated desc");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/workspaces/test-ws/evals/eval-set-1",
        expect.objectContaining({
          method: "PUT",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.name).toBe("Updated Name");
    expect(body.description).toBe("Updated desc");
  });

  it("calls onUpdated and closes modal on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }) as any;

    render(<EditEvalSetModal {...defaultProps} />);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Eval set updated");
      expect(defaultProps.onUpdated).toHaveBeenCalled();
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("shows error toast when request fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as any;

    render(<EditEvalSetModal {...defaultProps} />);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to update eval set");
    });
    expect(defaultProps.onUpdated).not.toHaveBeenCalled();
  });

  it("omits description from request body when empty", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;

    const evalSetNoDesc = { ...EVAL_SET, properties: { name: "My Set" } };
    render(<EditEvalSetModal {...defaultProps} evalSet={evalSetNoDesc} />);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.description).toBeUndefined();
  });
});
