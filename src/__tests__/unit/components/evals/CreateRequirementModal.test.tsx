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

// Mock TagInput: renders a plain input; pressing Enter calls onChange([...items, value])
vi.mock("@/components/ui/tag-input", () => ({
  TagInput: ({ items, onChange, placeholder, error }: any) => (
    <div>
      <input
        data-testid={`tag-input-${placeholder}`}
        placeholder={placeholder}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const val = (e.currentTarget as HTMLInputElement).value.trim();
            if (val) onChange([...items, val]);
            (e.currentTarget as HTMLInputElement).value = "";
          }
        }}
      />
      {error && <p>{error}</p>}
    </div>
  ),
}));

import { CreateRequirementModal } from "@/components/evals/CreateRequirementModal";
import { toast } from "sonner";

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  evalSetId: "eval-set-1",
  order: 0,
  onCreated: vi.fn(),
};

/** Helper: type into a TagInput mock and press Enter to add a chip */
async function addTagItem(placeholder: string, value: string) {
  const input = screen.getByTestId(`tag-input-${placeholder}`);
  await userEvent.type(input, value);
  await userEvent.keyboard("{Enter}");
}

describe("CreateRequirementModal — validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
  });

  it("renders the form when open", () => {
    render(<CreateRequirementModal {...defaultProps} />);
    expect(screen.getByTestId("dialog")).toBeTruthy();
    expect(screen.getByPlaceholderText("e.g. Correct auth handling")).toBeTruthy();
  });

  it("blocks submission when name is empty", async () => {
    render(<CreateRequirementModal {...defaultProps} />);

    await userEvent.type(
      screen.getByPlaceholderText("The portion of the prompt being evaluated..."),
      "Some prompt",
    );
    await addTagItem("The agent correctly...", "Good output");
    await addTagItem("The agent fails to...", "Bad output");

    await userEvent.click(screen.getByRole("button", { name: "Add Requirement" }));

    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeTruthy();
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("blocks submission when desirable_cases is empty", async () => {
    render(<CreateRequirementModal {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("e.g. Correct auth handling"), "My req");
    await userEvent.type(
      screen.getByPlaceholderText("The portion of the prompt being evaluated..."),
      "Some prompt",
    );
    await addTagItem("The agent fails to...", "Bad output");
    // Leave desirable_cases blank

    await userEvent.click(screen.getByRole("button", { name: "Add Requirement" }));

    await waitFor(() => {
      expect(screen.getByText("At least one desirable case is required")).toBeTruthy();
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("blocks submission when undesirable_cases is empty", async () => {
    render(<CreateRequirementModal {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("e.g. Correct auth handling"), "My req");
    await userEvent.type(
      screen.getByPlaceholderText("The portion of the prompt being evaluated..."),
      "Some prompt",
    );
    await addTagItem("The agent correctly...", "Good output");
    // Leave undesirable_cases blank

    await userEvent.click(screen.getByRole("button", { name: "Add Requirement" }));

    await waitFor(() => {
      expect(screen.getByText("At least one undesirable case is required")).toBeTruthy();
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("blocks submission when all fields empty", async () => {
    render(<CreateRequirementModal {...defaultProps} />);

    await userEvent.click(screen.getByRole("button", { name: "Add Requirement" }));

    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeTruthy();
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("submits successfully when all required fields are filled", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { ref_id: "new-req-1" } }),
    }) as any;

    render(<CreateRequirementModal {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("e.g. Correct auth handling"), "My req");
    await userEvent.type(
      screen.getByPlaceholderText("The portion of the prompt being evaluated..."),
      "Some prompt",
    );
    await addTagItem("The agent correctly...", "Good output");
    await addTagItem("The agent fails to...", "Bad output");

    await userEvent.click(screen.getByRole("button", { name: "Add Requirement" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/workspaces/test-ws/evals/eval-set-1/requirements",
        expect.objectContaining({ method: "POST" }),
      );
    });

    expect(toast.success).toHaveBeenCalledWith("Requirement added");
    expect(defaultProps.onCreated).toHaveBeenCalled();
  });

  it("shows error toast when request fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as any;

    render(<CreateRequirementModal {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("e.g. Correct auth handling"), "My req");
    await userEvent.type(
      screen.getByPlaceholderText("The portion of the prompt being evaluated..."),
      "Prompt",
    );
    await addTagItem("The agent correctly...", "Good");
    await addTagItem("The agent fails to...", "Bad");

    await userEvent.click(screen.getByRole("button", { name: "Add Requirement" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to add requirement");
    });
  });

  it("sends multiple positive/negative cases correctly", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    }) as any;

    render(<CreateRequirementModal {...defaultProps} />);

    await userEvent.type(screen.getByPlaceholderText("e.g. Correct auth handling"), "My req");
    await userEvent.type(
      screen.getByPlaceholderText("The portion of the prompt being evaluated..."),
      "Prompt",
    );
    // Add two positive cases via separate Enter presses
    await addTagItem("The agent correctly...", "Case one");
    await addTagItem("The agent correctly...", "Case two");
    // Add two negative cases via separate Enter presses
    await addTagItem("The agent fails to...", "Neg one");
    await addTagItem("The agent fails to...", "Neg two");

    await userEvent.click(screen.getByRole("button", { name: "Add Requirement" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const callBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(callBody.desirable_cases).toEqual(["Case one", "Case two"]);
    expect(callBody.undesirable_cases).toEqual(["Neg one", "Neg two"]);
  });
});
