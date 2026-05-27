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

import { EditRequirementModal } from "@/components/evals/EditRequirementModal";
import { toast } from "sonner";

const REQUIREMENT = {
  ref_id: "req-1",
  node_type: "EvalRequirement",
  properties: {
    name: "Existing Req",
    description: "Existing req desc",
    prompt_snippet: "When asked to do X...",
    positive_cases: ["Does A", "Does B"],
    negative_cases: ["Fails to C"],
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

  it("pre-populates all fields from requirement.properties", () => {
    render(<EditRequirementModal {...defaultProps} />);

    const nameInput = screen.getByPlaceholderText("e.g. Correct auth handling") as HTMLInputElement;
    expect(nameInput.value).toBe("Existing Req");

    const descTextarea = screen.getByPlaceholderText("Optional description...") as HTMLTextAreaElement;
    expect(descTextarea.value).toBe("Existing req desc");

    const promptTextarea = screen.getByPlaceholderText(
      "The portion of the prompt being evaluated...",
    ) as HTMLTextAreaElement;
    expect(promptTextarea.value).toBe("When asked to do X...");

    const posTextarea = screen.getByPlaceholderText("The agent correctly...") as HTMLTextAreaElement;
    expect(posTextarea.value).toBe("Does A\nDoes B");

    const negTextarea = screen.getByPlaceholderText("The agent fails to...") as HTMLTextAreaElement;
    expect(negTextarea.value).toBe("Fails to C");
  });

  it("does not render when open=false", () => {
    render(<EditRequirementModal {...defaultProps} open={false} />);
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("shows validation error when name is cleared", async () => {
    render(<EditRequirementModal {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("e.g. Correct auth handling");
    await userEvent.clear(nameInput);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeTruthy();
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows validation error when positive_cases is cleared", async () => {
    render(<EditRequirementModal {...defaultProps} />);
    const posTextarea = screen.getByPlaceholderText("The agent correctly...");
    await userEvent.clear(posTextarea);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("At least one positive case is required")).toBeTruthy();
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows validation error when negative_cases is cleared", async () => {
    render(<EditRequirementModal {...defaultProps} />);
    const negTextarea = screen.getByPlaceholderText("The agent fails to...");
    await userEvent.clear(negTextarea);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("At least one negative case is required")).toBeTruthy();
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls PUT with correct URL and body on submit", async () => {
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
    expect(body.prompt_snippet).toBe("When asked to do X...");
    expect(body.positive_cases).toEqual(["Does A", "Does B"]);
    expect(body.negative_cases).toEqual(["Fails to C"]);
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

  it("splits multi-line cases correctly in the request body", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;

    const reqWithMultiline = {
      ...REQUIREMENT,
      properties: {
        ...REQUIREMENT.properties,
        positive_cases: ["Case one", "Case two"],
        negative_cases: ["Neg one"],
      },
    };
    render(<EditRequirementModal {...defaultProps} requirement={reqWithMultiline} />);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.positive_cases).toEqual(["Case one", "Case two"]);
  });
});
