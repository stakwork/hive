// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: any) => (open ? <div data-testid="sheet">{children}</div> : null),
  SheetContent: ({ children }: any) => <div>{children}</div>,
  SheetHeader: ({ children }: any) => <div>{children}</div>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <div data-testid="select-wrapper" data-value={value}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<any>, { onValueChange })
          : child,
      )}
    </div>
  ),
  SelectTrigger: ({ children, "data-testid": testId }: any) => (
    <button data-testid={testId}>{children}</button>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children, onValueChange }: any) => (
    <div data-testid="select-content">
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<any>, { onValueChange })
          : child,
      )}
    </div>
  ),
  SelectItem: ({ value, children, onValueChange }: any) => (
    <button data-testid={`select-item-${value}`} onClick={() => onValueChange?.(value)}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, "data-testid": testId }: any) => (
    <button data-testid={testId} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ value, onChange, placeholder, "data-testid": testId }: any) => (
    <input data-testid={testId} value={value} onChange={onChange} placeholder={placeholder} />
  ),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { AddEdgePanel } from "@/app/w/[slug]/learn/lingo/components/AddEdgePanel";
import { toast } from "sonner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const defaultProps = {
  sourceRefId: "source-node-1",
  workspaceSlug: "my-ws",
  workspaceId: "ws-id-1",
  isOpen: true,
  onClose: vi.fn(),
  onEdgeCreated: vi.fn(),
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("AddEdgePanel", () => {
  describe("Schema loading", () => {
    it("fetches schema on open", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ node_types: ["Jargon", "Feature", "Task"] }),
      });

      render(<AddEdgePanel {...defaultProps} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/swarm/jarvis/schema?id=${defaultProps.workspaceId}`,
        );
      });
    });

    it("does not render when closed", () => {
      render(<AddEdgePanel {...defaultProps} isOpen={false} />);
      expect(screen.queryByTestId("sheet")).not.toBeInTheDocument();
    });

    it("populates node type dropdown with schema types", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ node_types: ["Jargon", "Feature"] }),
      });

      render(<AddEdgePanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("select-item-Feature")).toBeInTheDocument();
      });
    });
  });

  describe("Debounced search", () => {
    it("fires search after 300ms debounce", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ node_types: ["Jargon"] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                { ref_id: "n1", name: "Pod", jargon_context: "", jargon_candidates: [], created_at: "" },
              ],
            }),
        });

      render(<AddEdgePanel {...defaultProps} />);

      const input = screen.getByTestId("node-search-input");
      fireEvent.change(input, { target: { value: "pod" } });

      // Before debounce
      expect(mockFetch).toHaveBeenCalledTimes(1); // only schema

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve(); // flush microtasks
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
        const searchCall = mockFetch.mock.calls[1][0] as string;
        expect(searchCall).toContain(`/api/workspaces/${defaultProps.workspaceSlug}/lingo/nodes/search`);
        expect(searchCall).toContain("q=pod");
        expect(searchCall).toContain("type=Jargon");
      });

      vi.useRealTimers();
    });

    it("does not fire search before 300ms", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ node_types: [] }),
      });

      render(<AddEdgePanel {...defaultProps} />);
      const input = screen.getByTestId("node-search-input");
      fireEvent.change(input, { target: { value: "test" } });

      act(() => { vi.advanceTimersByTime(200); });

      expect(mockFetch).toHaveBeenCalledTimes(1); // only schema

      vi.useRealTimers();
    });

    it("renders search results after search fires", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ node_types: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                { ref_id: "result-1", name: "Result Node", jargon_context: "", jargon_candidates: [], created_at: "" },
              ],
            }),
        });

      render(<AddEdgePanel {...defaultProps} />);
      fireEvent.change(screen.getByTestId("node-search-input"), {
        target: { value: "result" },
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByTestId("search-result-result-1")).toBeInTheDocument();
      });

      vi.useRealTimers();
    });
  });

  describe("Confirm / POST edge", () => {
    it("confirm button is disabled when no target selected", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ node_types: [] }),
      });

      render(<AddEdgePanel {...defaultProps} />);

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId("confirm-add-edge")).toBeDisabled();
    });

    it("calls POST with correct body on confirm", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ node_types: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                { ref_id: "target-node", name: "Target", jargon_context: "", jargon_candidates: [], created_at: "" },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });

      const onEdgeCreated = vi.fn();
      const onClose = vi.fn();

      render(<AddEdgePanel {...defaultProps} onEdgeCreated={onEdgeCreated} onClose={onClose} />);

      fireEvent.change(screen.getByTestId("node-search-input"), {
        target: { value: "target" },
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });

      await waitFor(() => screen.getByTestId("search-result-target-node"));
      fireEvent.click(screen.getByTestId("search-result-target-node"));

      expect(screen.getByTestId("selected-target")).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByTestId("confirm-add-edge"));
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/workspaces/${defaultProps.workspaceSlug}/lingo/edges`,
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              source_ref_id: defaultProps.sourceRefId,
              target_ref_id: "target-node",
              edge_type: "RELATED_TO",
            }),
          }),
        );
        expect(onEdgeCreated).toHaveBeenCalled();
      });

      vi.useRealTimers();
    });

    it("shows error toast on POST failure", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ node_types: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ ref_id: "t1", name: "T1", jargon_context: "", jargon_candidates: [], created_at: "" }],
            }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: "Server error" }),
        });

      render(<AddEdgePanel {...defaultProps} />);
      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "T1" } });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });

      await waitFor(() => screen.getByTestId("search-result-t1"));
      fireEvent.click(screen.getByTestId("search-result-t1"));

      await act(async () => {
        fireEvent.click(screen.getByTestId("confirm-add-edge"));
      });

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Server error");
      });

      vi.useRealTimers();
    });
  });
});
