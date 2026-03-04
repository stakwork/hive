import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SignalGrid } from "@/components/capacity/SignalGrid";
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
  flaggedForRecreation: false,
  flaggedReason: null,
  taskId: null,
  taskTitle: null,
  assigneeName: null,
};

function makeVM(overrides: Partial<VMData> = {}): VMData {
  return { ...baseVM, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "open").mockImplementation(() => null);
});

// ─── Dropdown visibility (ported from VMGrid tests) ───────────────────────────

describe("SignalGrid — action button visibility", () => {
  it("shows action buttons for pending pod with credentials", () => {
    render(
      <SignalGrid
        vms={[makeVM({ state: "pending", password: "secret", url: "https://ide.example.com" })]}
      />
    );
    expect(screen.getByText("pwd")).toBeInTheDocument();
    expect(screen.getByText("ide")).toBeInTheDocument();
  });

  it("does not show action buttons for pending pod without credentials", () => {
    render(<SignalGrid vms={[makeVM({ state: "pending" })]} />);
    expect(screen.queryByText("pwd")).not.toBeInTheDocument();
    expect(screen.queryByText("ide")).not.toBeInTheDocument();
  });

  it("shows action buttons for running pod with credentials", () => {
    render(
      <SignalGrid
        vms={[makeVM({ state: "running", password: "secret", url: "https://ide.example.com" })]}
      />
    );
    expect(screen.getByText("pwd")).toBeInTheDocument();
    expect(screen.getByText("ide")).toBeInTheDocument();
  });
});

// ─── Action button behaviour ──────────────────────────────────────────────────

describe("SignalGrid — action button actions", () => {
  it("Copy password calls clipboard.writeText with correct value", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(
      <SignalGrid
        vms={[makeVM({ state: "pending", password: "mypassword", url: "https://ide.example.com" })]}
      />
    );

    await user.click(screen.getByText("pwd"));

    expect(writeText).toHaveBeenCalledWith("mypassword");
  });

  it("Open IDE calls window.open with correct URL", async () => {
    const user = userEvent.setup();
    render(
      <SignalGrid
        vms={[makeVM({ state: "pending", password: "mypassword", url: "https://ide.example.com" })]}
      />
    );

    await user.click(screen.getByText("ide"));

    expect(window.open).toHaveBeenCalledWith(
      "https://ide.example.com",
      "_blank",
      "noopener,noreferrer"
    );
  });
});

// ─── StatsBar counts ─────────────────────────────────────────────────────────

describe("SignalGrid — StatsBar counts", () => {
  it("renders correct TOTAL, ACTIVE and FREE counts", () => {
    const vms = [
      makeVM({ id: "vm-1", state: "running", usage_status: "used" }),   // active
      makeVM({ id: "vm-2", state: "running", usage_status: "unused" }), // free
      makeVM({ id: "vm-3", state: "running", usage_status: "unused" }), // free
      makeVM({ id: "vm-4", state: "pending" }),                         // starting
    ];
    render(<SignalGrid vms={vms} />);

    const total = screen.getByTestId("stat-total");
    const active = screen.getByTestId("stat-active");
    const free = screen.getByTestId("stat-free");

    expect(total).toHaveTextContent("4");
    expect(active).toHaveTextContent("1");
    expect(free).toHaveTextContent("2");
  });

  it("shows ERROR stat only when errors > 0", () => {
    render(<SignalGrid vms={[makeVM({ state: "failed" })]} />);
    expect(screen.getByTestId("stat-error")).toBeInTheDocument();
  });

  it("hides ERROR stat when no errors", () => {
    render(<SignalGrid vms={[makeVM({ state: "running" })]} />);
    expect(screen.queryByTestId("stat-error")).not.toBeInTheDocument();
  });

  it("shows FLAGGED stat only when flagged > 0", () => {
    render(
      <SignalGrid
        vms={[makeVM({ flaggedForRecreation: true, flaggedReason: "POOL_CONFIG_CHANGED" })]}
      />
    );
    expect(screen.getByTestId("stat-flagged")).toBeInTheDocument();
  });

  it("hides FLAGGED stat when no flagged pods", () => {
    render(<SignalGrid vms={[makeVM()]} />);
    expect(screen.queryByTestId("stat-flagged")).not.toBeInTheDocument();
  });
});

// ─── Flagged pod ──────────────────────────────────────────────────────────────

describe("SignalGrid — flagged pod", () => {
  it("shows flag icon when flaggedForRecreation is true", () => {
    render(
      <SignalGrid
        vms={[makeVM({ flaggedForRecreation: true, flaggedReason: "POOL_CONFIG_CHANGED" })]}
      />
    );
    expect(screen.getByLabelText("Flagged for recreation")).toBeInTheDocument();
  });

  it("shows flag reason text", () => {
    render(
      <SignalGrid
        vms={[makeVM({ flaggedForRecreation: true, flaggedReason: "POOL_CONFIG_CHANGED" })]}
      />
    );
    expect(screen.getByText("POOL_CONFIG_CHANGED")).toBeInTheDocument();
  });

  it("does not show flag icon when flaggedForRecreation is false", () => {
    render(<SignalGrid vms={[makeVM({ flaggedForRecreation: false })]} />);
    expect(screen.queryByLabelText("Flagged for recreation")).not.toBeInTheDocument();
  });
});

// ─── Active pod task context ──────────────────────────────────────────────────

describe("SignalGrid — active pod task context", () => {
  it("shows task title and assignee name for active pod", () => {
    render(
      <SignalGrid
        vms={[
          makeVM({
            state: "running",
            usage_status: "used",
            taskId: "cmmbvimzs000il204ppg1h0h2",
            taskTitle: "Fix auth middleware",
            assigneeName: "Alice Smith",
          }),
        ]}
      />
    );
    expect(screen.getByText("Fix auth middleware")).toBeInTheDocument();
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
  });

  it("shows short task ID (last 8 chars uppercased)", () => {
    render(
      <SignalGrid
        vms={[
          makeVM({
            state: "running",
            usage_status: "used",
            taskId: "cmmbvimzs000il204ppg1h0h2",
            taskTitle: "Fix auth middleware",
          }),
        ]}
      />
    );
    // Last 8 chars of "cmmbvimzs000il204ppg1h0h2" = "g1h0h2" → no, let's check
    // "cmmbvimzs000il204ppg1h0h2".slice(-8).toUpperCase() = "PPG1H0H2"
    expect(screen.getByText("PPG1H0H2")).toBeInTheDocument();
  });

  it("does not show task block for free pod", () => {
    render(
      <SignalGrid
        vms={[
          makeVM({
            state: "running",
            usage_status: "unused",
            taskTitle: "Should not appear",
          }),
        ]}
      />
    );
    expect(screen.queryByText("Should not appear")).not.toBeInTheDocument();
  });
});

// ─── ResourceBar colour thresholds ───────────────────────────────────────────

describe("ResourceBar — colour thresholds", () => {
  it("uses cyan colour at <= 70%", () => {
    render(
      <SignalGrid
        vms={[
          makeVM({
            resource_usage: {
              available: true,
              requests: { cpu: "1000m", memory: "2Gi" },
              usage: { cpu: "500m", memory: "1Gi" }, // 50%
            },
          }),
        ]}
      />
    );
    const bars = screen.getAllByTestId("resource-bar-fill");
    // Both CPU and MEM at 50% → cyan
    bars.forEach((bar) => {
      expect(bar).toHaveAttribute("data-color", "#22d3ee");
    });
  });

  it("uses amber colour at > 70% and <= 85%", () => {
    render(
      <SignalGrid
        vms={[
          makeVM({
            resource_usage: {
              available: true,
              requests: { cpu: "1000m", memory: "1000m" },
              usage: { cpu: "800m", memory: "800m" }, // 80%
            },
          }),
        ]}
      />
    );
    const bars = screen.getAllByTestId("resource-bar-fill");
    bars.forEach((bar) => {
      expect(bar).toHaveAttribute("data-color", "#f59e0b");
    });
  });

  it("uses red colour at > 85%", () => {
    render(
      <SignalGrid
        vms={[
          makeVM({
            resource_usage: {
              available: true,
              requests: { cpu: "1000m", memory: "1000m" },
              usage: { cpu: "900m", memory: "900m" }, // 90%
            },
          }),
        ]}
      />
    );
    const bars = screen.getAllByTestId("resource-bar-fill");
    bars.forEach((bar) => {
      expect(bar).toHaveAttribute("data-color", "#ef4444");
    });
  });
});

// ─── Refresh button ───────────────────────────────────────────────────────────

describe("SignalGrid — refresh button", () => {
  it("calls onRefresh when REFRESH button is clicked", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<SignalGrid vms={[makeVM()]} onRefresh={onRefresh} />);

    await user.click(screen.getByText("REFRESH"));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not render REFRESH button when onRefresh is not provided", () => {
    render(<SignalGrid vms={[makeVM()]} />);
    expect(screen.queryByText("REFRESH")).not.toBeInTheDocument();
  });
});
