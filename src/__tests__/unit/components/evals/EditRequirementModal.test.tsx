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

import { EditRequirementModal } from "@/components/evals/EditRequirementModal";
import { toast } from "sonner";

const NAME_PLACEHOLDER = "What should the agent always do?";
const REASON_PLACEHOLDER = "Why does this matter?";

const REQUIREMENT = {
  ref_id: "req-1",
  node_type: "EvalRequirement",
  properties: {
    name: "Existing Req",
    description: "Existing req desc",
    prompt_snippet: "When asked to do X...",
    desirable_cases: ["Does A", "Does B"],
    undesirable_cases: ["Fails to C"],
  },
};

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  evalSetId: "eval-set-1",
  requirement: REQUIREMENT,
  onUpdated: vi.fn(),
};

describe("EditRequirementModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
  });

  it("renders the dialog when open", () => {
    render(<EditRequirementModal {...defaultProps} />);
    expect(screen.getByTestId("dialog")).toBeTruthy();
    expect(screen.getByText("Edit Requirement")).toBeTruthy();
  });

  it("pre-populates name and reason from requirement.properties", () => {
    render(<EditRequirementModal {...defaultProps} />);

    const nameInput = screen.getByPlaceholderText(NAME_PLACEHOLDER) as HTMLTextAreaElement;
    expect(nameInput.value).toBe("Existing Req");

    const reasonInput = screen.getByPlaceholderText(REASON_PLACEHOLDER) as HTMLInputElement;
    expect(reasonInput.value).toBe("Existing req desc");
  });

  it("does not render when open=false", () => {
    render(<EditRequirementModal {...defaultProps} open={false} />);
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("shows validation error when the requirement is cleared", async () => {
    render(<EditRequirementModal {...defaultProps} />);
    await userEvent.clear(screen.getByPlaceholderText(NAME_PLACEHOLDER));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Requirement is required")).toBeTruthy();
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls PUT and preserves legacy prompt_snippet/example cases in the body", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }) as any;

    render(<EditRequirementModal {...defaultProps} />);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/workspaces/test-ws/evals/eval-set-1/requirements/req-1",
        expect.objectContaining({ method: "PUT" }),
      );
    });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.name).toBe("Existing Req");
    expect(body.description).toBe("Existing req desc");
    expect(body.prompt_snippet).toBe("When asked to do X...");
    expect(body.desirable_cases).toEqual(["Does A", "Does B"]);
    expect(body.undesirable_cases).toEqual(["Fails to C"]);
  });

  it("omits legacy fields when the requirement has none", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;

    const minimalReq = {
      ref_id: "req-2",
      node_type: "EvalRequirement",
      properties: { name: "Minimal", description: "why" },
    };
    render(<EditRequirementModal {...defaultProps} requirement={minimalReq} />);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.name).toBe("Minimal");
    expect(body.prompt_snippet).toBeUndefined();
    expect(body.desirable_cases).toBeUndefined();
    expect(body.undesirable_cases).toBeUndefined();
  });

  it("calls onUpdated and closes modal on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;

    render(<EditRequirementModal {...defaultProps} />);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Requirement updated");
      expect(defaultProps.onUpdated).toHaveBeenCalled();
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("shows error toast when request fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as any;

    render(<EditRequirementModal {...defaultProps} />);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to update requirement");
    });
    expect(defaultProps.onUpdated).not.toHaveBeenCalled();
  });
});
