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

  it("renders with labels, input, and save button", () => {
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} initialMinimumPods={null} />);
    expect(screen.getByText("Deployed Pods")).toBeInTheDocument();
    expect(screen.getByText("Desired Pod Count")).toBeInTheDocument();
    const inputs = screen.getAllByRole("spinbutton");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toHaveValue(2);
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  it("renders Deployed Pods as read-only text (not an input)", () => {
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={5} initialMinimumPods={3} />);
    expect(screen.getByText("5")).toBeInTheDocument();
    // Only one spinbutton (Desired Pod Count), not two
    expect(screen.getAllByRole("spinbutton")).toHaveLength(1);
  });

  it("renders a Desired Pod Count input with max=20", () => {
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} initialMinimumPods={3} />);
    expect(screen.getByText("Desired Pod Count")).toBeInTheDocument();
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("max", "20");
    expect(input).toHaveValue(3);
  });

  it("disables save button when value has not changed from initial props", () => {
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} initialMinimumPods={3} />);
    const button = screen.getByRole("button", { name: /save/i });
    expect(button).toBeDisabled();
  });

  it("enables save button when minimumPods changes", () => {
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} initialMinimumPods={3} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "8" } });
    const button = screen.getByRole("button", { name: /save/i });
    expect(button).toBeEnabled();
  });

  it("calls PATCH with only minimumPods in the body", async () => {
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} initialMinimumPods={2} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/w/test-workspace/pool/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minimumPods: 3 }),
      });
    });
  });

  it("shows success toast on successful save", async () => {
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} initialMinimumPods={null} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Pod count updated");
    });
  });

  it("shows error toast on failed save", async () => {
    mockFetch.mockResolvedValue({ ok: false });
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} initialMinimumPods={null} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to update pod count");
    });
  });

  it("shows error toast when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} initialMinimumPods={null} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to update pod count");
    });
  });

  it("disables button while saving", async () => {
    let resolveFetch!: (value: unknown) => void;
    mockFetch.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));

    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={2} initialMinimumPods={null} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    // Button should be disabled while in-flight
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();

    resolveFetch({ ok: true });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    });
  });

  it("Desired Pod Count input has min=1 attribute", () => {
    render(<AdminPodScaleControl slug="test-workspace" initialMinimumVms={3} initialMinimumPods={null} />);
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("min", "1");
  });
});
