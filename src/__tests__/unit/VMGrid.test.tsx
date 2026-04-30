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
  assignedTask: null,
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

describe("VMGrid — assigned task display", () => {
  it("renders task title as a link when usage_status is used and assignedTask is set", () => {
    render(
      <VMGrid
        vms={[
          makeVM({
            usage_status: "used",
            assignedTask: {
              id: "t1",
              title: "Fix auth bug",
              creator: { name: "Alice", image: null },
            },
          }),
        ]}
        workspaceSlug="test-workspace"
      />
    );
    const link = screen.getByRole("link", { name: "Fix auth bug" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/w/test-workspace/task/t1");
  });

  it("renders avatar fallback icon when creator has no image", () => {
    render(
      <VMGrid
        vms={[
          makeVM({
            usage_status: "used",
            assignedTask: {
              id: "t1",
              title: "Fix auth bug",
              creator: { name: "Alice", image: null },
            },
          }),
        ]}
        workspaceSlug="test-workspace"
      />
    );
    // Avatar fallback (User icon) should be present since image is null
    expect(screen.getByRole("link", { name: "Fix auth bug" })).toBeInTheDocument();
  });

  it("renders nothing for task section when usage_status is used but assignedTask is null", () => {
    render(
      <VMGrid
        vms={[makeVM({ usage_status: "used", assignedTask: null })]}
        workspaceSlug="test-workspace"
      />
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders nothing for task section when usage_status is unused", () => {
    render(
      <VMGrid
        vms={[
          makeVM({
            usage_status: "unused",
            assignedTask: {
              id: "t1",
              title: "Should not show",
              creator: { name: "Alice", image: null },
            },
          }),
        ]}
        workspaceSlug="test-workspace"
      />
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText("Should not show")).not.toBeInTheDocument();
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

describe("VMGrid — Open Browser action", () => {
  it("renders 'Open Browser' in dropdown when frontendUrl is set", async () => {
    const user = userEvent.setup();
    render(
      <VMGrid
        vms={[
          makeVM({
            password: "secret",
            url: "https://ide.example.com",
            frontendUrl: "https://pod-3000.example.com",
          }),
        ]}
      />
    );

    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Open Browser")).toBeInTheDocument();
  });

  it("does not render 'Open Browser' when frontendUrl is absent", async () => {
    const user = userEvent.setup();
    render(
      <VMGrid
        vms={[
          makeVM({
            password: "secret",
            url: "https://ide.example.com",
          }),
        ]}
      />
    );

    await user.click(screen.getByRole("button"));
    expect(screen.queryByText("Open Browser")).not.toBeInTheDocument();
  });

  it("calls window.open with frontendUrl when 'Open Browser' is clicked", async () => {
    const user = userEvent.setup();
    render(
      <VMGrid
        vms={[
          makeVM({
            password: "secret",
            url: "https://ide.example.com",
            frontendUrl: "https://pod-3000.example.com",
          }),
        ]}
      />
    );

    await user.click(screen.getByRole("button"));
    await user.click(screen.getByText("Open Browser"));

    expect(window.open).toHaveBeenCalledWith(
      "https://pod-3000.example.com",
      "_blank",
      "noopener,noreferrer"
    );
  });
});
