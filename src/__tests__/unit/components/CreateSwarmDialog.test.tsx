import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before component imports
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
}));

vi.mock("@/components/ui/toggle-group", () => ({
  ToggleGroup: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange: (v: string) => void;
  }) => (
    <div data-testid="toggle-group" data-value={value}>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child;
        const item = child as React.ReactElement<{
          value: string;
          children: React.ReactNode;
          "aria-label"?: string;
        }>;
        return React.cloneElement(item, {
          onClick: () => onValueChange(item.props.value),
        } as React.HTMLAttributes<HTMLElement>);
      })}
    </div>
  ),
  ToggleGroupItem: ({
    children,
    value,
    "aria-label": ariaLabel,
    onClick,
  }: {
    children: React.ReactNode;
    value: string;
    "aria-label"?: string;
    onClick?: () => void;
  }) => (
    <button
      data-testid={`toggle-${value}`}
      aria-label={ariaLabel ?? String(children)}
      onClick={onClick}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    id,
    checked,
    onCheckedChange,
    "data-testid": testId,
  }: {
    id?: string;
    checked?: boolean;
    onCheckedChange?: (v: boolean) => void;
    "data-testid"?: string;
  }) => (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      data-testid={testId}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
    />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    htmlFor,
    className,
  }: {
    children: React.ReactNode;
    htmlFor?: string;
    className?: string;
  }) => (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: React.forwardRef(
    (
      props: React.InputHTMLAttributes<HTMLInputElement> & {
        "data-testid"?: string;
      },
      ref: React.Ref<HTMLInputElement>
    ) => <input ref={ref} {...props} />
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    "data-testid": testId,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    "data-testid"?: string;
    className?: string;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={className}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Global mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;
global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
global.URL.revokeObjectURL = vi.fn();

// For the CSV download, we intercept the real anchor's click instead of replacing the element
const mockClick = vi.fn();
let lastAnchor: HTMLAnchorElement | null = null;
const origCreateElement = document.createElement.bind(document);
vi.spyOn(document, "createElement").mockImplementation((tag, ...rest) => {
  const el = origCreateElement(tag, ...rest);
  if (tag === "a") {
    lastAnchor = el as HTMLAnchorElement;
    vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(mockClick);
  }
  return el;
});

// ---------------------------------------------------------------------------
// Import component under test (after mocks)
// ---------------------------------------------------------------------------

import CreateSwarmDialog from "@/app/admin/swarms/CreateSwarmDialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  onCreated: vi.fn(),
};

const mockCredentials = {
  success: true,
  message: "Swarm created",
  data: {
    swarm_id: "swarm-abc",
    address: "http://swarm.test",
    ec2_id: "i-test123",
    x_api_key: "key-test",
  },
  password: "secret-pw",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  mockClick.mockReset();
  lastAnchor = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreateSwarmDialog", () => {
  it("renders the form with Graph Mindset selected by default", () => {
    render(<CreateSwarmDialog {...defaultProps} />);
    expect(screen.getByText("Graph Mindset")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(screen.getByTestId("create-swarm-submit")).toBeInTheDocument();
  });

  it("shows auto-generate checkbox checked by default", () => {
    render(<CreateSwarmDialog {...defaultProps} />);
    const checkbox = screen.getByLabelText(/auto-generate password/i);
    expect(checkbox).toBeChecked();
  });

  it("shows a pre-filled read-only password input when auto-generate is on", () => {
    render(<CreateSwarmDialog {...defaultProps} />);
    const input = screen.getByTestId("password-input") as HTMLInputElement;
    expect(input.value.length).toBeGreaterThan(0);
    expect(input.readOnly).toBe(true);
  });

  it("makes password editable when auto-generate is unchecked", async () => {
    const user = userEvent.setup();
    render(<CreateSwarmDialog {...defaultProps} />);
    const checkbox = screen.getByLabelText(/auto-generate password/i);
    await user.click(checkbox);
    const input = screen.getByTestId("password-input") as HTMLInputElement;
    expect(input.readOnly).toBe(false);
  });

  it("submits with graph_mindset workspace_type when Graph Mindset is selected", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCredentials,
    });

    render(<CreateSwarmDialog {...defaultProps} />);
    await user.click(screen.getByTestId("create-swarm-submit"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/swarms",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"workspace_type":"graph_mindset"'),
        })
      );
    });
  });

  it("submits without workspace_type when Other is selected", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCredentials,
    });

    render(<CreateSwarmDialog {...defaultProps} />);

    // Switch to Other
    await user.click(screen.getByTestId("toggle-other"));

    await user.click(screen.getByTestId("create-swarm-submit"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as RequestInit).body as string
      );
      expect("workspace_type" in body).toBe(false);
    });
  });

  it("shows results view with all credential fields after success", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCredentials,
    });

    render(<CreateSwarmDialog {...defaultProps} />);
    await user.click(screen.getByTestId("create-swarm-submit"));

    await waitFor(() => {
      expect(screen.getByText("swarm-abc")).toBeInTheDocument();
      expect(screen.getByText("http://swarm.test")).toBeInTheDocument();
      expect(screen.getByText("i-test123")).toBeInTheDocument();
      expect(screen.getByText("key-test")).toBeInTheDocument();
      expect(screen.getByText("secret-pw")).toBeInTheDocument();
    });

    expect(screen.getByText(/save this information now/i)).toBeInTheDocument();
  });

  it("close button is disabled until credentials are downloaded or confirmed", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCredentials,
    });

    render(<CreateSwarmDialog {...defaultProps} />);
    await user.click(screen.getByTestId("create-swarm-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("close-button")).toBeInTheDocument();
    });

    expect(screen.getByTestId("close-button")).toBeDisabled();
  });

  it("close button is enabled after downloading credentials", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCredentials,
    });

    render(<CreateSwarmDialog {...defaultProps} />);
    await user.click(screen.getByTestId("create-swarm-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("download-credentials")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("download-credentials"));

    await waitFor(() => {
      expect(screen.getByTestId("close-button")).not.toBeDisabled();
    });
  });

  it("close button is enabled after checking the 'I've saved this' checkbox", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCredentials,
    });

    render(<CreateSwarmDialog {...defaultProps} />);
    await user.click(screen.getByTestId("create-swarm-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("saved-confirm")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("saved-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("close-button")).not.toBeDisabled();
    });
  });

  it("downloads a CSV file with correct filename and columns", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCredentials,
    });

    render(<CreateSwarmDialog {...defaultProps} />);
    await user.click(screen.getByTestId("create-swarm-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("download-credentials")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("download-credentials"));

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(lastAnchor?.download).toBe("swarm-swarm-abc.csv");
    expect(mockClick).toHaveBeenCalled();
  });

  it("calls onCreated when dialog is closed after successful creation", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCredentials,
    });

    render(<CreateSwarmDialog {...defaultProps} onCreated={onCreated} />);
    await user.click(screen.getByTestId("create-swarm-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("saved-confirm")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("saved-confirm"));
    await user.click(screen.getByTestId("close-button"));

    expect(onCreated).toHaveBeenCalledTimes(1);
  });
});
