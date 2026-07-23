/**
 * @vitest-environment jsdom
 *
 * Unit tests for MockStepOutputsPanel:
 * - viewMode transitions (list → detail → create → list)
 * - JSON output validation (0, false, "", null accepted; malformed rejected)
 * - Empty-list state until workflow_id provided
 * - URL query sync (id + workflow_id + optional version)
 * - Post-create/update re-fetch-and-select-by-key behaviour
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MockStepOutputsPanel } from "@/components/mock-step-outputs";

// ─── Mutable search params store (set per-test before render) ─────────────────

let mockSearchParamsStore: Record<string, string> = {};
const mockRouterReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockRouterReplace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/w/test/mock-step-outputs",
  useSearchParams: () => ({
    get: (key: string) => mockSearchParamsStore[key] ?? null,
    toString: () => new URLSearchParams(mockSearchParamsStore).toString(),
  }),
}));

// ─── UI mock shims ─────────────────────────────────────────────────────────────

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, type, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) => (
    <button onClick={onClick} disabled={disabled} type={type ?? "button"} {...rest}>{children}</button>
  ),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));
vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...rest }: { children?: React.ReactNode; [k: string]: unknown }) => <div {...rest}>{children}</div>,
}));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: ({ children, asChild }: { children?: React.ReactNode; asChild?: boolean }) => {
    void asChild;
    return <div>{children}</div>;
  },
  AlertDialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
  AlertDialogAction: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick} data-testid="confirm-delete">{children}</button>
  ),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ITEM_1 = {
  id: 1,
  workflow_id: "wf-abc",
  step_id: "step-1",
  workflow_version_id: null,
  output: { result: "ok" },
};

const ITEM_2 = {
  id: 2,
  workflow_id: "wf-abc",
  step_id: "step-2",
  workflow_version_id: "v42",
  output: false,
};

function makeListResponse(items = [ITEM_1, ITEM_2]) {
  return Promise.resolve({ ok: true, json: async () => ({ success: true, data: items }) });
}

function makeDetailResponse(item = ITEM_1) {
  return Promise.resolve({ ok: true, json: async () => ({ success: true, data: item }) });
}

function makeDeleteResponse() {
  return Promise.resolve({ ok: true, json: async () => ({ success: true, data: "Mock step output deleted successfully" }) });
}

function makeErrorResponse(status: number, error: string) {
  return Promise.resolve({ ok: false, status, json: async () => ({ success: false, error }) });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MockStepOutputsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsStore = {};
    global.fetch = vi.fn();
  });

  // ── Empty state ─────────────────────────────────────────────────────────────

  it("shows empty prompt state when no workflow_id is entered", () => {
    render(<MockStepOutputsPanel variant="fullpage" />);
    expect(screen.getByText(/Enter a Workflow ID above to load/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── List fetch & display ────────────────────────────────────────────────────

  it("fetches and displays items when user submits workflow_id", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      await makeListResponse()
    );

    render(<MockStepOutputsPanel variant="fullpage" />);

    const wfInput = screen.getByTestId("filter-workflow-id");
    fireEvent.change(wfInput, { target: { value: "wf-abc" } });

    const searchBtn = screen.getByText("Search");
    await act(async () => { fireEvent.click(searchBtn); });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("workflow_id=wf-abc")
      );
    });

    await waitFor(() => {
      expect(screen.getByText("step-1")).toBeInTheDocument();
      expect(screen.getByText("step-2")).toBeInTheDocument();
    });
  });

  // ── viewMode: list → detail ─────────────────────────────────────────────────

  it("transitions to detail view when an item is clicked", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(await makeListResponse())
      .mockResolvedValueOnce(await makeDetailResponse(ITEM_1));

    render(<MockStepOutputsPanel variant="fullpage" />);

    // Trigger list fetch
    fireEvent.change(screen.getByTestId("filter-workflow-id"), { target: { value: "wf-abc" } });
    await act(async () => { fireEvent.click(screen.getByText("Search")); });
    await waitFor(() => expect(screen.getByText("step-1")).toBeInTheDocument());

    // Click item
    await act(async () => { fireEvent.click(screen.getByText("step-1")); });

    // Back button should appear (detail view indicator)
    await waitFor(() => expect(screen.getAllByText("Back")[0]).toBeInTheDocument());

    // Form fields should be pre-populated
    await waitFor(() => {
      expect((screen.getByTestId("form-step-id") as HTMLInputElement).value).toBe("step-1");
      expect((screen.getByTestId("form-workflow-id") as HTMLInputElement).value).toBe("wf-abc");
    });
  });

  // ── viewMode: detail → list ─────────────────────────────────────────────────

  it("returns to list view on Back button click", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(await makeListResponse())
      .mockResolvedValueOnce(await makeDetailResponse(ITEM_1));

    render(<MockStepOutputsPanel variant="fullpage" />);

    fireEvent.change(screen.getByTestId("filter-workflow-id"), { target: { value: "wf-abc" } });
    await act(async () => { fireEvent.click(screen.getByText("Search")); });
    await waitFor(() => expect(screen.getByText("step-1")).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByText("step-1")); });
    await waitFor(() => expect(screen.getByText("Back")).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByText("Back")); });

    // After going back, the list view is shown again (filter bar is visible)
    await waitFor(() => {
      expect(screen.getByTestId("filter-workflow-id")).toBeInTheDocument();
      // The form fields from the detail view should be gone
      expect(screen.queryByText("Save")).not.toBeInTheDocument();
    });
  });

  // ── viewMode: list → create ─────────────────────────────────────────────────

  it("transitions to create view when New button is clicked", async () => {
    render(<MockStepOutputsPanel variant="fullpage" />);

    await act(async () => { fireEvent.click(screen.getByTestId("create-button")); });

    expect(screen.getByText("Create Mock Step Output")).toBeInTheDocument();
    expect(screen.getByTestId("form-workflow-id")).toBeInTheDocument();
    expect(screen.getByTestId("form-step-id")).toBeInTheDocument();
    expect(screen.getByTestId("form-output")).toBeInTheDocument();
  });

  // ── viewMode: create → list ─────────────────────────────────────────────────

  it("returns to list view on Cancel in create mode", async () => {
    render(<MockStepOutputsPanel variant="fullpage" />);

    await act(async () => { fireEvent.click(screen.getByTestId("create-button")); });
    expect(screen.getByText("Create Mock Step Output")).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByText("Cancel")); });
    expect(screen.getByText(/Enter a Workflow ID above to load/i)).toBeInTheDocument();
  });

  // ── JSON output validation ──────────────────────────────────────────────────

  it.each([
    ["0", 0],
    ["false", false],
    ['""', ""],
    ["null", null],
    ['{"key":"value"}', { key: "value" }],
    ["[1,2,3]", [1, 2, 3]],
  ])("accepts valid JSON output value: %s", async (rawJson) => {
    // Create mock that succeeds and returns a newly created item
    const createdItem = { ...ITEM_1, step_id: "step-new", output: JSON.parse(rawJson) };
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(await Promise.resolve({ ok: true, json: async () => ({ success: true, data: createdItem }) }))
      .mockResolvedValueOnce(await makeListResponse([createdItem]));

    render(<MockStepOutputsPanel variant="fullpage" />);

    await act(async () => { fireEvent.click(screen.getByTestId("create-button")); });

    fireEvent.change(screen.getByTestId("form-workflow-id"), { target: { value: "wf-abc" } });
    fireEvent.change(screen.getByTestId("form-step-id"), { target: { value: "step-new" } });
    fireEvent.change(screen.getByTestId("form-output"), { target: { value: rawJson } });

    await act(async () => { fireEvent.click(screen.getByText("Create")); });

    // Should NOT show a JSON error message
    await waitFor(() => {
      expect(screen.queryByText(/Invalid JSON/i)).not.toBeInTheDocument();
    });

    // fetch should have been called with POST
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(
      ([url, opts]: [string, RequestInit]) => url.includes("/api/workflow/mock-step-outputs") && opts?.method === "POST"
    )).toBe(true);
  });

  it("rejects malformed JSON and shows inline error without submitting", async () => {
    render(<MockStepOutputsPanel variant="fullpage" />);

    await act(async () => { fireEvent.click(screen.getByTestId("create-button")); });

    fireEvent.change(screen.getByTestId("form-workflow-id"), { target: { value: "wf-abc" } });
    fireEvent.change(screen.getByTestId("form-step-id"), { target: { value: "step-x" } });
    fireEvent.change(screen.getByTestId("form-output"), { target: { value: "{bad json}" } });

    await act(async () => { fireEvent.click(screen.getByText("Create")); });

    expect(screen.getByText(/Invalid JSON/i)).toBeInTheDocument();
    // fetch should NOT have been called with POST
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(
      ([, opts]: [string, RequestInit]) => opts?.method === "POST"
    )).toBe(false);
  });

  // ── URL query sync ──────────────────────────────────────────────────────────

  it("updates URL with workflow_id and id when viewing detail", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(await makeListResponse())
      .mockResolvedValueOnce(await makeDetailResponse(ITEM_1));

    render(<MockStepOutputsPanel variant="fullpage" />);

    fireEvent.change(screen.getByTestId("filter-workflow-id"), { target: { value: "wf-abc" } });
    await act(async () => { fireEvent.click(screen.getByText("Search")); });
    await waitFor(() => expect(screen.getByText("step-1")).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByText("step-1")); });

    await waitFor(() => {
      const calls = mockRouterReplace.mock.calls;
      const lastUrl: string = calls[calls.length - 1]?.[0] ?? "";
      expect(lastUrl).toContain("workflow_id=wf-abc");
      expect(lastUrl).toContain("id=1");
    });
  });

  it("clears id from URL when returning to list", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(await makeListResponse())
      .mockResolvedValueOnce(await makeDetailResponse(ITEM_1));

    render(<MockStepOutputsPanel variant="fullpage" />);

    fireEvent.change(screen.getByTestId("filter-workflow-id"), { target: { value: "wf-abc" } });
    await act(async () => { fireEvent.click(screen.getByText("Search")); });
    await waitFor(() => expect(screen.getByText("step-1")).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByText("step-1")); });
    await waitFor(() => expect(screen.getByText("Back")).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByText("Back")); });

    await waitFor(() => {
      const calls = mockRouterReplace.mock.calls;
      const lastUrl: string = calls[calls.length - 1]?.[0] ?? "";
      expect(lastUrl).not.toContain("id=");
    });
  });

  // ── Deep-link rehydration ───────────────────────────────────────────────────

  it("rehydrates workflow-scoped list and opens detail when URL has workflow_id + id", async () => {
    mockSearchParamsStore = { workflow_id: "wf-abc", id: "1" };

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(await makeListResponse([ITEM_1, ITEM_2]));

    render(<MockStepOutputsPanel variant="fullpage" />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("workflow_id=wf-abc")
      );
    });

    // Detail view should open for ITEM_1 (matched by id in list)
    await waitFor(() => {
      expect((screen.getByTestId("form-step-id") as HTMLInputElement).value).toBe("step-1");
    });
  });

  it("rehydrates with workflow_version_id in URL", async () => {
    mockSearchParamsStore = { workflow_id: "wf-abc", workflow_version_id: "v42", id: "2" };

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(await makeListResponse([ITEM_1, ITEM_2]));

    render(<MockStepOutputsPanel variant="fullpage" />);

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some(([url]: [string]) =>
        url.includes("workflow_id=wf-abc") && url.includes("workflow_version_id=v42")
      )).toBe(true);
    });

    // Detail view should open for ITEM_2 (matched by id)
    await waitFor(() => {
      expect((screen.getByTestId("form-step-id") as HTMLInputElement).value).toBe("step-2");
    });
  });

  // ── Post-create re-fetch-and-select-by-key ───────────────────────────────────

  it("re-fetches list after create and selects entry by key match", async () => {
    const newItem = {
      id: 99,
      workflow_id: "wf-xyz",
      step_id: "step-new",
      workflow_version_id: null,
      output: { data: 42 },
    };

    (global.fetch as ReturnType<typeof vi.fn>)
      // POST create response
      .mockResolvedValueOnce(await Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: newItem }),
      }))
      // GET list after create
      .mockResolvedValueOnce(await makeListResponse([newItem]));

    render(<MockStepOutputsPanel variant="fullpage" />);

    await act(async () => { fireEvent.click(screen.getByTestId("create-button")); });

    fireEvent.change(screen.getByTestId("form-workflow-id"), { target: { value: "wf-xyz" } });
    fireEvent.change(screen.getByTestId("form-step-id"), { target: { value: "step-new" } });
    fireEvent.change(screen.getByTestId("form-output"), { target: { value: '{"data":42}' } });

    await act(async () => { fireEvent.click(screen.getByText("Create")); });

    // List should be refetched
    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some(([url]: [string]) =>
        url.includes("/api/workflow/mock-step-outputs") && url.includes("workflow_id=wf-xyz")
      )).toBe(true);
    });

    // Detail view should open with the created item
    await waitFor(() => {
      expect((screen.getByTestId("form-step-id") as HTMLInputElement).value).toBe("step-new");
    });
  });

  // ── Delete ──────────────────────────────────────────────────────────────────

  it("deletes item and returns to list view", async () => {
    // Calls in order:
    // 1. GET list (search click)
    // 2. DELETE /:id (confirm delete)
    // 3. GET list (refresh after delete)
    // Note: clicking an item in this panel opens detail from the list data directly
    //       (no extra GET/:id call), so we only need 3 mocks.
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(await makeListResponse([ITEM_1]))    // 1. list
      .mockResolvedValueOnce(await makeDeleteResponse())           // 2. DELETE
      .mockResolvedValueOnce(await makeListResponse([]));          // 3. refresh

    render(<MockStepOutputsPanel variant="fullpage" />);

    fireEvent.change(screen.getByTestId("filter-workflow-id"), { target: { value: "wf-abc" } });
    await act(async () => { fireEvent.click(screen.getByText("Search")); });
    await waitFor(() => expect(screen.getByText("step-1")).toBeInTheDocument());

    // Click item to go to detail
    await act(async () => { fireEvent.click(screen.getByText("step-1")); });
    await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());

    // Click the Delete trigger button (the one in AlertDialogTrigger)
    const deleteButtons = screen.getAllByText("Delete");
    await act(async () => { fireEvent.click(deleteButtons[0]); });

    // Confirm deletion via the AlertDialogAction
    const confirmBtn = screen.getByTestId("confirm-delete");
    await act(async () => { fireEvent.click(confirmBtn); });

    await waitFor(() => {
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(
        ([url, opts]: [string, RequestInit]) =>
          url.includes(`/api/workflow/mock-step-outputs/${ITEM_1.id}`) && opts?.method === "DELETE"
      )).toBe(true);
    });

    // After delete, we should return to list view (filter bar visible, Save gone)
    await waitFor(() => {
      expect(screen.queryByText("Save")).not.toBeInTheDocument();
      expect(screen.getByTestId("filter-workflow-id")).toBeInTheDocument();
    });
  });

  // ── Save (PUT) validation ────────────────────────────────────────────────────

  it("rejects malformed JSON in edit mode without calling PUT", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(await makeListResponse([ITEM_1]))
      .mockResolvedValueOnce(await makeDetailResponse(ITEM_1));

    render(<MockStepOutputsPanel variant="fullpage" />);

    fireEvent.change(screen.getByTestId("filter-workflow-id"), { target: { value: "wf-abc" } });
    await act(async () => { fireEvent.click(screen.getByText("Search")); });
    await waitFor(() => expect(screen.getByText("step-1")).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByText("step-1")); });
    await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());

    // Enter bad JSON
    fireEvent.change(screen.getByTestId("form-output"), { target: { value: "not valid json {{" } });

    await act(async () => { fireEvent.click(screen.getByText("Save")); });

    expect(screen.getByText(/Invalid JSON/i)).toBeInTheDocument();
    // PUT should not have been called
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(
      ([, opts]: [string, RequestInit]) => opts?.method === "PUT"
    )).toBe(false);
  });

  // ── Error forwarding ────────────────────────────────────────────────────────

  it("shows list error when API returns non-ok", async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(await makeErrorResponse(500, "Server error"));

    render(<MockStepOutputsPanel variant="fullpage" />);

    fireEvent.change(screen.getByTestId("filter-workflow-id"), { target: { value: "wf-abc" } });
    await act(async () => { fireEvent.click(screen.getByText("Search")); });

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch mock step outputs/i)).toBeInTheDocument();
    });
  });
});
