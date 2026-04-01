// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import AdminPodScaleControl from "@/app/admin/workspaces/[slug]/AdminPodScaleControl";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("AdminPodScaleControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it("renders with label, input, and save button", () => {
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} />);
    expect(screen.getByText("Minimum Pods")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toHaveValue(2);
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  it("disables save button when value is unchanged", () => {
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} />);
    const button = screen.getByRole("button", { name: /save/i });
    expect(button).toBeDisabled();
  });

  it("enables save button when value changes", () => {
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "5" } });
    const button = screen.getByRole("button", { name: /save/i });
    expect(button).toBeEnabled();
  });

  it("calls PATCH /api/w/[slug]/pool/config with correct body on save", async () => {
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/w/test-workspace/pool/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minimumVms: 5 }),
      });
    });
  });

  it("shows success toast on successful save", async () => {
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Pod count updated");
    });
  });

  it("shows error toast on failed save", async () => {
    mockFetch.mockResolvedValue({ ok: false });
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to update pod count");
    });
  });

  it("shows error toast when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to update pod count");
    });
  });

  it("disables button while saving", async () => {
    let resolveFetch!: (value: unknown) => void;
    mockFetch.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));

    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    // Button should be disabled while in-flight
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();

    resolveFetch({ ok: true });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    });
  });

  it("input has min=1 attribute", () => {
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={3} />);
    expect(screen.getByRole("spinbutton")).toHaveAttribute("min", "1");
  });
});
