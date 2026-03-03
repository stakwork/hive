import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VMGrid } from "@/components/capacity/VMGrid";
import { VMData } from "@/types/pool-manager";

const baseVM: VMData = {
  id: "vm-1",
  subdomain: "pod-1",
  state: "running",
  internal_state: "running",
  usage_status: "unused",
  user_info: null,
  marked_at: null,
  resource_usage: { available: false },
};

function makeVM(overrides: Partial<VMData> = {}): VMData {
  return { ...baseVM, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "open").mockImplementation(() => null);
});

describe("VMGrid — dropdown visibility", () => {
  it("shows ⋮ dropdown for pending pod with credentials", () => {
    render(
      <VMGrid
        vms={[makeVM({ state: "pending", password: "secret", url: "https://ide.example.com" })]}
      />
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("does not show ⋮ dropdown for pending pod without credentials", () => {
    render(<VMGrid vms={[makeVM({ state: "pending" })]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows ⋮ dropdown for running pod with credentials (regression)", () => {
    render(
      <VMGrid
        vms={[makeVM({ state: "running", password: "secret", url: "https://ide.example.com" })]}
      />
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});

describe("VMGrid — dropdown actions", () => {
  it("Copy password calls clipboard.writeText with correct value", async () => {
    const user = userEvent.setup();
    // user-event installs its own clipboard stub; spy on it after setup()
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(
      <VMGrid
        vms={[makeVM({ state: "pending", password: "mypassword", url: "https://ide.example.com" })]}
      />
    );

    await user.click(screen.getByRole("button"));
    await user.click(screen.getByText("Copy password"));

    expect(writeText).toHaveBeenCalledWith("mypassword");
  });

  it("Open IDE calls window.open with correct URL", async () => {
    const user = userEvent.setup();
    render(
      <VMGrid
        vms={[makeVM({ state: "pending", password: "mypassword", url: "https://ide.example.com" })]}
      />
    );

    await user.click(screen.getByRole("button"));
    await user.click(screen.getByText("Open IDE"));

    expect(window.open).toHaveBeenCalledWith(
      "https://ide.example.com",
      "_blank",
      "noopener,noreferrer"
    );
  });
});
