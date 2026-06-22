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

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
}));

import { CreateRequirementModal } from "@/components/evals/CreateRequirementModal";
import { toast } from "sonner";

const NAME_PLACEHOLDER = "What should the agent always do?";
const REASON_PLACEHOLDER = "Why does this matter?";

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  evalSetId: "eval-set-1",
  order: 0,
  onCreated: vi.fn(),
};

describe("CreateRequirementModal — name + reason", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
  });

  it("renders the form when open", () => {
    render(<CreateRequirementModal {...defaultProps} />);
    expect(screen.getByTestId("dialog")).toBeTruthy();
    expect(screen.getByPlaceholderText(NAME_PLACEHOLDER)).toBeTruthy();
    expect(screen.getByPlaceholderText(REASON_PLACEHOLDER)).toBeTruthy();
  });

  it("blocks submission when the requirement is empty", async () => {
    render(<CreateRequirementModal {...defaultProps} />);

    await userEvent.click(screen.getByRole("button", { name: "Add Requirement" }));

    await waitFor(() => {
      expect(screen.getByText("Requirement is required")).toBeTruthy();
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("submits with only a name (reason omitted)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { ref_id: "new-req-1" } }),
    }) as any;

    render(<CreateRequirementModal {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), "My req");
    await userEvent.click(screen.getByRole("button", { name: "Add Requirement" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/workspaces/test-ws/evals/eval-set-1/requirements",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(callBody.name).toBe("My req");
    expect(callBody.description).toBeUndefined();
    expect(callBody.order).toBe(0);

    expect(toast.success).toHaveBeenCalledWith("Requirement added");
    expect(defaultProps.onCreated).toHaveBeenCalled();
  });

  it("includes the reason as description when provided", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    }) as any;

    render(<CreateRequirementModal {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), "My req");
    await userEvent.type(screen.getByPlaceholderText(REASON_PLACEHOLDER), "It matters");
    await userEvent.click(screen.getByRole("button", { name: "Add Requirement" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(callBody.description).toBe("It matters");
  });

  it("shows error toast when request fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as any;

    render(<CreateRequirementModal {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), "My req");
    await userEvent.click(screen.getByRole("button", { name: "Add Requirement" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to add requirement");
    });
  });
});
