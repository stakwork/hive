// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import React from "react";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, onOpenChange, children }: any) =>
    open ? (
      <div data-testid="dialog-root">
        <button data-testid="dialog-close-trigger" onClick={() => onOpenChange(false)} />
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, type, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} type={type ?? "button"} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: React.forwardRef(({ value, onChange, disabled, ...props }: any, ref: any) => (
    <input ref={ref} value={value} onChange={onChange} disabled={disabled} {...props} />
  )),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: ({ value, onChange, disabled, ...props }: any) => (
    <textarea value={value} onChange={onChange} disabled={disabled} {...props} />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
}));

// ─── Import after mocks ────────────────────────────────────────────────────────

import { CreateLingoNodeDialog } from "@/app/w/[slug]/learn/lingo/components/CreateLingoNodeDialog";
import { toast } from "sonner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SLUG = "test-ws";

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

function renderDialog(overrides: Partial<{
  isOpen: boolean;
  onClose: () => void;
  onCreated: (node: any) => void;
}> = {}) {
  const props = {
    workspaceSlug: SLUG,
    isOpen: true,
    onClose: vi.fn(),
    onCreated: vi.fn(),
    ...overrides,
  };
  return { ...render(<CreateLingoNodeDialog {...props} />), props };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CreateLingoNodeDialog", () => {
  it("renders name and definition fields when open", () => {
    renderDialog();
    expect(screen.getByTestId("lingo-name-input")).toBeInTheDocument();
    expect(screen.getByTestId("lingo-definition-input")).toBeInTheDocument();
    expect(screen.getByTestId("lingo-create-submit")).toBeInTheDocument();
  });

  it("does not render when isOpen is false", () => {
    renderDialog({ isOpen: false });
    expect(screen.queryByTestId("lingo-name-input")).not.toBeInTheDocument();
  });

  it("submit button is disabled when name is empty", () => {
    renderDialog();
    const submit = screen.getByTestId("lingo-create-submit");
    expect(submit).toBeDisabled();
  });

  it("submit button is enabled when name has value", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("lingo-name-input"), {
      target: { value: "My Term" },
    });
    expect(screen.getByTestId("lingo-create-submit")).not.toBeDisabled();
  });

  it("shows 'Creating…' while submitting and disables submit button", async () => {
    let resolveFetch!: (value: any) => void;
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => { resolveFetch = resolve; }),
    );

    renderDialog();
    fireEvent.change(screen.getByTestId("lingo-name-input"), {
      target: { value: "My Term" },
    });

    fireEvent.click(screen.getByTestId("lingo-create-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("lingo-create-submit")).toHaveTextContent("Creating…");
      expect(screen.getByTestId("lingo-create-submit")).toBeDisabled();
    });

    // Resolve to avoid pending promise warnings
    resolveFetch({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { ref_id: "r1", name: "My Term" } }),
    });
  });

  it("calls onCreated and onClose with success toast on fresh create", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { ref_id: "ref-001", name: "My Term", definition: "A definition" },
        }),
    });

    const { props } = renderDialog();
    fireEvent.change(screen.getByTestId("lingo-name-input"), {
      target: { value: "My Term" },
    });
    fireEvent.change(screen.getByTestId("lingo-definition-input"), {
      target: { value: "A definition" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("lingo-create-submit"));
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Lingo node created");
      expect(props.onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ ref_id: "ref-001", name: "My Term", definition: "A definition" }),
      );
      expect(props.onClose).toHaveBeenCalled();
    });
  });

  it("shows duplicate toast and opens existing node on alreadyExists: true", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          alreadyExists: true,
          data: { ref_id: "existing-ref", name: "Dupe Term" },
        }),
    });

    const { props } = renderDialog();
    fireEvent.change(screen.getByTestId("lingo-name-input"), {
      target: { value: "Dupe Term" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("lingo-create-submit"));
    });

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        "A node with that name already exists — opening it",
      );
      expect(props.onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ ref_id: "existing-ref", name: "Dupe Term" }),
      );
      expect(props.onClose).toHaveBeenCalled();
    });
  });

  it("shows inline error and keeps dialog open on success: false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ success: false, error: "Something went wrong on server" }),
    });

    const { props } = renderDialog();
    fireEvent.change(screen.getByTestId("lingo-name-input"), {
      target: { value: "Bad Term" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("lingo-create-submit"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("lingo-create-error")).toHaveTextContent(
        "Something went wrong on server",
      );
    });

    expect(props.onCreated).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("shows inline error on fetch throw", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    const { props } = renderDialog();
    fireEvent.change(screen.getByTestId("lingo-name-input"), {
      target: { value: "Error Term" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("lingo-create-submit"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("lingo-create-error")).toBeInTheDocument();
    });

    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("POSTs to correct URL with name and definition", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ success: true, data: { ref_id: "r1", name: "Term A" } }),
    });

    renderDialog();
    fireEvent.change(screen.getByTestId("lingo-name-input"), {
      target: { value: "Term A" },
    });
    fireEvent.change(screen.getByTestId("lingo-definition-input"), {
      target: { value: "Definition A" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("lingo-create-submit"));
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/workspaces/${SLUG}/lingo/nodes`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Term A", definition: "Definition A" }),
        }),
      );
    });
  });
});
