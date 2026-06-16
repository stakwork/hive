// @vitest-environment jsdom
/**
 * Unit tests for `DeferredCheckCard`.
 *
 * Covers:
 *   - countdown renders from a future fireAt
 *   - countdown hits 0 → "Checking…" spinner
 *   - Cancel button calls DELETE and flips to Cancelled optimistically
 *   - API error reverts optimistic state
 *   - FIRED state renders "Completed ✓"
 *   - CANCELLED state renders "Cancelled" text
 *   - FAILED state renders "Check failed"
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { DeferredCheckCard } from "@/app/org/[githubLogin]/_components/DeferredCheckCard";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDeferredCheck(overrides: Partial<{
  id: string;
  description: string;
  fireAt: string;
  status: "PENDING" | "FIRED" | "CANCELLED" | "FAILED";
}> = {}) {
  return {
    id: "action-1",
    description: "Check PR logs for feature X",
    fireAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min from now
    status: "PENDING" as const,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DeferredCheckCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders description and countdown for PENDING status", () => {
    const check = makeDeferredCheck();
    render(<DeferredCheckCard deferredCheck={check} githubLogin="my-org" />);

    expect(screen.getByText("Check PR logs for feature X")).toBeTruthy();
    expect(screen.getByText("Scheduled check")).toBeTruthy();
    // Countdown should be present (shows "Fires in X:XX")
    expect(screen.getByText("Fires in")).toBeTruthy();
  });

  it("shows Cancel button in PENDING state", () => {
    const check = makeDeferredCheck();
    render(<DeferredCheckCard deferredCheck={check} githubLogin="my-org" />);

    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
  });

  it("updates countdown every second", () => {
    const fireAt = new Date(Date.now() + 2 * 60 * 1000).toISOString(); // 2 min
    const check = makeDeferredCheck({ fireAt });
    render(<DeferredCheckCard deferredCheck={check} githubLogin="my-org" />);

    // Initially shows ~2:00
    expect(screen.getByText(/2:0/)).toBeTruthy();

    // After 30s tick
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByText(/1:[3-9]/)).toBeTruthy();
  });

  it("shows Checking… spinner when countdown reaches 0", () => {
    // Fire at already in the past
    const fireAt = new Date(Date.now() - 1000).toISOString();
    const check = makeDeferredCheck({ fireAt });
    render(<DeferredCheckCard deferredCheck={check} githubLogin="my-org" />);

    expect(screen.getByText("Checking…")).toBeTruthy();
    // Cancel button should not be present when countdown is done
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });

  it("Cancel button optimistically flips to Cancelled and calls DELETE", async () => {
    // Use real timers for async tests — fake timers block waitFor's internal setTimeout.
    vi.useRealTimers();
    const check = makeDeferredCheck();
    render(<DeferredCheckCard deferredCheck={check} githubLogin="test-org" />);

    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    await act(async () => {
      fireEvent.click(cancelBtn);
    });

    // Optimistic: card should immediately show Cancelled state
    expect(screen.getByText("Cancelled")).toBeTruthy();

    // API should have been called
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/orgs/test-org/chat/deferred-actions/action-1",
      { method: "DELETE" },
    );
  });

  it("reverts optimistic state on API error", async () => {
    vi.useRealTimers();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Network error" }),
    });

    const { toast } = await import("sonner");
    const check = makeDeferredCheck();
    render(<DeferredCheckCard deferredCheck={check} githubLogin="my-org" />);

    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    await act(async () => {
      fireEvent.click(cancelBtn);
    });

    // After API rejects, should revert to PENDING with Cancel button visible again
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
    });

    expect(toast.error).toHaveBeenCalled();
  });

  it("FIRED state renders Completed ✓ without cancel button", () => {
    const check = makeDeferredCheck({ status: "FIRED" });
    render(<DeferredCheckCard deferredCheck={check} githubLogin="my-org" />);

    expect(screen.getByText(/Completed ✓/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });

  it("CANCELLED state renders Cancelled text", () => {
    const check = makeDeferredCheck({ status: "CANCELLED" });
    render(<DeferredCheckCard deferredCheck={check} githubLogin="my-org" />);

    // Both the StatusBadge ("Cancelled") and the footer ("This check was cancelled.")
    // should be present — assert at least one of them is visible.
    const cancelleds = screen.getAllByText(/cancelled/i);
    expect(cancelleds.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });

  it("FAILED state renders Check failed", () => {
    const check = makeDeferredCheck({ status: "FAILED" });
    render(<DeferredCheckCard deferredCheck={check} githubLogin="my-org" />);

    expect(screen.getByText(/Check failed/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });

  it("syncs status from props when it changes externally (Pusher update)", () => {
    const check = makeDeferredCheck({ status: "PENDING" });
    const { rerender } = render(
      <DeferredCheckCard deferredCheck={check} githubLogin="my-org" />,
    );

    // Simulate Pusher causing a re-render with FIRED status
    rerender(
      <DeferredCheckCard
        deferredCheck={{ ...check, status: "FIRED" }}
        githubLogin="my-org"
      />,
    );

    expect(screen.getByText(/Completed ✓/)).toBeTruthy();
  });

  it("does not show countdown when status is not PENDING", () => {
    const check = makeDeferredCheck({ status: "FIRED" });
    render(<DeferredCheckCard deferredCheck={check} githubLogin="my-org" />);

    expect(screen.queryByText("Fires in")).toBeNull();
  });
});
