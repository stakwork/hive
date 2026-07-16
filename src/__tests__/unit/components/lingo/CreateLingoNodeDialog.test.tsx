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

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children, disabled }: any) => (
    <select
      data-testid="lingo-type-select"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">Select a type…</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

// ─── Import after mocks ────────────────────────────────────────────────────────

import { CreateLingoNodeDialog } from "@/app/w/[slug]/lingo/components/CreateLingoNodeDialog";
import { toast } from "sonner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SLUG = "test-ws";
const WORKSPACE_ID = "ws-id-001";

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  // Mock URL.createObjectURL / revokeObjectURL
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:mock-preview-url"),
    revokeObjectURL: vi.fn(),
  });
});

function renderDialog(overrides: Partial<{
  isOpen: boolean;
  workspaceId: string;
  onClose: () => void;
  onCreated: (node: any) => void;
}> = {}) {
  const props = {
    workspaceSlug: SLUG,
    workspaceId: WORKSPACE_ID,
    isOpen: true,
    onClose: vi.fn(),
    onCreated: vi.fn(),
    ...overrides,
  };
  return { ...render(<CreateLingoNodeDialog {...props} />), props };
}

function makeFile(name = "icon.png", type = "image/png", size = 1024) {
  const file = new File(["x".repeat(size)], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

// ─── Core dialog tests ────────────────────────────────────────────────────────

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
        expect.objectContaining({ ref_id: "ref-001", name: "My Term", definition: "A definition", node_type: "Lingo" }),
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
        expect.objectContaining({ ref_id: "existing-ref", name: "Dupe Term", node_type: "Lingo" }),
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

  it("renders a lingo-type-select in the open dialog", () => {
    renderDialog();
    expect(screen.getByTestId("lingo-type-select")).toBeInTheDocument();
  });

  it("includes lingo_type in POST body when a type is selected", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ success: true, data: { ref_id: "r2", name: "Typed Term", lingo_type: "company_jargon" } }),
    });

    renderDialog();
    fireEvent.change(screen.getByTestId("lingo-name-input"), {
      target: { value: "Typed Term" },
    });
    fireEvent.change(screen.getByTestId("lingo-type-select"), {
      target: { value: "company_jargon" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("lingo-create-submit"));
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/workspaces/${SLUG}/lingo/nodes`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Typed Term", lingo_type: "company_jargon" }),
        }),
      );
    });
  });

  it("omits lingo_type from POST body when no type is selected", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ success: true, data: { ref_id: "r3", name: "Untyped Term" } }),
    });

    renderDialog();
    fireEvent.change(screen.getByTestId("lingo-name-input"), {
      target: { value: "Untyped Term" },
    });
    // Do NOT change lingo-type-select — leave it as default ""

    await act(async () => {
      fireEvent.click(screen.getByTestId("lingo-create-submit"));
    });

    await waitFor(() => {
      const [, callOptions] = mockFetch.mock.calls[0];
      const parsedBody = JSON.parse(callOptions.body);
      expect(parsedBody).not.toHaveProperty("lingo_type");
    });
  });
});

// ─── Icon upload chain tests ──────────────────────────────────────────────────

describe("CreateLingoNodeDialog — icon upload chain", () => {
  it("renders an 'Add icon' button", () => {
    renderDialog();
    expect(screen.getByTestId("add-icon-button")).toBeInTheDocument();
  });

  it("does NOT call fetch when a file is selected (deferred upload)", async () => {
    renderDialog();
    const fileInput = screen.getByTestId("icon-file-input");
    const file = makeFile();

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows a preview after valid file select", async () => {
    renderDialog();
    const fileInput = screen.getByTestId("icon-file-input");
    const file = makeFile();

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    expect(screen.getByTestId("icon-preview")).toBeInTheDocument();
    expect(screen.getByTestId("icon-preview")).toHaveAttribute("src", "blob:mock-preview-url");
  });

  it("shows inline error for invalid file type", async () => {
    renderDialog();
    const fileInput = screen.getByTestId("icon-file-input");
    const file = makeFile("doc.pdf", "application/pdf");

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    expect(screen.getByTestId("icon-error")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows inline error for oversized file", async () => {
    renderDialog();
    const fileInput = screen.getByTestId("icon-file-input");
    const file = makeFile("big.png", "image/png", 11 * 1024 * 1024);

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    expect(screen.getByTestId("icon-error")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fires presign → PUT → POST in sequence on form submit with a valid file", async () => {
    const S3_PATH = "uploads/ws-id-001/lingo-icons/123_abc_icon.png";
    const PRESIGN_URL = "https://s3.example.com/presigned";

    // 1. Presign call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ presignedUrl: PRESIGN_URL, s3Path: S3_PATH }),
    });
    // 2. PUT to S3
    mockFetch.mockResolvedValueOnce({ ok: true });
    // 3. POST create node
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { ref_id: "new-ref", name: "Icon Node", icon_url: S3_PATH },
        }),
    });

    const { props } = renderDialog();

    // Select file first
    const fileInput = screen.getByTestId("icon-file-input");
    const file = makeFile("icon.png", "image/png", 1024);
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    // Fill in name
    fireEvent.change(screen.getByTestId("lingo-name-input"), {
      target: { value: "Icon Node" },
    });

    // Submit
    await act(async () => {
      fireEvent.click(screen.getByTestId("lingo-create-submit"));
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    // Call 1: presign
    expect(mockFetch.mock.calls[0][0]).toBe("/api/upload/presigned-url");
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
      workspaceId: WORKSPACE_ID,
      context: "lingo",
      filename: "icon.png",
      contentType: "image/png",
    });

    // Call 2: PUT to S3
    expect(mockFetch.mock.calls[1][0]).toBe(PRESIGN_URL);
    expect(mockFetch.mock.calls[1][1].method).toBe("PUT");

    // Call 3: POST create node with icon_url
    expect(mockFetch.mock.calls[2][0]).toBe(`/api/workspaces/${SLUG}/lingo/nodes`);
    const postBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(postBody.icon_url).toBe(S3_PATH);

    expect(props.onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Icon Node", icon_url: S3_PATH }),
    );
  });

  it("aborts node creation and shows error when presign fails", async () => {
    // Presign fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "Presign error" }),
    });

    const { props } = renderDialog();

    const fileInput = screen.getByTestId("icon-file-input");
    const file = makeFile();
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    fireEvent.change(screen.getByTestId("lingo-name-input"), {
      target: { value: "Fail Node" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("lingo-create-submit"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("lingo-create-error")).toBeInTheDocument();
    });

    // Only 1 fetch call (the presign); node POST never fires
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(props.onCreated).not.toHaveBeenCalled();
  });

  it("aborts node creation and shows error when S3 PUT fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ presignedUrl: "https://s3.example.com/p", s3Path: "some/path" }),
    });
    // PUT fails
    mockFetch.mockResolvedValueOnce({ ok: false });

    const { props } = renderDialog();

    const fileInput = screen.getByTestId("icon-file-input");
    const file = makeFile();
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    fireEvent.change(screen.getByTestId("lingo-name-input"), {
      target: { value: "Fail Node" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("lingo-create-submit"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("lingo-create-error")).toBeInTheDocument();
    });

    // 2 calls (presign + PUT); node POST never fires
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(props.onCreated).not.toHaveBeenCalled();
  });

  it("submits without icon when no file is selected", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ success: true, data: { ref_id: "r1", name: "No Icon" } }),
    });

    renderDialog();
    fireEvent.change(screen.getByTestId("lingo-name-input"), {
      target: { value: "No Icon" },
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("lingo-create-submit"));
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    const postBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(postBody).not.toHaveProperty("icon_url");
  });
});
