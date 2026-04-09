// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
    size,
    "data-testid": testId,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    size?: string;
    "data-testid"?: string;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      data-size={size}
      data-testid={testId}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span data-testid="badge" className={className}>
      {children}
    </span>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({
    value,
    onChange,
    placeholder,
    className,
  }: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    className?: string;
  }) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
    />
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange: (v: string) => void;
  }) => (
    <select
      data-testid="state-filter"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <option value="">{placeholder}</option>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({
    children,
    className,
    onClick,
  }: {
    children: React.ReactNode;
    className?: string;
    onClick?: (e: React.MouseEvent) => void;
  }) => (
    <td className={className} onClick={onClick}>
      {children}
    </td>
  ),
  TableHead: ({
    children,
    className,
    onClick,
  }: {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
  }) => (
    <th className={className} onClick={onClick}>
      {children}
    </th>
  ),
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableRow: ({
    children,
    className,
    onClick,
  }: {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
  }) => (
    <tr className={className} onClick={onClick}>
      {children}
    </tr>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="dialog-mock" role="dialog">
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/app/admin/swarms/CreateSwarmDialog", () => ({
  default: () => null,
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// fetch mock
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstance(overrides: Partial<{
  instanceId: string;
  name: string;
  state: string;
  instanceType: string;
  launchTime: string | null;
  tags: { key: string; value: string }[];
  publicIp: string | null;
  privateIp: string | null;
  hiveWorkspace: { name: string; slug: string } | null;
}> = {}) {
  return {
    instanceId: "i-abc123",
    name: "test-instance",
    state: "running",
    instanceType: "t3.medium",
    launchTime: "2026-01-01T00:00:00Z",
    tags: [{ key: "UserAssignedName", value: "swarm-node-1" }],
    publicIp: "1.2.3.4",
    privateIp: "10.0.0.1",
    hiveWorkspace: null,
    ...overrides,
  };
}

function makeFetchResponse(instances: ReturnType<typeof makeInstance>[]) {
  return {
    ok: true,
    json: async () => instances,
  };
}

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import SwarmsTable from "@/app/admin/swarms/SwarmsTable";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SwarmsTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("running instance", () => {
    it("renders Start (disabled), Stop (enabled), and Update Swarm buttons", async () => {
      mockFetch.mockResolvedValueOnce(makeFetchResponse([makeInstance({ state: "running" })]));

      render(<SwarmsTable />);

      await waitFor(() => expect(screen.getByText("test-instance")).toBeInTheDocument());

      const startBtn = screen.getByRole("button", { name: "Start" });
      const stopBtn = screen.getByRole("button", { name: "Stop" });
      const updateBtn = screen.getByRole("button", { name: "Update Swarm" });

      expect(startBtn).toBeDisabled();
      expect(stopBtn).not.toBeDisabled();
      expect(updateBtn).toBeInTheDocument();
    });
  });

  describe("stopped instance", () => {
    it("renders Start (enabled), Stop (disabled), and no Update Swarm button", async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse([makeInstance({ state: "stopped" })])
      );

      render(<SwarmsTable />);

      await waitFor(() => expect(screen.getByText("test-instance")).toBeInTheDocument());

      const startBtn = screen.getByRole("button", { name: "Start" });
      const stopBtn = screen.getByRole("button", { name: "Stop" });

      expect(startBtn).not.toBeDisabled();
      expect(stopBtn).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Update Swarm" })).toBeNull();
    });
  });

  describe("pending (transitional) instance", () => {
    it("renders Start (disabled) and Stop (disabled)", async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse([makeInstance({ state: "pending" })])
      );

      render(<SwarmsTable />);

      await waitFor(() => expect(screen.getByText("test-instance")).toBeInTheDocument());

      const startBtn = screen.getByRole("button", { name: "Start" });
      const stopBtn = screen.getByRole("button", { name: "Stop" });

      expect(startBtn).toBeDisabled();
      expect(stopBtn).toBeDisabled();
    });
  });

  describe("stopping (transitional) instance", () => {
    it("renders Start (disabled) and Stop (disabled)", async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse([makeInstance({ state: "stopping" })])
      );

      render(<SwarmsTable />);

      await waitFor(() => expect(screen.getByText("test-instance")).toBeInTheDocument());

      const startBtn = screen.getByRole("button", { name: "Start" });
      const stopBtn = screen.getByRole("button", { name: "Stop" });

      expect(startBtn).toBeDisabled();
      expect(stopBtn).toBeDisabled();
    });
  });

  describe("clicking Stop on running instance", () => {
    it("opens confirmation dialog", async () => {
      mockFetch.mockResolvedValueOnce(makeFetchResponse([makeInstance({ state: "running" })]));

      render(<SwarmsTable />);

      await waitFor(() => expect(screen.getByText("test-instance")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: "Stop" }));

      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("clicking Start on stopped instance", () => {
    it("opens confirmation dialog", async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse([makeInstance({ state: "stopped" })])
      );

      render(<SwarmsTable />);

      await waitFor(() => expect(screen.getByText("test-instance")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: "Start" }));

      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("state filter", () => {
    it("renders the state filter with All states, Running, Stopped options", async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse([makeInstance({ state: "running" })])
      );

      render(<SwarmsTable />);

      await waitFor(() => expect(screen.getByText("test-instance")).toBeInTheDocument());

      const select = screen.getByTestId("state-filter") as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.value);
      expect(options).toContain("all");
      expect(options).toContain("running");
      expect(options).toContain("stopped");
    });

    it("shows all instances when 'all' is selected (default)", async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse([
          makeInstance({ instanceId: "i-1", name: "instance-1", state: "running" }),
          makeInstance({ instanceId: "i-2", name: "instance-2", state: "stopped" }),
        ])
      );

      render(<SwarmsTable />);

      await waitFor(() => expect(screen.getByText("instance-1")).toBeInTheDocument());
      expect(screen.getByText("instance-2")).toBeInTheDocument();
    });

    it("filters to only running instances when 'running' is selected", async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse([
          makeInstance({ instanceId: "i-1", name: "instance-running", state: "running" }),
          makeInstance({ instanceId: "i-2", name: "instance-stopped", state: "stopped" }),
        ])
      );

      render(<SwarmsTable />);

      await waitFor(() => expect(screen.getByText("instance-running")).toBeInTheDocument());

      fireEvent.change(screen.getByTestId("state-filter"), { target: { value: "running" } });

      expect(screen.getByText("instance-running")).toBeInTheDocument();
      expect(screen.queryByText("instance-stopped")).toBeNull();
    });

    it("filters to only stopped instances when 'stopped' is selected", async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse([
          makeInstance({ instanceId: "i-1", name: "instance-running", state: "running" }),
          makeInstance({ instanceId: "i-2", name: "instance-stopped", state: "stopped" }),
        ])
      );

      render(<SwarmsTable />);

      await waitFor(() => expect(screen.getByText("instance-running")).toBeInTheDocument());

      fireEvent.change(screen.getByTestId("state-filter"), { target: { value: "stopped" } });

      expect(screen.queryByText("instance-running")).toBeNull();
      expect(screen.getByText("instance-stopped")).toBeInTheDocument();
    });

    it("applies name search and state filter together", async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse([
          makeInstance({ instanceId: "i-1", name: "alpha-running", state: "running" }),
          makeInstance({ instanceId: "i-2", name: "alpha-stopped", state: "stopped" }),
          makeInstance({ instanceId: "i-3", name: "beta-running", state: "running" }),
        ])
      );

      render(<SwarmsTable />);

      await waitFor(() => expect(screen.getByText("alpha-running")).toBeInTheDocument());

      fireEvent.change(screen.getByPlaceholderText("Filter by name…"), {
        target: { value: "alpha" },
      });
      fireEvent.change(screen.getByTestId("state-filter"), { target: { value: "running" } });

      expect(screen.getByText("alpha-running")).toBeInTheDocument();
      expect(screen.queryByText("alpha-stopped")).toBeNull();
      expect(screen.queryByText("beta-running")).toBeNull();
    });

    it("shows empty state message when combined filters yield no results", async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse([
          makeInstance({ instanceId: "i-1", name: "my-instance", state: "running" }),
        ])
      );

      render(<SwarmsTable />);

      await waitFor(() => expect(screen.getByText("my-instance")).toBeInTheDocument());

      fireEvent.change(screen.getByTestId("state-filter"), { target: { value: "stopped" } });

      expect(screen.getByText("No instances match the current filters.")).toBeInTheDocument();
    });
  });

  describe("clicking disabled buttons", () => {
    it("does not open dialog when Start is disabled (running instance)", async () => {
      mockFetch.mockResolvedValueOnce(makeFetchResponse([makeInstance({ state: "running" })]));

      render(<SwarmsTable />);

      await waitFor(() => expect(screen.getByText("test-instance")).toBeInTheDocument());

      const startBtn = screen.getByRole("button", { name: "Start" });
      expect(startBtn).toBeDisabled();
      fireEvent.click(startBtn);

      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("does not open dialog when Stop is disabled (stopped instance)", async () => {
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse([makeInstance({ state: "stopped" })])
      );

      render(<SwarmsTable />);

      await waitFor(() => expect(screen.getByText("test-instance")).toBeInTheDocument());

      const stopBtn = screen.getByRole("button", { name: "Stop" });
      expect(stopBtn).toBeDisabled();
      fireEvent.click(stopBtn);

      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
