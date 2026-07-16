/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

globalThis.React = React;

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    [k: string]: unknown;
  }) =>
    React.createElement("button", { onClick, disabled, ...rest }, children),
}));

global.fetch = vi.fn();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<{ refId: string; id: string; name: string }> = {}) {
  return {
    refId: "ref-abc",
    id: "antitrust/task-1",
    name: "Antitrust Task 1",
    ...overrides,
  };
}

function mockFetchOk() {
  vi.mocked(global.fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, enabled: false }),
  } as Response);
}

function mockFetchFail(status = 500, error = "Graph error") {
  vi.mocked(global.fetch).mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error }),
  } as Response);
}

// ─── Component under test (lazy import so mocks are applied first) ────────────

import { RecursionList } from "@/components/legal/RecursionBox";

// ─── RecursionCard (via RecursionList rendering) ──────────────────────────────

describe("RecursionCard", () => {
  const mockRefetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefetch.mockResolvedValue(undefined);
  });

  function renderCard(overrides: Partial<{ refId: string; id: string; name: string }> = {}) {
    const entry = makeEntry(overrides);
    render(
      <RecursionList
        entries={[entry]}
        isLoading={false}
        error={null}
        refetch={mockRefetch}
      />,
    );
  }

  it("renders task name and id", () => {
    renderCard();
    expect(screen.getByText("Antitrust Task 1")).toBeTruthy();
    expect(screen.getByText("antitrust/task-1")).toBeTruthy();
  });

  it("shows Disable button", () => {
    renderCard();
    expect(screen.getByRole("button", { name: /disable/i })).toBeTruthy();
  });

  it("calls PATCH with correct refId and enabled=false on Disable click", async () => {
    mockFetchOk();
    renderCard({ refId: "ref-xyz" });

    fireEvent.click(screen.getByRole("button", { name: /disable/i }));

    await waitFor(() => expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce());

    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      "/api/workspaces/openlaw/legal/benchmarks/recursion/ref-xyz",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      }),
    );
  });

  it("calls refetch after successful toggle", async () => {
    mockFetchOk();
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /disable/i }));

    await waitFor(() => expect(mockRefetch).toHaveBeenCalledOnce());
  });

  it("does NOT call refetch on failed toggle", async () => {
    mockFetchFail();
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /disable/i }));

    await waitFor(() => expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce());
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("shows inline error message on toggle failure", async () => {
    mockFetchFail(502, "Graph write failed");
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /disable/i }));

    await waitFor(() => screen.getByText("Graph write failed"));
  });

  it("shows inline error on network error", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("Network down"));
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /disable/i }));

    await waitFor(() => screen.getByText("Network down"));
  });

  it("does not make any DELETE calls", async () => {
    mockFetchOk();
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: /disable/i }));
    await waitFor(() => expect(vi.mocked(global.fetch)).toHaveBeenCalledOnce());

    const call = vi.mocked(global.fetch).mock.calls[0];
    const options = call[1] as RequestInit | undefined;
    expect(options?.method).not.toBe("DELETE");
  });
});

// ─── RecursionList ────────────────────────────────────────────────────────────

describe("RecursionList", () => {
  const mockRefetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefetch.mockResolvedValue(undefined);
  });

  it("shows loading spinner when isLoading=true", () => {
    render(
      <RecursionList entries={[]} isLoading={true} error={null} refetch={mockRefetch} />,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows error message and Retry button when error is set", () => {
    render(
      <RecursionList entries={[]} isLoading={false} error="Fetch failed" refetch={mockRefetch} />,
    );
    expect(screen.getByText("Fetch failed")).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("Retry button calls refetch", () => {
    render(
      <RecursionList entries={[]} isLoading={false} error="err" refetch={mockRefetch} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(mockRefetch).toHaveBeenCalledOnce();
  });

  it("shows empty-state copy when entries is empty and not loading", () => {
    render(
      <RecursionList entries={[]} isLoading={false} error={null} refetch={mockRefetch} />,
    );
    expect(screen.getByText(/No tasks enrolled in recursion/i)).toBeTruthy();
    // The second sentence spans multiple elements (includes a <strong>), so check container text
    const { container } = render(
      <RecursionList entries={[]} isLoading={false} error={null} refetch={mockRefetch} />,
    );
    expect(container.textContent).toMatch(/toggles the recursion flag/i);
  });

  it("empty-state mentions completing a benchmark run with failing criteria", () => {
    const { container } = render(
      <RecursionList entries={[]} isLoading={false} error={null} refetch={mockRefetch} />,
    );
    // Should reference Recursion action and failing criteria somewhere in the empty state
    const text = container.textContent ?? "";
    expect(text).toMatch(/Recursion/i);
    expect(text).toMatch(/failing criteria/i);
  });

  it("renders a card per entry", () => {
    const entries = [
      makeEntry({ refId: "r1", id: "slug-1", name: "Task One" }),
      makeEntry({ refId: "r2", id: "slug-2", name: "Task Two" }),
    ];
    render(
      <RecursionList entries={entries} isLoading={false} error={null} refetch={mockRefetch} />,
    );
    expect(screen.getByText("Task One")).toBeTruthy();
    expect(screen.getByText("Task Two")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /disable/i })).toHaveLength(2);
  });

  it("does not render StatusBadge or status-related UI", () => {
    const entries = [makeEntry()];
    render(
      <RecursionList entries={entries} isLoading={false} error={null} refetch={mockRefetch} />,
    );
    // No ACTIVE/RUNNING/INACTIVE badge text
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.queryByText("Running")).toBeNull();
    expect(screen.queryByText("Inactive")).toBeNull();
  });
});
